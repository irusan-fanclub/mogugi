package packet

import "testing"

func TestParseItemInfo(t *testing.T) {
	info := make([]byte, 80)
	le.PutUint32(info[0:], 2)     // rec_type = main
	le.PutUint32(info[4:], 40026) // ItemId
	le.PutUint32(info[36:], 5)    // Quantity
	le.PutUint32(info[44:], 3)    // PosX
	le.PutUint32(info[48:], 1)    // PosY

	got, err := parseItemInfo(info)
	if err != nil {
		t.Fatalf("parseItemInfo: %v", err)
	}
	// InventoryItem 含 slice，不能直接 ==；逐欄比對 parseItemInfo 會填的欄位。
	if got.ItemID != 40026 || got.Qty != 5 || got.Container != "main" || got.PosX != 3 || got.PosY != 1 {
		t.Fatalf("got %+v", got)
	}
}

func TestParseItemInfo_ContainerMapping(t *testing.T) {
	cases := map[uint32]string{2: "main", 20: "pet_equip", 86: "pet_bag", 100: "pet_subbag", 101: "pet_subbag", 999: "unknown"}
	for rec, want := range cases {
		info := make([]byte, 80)
		le.PutUint32(info[0:], rec)
		got, err := parseItemInfo(info)
		if err != nil {
			t.Fatalf("rec=%d: %v", rec, err)
		}
		if got.Container != want {
			t.Fatalf("rec=%d container=%q want %q", rec, got.Container, want)
		}
	}
}

func TestParseItemInfo_TooShort(t *testing.T) {
	if _, err := parseItemInfo(make([]byte, 50)); err == nil {
		t.Fatal("expected error for short Item.Info")
	}
}
