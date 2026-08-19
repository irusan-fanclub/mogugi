package packet

import "testing"

// Verbatim from capture 2026-08-15_17-24-08 (0x526D category 4): note the
// 增加了 wording and the loose "35% ." spacing, which 序曲 never writes.
const capturedBardsongStart = "地獄哞菇 向敵軍演奏非常響亮的戰場上的狂吼.\n" +
	"最大攻擊力增加了 35% .\n最小攻擊力增加了 35% .\n"

// Verbatim from capture 嫩煎雞_使用戰場的序曲 (0x526D category 4).
const capturedMusicSkillStart = "蘑菇嫩煎雞的戰場的序曲發出迴響.\n" +
	"最小攻擊力增加32.20%.\n最大攻擊力增加 32.20%.\n暴擊率增加 17.71%."

func TestParseBardsongNoticeStart(t *testing.T) {
	n, ok := ParseBardsongNotice(capturedBardsongStart)
	if !ok {
		t.Fatal("not recognised")
	}
	if n.IsEnd {
		t.Error("IsEnd = true, want false")
	}
	if n.Performer != "地獄哞菇" {
		t.Errorf("Performer = %q", n.Performer)
	}
	// Pins the space branch of splitPerformerAndSong: Song is the raw
	// remainder of the line, not a bare song name.
	if n.Song != "向敵軍演奏非常響亮的戰場上的狂吼" {
		t.Errorf("Song = %q", n.Song)
	}
	if n.Bonuses["最大攻擊力"] != 35 || n.Bonuses["最小攻擊力"] != 35 {
		t.Errorf("Bonuses = %v", n.Bonuses)
	}
}

// 戰場的序曲 is a music skill (CC 680) with its own lane, and its ending is
// rejected below — accepting its start would latch the bardsong lane on for
// the rest of the fight.
func TestParseBardsongNoticeIgnoresMusicSkillStart(t *testing.T) {
	if n, ok := ParseBardsongNotice(capturedMusicSkillStart); ok {
		t.Errorf("music-skill start must not be taken as a bardsong start: %+v", n)
	}
	if !IsMusicSkillNotice(capturedMusicSkillStart) {
		t.Error("music-skill start must be recognised as deliberately ignored")
	}
}

func TestParseBardsongNoticeEnd(t *testing.T) {
	n, ok := ParseBardsongNotice("演奏的效果消失.")
	if !ok || !n.IsEnd {
		t.Fatalf("ok=%v n=%+v, want a recognised end notice", ok, n)
	}
	if IsMusicSkillNotice("演奏的效果消失.") {
		t.Error("the generic bardsong ending is not a music-skill notice")
	}
}

// A music-skill ending names the song, so it is NOT a bardsong end.
func TestParseBardsongNoticeIgnoresMusicSkillEnd(t *testing.T) {
	if _, ok := ParseBardsongNotice("戰場的序曲 效果消失."); ok {
		t.Error("music-skill ending must not be taken as a bardsong ending")
	}
	if !IsMusicSkillNotice("戰場的序曲 效果消失.") {
		t.Error("music-skill ending must be recognised as deliberately ignored")
	}
}

func TestParseBardsongNoticeIgnoresUnrelated(t *testing.T) {
	if _, ok := ParseBardsongNotice("某人 已成功製作 某物 . (CHANNEL3)"); ok {
		t.Error("unrelated notice must not match")
	}
}

// The lane is hardcoded to 戰吼, so a bare 演奏 must not open it — labelling
// another song 戰吼 is the same class of wrong as the 序曲 case above. The
// marker is also read from the first line only.
func TestParseBardsongNoticeStartIsNarrow(t *testing.T) {
	if _, ok := ParseBardsongNotice("某人 向友軍演奏某首歌.\n最大攻擊力增加了 10% .\n"); ok {
		t.Error("a different song must not open the 戰吼 lane")
	}
	if _, ok := ParseBardsongNotice("戰場的序曲 效果消失.\n向敵軍演奏\n"); ok {
		t.Error("向敵軍演奏 outside the first line must not start the lane")
	}
}

// The 的-branch is a fallback for a hypothetical space-less announcement;
// every observed one has a space, so pin it directly rather than through a
// made-up notice.
func TestSplitPerformerAndSongNoSpaceFallback(t *testing.T) {
	performer, song := splitPerformerAndSong("某人的某首歌.")
	if performer != "某人" || song != "某首歌" {
		t.Errorf("got (%q, %q)", performer, song)
	}
}
