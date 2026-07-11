// throwaway: replay a pcapng and print every packet's opcode + brief args.
package main

import (
	"context"
	"fmt"
	"os"
	"time"

	"github.com/irusan-fanclub/mogugi/lib/packet"
)

func main() {
	if len(os.Args) < 2 {
		fmt.Fprintln(os.Stderr, "usage: opdump <capture.pcapng>")
		os.Exit(2)
	}
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	r, err := packet.NewGameServerPacketReader(&packet.GameServerPacketReaderOpt{
		Ctx: ctx, FileName: os.Args[1], Quiet: true,
	})
	if err != nil {
		panic(err)
	}
	go func() { time.Sleep(50 * time.Second); os.Exit(0) }()
	for p := range r.PacketCh() {
		if p.IsShortPacket {
			continue
		}
		// brief: op, id, first few elems
		s := fmt.Sprintf("%s op=0x%04X id=%d n=%d", p.At.Format("15:04:05.000"), p.Op, p.Id, len(p.Msg))
		for i, e := range p.Msg {
			if i >= 6 {
				s += " ..."
				break
			}
			switch d := e.Data().(type) {
			case string:
				if len(d) > 24 {
					d = d[:24] + "…"
				}
				s += fmt.Sprintf(" %q", d)
			case []byte:
				s += fmt.Sprintf(" bin(%d)", len(d))
			default:
				s += fmt.Sprintf(" %v", d)
			}
		}
		fmt.Println(s)
	}
}
