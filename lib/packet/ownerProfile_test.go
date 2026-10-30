package packet

import "testing"

// Fixtures are iruneko tw166 0x5209 captures, truncated after CMultiClassComponent.

func TestParseOwnerProfile_Giant(t *testing.T) {
	msg, _ := loadFixture(t, "testdata/0x5209_profile_tw166_giant.json")
	p, err := ParseOwnerProfile(msg)
	if err != nil {
		t.Fatalf("ParseOwnerProfile: %v", err)
	}
	if p.Titles == nil || p.Titles.TitleId != 10700 || p.Titles.OptionTitleId != 9180 {
		t.Fatalf("titles = %+v, want 10700/9180", p.Titles)
	}
	if p.Talent == nil || p.Talent.GrandmasterTalentId != 10 || len(p.Talent.OwnedTitleIds) != 96 {
		t.Fatalf("talent = %+v, want gm 10 with 96 owned titles", p.Talent)
	}
	if p.Talent.OwnedTitleIds[0] != 20016 {
		t.Errorf("first owned title = %d, want 20016", p.Talent.OwnedTitleIds[0])
	}
	mc := p.MultiClass
	if mc == nil || mc.CurrentClassId != 10 || len(mc.Classes) != 9 {
		t.Fatalf("multiClass = %+v, want current 10 with 9 classes", mc)
	}
}

func TestParseOwnerProfile_NoGrandmaster(t *testing.T) {
	msg, _ := loadFixture(t, "testdata/0x5209_profile_tw166_nogm.json")
	p, err := ParseOwnerProfile(msg)
	if err != nil {
		t.Fatalf("ParseOwnerProfile: %v", err)
	}
	if p.Titles == nil || p.Titles.TitleId != 0 || p.Titles.OptionTitleId != 0 {
		t.Errorf("titles = %+v, want zeros", p.Titles)
	}
	if p.Talent == nil || p.Talent.GrandmasterTalentId != 255 || len(p.Talent.OwnedTitleIds) != 12 {
		t.Errorf("talent = %+v, want gm 255 with 12 owned titles", p.Talent)
	}
	if p.MultiClass == nil {
		t.Error("multiClass is nil")
	}
}

func TestParseOwnerProfile_TruncatedKeepsEarlierSections(t *testing.T) {
	msg, _ := loadFixture(t, "testdata/0x5209_profile_tw166_giant.json")
	p, err := ParseOwnerProfile(msg[:5000])
	if err == nil {
		t.Fatal("want an error for a truncated message")
	}
	if p.Titles == nil || p.Titles.TitleId != 10700 {
		t.Errorf("titles = %+v, want kept", p.Titles)
	}
	if p.Talent != nil || p.MultiClass != nil {
		t.Errorf("later sections must be nil, got talent=%v multiClass=%v", p.Talent, p.MultiClass)
	}
}

func TestParseOwnerProfile_NotASnapshot(t *testing.T) {
	p, err := ParseOwnerProfile(Message{NewMessageElemByte(1)})
	if err == nil || p.Titles != nil {
		t.Errorf("want error and no sections, got %+v, %v", p, err)
	}
}
