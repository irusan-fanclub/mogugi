package pcaputil

import (
	"context"
	"encoding/binary"
	"errors"
	"fmt"
	"log"
	"net"
	"os"
	"path/filepath"
	"strings"
	"time"
	"unsafe"

	"github.com/gopacket/gopacket/pcap"
	"gitlab.com/prilus/mabidilmeter/packet"
	"golang.org/x/sys/windows"
)

var logger = log.New(os.Stdout, "pcaputil ", log.LstdFlags|log.Lshortfile)

const (
	afInet                 = 2
	afUnspec               = 0
	tcpTableOwnerPIDAll    = 5
	processQueryLimitedInf = 0x1000
)

var (
	iphlpapiDLL             = windows.NewLazySystemDLL("iphlpapi.dll")
	procGetExtendedTcpTable = iphlpapiDLL.NewProc("GetExtendedTcpTable")
)

type mibTCPRowOwnerPID struct {
	State      uint32
	LocalAddr  uint32
	LocalPort  uint32
	RemoteAddr uint32
	RemotePort uint32
	OwningPID  uint32
}

type mibTCPTableOwnerPID struct {
	NumEntries uint32
	Table      [1]mibTCPRowOwnerPID
}

func FindNic() (string, error) {
	// Find the network interface where Client.exe has TCP connections
	// by scanning Client.exe TCP connections and testing each network interface

	rows, err := getTCPRows()
	if err != nil {
		logger.Println("getTCPRows failed:", err)
		return "", err
	}

	ifaceMap := getInterfaceMap()
	nicMap := getInterfaceNicMap()

	// Collect unique network interfaces where Client.exe has connections
	nicsToTest := make(map[string]bool)

	for _, row := range rows {
		// Skip non-ESTABLISHED connections
		if row.State != 5 { // TCP_ESTABLISHED = 5
			continue
		}

		// Check if this connection belongs to Client.exe
		name, err := processName(row.OwningPID)
		if err != nil || !strings.EqualFold(name, "Client.exe") {
			continue
		}

		localIP := ipv4FromDWORD(row.LocalAddr)
		remoteIP := ipv4FromDWORD(row.RemoteAddr)
		remotePort := portFromDWORD(row.RemotePort)

		logger.Printf("Found Client.exe connection: %s -> %s:%d (PID: %d)",
			localIP.String(), remoteIP.String(), remotePort, row.OwningPID)

		// Get friendly interface name from local IP
		if friendlyName, ok := ifaceMap[localIP.String()]; ok {
			logger.Printf("  Interface: %s", friendlyName)
			nicsToTest[friendlyName] = true
		}
	}

	// Test each network interface in order
	if len(nicsToTest) > 0 {
		logger.Printf("Testing %d network interface(s) with Client.exe connections...", len(nicsToTest))

		for friendlyName := range nicsToTest {
			nicName, ok := nicMap[friendlyName]
			if !ok {
				logger.Printf("Warning: Could not map friendly name '%s' to NIC name", friendlyName)
				continue
			}

			logger.Printf("Testing NIC: %s (%s)", nicName, friendlyName)
			if found := testNicForPackets(nicName); found {
				logger.Printf("Success: Found game packets on %s", nicName)
				return nicName, nil
			}
		}
	}

	// Fallback: try all NICs if none of the Client.exe NICs worked
	logger.Println("No game packets found on Client.exe network interfaces, falling back to all NICs...")
	return findNicByPackets()
}

func testNicForPackets(nicName string) bool {
	packetWaitTime := time.Second * 3

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	r, err := packet.NewGameServerPacketReader(&packet.GameServerPacketReaderOpt{
		Ctx:     ctx,
		NicName: nicName,
	})

	if err != nil {
		logger.Printf("  Error opening NIC %s: %v", nicName, err)
		return false
	}
	defer r.Close()

	select {
	case <-time.After(packetWaitTime):
		logger.Printf("  Timeout on %s", nicName)
		return false

	case <-r.PacketCh():
		return true
	}
}

func processName(pid uint32) (string, error) {
	h, err := windows.OpenProcess(processQueryLimitedInf, false, pid)
	if err != nil {
		return "", err
	}
	defer windows.CloseHandle(h)

	buf := make([]uint16, windows.MAX_PATH)
	size := uint32(len(buf))
	if err := windows.QueryFullProcessImageName(h, 0, &buf[0], &size); err != nil {
		return "", err
	}

	full := windows.UTF16ToString(buf[:size])
	return filepath.Base(full), nil
}

func getInterfaceNicMap() map[string]string {
	// Create a mapping from friendly interface names to pcap NIC names
	result := map[string]string{}

	nics, err := pcap.FindAllDevs()
	if err != nil {
		logger.Println("pcap.FindAllDevs failed:", err)
		return result
	}

	// Get Windows adapter addresses
	var size uint32
	_ = windows.GetAdaptersAddresses(afUnspec, windows.GAA_FLAG_INCLUDE_PREFIX, 0, nil, &size)
	if size == 0 {
		return result
	}

	buf := make([]byte, size)
	addr := (*windows.IpAdapterAddresses)(unsafe.Pointer(&buf[0]))
	if err := windows.GetAdaptersAddresses(afUnspec, windows.GAA_FLAG_INCLUDE_PREFIX, 0, addr, &size); err != nil {
		return result
	}

	// Build a map of IP -> (friendly name, GUID)
	ipToAdapter := make(map[string]*windows.IpAdapterAddresses)
	for a := addr; a != nil; a = a.Next {
		for u := a.FirstUnicastAddress; u != nil; u = u.Next {
			ip := sockaddrToIP(u.Address)
			if ip != nil {
				ipToAdapter[ip.String()] = a
			}
		}
	}

	// Match each NIC to a friendly name based on IP
	for _, nic := range nics {
		if len(nic.Addresses) > 0 {
			for _, addr := range nic.Addresses {
				if adapter, ok := ipToAdapter[addr.IP.String()]; ok {
					friendlyName := windows.UTF16PtrToString(adapter.FriendlyName)
					result[friendlyName] = nic.Name
					logger.Printf("Mapped friendly name '%s' to NIC '%s'",
						friendlyName, nic.Name)
					break
				}
			}
		}
	}

	return result
}

func findNicByPackets() (string, error) {
	// Original implementation: try each NIC until we find game server packets
	packetWaitTime := time.Second * 5

	nics, err := pcap.FindAllDevs()
	if err != nil {
		logger.Println(err)
		return "", err
	}

	found := ""
	for _, nic := range nics {
		ctx, cancel := context.WithCancel(context.Background())

		r, err := packet.NewGameServerPacketReader(&packet.GameServerPacketReaderOpt{
			Ctx:     ctx,
			NicName: nic.Name,
		})

		if err != nil {
			logger.Println("findNic failed", err, nic.Name)
			cancel()
			continue
		}

		select {
		case <-time.After(packetWaitTime):
			logger.Println("findNic timeout", nic.Name)

		case <-r.PacketCh():
			found = nic.Name
			logger.Println("findNic success", nic.Name)
		}

		cancel()
		r.Close()
	}

	if found == "" {
		err := errors.New("findNic failed: not found")
		logger.Println(err)
		return "", err
	}

	logger.Println("findNic success:", found)
	return found, nil
}

func getTCPRows() ([]mibTCPRowOwnerPID, error) {
	var size uint32
	_ = getExtendedTcpTable(nil, &size, false, afInet, tcpTableOwnerPIDAll, 0)
	if size == 0 {
		return nil, fmt.Errorf("empty table size")
	}

	buf := make([]byte, size)
	if err := getExtendedTcpTable(&buf[0], &size, false, afInet, tcpTableOwnerPIDAll, 0); err != nil {
		return nil, err
	}

	table := (*mibTCPTableOwnerPID)(unsafe.Pointer(&buf[0]))
	rows := make([]mibTCPRowOwnerPID, 0, table.NumEntries)
	first := unsafe.Pointer(&table.Table[0])
	rowSize := unsafe.Sizeof(table.Table[0])

	for i := uint32(0); i < table.NumEntries; i++ {
		row := *(*mibTCPRowOwnerPID)(unsafe.Pointer(uintptr(first) + uintptr(i)*rowSize))
		rows = append(rows, row)
	}

	return rows, nil
}

func getExtendedTcpTable(table *byte, size *uint32, order bool, af uint32, tableClass uint32, reserved uint32) error {
	if err := iphlpapiDLL.Load(); err != nil {
		return err
	}

	var orderFlag uintptr
	if order {
		orderFlag = 1
	}

	r1, _, _ := procGetExtendedTcpTable.Call(
		uintptr(unsafe.Pointer(table)),
		uintptr(unsafe.Pointer(size)),
		orderFlag,
		uintptr(af),
		uintptr(tableClass),
		uintptr(reserved),
	)

	if r1 == 0 {
		return nil
	}

	if r1 == uintptr(windows.ERROR_INSUFFICIENT_BUFFER) {
		return windows.ERROR_INSUFFICIENT_BUFFER
	}

	return windows.Errno(r1)
}

func ipv4FromDWORD(addr uint32) net.IP {
	return net.IPv4(byte(addr), byte(addr>>8), byte(addr>>16), byte(addr>>24))
}

func portFromDWORD(port uint32) int {
	b := (*[2]byte)(unsafe.Pointer(&port))
	return int(binary.BigEndian.Uint16(b[:]))
}

func getInterfaceMap() map[string]string {
	result := map[string]string{}

	var size uint32
	_ = windows.GetAdaptersAddresses(afUnspec, windows.GAA_FLAG_INCLUDE_PREFIX, 0, nil, &size)
	if size == 0 {
		return result
	}

	buf := make([]byte, size)
	addr := (*windows.IpAdapterAddresses)(unsafe.Pointer(&buf[0]))
	if err := windows.GetAdaptersAddresses(afUnspec, windows.GAA_FLAG_INCLUDE_PREFIX, 0, addr, &size); err != nil {
		return result
	}

	for a := addr; a != nil; a = a.Next {
		name := windows.UTF16PtrToString(a.FriendlyName)
		for u := a.FirstUnicastAddress; u != nil; u = u.Next {
			ip := sockaddrToIP(u.Address)
			if ip == nil {
				continue
			}
			result[ip.String()] = name
		}
	}

	return result
}

func sockaddrToIP(sa windows.SocketAddress) net.IP {
	if sa.Sockaddr == nil {
		return nil
	}

	switch sa.Sockaddr.Addr.Family {
	case windows.AF_INET:
		sa4 := (*windows.RawSockaddrInet4)(unsafe.Pointer(sa.Sockaddr))
		return net.IPv4(sa4.Addr[0], sa4.Addr[1], sa4.Addr[2], sa4.Addr[3])
	case windows.AF_INET6:
		sa6 := (*windows.RawSockaddrInet6)(unsafe.Pointer(sa.Sockaddr))
		return net.IP(sa6.Addr[:])
	default:
		return nil
	}
}
