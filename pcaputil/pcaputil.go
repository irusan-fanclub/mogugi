package pcaputil

import (
	"context"
	"errors"
	"log"
	"os"
	"time"

	"github.com/gopacket/gopacket/pcap"
	"gitlab.com/prilus/mabidilmeter/packet"
)

var logger = log.New(os.Stdout, "pcaputil ", log.LstdFlags|log.Lshortfile)

func FindNic() (string, error) {
	// Find the network interface where game server packets are received.
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
