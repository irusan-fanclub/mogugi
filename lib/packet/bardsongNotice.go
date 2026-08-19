package packet

import (
	"regexp"
	"strconv"
	"strings"
)

// 戰吼 announces itself as 向敵軍演奏 and ends with the generic 演奏的效果消失.
// The 戰場的序曲 music skill (CC 680) instead 發出迴響 and names the song when
// it ends, yet writes the same 增加 NN% lines — so the bonus lines cannot
// decide, only the announcement can.
//
// bardsongPerform is deliberately narrow: the lane it feeds is hardcoded to
// 戰吼 (BARDSONG_CC_ID 900206). Modelling a second song means widening the
// lane and this rule together, never the rule alone.
const (
	bardsongPerform = "向敵軍演奏"
	bardsongEnd     = "演奏的效果消失."
	musicSkillEcho  = "發出迴響"
)

// musicSkillEndRe matches "<song> 效果消失." — the music skill names the song
// before the space, where the bard-song ending above never does.
var musicSkillEndRe = regexp.MustCompile(`\S+\s+效果消失\.`)

// One rule for every song: the spacing around the number differs between
// them, so match loosely rather than templating per song. Only run once the
// notice is known to be a song — 序曲 writes these lines too.
var bonusRe = regexp.MustCompile(`([^\s.\n]+?)增加了?\s*([0-9]+(?:\.[0-9]+)?)\s*%`)

type BardsongNotice struct {
	// Performer is the announcer's name, e.g. "地獄哞菇"; empty on an end notice.
	Performer string
	// Song is the remainder of the announcement's first line after the
	// performer, not a bare song name (e.g. "向敵軍演奏非常響亮的戰場上的狂吼").
	// Isolating the real name needs the friend_msg table from BardsSong.xml.
	Song string
	// Bonuses maps a stat name to its raw percentage, e.g. "最大攻擊力" -> 35.
	Bonuses map[string]float64
	// IsEnd marks the generic "演奏的效果消失." ending notice.
	IsEnd bool
}

func ParseBardsongNotice(text string) (*BardsongNotice, bool) {
	if strings.HasPrefix(strings.TrimSpace(text), bardsongEnd) {
		return &BardsongNotice{IsEnd: true, Bonuses: map[string]float64{}}, true
	}

	// Only the first line announces the song; a bonus line never does.
	line, _, _ := strings.Cut(text, "\n")
	if !strings.Contains(line, bardsongPerform) {
		return nil, false
	}

	n := &BardsongNotice{Bonuses: map[string]float64{}}
	for _, g := range bonusRe.FindAllStringSubmatch(text, -1) {
		if f, err := strconv.ParseFloat(g[2], 64); err == nil {
			n.Bonuses[g[1]] = f
		}
	}

	// The first line names the performer and the song; its wording varies.
	n.Performer, n.Song = splitPerformerAndSong(line)
	return n, true
}

// IsMusicSkillNotice reports whether text is a 戰場的序曲-style music *skill*
// notice. It shares the bard song's bonus wording but belongs to another buff
// system, so callers can tell "deliberately ignored" from "unrecognised".
func IsMusicSkillNotice(text string) bool {
	return strings.Contains(text, musicSkillEcho) || musicSkillEndRe.MatchString(text)
}

// splitPerformerAndSong takes the leading run before the first space as the
// performer, or before the first 的 when there is no space. The remainder,
// minus its trailing full stop, is the song.
func splitPerformerAndSong(line string) (performer, song string) {
	sep := " "
	if !strings.Contains(line, sep) {
		sep = "的"
	}
	performer, rest, ok := strings.Cut(line, sep)
	if !ok {
		return line, ""
	}
	return performer, strings.TrimSuffix(strings.TrimSpace(rest), ".")
}
