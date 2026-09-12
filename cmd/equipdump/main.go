// throwaway: replay a pcapng and dump every packet that touches an owner
// inventory item (matched by ItemEID) or an equip/unequip opcode.
package main

import (
	"context"
	"encoding/hex"
	"fmt"
	"os"
	"time"

	"github.com/irusan-fanclub/mogugi/lib/packet"
)

const opItemRecordSingle packet.OpCode = 0x5BD4

func main() {
	if len(os.Args) < 2 {
		fmt.Fprintln(os.Stderr, "usage: equipdump <capture.pcapng>")
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
	go func() { time.Sleep(90 * time.Second); os.Exit(0) }()

	known := map[uint64]uint32{} // ItemEID -> item id
	var t0 time.Time
	for p := range r.PacketCh() {
		if t0.IsZero() {
			t0 = p.At
		}
		if p.Op == packet.OpcodeChannelCharacterInfoR {
			snap, err := packet.ParseEntitySnapshot(p.Msg)
			if err != nil {
				continue
			}
			for _, it := range snap.Items {
				known[it.EID] = it.ItemID
			}
			fmt.Printf("%8.3fs 0x5209 id=%d %q: %d items, %d eids known\n",
				p.At.Sub(t0).Seconds(), snap.Id, snap.Name, len(snap.Items), len(known))
			continue
		}
		hit := p.Op == packet.OpcodeEquipmentChanged || p.Op == packet.OpcodeUnequipment || p.Op == opItemRecordSingle
		for _, e := range p.Msg {
			if v, ok := e.Data().(uint64); ok && e.Type() == packet.MessageElemTypeLong {
				if _, seen := known[v]; seen {
					hit = true
					break
				}
			}
		}
		if !hit {
			continue
		}
		fmt.Printf("\n%8.3fs op=%s(0x%04X) id=%d elems=%d\n",
			p.At.Sub(t0).Seconds(), p.Op, uint32(p.Op), p.Id, len(p.Msg))
		for i, e := range p.Msg {
			if i >= 16 {
				fmt.Println("  ...")
				break
			}
			switch d := e.Data().(type) {
			case string:
				fmt.Printf("  [%2d] String %q\n", i, d)
			case []byte:
				fmt.Printf("  [%2d] Bin len=%d %s\n", i, len(d), hex.EncodeToString(d))
			case uint64:
				tag := ""
				if id, ok := known[d]; ok {
					tag = fmt.Sprintf("  <- item %d", id)
				}
				fmt.Printf("  [%2d] Long %d%s\n", i, d, tag)
			default:
				fmt.Printf("  [%2d] %T %v\n", i, d, d)
			}
		}
	}
}
