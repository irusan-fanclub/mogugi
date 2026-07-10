// throwaway: replay a pcapng and dump every 0x5209 element sequence (full hex).
package main

import (
	"context"
	"encoding/hex"
	"fmt"
	"os"
	"time"

	"github.com/irusan-fanclub/mabidilmeter/lib/packet"
)

func main() {
	if len(os.Args) < 2 {
		fmt.Fprintln(os.Stderr, "usage: itemdump <capture.pcapng>")
		os.Exit(2)
	}
	file := os.Args[1]
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	r, err := packet.NewGameServerPacketReader(&packet.GameServerPacketReaderOpt{
		Ctx: ctx, FileName: file, Quiet: true,
	})
	if err != nil {
		panic(err)
	}

	names := map[packet.MessageElemType]string{
		packet.MessageElemTypeByte: "Byte", packet.MessageElemTypeShort: "Short",
		packet.MessageElemTypeInt: "Int", packet.MessageElemTypeLong: "Long",
		packet.MessageElemTypeFloat: "Float", packet.MessageElemTypeString: "String",
		packet.MessageElemTypeBin: "Bin",
	}

	go func() { time.Sleep(70 * time.Second); os.Exit(0) }()

	n := 0
	for p := range r.PacketCh() {
		if p.Op != packet.OpcodeChannelCharacterInfoR {
			continue
		}
		n++
		fmt.Printf("\n########## 0x5209 #%d  (%d elements) ##########\n", n, len(p.Msg))
		for i, e := range p.Msg {
			tn := names[e.Type()]
			switch e.Type() {
			case packet.MessageElemTypeString:
				s, _ := e.Data().(string)
				fmt.Printf("[%3d] %-6s %q\n", i, tn, s)
			case packet.MessageElemTypeBin:
				d, _ := e.Data().([]byte)
				fmt.Printf("[%3d] %-6s len=%d %s\n", i, tn, len(d), hex.EncodeToString(d))
			default:
				fmt.Printf("[%3d] %-6s %v\n", i, tn, e.Data())
			}
		}
	}
}
