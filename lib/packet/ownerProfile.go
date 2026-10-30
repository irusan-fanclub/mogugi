package packet

import "fmt"

// OwnerProfile is the slice of the 0x5209 owner snapshot that describes the
// character's titles, grandmaster talent and arcana. A section is nil when
// the walker could not reach or read it.
type OwnerProfile struct {
	Titles     *OwnerTitles     `json:"titles"`
	Talent     *OwnerTalent     `json:"talent"`
	MultiClass *OwnerMultiClass `json:"multiClass"`
}

// OwnerTitles is CTitleMgr's equipped pair (A group, the effect source).
type OwnerTitles struct {
	TitleId       uint32 `json:"titleId"`
	OptionTitleId uint32 `json:"optionTitleId"`
}

// OwnerTalent is CTalentComponent: GrandmasterTalentId 255 means none active;
// OwnedTitleIds are talenttitle.xml ids.
type OwnerTalent struct {
	GrandmasterTalentId uint8    `json:"grandmasterTalentId"`
	OwnedTitleIds       []uint16 `json:"ownedTitleIds"`
}

// OwnerMultiClass is CMultiClassComponent; CurrentClassId 0 means none.
type OwnerMultiClass struct {
	CurrentClassId uint16       `json:"currentClassId"`
	Classes        []OwnerClass `json:"classes"`
}

// OwnerClass is one arcana record: Exp maps to a level via MultiClassCommon.xml.
type OwnerClass struct {
	ClassId     uint16 `json:"classId"`
	Exp         uint32 `json:"exp"`
	ArcanaLevel uint16 `json:"arcanaLevel"`
}

// Wire shapes of the CParameter stat blocks (see iruneko character-parameter.md).
const (
	paramBlock1 = "SSSibhbhiffffiiibibiiifSbbhih"
	paramBlock2 = "ffffffffffffhihhhqhffffffffffffffffffihhhhhhhhhhhhhhhhffhhfffhhffffhhhhhhhqiiiiqqhhhhffffhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhffffffffShhiqifffffbbbbfffffffffhhhhhhhhffhhhhh"
)

// ParseOwnerProfile walks a 0x5209 owner snapshot sequentially: a port of
// iruneko's 0x5209 walker up to CMultiClassComponent. Sections read before a
// failure are still returned alongside the error.
func ParseOwnerProfile(msg Message) (OwnerProfile, error) {
	w := &profileWalker{msg: msg}
	var p OwnerProfile

	w.skip("bq") // result, character id
	w.parameter()
	p.Titles = w.titleMgr()
	w.skip("qSqh") // CMateMgr
	w.skip("b")    // CJobComponent
	w.optionWeapon()
	w.skip("iii") // SCMO, inventory width and height
	w.items()
	w.each(int(w.u16()), func() { w.skip("h") }) // CKeyword
	w.skillMgr()
	w.skip("bS")                 // CBannerMgr
	w.skip("bibibbbqqibbiiiibb") // CPVPMgr
	w.conditionMgr()
	w.skip("qSiiqbbbibbbbS") // CGuildComponent
	w.skip("q")              // CArbeitMgr
	w.each(int(w.u32()), func() { w.skip("iii") })
	w.skip("qbbf")         // CSummonSlave
	w.skip("q")            // CSummonMaster
	w.skip("bhhii")        // CTransformMgr
	w.skip("SiqqbbqbqqbS") // CPetMgr
	w.skip("q")            // CHouseComponent
	w.skip("qbbbi")        // CTameMgr
	w.skip("iiqibbb")      // CVehicle
	w.skip("iqqb")         // CShowdownComponent
	w.skip("qi")           // CTransportComponent
	w.zero(uint64(w.u8()), "CAviationComponent")
	w.zero(uint64(w.u8()), "CSkiingComponent")
	w.zero(w.u64(), "CFarmingComponent")
	w.skip("bbSbb")       // CEventComponent
	w.skip("hh")          // CHeartStickerComponent
	w.skip("iibbbhhhhii") // CJoustComponent
	w.skip("i")           // CAchievement
	w.each(int(w.u16()), func() { w.skip("h") })
	w.each(int(w.u32()), func() { w.skip("qihhSS") }) // CPrivateFarmComponent
	w.family()
	w.skip("i")    // CDemiGodComponent
	w.skip("bqfi") // CCommerceComponent
	p.Talent = w.talent()
	afterTalent := w.i
	w.each(int(w.u32()), func() { w.skip("ibb") }) // CShapeShiftComponent
	w.skip("i")                                    // feature 0x395
	w.each(int(w.u32()), func() { w.skip("iq") })
	w.skip("iqqSbi")                              // CRockPaperScissorsComponent
	w.each(int(w.u32()), func() { w.skip("qi") }) // CRegisterComponent
	w.newEgo()
	w.skip("f") // CMagigraphComponent
	w.each(int(w.u32()), func() { w.skip("if") })
	p.MultiClass = w.multiClass()
	if p.MultiClass == nil && p.Talent != nil {
		// A component between them (e.g. an ego weapon jump-table branch not
		// yet mapped) broke the walk; the arcana block is still findable.
		p.MultiClass = scanMultiClass(msg, afterTalent)
	}
	return p, w.err
}

type profileWalker struct {
	msg Message
	i   int
	err error
}

func (w *profileWalker) fail(format string, a ...any) {
	if w.err == nil {
		w.err = fmt.Errorf("0x5209 walker at element %d: %s", w.i, fmt.Sprintf(format, a...))
	}
}

// peek reports the type of the element off ahead of the cursor.
func (w *profileWalker) peek(off int) (MessageElemType, bool) {
	if w.err != nil || w.i+off >= len(w.msg) {
		return 0, false
	}
	return w.msg[w.i+off].Type(), true
}

func (w *profileWalker) peekIs(t MessageElemType) bool {
	got, ok := w.peek(0)
	return ok && got == t
}

// next consumes one element of the wanted type, or records a failure.
func (w *profileWalker) next(want MessageElemType) IMessageElem {
	if w.err != nil {
		return nil
	}
	if w.i >= len(w.msg) {
		w.fail("EOF, want type %d", want)
		return nil
	}
	e := w.msg[w.i]
	if e.Type() != want {
		w.fail("want type %d, got %d", want, e.Type())
		return nil
	}
	w.i++
	return e
}

func (w *profileWalker) u8() uint8 {
	if e := w.next(MessageElemTypeByte); e != nil {
		return e.Data().(uint8)
	}
	return 0
}

func (w *profileWalker) u16() uint16 {
	if e := w.next(MessageElemTypeShort); e != nil {
		return e.Data().(uint16)
	}
	return 0
}

func (w *profileWalker) u32() uint32 {
	if e := w.next(MessageElemTypeInt); e != nil {
		return e.Data().(uint32)
	}
	return 0
}

func (w *profileWalker) u64() uint64 {
	if e := w.next(MessageElemTypeLong); e != nil {
		return e.Data().(uint64)
	}
	return 0
}

func (w *profileWalker) bin() []byte {
	if e := w.next(MessageElemTypeBin); e != nil {
		b, _ := e.Data().([]byte)
		return b
	}
	return nil
}

// skip consumes one element per letter: b h i q f S B.
func (w *profileWalker) skip(shape string) {
	for _, c := range shape {
		switch c {
		case 'b':
			w.next(MessageElemTypeByte)
		case 'h':
			w.next(MessageElemTypeShort)
		case 'i':
			w.next(MessageElemTypeInt)
		case 'q':
			w.next(MessageElemTypeLong)
		case 'f':
			w.next(MessageElemTypeFloat)
		case 'S':
			w.next(MessageElemTypeString)
		case 'B':
			w.next(MessageElemTypeBin)
		}
	}
}

// each runs fn count times, stopping on error so a corrupt count cannot spin.
func (w *profileWalker) each(count int, fn func()) {
	for k := 0; k < count && w.err == nil; k++ {
		fn()
	}
}

// zero fails on a nonzero flag: those components have an unmapped branch.
func (w *profileWalker) zero(v uint64, what string) {
	if w.err == nil && v != 0 {
		w.fail("%s flag %d takes an unmapped branch", what, v)
	}
}

func (w *profileWalker) parameter() {
	if dt := w.u8(); w.err == nil && dt != 2 {
		w.fail("CParameter dataType %d != 2", dt)
		return
	}
	w.skip(paramBlock1)
	w.skip(paramBlock2)
	w.skip("h")         // extra Short after the stats (tw166+)
	w.skip("bbbbbbbbb") // CStatusEx2 bits
	w.each(int(w.u32()), func() { w.skip("ifiibfb") })
	w.skip("ffffffff") // feature 0x790
}

func (w *profileWalker) titleMgr() *OwnerTitles {
	t := OwnerTitles{TitleId: w.u32()}
	w.skip("q")
	w.each(int(w.u16()), func() { w.skip("ibq") })
	t.OptionTitleId = w.u32()
	w.skip("ii") // MCDT1, MCDT2 (costume titles)
	if w.err != nil {
		return nil
	}
	return &t
}

func (w *profileWalker) optionWeapon() {
	w.skip("hi")
	w.each(int(w.u32()), func() { w.skip("hhh") })
	w.each(int(w.u32()), func() { w.skip("i") })
	w.each(int(w.u32()), func() { w.skip("ih") })
}

// items walks the item container: Int count then count item records.
func (w *profileWalker) items() {
	w.each(int(w.u32()), w.itemRecord)
}

func (w *profileWalker) itemRecord() {
	w.skip("q")
	if mode := w.u8(); w.err == nil && mode != 2 {
		w.fail("item mode %d != 2", mode)
		return
	}
	info := w.bin()
	if w.err == nil && len(info) < 56 {
		w.fail("item Info is %d bytes, want >= 56", len(info))
		return
	}
	if w.err != nil {
		return
	}
	// A String is inserted before Property for fused items.
	if !w.peekIs(MessageElemTypeBin) {
		w.skip("S")
	}
	w.bin()
	if le.Uint32(info[52:56]) == 0x100 {
		// Legacy spirit weapon block.
		w.skip("S")
		cnt := int(w.u8())
		w.skip("b")
		w.each(cnt, func() { w.skip("bi") })
		w.skip("qqiSS")
	} else {
		w.skip("SS")
	}
	w.each(int(w.u8()), func() { w.bin() }) // ExtraEffect
	if w.u64() != 0 {
		w.skip("S") // quest descriptor
	}
	for w.peekIs(MessageElemTypeString) { // guild item strings
		w.skip("S")
	}
	if w.peekIs(MessageElemTypeInt) {
		w.each(int(w.u32()), func() { w.skip("ii") })
	}
	w.skip("bb")
	if w.peekIs(MessageElemTypeString) {
		w.skip("S") // fusion extra
	}
	if w.peekIs(MessageElemTypeShort) {
		w.each(int(w.u16()), func() { w.skip("Si") }) // related quests
	}
	w.skip("q") // owner
}

func (w *profileWalker) skillMgr() {
	w.each(int(w.u16()), func() { w.bin() })
	w.each(int(w.u32()), func() { w.skip("if") })
	w.skip("bi")
}

func (w *profileWalker) conditionMgr() {
	w.each(int(w.u32()), func() { w.skip("iqSqSS") })
	w.skip("q")
}

// family: a zero family id truncates the rest of the component.
func (w *profileWalker) family() {
	if w.u64() != 0 {
		w.skip("ShhhS")
	}
}

func (w *profileWalker) talent() *OwnerTalent {
	w.skip("h") // selectedTitleId
	t := OwnerTalent{GrandmasterTalentId: w.u8()}
	w.skip("iiiiiiiiiiiiiiiiiiiiiiii") // exp24
	n := int(w.u8())
	t.OwnedTitleIds = make([]uint16, 0, n)
	w.each(n, func() { t.OwnedTitleIds = append(t.OwnedTitleIds, w.u16()) })
	if w.err != nil {
		return nil
	}
	return &t
}

func (w *profileWalker) newEgo() {
	w.skip("hhhhh")
	w.each(int(w.u32()), func() { w.skip("ihhhqShiihhhSShiq") })
	w.marker(4)
	w.skip("iiii")
	w.marker(4)
	for range 4 {
		w.each(int(w.u32()), func() { w.skip("hfi") })
	}
	w.each(int(w.u32()), func() {
		w.skip("h")
		w.each(int(w.u32()), func() { w.skip("if") })
	})
	if tag := w.u16(); w.err == nil && tag != 0xFFFF {
		w.fail("CNewEgoWeaponComponent tag %#x != 0xFFFF", tag)
	}
}

func (w *profileWalker) marker(want uint32) {
	if got := w.u32(); w.err == nil && got != want {
		w.fail("block marker %d != %d", got, want)
	}
}

func (w *profileWalker) multiClass() *OwnerMultiClass {
	mc := OwnerMultiClass{CurrentClassId: w.u16()}
	n := int(w.u32())
	mc.Classes = make([]OwnerClass, 0, min(n, 64))
	w.each(n, func() {
		c := OwnerClass{ClassId: w.u16(), Exp: w.u32(), ArcanaLevel: w.u16()}
		mc.Classes = append(mc.Classes, c)
	})
	for range 4 {
		w.skip("SSSSbh")
	}
	if w.err != nil {
		return nil
	}
	return &mc
}

// scanMultiClass looks for the CMultiClassComponent signature from index
// from: Short, Int count, count x (Short, Int, Short) with ascending class
// ids, then four (S,S,S,S,b,h) groups.
func scanMultiClass(msg Message, from int) *OwnerMultiClass {
	for i := from; i < len(msg); i++ {
		w := &profileWalker{msg: msg, i: i}
		mc := w.multiClass()
		if mc == nil || len(mc.Classes) == 0 || len(mc.Classes) > 32 {
			continue
		}
		ok := true
		for k, c := range mc.Classes {
			if c.ClassId == 0 || (k > 0 && c.ClassId <= mc.Classes[k-1].ClassId) {
				ok = false
				break
			}
		}
		if ok {
			return mc
		}
	}
	return nil
}
