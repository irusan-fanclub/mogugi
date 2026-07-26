package packet

import "fmt"

// BankTab is one per-character tab in the bank list.
type BankTab struct {
	Owner    string
	Declared uint32
	Items    []InventoryItem
}

// BankList is one 0x7212 packet: a single race page of the account bank.
type BankList struct {
	Page       uint8
	Account    string
	Branch     string
	BranchName string
	Gold       uint64
	Tabs       []BankTab
}

// ParseBankListPacket parses a 0x7212 race page. Item Container carries the
// per-item branch code; Qty is normalized to >= 1 like the beauty room.
func ParseBankListPacket(msg Message) (*BankList, error) {
	if len(msg) < 9 ||
		msg[0].Type() != MessageElemTypeByte ||
		msg[1].Type() != MessageElemTypeByte ||
		msg[2].Type() != MessageElemTypeLong ||
		msg[3].Type() != MessageElemTypeByte ||
		msg[4].Type() != MessageElemTypeString ||
		msg[5].Type() != MessageElemTypeString ||
		msg[6].Type() != MessageElemTypeString ||
		msg[7].Type() != MessageElemTypeLong ||
		msg[8].Type() != MessageElemTypeInt {
		return nil, fmt.Errorf("bank list: unexpected header shape (n=%d)", len(msg))
	}
	b := &BankList{}
	page, _ := msg[1].Data().(uint8)
	b.Page = page
	b.Account, _ = msg[4].Data().(string)
	b.Branch, _ = msg[5].Data().(string)
	b.BranchName, _ = msg[6].Data().(string)
	b.Gold, _ = msg[7].Data().(uint64)

	// Tab headers: String, Byte, Int, Int(12), Int(8), Int(count).
	starts := []int{}
	for i := 9; i+5 < len(msg); i++ {
		if msg[i].Type() != MessageElemTypeString ||
			msg[i+1].Type() != MessageElemTypeByte ||
			msg[i+2].Type() != MessageElemTypeInt ||
			msg[i+3].Type() != MessageElemTypeInt ||
			msg[i+4].Type() != MessageElemTypeInt ||
			msg[i+5].Type() != MessageElemTypeInt {
			continue
		}
		w, _ := msg[i+3].Data().(uint32)
		h, _ := msg[i+4].Data().(uint32)
		if w == 12 && h == 8 {
			starts = append(starts, i)
		}
	}
	for k, start := range starts {
		end := len(msg)
		if k+1 < len(starts) {
			end = starts[k+1]
		}
		tab := BankTab{Items: []InventoryItem{}}
		tab.Owner, _ = msg[start].Data().(string)
		tab.Declared, _ = msg[start+5].Data().(uint32)
		for i := start + 6; i+2 < end; i++ {
			it, _, ok := parseItemAt(msg, i)
			if !ok {
				continue
			}
			// Branch code sits 3 elements before the item anchor.
			if i-3 >= start+6 && msg[i-3].Type() == MessageElemTypeString {
				it.Container, _ = msg[i-3].Data().(string)
			}
			if it.Qty == 0 {
				it.Qty = 1
			}
			tab.Items = append(tab.Items, it)
		}
		b.Tabs = append(b.Tabs, tab)
	}
	return b, nil
}
