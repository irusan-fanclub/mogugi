package packet

import "testing"

func TestParseBankListPage0(t *testing.T) {
	msg, _ := loadFixture(t, "testdata/0x7212_page0.json")

	b, err := ParseBankListPacket(msg)
	if err != nil {
		t.Fatal(err)
	}
	if b.Page != 0 || b.Branch != "DunbartonBank" || b.Gold != 26911468 {
		t.Fatalf("header = %+v", b)
	}
	if len(b.Account) != 20 || b.Account[0] != 'x' {
		t.Fatalf("account not masked-20: %q", b.Account)
	}
	wantCounts := []uint32{14, 26, 21, 13}
	if len(b.Tabs) != 4 {
		t.Fatalf("tabs = %d, want 4", len(b.Tabs))
	}
	for i, tab := range b.Tabs {
		if tab.Owner != fmtTab(i) {
			t.Errorf("tab[%d].Owner = %q, want %q (masked)", i, tab.Owner, fmtTab(i))
		}
		if tab.Declared != wantCounts[i] || uint32(len(tab.Items)) != wantCounts[i] {
			t.Errorf("tab[%d]: declared=%d parsed=%d want %d", i, tab.Declared, len(tab.Items), wantCounts[i])
		}
		for _, it := range tab.Items {
			if it.Container != "DunbartonBank" {
				t.Fatalf("item container = %q, want branch code", it.Container)
			}
			if it.Qty == 0 {
				t.Fatal("bank item qty must be normalized >= 1")
			}
		}
	}
}

func fmtTab(i int) string { return "tab" + string(rune('0'+i)) }

func TestParseBankListPage1IncludesEmptyTab(t *testing.T) {
	msg, _ := loadFixture(t, "testdata/0x7212_page1.json")

	b, err := ParseBankListPacket(msg)
	if err != nil {
		t.Fatal(err)
	}
	if b.Page != 1 || len(b.Tabs) != 3 {
		t.Fatalf("page=%d tabs=%d, want 1/3", b.Page, len(b.Tabs))
	}
	counts := []uint32{25, 37, 0}
	for i, tab := range b.Tabs {
		if tab.Declared != counts[i] || uint32(len(tab.Items)) != counts[i] {
			t.Errorf("tab[%d]: declared=%d parsed=%d want %d", i, tab.Declared, len(tab.Items), counts[i])
		}
	}
}

func TestParseBankListRejectsBadHeader(t *testing.T) {
	if _, err := ParseBankListPacket(Message{NewMessageElemByte(1)}); err == nil {
		t.Error("short message: want error")
	}
}
