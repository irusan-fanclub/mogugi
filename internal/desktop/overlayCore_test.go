package desktop

import (
	"errors"
	"reflect"
	"strings"
	"testing"

	"github.com/irusan-fanclub/mogugi/internal/app"
)

type fakeOverlay struct {
	licensed   bool
	failAccel  map[string]bool
	registered []string
	cbs        map[string]func()
	unreg      []string
	opens      int
	closes     int
	bounds     []rect
	shows      int
	hides      int
	raises     int
	clicks     []bool
	emits      []OverlayStateMsg
	elevated   bool
	savedIDs   []string
	removedIDs []string
	saved      []app.OverlayLayout
	savedKeys  []string
	savedVis   []string
	replaced   []replaceCall
}

type replaceCall struct {
	saves   map[string]app.OverlayLayout
	removes []string
}

func (f *fakeOverlay) deps() overlayDeps {
	return overlayDeps{
		open:            func() { f.opens++ },
		close:           func() { f.closes++ },
		setBounds:       func(r rect) { f.bounds = append(f.bounds, r) },
		show:            func() { f.shows++ },
		hide:            func() { f.hides++ },
		raise:           func() { f.raises++ },
		setClickThrough: func(l bool) { f.clicks = append(f.clicks, l) },
		emit:            func(m OverlayStateMsg) { f.emits = append(f.emits, m) },
		register: func(a string, cb func()) error {
			if f.failAccel[a] {
				return errors.New("taken")
			}
			f.registered = append(f.registered, a)
			if f.cbs == nil {
				f.cbs = map[string]func(){}
			}
			f.cbs[a] = cb
			return nil
		},
		unregister: func(a string) error { f.unreg = append(f.unreg, a); return nil },
		licensed:   func() bool { return f.licensed },
		elevated:   func() bool { return f.elevated },
		saveLayout: func(id string, l app.OverlayLayout) error {
			f.savedIDs = append(f.savedIDs, id)
			f.saved = append(f.saved, l)
			return nil
		},
		removeLayout: func(id string) error { f.removedIDs = append(f.removedIDs, id); return nil },
		replaceLayouts: func(s map[string]app.OverlayLayout, r []string) error {
			f.replaced = append(f.replaced, replaceCall{s, r})
			return nil
		},
		saveHotkey:        func(h string) error { f.savedKeys = append(f.savedKeys, h); return nil },
		saveVisibleHotkey: func(h string) error { f.savedVis = append(f.savedVis, h); return nil },
	}
}

func newTestCore(f *fakeOverlay, layouts map[string]app.OverlayLayout) *overlayCore {
	return newOverlayCore(f.deps(), app.DefaultOverlayHotkey, app.DefaultOverlayVisibleHotkey, layouts)
}

func TestStartRegistersHotkeyLocked(t *testing.T) {
	f := &fakeOverlay{}
	c := newTestCore(f, nil)
	c.Start()
	if len(f.registered) != 2 || f.registered[0] != "Ctrl+Alt+L" || f.registered[1] != "Ctrl+Alt+O" {
		t.Fatalf("registered = %v", f.registered)
	}
	s := c.State()
	if !s.Locked || s.HotkeyError != "" || len(f.emits) != 1 {
		t.Fatalf("state = %+v emits=%d", s, len(f.emits))
	}
}

func TestStartHotkeyFailureReported(t *testing.T) {
	f := &fakeOverlay{failAccel: map[string]bool{"Ctrl+Alt+L": true}}
	c := newTestCore(f, nil)
	c.Start()
	if !strings.Contains(c.State().HotkeyError, "Ctrl+Alt+L") || len(f.emits) != 1 {
		t.Fatalf("state = %+v emits=%d", c.State(), len(f.emits))
	}
}

func TestSetHotkeyConflictKeepsOld(t *testing.T) {
	f := &fakeOverlay{failAccel: map[string]bool{"Ctrl+Alt+K": true}}
	c := newTestCore(f, nil)
	c.Start()
	c.SetHotkey("Ctrl+Alt+K")
	s := c.State()
	if s.Hotkey != "Ctrl+Alt+L" || !strings.Contains(s.HotkeyError, "Ctrl+Alt+K") {
		t.Fatalf("state = %+v", s)
	}
	if len(f.savedKeys) != 0 {
		t.Fatalf("saved %v", f.savedKeys)
	}
	if n := len(f.registered); n != 3 || f.registered[2] != "Ctrl+Alt+L" {
		t.Fatalf("old not re-registered: %v", f.registered)
	}
}

func TestSetHotkeySuccess(t *testing.T) {
	f := &fakeOverlay{}
	c := newTestCore(f, nil)
	c.Start()
	c.SetHotkey("alt+ctrl+k")
	s := c.State()
	if s.Hotkey != "Ctrl+Alt+K" || s.HotkeyError != "" {
		t.Fatalf("state = %+v", s)
	}
	if len(f.unreg) != 1 || f.unreg[0] != "Ctrl+Alt+L" || len(f.savedKeys) != 1 || f.savedKeys[0] != "Ctrl+Alt+K" {
		t.Fatalf("unreg=%v saved=%v", f.unreg, f.savedKeys)
	}
}

func TestSetHotkeyInvalid(t *testing.T) {
	f := &fakeOverlay{}
	c := newTestCore(f, nil)
	c.Start()
	c.SetHotkey("L")
	if c.State().HotkeyError == "" || c.State().Hotkey != "Ctrl+Alt+L" || len(f.savedKeys) != 0 {
		t.Fatalf("state = %+v", c.State())
	}
}

func TestToggleLockedSetsClickThrough(t *testing.T) {
	f := &fakeOverlay{}
	c := newTestCore(f, nil)
	c.ToggleLocked()
	c.ToggleLocked()
	if len(f.clicks) != 2 || f.clicks[0] || !f.clicks[1] || len(f.emits) != 2 {
		t.Fatalf("clicks=%v emits=%d", f.clicks, len(f.emits))
	}
}

func TestShutdownIdempotent(t *testing.T) {
	f := &fakeOverlay{}
	c := newTestCore(f, nil)
	n := 0
	c.onShutdown = func() { n++ }
	c.Shutdown()
	c.Shutdown()
	if n != 1 {
		t.Fatalf("onShutdown called %d times", n)
	}
}

func TestStartFailureThenSetHotkeySameValueRetries(t *testing.T) {
	f := &fakeOverlay{failAccel: map[string]bool{"Ctrl+Alt+L": true}}
	c := newTestCore(f, nil)
	c.Start()
	delete(f.failAccel, "Ctrl+Alt+L")
	c.SetHotkey("Ctrl+Alt+L")
	s := c.State()
	if s.HotkeyError != "" || len(f.registered) != 2 || f.registered[1] != "Ctrl+Alt+L" {
		t.Fatalf("state=%+v registered=%v", s, f.registered)
	}
}

func TestStateCarriesElevationAndItsError(t *testing.T) {
	f := &fakeOverlay{}
	c := newTestCore(f, nil)
	if c.State().Elevated {
		t.Fatal("not elevated")
	}
	f.elevated = true
	if !c.State().Elevated {
		t.Fatal("elevated")
	}
	c.SetElevateError("已取消")
	if c.State().ElevateError != "已取消" || len(f.emits) != 1 {
		t.Fatalf("state=%+v emits=%d", c.State(), len(f.emits))
	}
}

func TestSetVisibleHotkey(t *testing.T) {
	f := &fakeOverlay{}
	c := newTestCore(f, nil)
	c.Start()
	c.SetVisibleHotkey("ctrl+alt+h")
	s := c.State()
	if s.VisibleHotkey != "Ctrl+Alt+H" || s.VisibleHotkeyError != "" || s.Hotkey != "Ctrl+Alt+L" {
		t.Fatalf("state = %+v", s)
	}
	if len(f.unreg) != 1 || f.unreg[0] != "Ctrl+Alt+O" || len(f.savedVis) != 1 || len(f.savedKeys) != 0 {
		t.Fatalf("unreg=%v savedVis=%v savedKeys=%v", f.unreg, f.savedVis, f.savedKeys)
	}
}

func TestHotkeysCannotShareAKey(t *testing.T) {
	f := &fakeOverlay{}
	c := newTestCore(f, nil)
	c.Start()
	c.SetVisibleHotkey("Ctrl+Alt+L")
	c.SetHotkey("Ctrl+Alt+O")
	s := c.State()
	if s.VisibleHotkey != "Ctrl+Alt+O" || !strings.Contains(s.VisibleHotkeyError, "鎖定") {
		t.Fatalf("visible: %+v", s)
	}
	if s.Hotkey != "Ctrl+Alt+L" || !strings.Contains(s.HotkeyError, "顯示") {
		t.Fatalf("lock: %+v", s)
	}
	if len(f.unreg) != 0 || len(f.savedVis)+len(f.savedKeys) != 0 {
		t.Fatalf("unreg=%v", f.unreg)
	}
}

func TestOpensOneWindowWhenLicensed(t *testing.T) {
	f := &fakeOverlay{}
	c := newTestCore(f, nil)
	c.EnsureOpen()
	if f.opens != 0 {
		t.Fatalf("opened unlicensed: %d", f.opens)
	}
	f.licensed = true
	c.EnsureOpen()
	c.EnsureOpen()
	if f.opens != 1 {
		t.Fatalf("opens = %d", f.opens)
	}
}

func TestGameDrivesBoundsAndVisibility(t *testing.T) {
	f := &fakeOverlay{licensed: true}
	c := newTestCore(f, nil)
	c.EnsureOpen()
	f.hides = 0
	r := rect{8, 31, 2544, 1378}
	c.OnGame(gameState{Found: true, Rect: r})
	if len(f.bounds) != 1 || f.bounds[0] != r || f.shows != 1 || !c.State().GameFound {
		t.Fatalf("bounds=%v shows=%d state=%+v", f.bounds, f.shows, c.State())
	}
	c.OnGame(gameState{Found: true, Minimized: true, Rect: r})
	if len(f.bounds) != 1 || f.hides != 1 || !c.State().GameFound {
		t.Fatalf("minimized: bounds=%v hides=%d", f.bounds, f.hides)
	}
	c.OnGame(gameState{Found: true, Rect: r})
	c.OnGame(gameState{})
	if f.hides != 2 || c.State().GameFound {
		t.Fatalf("gone: hides=%d state=%+v", f.hides, c.State())
	}
}

func TestGameStateBeforeOpenAppliesOnOpen(t *testing.T) {
	f := &fakeOverlay{}
	c := newTestCore(f, nil)
	r := rect{1, 2, 3, 4}
	c.OnGame(gameState{Found: true, Rect: r})
	if len(f.bounds) != 0 || f.shows != 0 || !c.State().GameFound {
		t.Fatalf("touched a closed window: bounds=%v shows=%d", f.bounds, f.shows)
	}
	f.licensed = true
	c.EnsureOpen()
	if f.opens != 1 || len(f.bounds) != 1 || f.bounds[0] != r || f.shows != 1 {
		t.Fatalf("opens=%d bounds=%v shows=%d", f.opens, f.bounds, f.shows)
	}
}

func TestOnGameForegroundRaises(t *testing.T) {
	f := &fakeOverlay{licensed: true}
	c := newTestCore(f, nil)
	c.EnsureOpen()
	c.OnGameForeground()
	if f.raises != 1 {
		t.Fatalf("raises = %d", f.raises)
	}
}

func TestSetLayoutSavesAndEmits(t *testing.T) {
	f := &fakeOverlay{}
	c := newTestCore(f, nil)
	l := app.OverlayLayout{Enabled: true, Anchor: "tr", X: 10, Y: 20, Width: 300, MaxRows: 6}
	c.SetLayout("cc", l)
	if len(f.saved) != 1 || f.savedIDs[0] != "cc" || !reflect.DeepEqual(f.saved[0], l) {
		t.Fatalf("saved=%v %+v", f.savedIDs, f.saved)
	}
	if len(f.emits) != 1 || !reflect.DeepEqual(f.emits[0].Layout["cc"], l) {
		t.Fatalf("emits=%+v", f.emits)
	}
	bad := l
	bad.Anchor = "x"
	c.SetLayout("cc", bad)
	c.SetLayout("bad key]", l)
	if len(f.saved) != 1 || len(f.emits) != 1 || !reflect.DeepEqual(c.State().Layout["cc"], l) {
		t.Fatalf("invalid accepted: saved=%d emits=%d", len(f.saved), len(f.emits))
	}
}

func TestRemoveLayoutDropsSavesAndEmits(t *testing.T) {
	f := &fakeOverlay{}
	l := app.OverlayLayout{Enabled: true, Anchor: "tl", Width: 200, MaxRows: 8}
	c := newTestCore(f, map[string]app.OverlayLayout{"w1": l})
	c.RemoveLayout("w1")
	if _, ok := c.State().Layout["w1"]; ok || len(f.removedIDs) != 1 || len(f.emits) != 1 {
		t.Fatalf("removed=%v emits=%d", f.removedIDs, len(f.emits))
	}
	c.RemoveLayout("w1")
	if len(f.removedIDs) != 1 || len(f.emits) != 1 {
		t.Fatalf("unknown id acted on: removed=%v", f.removedIDs)
	}
}

func TestReplaceLayoutsAppliesOnceAndEmitsOnce(t *testing.T) {
	f := &fakeOverlay{}
	l1 := app.OverlayLayout{Enabled: true, Anchor: "tl", Width: 200, MaxRows: 8}
	l2 := app.OverlayLayout{Enabled: true, Anchor: "br", X: 5, Width: 300, MaxRows: 4}
	c := newTestCore(f, map[string]app.OverlayLayout{"a": l1, "b": l1})
	c.ReplaceLayouts(map[string]app.OverlayLayout{"a": l2, "c": l1}, []string{"b"})
	want := map[string]app.OverlayLayout{"a": l2, "c": l1}
	if got := c.State().Layout; !reflect.DeepEqual(got, want) {
		t.Fatalf("layout = %+v", got)
	}
	if len(f.replaced) != 1 || !reflect.DeepEqual(f.replaced[0].saves, want) || !reflect.DeepEqual(f.replaced[0].removes, []string{"b"}) {
		t.Fatalf("replaced = %+v", f.replaced)
	}
	if len(f.emits) != 1 {
		t.Fatalf("emits = %d", len(f.emits))
	}
}

func TestReplaceLayoutsSkipsInvalidEntries(t *testing.T) {
	f := &fakeOverlay{}
	l := app.OverlayLayout{Enabled: true, Anchor: "tl", Width: 200, MaxRows: 8}
	bad := l
	bad.Anchor = "x"
	c := newTestCore(f, map[string]app.OverlayLayout{"old": l})
	c.ReplaceLayouts(map[string]app.OverlayLayout{"bad key]": l, "badAnchor": bad, "ok": l}, []string{"nope", "old"})
	want := map[string]app.OverlayLayout{"ok": l}
	if got := c.State().Layout; !reflect.DeepEqual(got, want) {
		t.Fatalf("layout = %+v", got)
	}
	if len(f.replaced) != 1 || !reflect.DeepEqual(f.replaced[0].saves, want) || !reflect.DeepEqual(f.replaced[0].removes, []string{"old"}) {
		t.Fatalf("replaced = %+v", f.replaced)
	}
}

func TestReplaceLayoutsSaveWinsOverRemove(t *testing.T) {
	f := &fakeOverlay{}
	l1 := app.OverlayLayout{Enabled: true, Anchor: "tl", Width: 200, MaxRows: 8}
	l2 := app.OverlayLayout{Enabled: false, Anchor: "tr", Width: 250, MaxRows: 3}
	c := newTestCore(f, map[string]app.OverlayLayout{"a": l1})
	c.ReplaceLayouts(map[string]app.OverlayLayout{"a": l2}, []string{"a"})
	if got := c.State().Layout["a"]; !reflect.DeepEqual(got, l2) {
		t.Fatalf("a = %+v", got)
	}
	if len(f.replaced) != 1 || len(f.replaced[0].removes) != 0 {
		t.Fatalf("replaced = %+v", f.replaced)
	}
}

func TestReplaceLayoutsNoopDoesNothing(t *testing.T) {
	f := &fakeOverlay{}
	l := app.OverlayLayout{Enabled: true, Anchor: "x", Width: 200, MaxRows: 8}
	c := newTestCore(f, nil)
	c.ReplaceLayouts(map[string]app.OverlayLayout{"bad key]": l, "badAnchor": l}, []string{"unknown"})
	if len(f.replaced) != 0 || len(f.emits) != 0 {
		t.Fatalf("replaced=%d emits=%d", len(f.replaced), len(f.emits))
	}
}

func TestStateLayoutIsACopy(t *testing.T) {
	f := &fakeOverlay{}
	l := app.OverlayLayout{Enabled: true, Anchor: "tl", Width: 200, MaxRows: 8}
	c := newTestCore(f, map[string]app.OverlayLayout{"dps": l})
	c.State().Layout["dps"] = app.OverlayLayout{}
	if !reflect.DeepEqual(c.State().Layout["dps"], l) {
		t.Fatal("State leaks the internal map")
	}
}

func TestCloseAllIfUnlicensed(t *testing.T) {
	f := &fakeOverlay{licensed: true}
	c := newTestCore(f, nil)
	c.EnsureOpen()
	c.CloseAllIfUnlicensed()
	if f.closes != 0 {
		t.Fatal("closed while licensed")
	}
	f.licensed = false
	emits := len(f.emits)
	c.CloseAllIfUnlicensed()
	c.CloseAllIfUnlicensed()
	if f.closes != 1 || len(f.emits) != emits+1 {
		t.Fatalf("closes=%d emits=%d->%d", f.closes, emits, len(f.emits))
	}
	f.licensed = true
	c.EnsureOpen()
	if f.opens != 2 {
		t.Fatalf("opens = %d", f.opens)
	}
}

func TestHiddenHidesWithoutClosing(t *testing.T) {
	f := &fakeOverlay{licensed: true}
	c := newTestCore(f, nil)
	c.Start()
	c.EnsureOpen()
	r := rect{8, 31, 2544, 1378}
	c.OnGame(gameState{Found: true, Rect: r})
	hides := f.hides
	f.cbs["Ctrl+Alt+O"]()
	if !c.State().Hidden || f.closes != 0 || f.hides != hides+1 || len(f.saved) != 0 {
		t.Fatalf("state=%+v closes=%d hides=%d", c.State(), f.closes, f.hides)
	}
	c.EnsureOpen()
	if f.opens != 1 {
		t.Fatalf("reopened: %d", f.opens)
	}
	shows := f.shows
	c.OnGame(gameState{Found: true, Rect: rect{9, 9, 9, 9}})
	if f.shows != shows {
		t.Fatalf("showed while hidden: %d", f.shows)
	}
	c.ToggleHidden()
	last := f.bounds[len(f.bounds)-1]
	if c.State().Hidden || f.opens != 1 || f.closes != 0 || last != (rect{9, 9, 9, 9}) || f.shows != shows+1 {
		t.Fatalf("hidden=%v opens=%d bounds=%v shows=%d", c.State().Hidden, f.opens, f.bounds, f.shows)
	}
}

func TestUnhideShowsLastBounds(t *testing.T) {
	f := &fakeOverlay{licensed: true}
	c := newTestCore(f, nil)
	c.EnsureOpen()
	r := rect{1, 2, 300, 400}
	c.OnGame(gameState{Found: true, Rect: r})
	c.SetHidden(true)
	c.SetHidden(false)
	if f.bounds[len(f.bounds)-1] != r || f.shows != 2 {
		t.Fatalf("bounds=%v shows=%d", f.bounds, f.shows)
	}
}

func TestSetHiddenIsIdempotent(t *testing.T) {
	f := &fakeOverlay{licensed: true}
	c := newTestCore(f, nil)
	c.EnsureOpen()
	c.OnGame(gameState{Found: true, Rect: rect{0, 0, 10, 10}})
	f.hides = 0
	c.SetHidden(true)
	c.SetHidden(true)
	c.SetHidden(false)
	c.SetHidden(false)
	if f.closes != 0 || f.opens != 1 || f.hides != 1 || f.shows != 2 {
		t.Fatalf("closes=%d opens=%d hides=%d shows=%d", f.closes, f.opens, f.hides, f.shows)
	}
}

func TestShowIsSentOnTransitionsOnly(t *testing.T) {
	f := &fakeOverlay{licensed: true}
	c := newTestCore(f, nil)
	c.EnsureOpen()
	c.OnGame(gameState{Found: true, Rect: rect{0, 0, 10, 10}})
	c.OnGame(gameState{Found: true, Rect: rect{0, 0, 11, 10}})
	c.OnGame(gameState{Found: true, Rect: rect{0, 0, 12, 10}})
	if f.shows != 1 || len(f.bounds) != 3 {
		t.Fatalf("shows=%d bounds=%d", f.shows, len(f.bounds))
	}
	c.OnGame(gameState{Found: true, Minimized: true})
	c.OnGame(gameState{})
	if f.hides != 1 {
		t.Fatalf("hides=%d", f.hides)
	}
}

func TestExternalCloseAllowsReopen(t *testing.T) {
	f := &fakeOverlay{licensed: true}
	c := newTestCore(f, nil)
	c.EnsureOpen()
	c.OnWindowClosed()
	c.EnsureOpen()
	if f.opens != 2 {
		t.Fatalf("opens=%d", f.opens)
	}
}

func TestSetLayoutEmitsBeforeSaving(t *testing.T) {
	f := &fakeOverlay{}
	var order []string
	d := f.deps()
	d.emit = func(OverlayStateMsg) { order = append(order, "emit") }
	save := d.saveLayout
	d.saveLayout = func(id string, l app.OverlayLayout) error { order = append(order, "save"); return save(id, l) }
	c := newOverlayCore(d, app.DefaultOverlayHotkey, app.DefaultOverlayVisibleHotkey, nil)
	c.SetLayout("cc", app.OverlayLayout{Enabled: true, Anchor: "tl", Width: 300, MaxRows: 6})
	if len(order) != 2 || order[0] != "emit" || order[1] != "save" {
		t.Fatalf("order=%v", order)
	}
}
