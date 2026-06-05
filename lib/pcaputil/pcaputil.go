package pcaputil

import (
	"context"
	"encoding/binary"
	"errors"
	"fmt"
	"net"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"
	"unsafe"

	"github.com/gopacket/gopacket/pcap"
	"github.com/irusan-fanclub/mabidilmeter/lib/constants"
	"github.com/irusan-fanclub/mabidilmeter/lib/packet"
	"github.com/irusan-fanclub/mabidilmeter/lib/util"
	"golang.org/x/sys/windows"
)

var logger = util.NewLogger("pcaputil")

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

// ClientConnection describes a single Client.exe ESTABLISHED TCP
// connection along with the pcap NIC name that owns its local IP.
type ClientConnection struct {
	NicName      string
	FriendlyName string
	ServerIP     string
	ServerPort   string
	LocalPort    string
}

// nicCache memoizes interface mappings — they are queried by every
// watchdog poll but never change for the process lifetime in practice
// (NICs aren't hot-swapped while the meter is running).
var (
	nicCacheOnce        sync.Once
	cachedInterfaceMap  map[string]string
	cachedInterfaceNicMap map[string]string
)

// lastPickedNic remembers the device a brute-force probe last succeeded on.
// On a PPPoE setup the connection's local IP belongs to a WAN-Miniport
// adapter npcap can't capture on, so FindNic has to probe physical devices;
// caching the winner lets subsequent channel-switch re-discoveries try the
// known-good device first instead of paying the full per-device timeout
// sweep every time.
var (
	lastPickedNicMu sync.Mutex
	lastPickedNic   string
)

func setLastPickedNic(name string) {
	lastPickedNicMu.Lock()
	lastPickedNic = name
	lastPickedNicMu.Unlock()
}

func getLastPickedNic() string {
	lastPickedNicMu.Lock()
	defer lastPickedNicMu.Unlock()
	return lastPickedNic
}

// orderCandidates returns devs with preferred moved to the front. A preferred
// value that is empty or absent from devs is ignored, so a stale cached NIC is
// never probed for a device that no longer exists.
func orderCandidates(preferred string, devs []string) []string {
	if preferred == "" {
		return devs
	}
	ordered := make([]string, 0, len(devs))
	found := false
	for _, d := range devs {
		if d == preferred {
			found = true
			continue
		}
		ordered = append(ordered, d)
	}
	if !found {
		return devs
	}
	return append([]string{preferred}, ordered...)
}

// allDeviceNames returns every capturable npcap device name.
func allDeviceNames() ([]string, error) {
	devs, err := pcap.FindAllDevs()
	if err != nil {
		return nil, err
	}
	names := make([]string, 0, len(devs))
	for _, d := range devs {
		names = append(names, d.Name)
	}
	return names, nil
}

func ensureNicCache() {
	nicCacheOnce.Do(func() {
		cachedInterfaceMap = buildInterfaceMap()
		cachedInterfaceNicMap = buildInterfaceNicMap()

		names := make([]string, 0, len(cachedInterfaceNicMap))
		maxWidth := 0
		for friendly := range cachedInterfaceNicMap {
			names = append(names, friendly)
			if w := displayWidth(friendly); w > maxWidth {
				maxWidth = w
			}
		}
		sort.Strings(names)

		logger.Printf("NIC list (%d):", len(names))
		idxWidth := len(strconv.Itoa(len(names)))
		for i, friendly := range names {
			pad := maxWidth - displayWidth(friendly)
			logger.Printf("  [%*d] %s%s  %s", idxWidth, i+1, friendly, strings.Repeat(" ", pad), cachedInterfaceNicMap[friendly])
		}
	})
}

// displayWidth returns the column width of s in a monospaced font,
// counting East Asian Wide / Fullwidth runes as 2 columns. Used to
// align mixed-script names (English NIC names alongside 中文 / 한국어
// labels) in log output.
func displayWidth(s string) int {
	w := 0
	for _, r := range s {
		if isWideRune(r) {
			w += 2
		} else {
			w += 1
		}
	}
	return w
}

func isWideRune(r rune) bool {
	switch {
	case r >= 0x1100 && r <= 0x115F, // Hangul Jamo
		r >= 0x2E80 && r <= 0x303E,    // CJK Radicals / Symbols
		r >= 0x3041 && r <= 0x33FF,    // Hiragana / Katakana / CJK symbols
		r >= 0x3400 && r <= 0x4DBF,    // CJK Extension A
		r >= 0x4E00 && r <= 0x9FFF,    // CJK Unified Ideographs
		r >= 0xA000 && r <= 0xA4CF,    // Yi
		r >= 0xAC00 && r <= 0xD7A3,    // Hangul Syllables
		r >= 0xF900 && r <= 0xFAFF,    // CJK Compatibility Ideographs
		r >= 0xFE30 && r <= 0xFE4F,    // CJK Compatibility Forms
		r >= 0xFF00 && r <= 0xFF60,    // Fullwidth Forms
		r >= 0xFFE0 && r <= 0xFFE6,    // Fullwidth signs
		r >= 0x20000 && r <= 0x2FFFD,  // CJK Extensions B-F
		r >= 0x30000 && r <= 0x3FFFD:  // CJK Extension G
		return true
	}
	return false
}

// PollClientConnections enumerates all currently ESTABLISHED Client.exe
// TCP connections and resolves each to a pcap NIC. No filter is applied
// and no packets are read — this is a fast, side-effect-free probe.
func PollClientConnections() ([]ClientConnection, error) {
	rows, err := getTCPRows()
	if err != nil {
		return nil, err
	}

	// First pass: filter ESTABLISHED rows owned by Client.exe. If none,
	// the game isn't running — return early without enumerating NICs
	// (which logs the full list on first call). Watchdog calls this
	// every 3s while idle, so the fast-exit matters.
	type rawConn struct {
		localIP    string
		remoteIP   string
		remotePort uint32
		localPort  uint32
	}
	var raw []rawConn
	for _, row := range rows {
		if row.State != 5 {
			continue
		}
		name, err := processName(row.OwningPID)
		if err != nil || !strings.EqualFold(name, "Client.exe") {
			continue
		}
		raw = append(raw, rawConn{
			localIP:    ipv4FromDWORD(row.LocalAddr).String(),
			remoteIP:   ipv4FromDWORD(row.RemoteAddr).String(),
			remotePort: row.RemotePort,
			localPort:  row.LocalPort,
		})
	}
	if len(raw) == 0 {
		return nil, nil
	}

	ensureNicCache()
	ifaceMap := cachedInterfaceMap
	nicMap := cachedInterfaceNicMap

	var conns []ClientConnection
	for _, r := range raw {
		// Both lookups are best-effort. On a PPPoE setup the local IP belongs
		// to a WAN-Miniport adapter: ifaceMap resolves it to a friendly name
		// (e.g. "寬頻網路") but nicMap has no npcap device for it, since npcap
		// captures on the underlying physical NIC, not the virtual dial-up
		// one. We must still surface the connection (NicName empty) so the
		// watchdog sees the game is running and FindNic can probe devices.
		friendlyName := ifaceMap[r.localIP]
		nicName := nicMap[friendlyName]
		conns = append(conns, ClientConnection{
			NicName:      nicName,
			FriendlyName: friendlyName,
			ServerIP:     r.remoteIP,
			ServerPort:   fmt.Sprintf("%d", portFromDWORD(r.remotePort)),
			LocalPort:    fmt.Sprintf("%d", portFromDWORD(r.localPort)),
		})
	}

	return conns, nil
}

// ApplyConnectionFilter updates the global BPF filter to match the
// given connection. Subsequent NewGameServerPacketReader calls will pick
// up the new filter. Logging is left to the caller (FindNic only logs
// the final successful triple).
func ApplyConnectionFilter(c ClientConnection) {
	constants.ServerIP = c.ServerIP
	constants.ServerSrcPort = c.ServerPort
	constants.ServerDstPort = c.LocalPort
	constants.RebuildFilter()
}

func FindNic() (string, error) {
	conns, err := PollClientConnections()
	if err != nil {
		logger.Println("PollClientConnections failed:", err)
		return "", err
	}

	if len(conns) == 0 {
		return "", errors.New("no Client.exe network connections found")
	}

	// Snapshot the current filter so we can restore it if every
	// candidate fails — otherwise constants.* would be left pointing at
	// the last (wrong) candidate, and the watchdog's "alive" check would
	// match it on the next poll.
	savedIP := constants.ServerIP
	savedSrcPort := constants.ServerSrcPort
	savedDstPort := constants.ServerDstPort

	// Test high server-side ports first. Login / patch / lobby servers
	// tend to use lower well-known ports (e.g. 11020), while game shards
	// listen on larger ports (e.g. 11022, 59062). Trying the larger
	// candidates first usually picks the actual game connection on the
	// first attempt and avoids the 3-second per-candidate timeout we'd
	// otherwise pay on the login connection.
	sort.SliceStable(conns, func(i, j int) bool {
		pi, _ := strconv.Atoi(conns[i].ServerPort)
		pj, _ := strconv.Atoi(conns[j].ServerPort)
		return pi > pj
	})

	logger.Printf("Testing %d Client.exe connection(s):", len(conns))
	maxRemote := 0
	for _, c := range conns {
		if w := len(c.ServerIP) + 1 + len(c.ServerPort); w > maxRemote {
			maxRemote = w
		}
	}
	for i, c := range conns {
		remote := fmt.Sprintf("%s:%s", c.ServerIP, c.ServerPort)
		logger.Printf("  [%d] %-*s -> :%-5s  %s", i+1, maxRemote, remote, c.LocalPort, c.FriendlyName)
	}

	for _, c := range conns {
		ApplyConnectionFilter(c)

		// When the connection mapped to a specific npcap device, test only
		// that one. When it didn't (PPPoE / WAN-Miniport local IP), we don't
		// know which physical NIC carries the traffic, so probe every device
		// — cached known-good device first to keep channel-switch
		// re-discovery fast.
		var candidates []string
		if c.NicName != "" {
			candidates = []string{c.NicName}
		} else {
			devs, err := allDeviceNames()
			if err != nil {
				logger.Println("FindNic: enumerate devices failed:", err)
				continue
			}
			candidates = orderCandidates(getLastPickedNic(), devs)
			logger.Printf("  %s:%s has no mapped NIC (PPPoE?); probing %d device(s)",
				c.ServerIP, c.ServerPort, len(candidates))
		}

		for _, nic := range candidates {
			if testNicForPackets(nic) {
				if c.NicName == "" {
					setLastPickedNic(nic)
				}
				logger.Printf("Picked NIC %s (%s) -> %s:%s",
					nic, c.FriendlyName, c.ServerIP, c.ServerPort)
				return nic, nil
			}
		}
	}

	constants.ServerIP = savedIP
	constants.ServerSrcPort = savedSrcPort
	constants.ServerDstPort = savedDstPort
	constants.RebuildFilter()

	return "", errors.New("no game packets found on any Client.exe connection")
}

func testNicForPackets(nicName string) bool {
	packetWaitTime := time.Second * 3

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	r, err := packet.NewGameServerPacketReader(&packet.GameServerPacketReaderOpt{
		Ctx:     ctx,
		NicName: nicName,
		Quiet:   true,
	})

	if err != nil {
		return false
	}
	defer r.Close()

	select {
	case <-time.After(packetWaitTime):
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

func buildInterfaceNicMap() map[string]string {
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

func buildInterfaceMap() map[string]string {
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
