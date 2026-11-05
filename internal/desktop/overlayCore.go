package desktop

import (
	"fmt"
	"sync"

	"github.com/irusan-fanclub/mogugi/internal/app"
)

// OverlayStateMsg is the overlay:state payload; it matches the TS OverlayState.
type OverlayStateMsg struct {
	Locked      bool   `json:"locked"`
	Hotkey      string `json:"hotkey"`
	HotkeyError string `json:"hotkeyError"`
	Licensed    bool   `json:"licensed"`
	// Layout is every component's saved layout, keyed by component id.
	Layout    map[string]app.OverlayLayout `json:"layout"`
	GameFound bool                         `json:"gameFound"`
	// Elevated is false when in-game hotkeys cannot work (the game runs as admin).
	Elevated     bool   `json:"elevated"`
	ElevateError string `json:"elevateError"`
	// The hidden overlay window stays open (voice alerts keep going) but is not shown.
	Hidden             bool   `json:"hidden"`
	VisibleHotkey      string `json:"visibleHotkey"`
	VisibleHotkeyError string `json:"visibleHotkeyError"`
}

// The core's global hotkeys, as indexes into overlayCore.keys.
const (
	keyLock = iota
	keyVisible
)

// hotkeySlot is one global hotkey the core keeps registered.
type hotkeySlot struct {
	name       string // what it does, for a conflict message
	accel, err string
	registered bool
}

// gameState is what the tracker reports about the game window.
type gameState struct {
	Found, Minimized bool
	Rect             rect // client area, physical px
}

// overlayDeps are the side effects of the core, so it needs no Wails types.
type overlayDeps struct {
	open, close     func()
	setBounds       func(r rect)
	show, hide      func()
	raise           func()
	setClickThrough func(locked bool)
	emit            func(OverlayStateMsg)
	register        func(accel string, cb func()) error
	unregister      func(accel string) error
	licensed        func() bool
	elevated        func() bool
	saveLayout      func(id string, l app.OverlayLayout) error
	removeLayout    func(id string) error
	saveHotkey      func(string) error
	// saveVisibleHotkey persists the show/hide hotkey.
	saveVisibleHotkey func(string) error
}

// overlayCore holds the overlay logic; deps are never called with mu held.
// opMu serializes open/close/lock paths and game updates across their dep
// calls. hotkeyMu serializes hotkey changes.
type overlayCore struct {
	d overlayDeps

	opMu     sync.Mutex
	hotkeyMu sync.Mutex
	saveMu   sync.Mutex

	mu         sync.Mutex
	keys       [2]hotkeySlot
	elevateErr string
	locked     bool
	hidden     bool
	stopped    bool
	isOpen     bool
	shown      bool
	bounds     rect
	hasBounds  bool
	game       gameState
	layouts    map[string]app.OverlayLayout
	onShutdown func()
}

func newOverlayCore(d overlayDeps, hotkey, visibleHotkey string, layouts map[string]app.OverlayLayout) *overlayCore {
	norm := func(h, def string) string {
		if n, ok := normalizeHotkey(h); ok {
			return n
		}
		return def
	}
	c := &overlayCore{d: d, locked: true, layouts: make(map[string]app.OverlayLayout, len(layouts))}
	c.keys[keyLock] = hotkeySlot{name: "鎖定", accel: norm(hotkey, app.DefaultOverlayHotkey)}
	c.keys[keyVisible] = hotkeySlot{name: "顯示／隱藏", accel: norm(visibleHotkey, app.DefaultOverlayVisibleHotkey)}
	for id, l := range layouts {
		c.layouts[id] = l
	}
	return c
}

// keyAction is what hotkey slot i does when pressed.
func (c *overlayCore) keyAction(i int) func() {
	if i == keyVisible {
		return c.ToggleHidden
	}
	return c.ToggleLocked
}

func (c *overlayCore) keySave(i int) func(string) error {
	if i == keyVisible {
		return c.d.saveVisibleHotkey
	}
	return c.d.saveHotkey
}

// State returns the current snapshot; Layout is a copy.
func (c *overlayCore) State() OverlayStateMsg {
	lic := c.d.licensed()
	elev := c.d.elevated != nil && c.d.elevated()
	c.mu.Lock()
	defer c.mu.Unlock()
	ly := make(map[string]app.OverlayLayout, len(c.layouts))
	for id, l := range c.layouts {
		ly[id] = l
	}
	lk, vk := c.keys[keyLock], c.keys[keyVisible]
	return OverlayStateMsg{Locked: c.locked, Hotkey: lk.accel, HotkeyError: lk.err,
		Licensed: lic, Layout: ly, GameFound: c.game.Found, Elevated: elev, ElevateError: c.elevateErr,
		Hidden: c.hidden, VisibleHotkey: vk.accel, VisibleHotkeyError: vk.err}
}

func (c *overlayCore) emitState() { c.d.emit(c.State()) }

// Start registers the hotkeys; call it once the application is running.
func (c *overlayCore) Start() {
	c.hotkeyMu.Lock()
	defer c.hotkeyMu.Unlock()
	for i := range c.keys {
		c.mu.Lock()
		h := c.keys[i].accel
		c.mu.Unlock()
		err := c.d.register(h, c.keyAction(i))
		c.mu.Lock()
		c.keys[i].registered = err == nil
		c.keys[i].err = ""
		if err != nil {
			c.keys[i].err = fmt.Sprintf("無法註冊快捷鍵 %s：%v", h, err)
		}
		c.mu.Unlock()
	}
	c.emitState()
}

// applyGame puts the window where the game is and shows or hides it; show and
// hide fire only on transitions, setBounds only when the rect changed.
// Caller holds opMu.
func (c *overlayCore) applyGame() {
	c.mu.Lock()
	g, open, hidden := c.game, c.isOpen, c.hidden
	shown, last, hasLast := c.shown, c.bounds, c.hasBounds
	c.mu.Unlock()
	if !open {
		return
	}
	present := g.Found && !g.Minimized
	if present && (!hasLast || last != g.Rect) {
		c.d.setBounds(g.Rect)
		c.mu.Lock()
		c.bounds, c.hasBounds = g.Rect, true
		c.mu.Unlock()
	}
	want := present && !hidden
	if want == shown {
		return
	}
	c.mu.Lock()
	c.shown = want
	c.mu.Unlock()
	if want {
		c.d.show()
	} else {
		c.d.hide()
	}
}

// OnWindowClosed records that the window went away outside the core.
func (c *overlayCore) OnWindowClosed() {
	c.mu.Lock()
	c.isOpen, c.shown, c.hasBounds = false, false, false
	c.mu.Unlock()
}

// openIfNeeded opens the window when licensed and not open yet. A hidden
// overlay is still opened, so its voice alerts work. Caller holds opMu.
func (c *overlayCore) openIfNeeded() {
	if !c.d.licensed() {
		return
	}
	c.mu.Lock()
	if c.stopped || c.isOpen {
		c.mu.Unlock()
		return
	}
	c.isOpen, c.shown, c.hasBounds = true, false, false
	c.mu.Unlock()
	c.d.open()
	c.applyGame()
}

// EnsureOpen opens the overlay window when it should be open and is not.
func (c *overlayCore) EnsureOpen() {
	c.opMu.Lock()
	defer c.opMu.Unlock()
	c.openIfNeeded()
}

// CloseAllIfUnlicensed closes the window when the license is gone. The license
// is read under opMu, so it cannot go stale while an open is in flight.
func (c *overlayCore) CloseAllIfUnlicensed() {
	c.opMu.Lock()
	defer c.opMu.Unlock()
	if c.d.licensed() {
		return
	}
	c.mu.Lock()
	was := c.isOpen
	c.isOpen, c.shown, c.hasBounds = false, false, false
	c.mu.Unlock()
	if !was {
		return
	}
	c.d.close()
	c.emitState()
}

// OnGame takes the tracker's latest view of the game window.
func (c *overlayCore) OnGame(g gameState) {
	c.opMu.Lock()
	defer c.opMu.Unlock()
	c.mu.Lock()
	changed := c.game.Found != g.Found
	c.game = g
	c.mu.Unlock()
	c.applyGame()
	if changed {
		c.emitState()
	}
}

// OnGameForeground raises the overlay above the game when it takes focus.
func (c *overlayCore) OnGameForeground() {
	c.mu.Lock()
	open := c.isOpen
	c.mu.Unlock()
	if open {
		c.d.raise()
	}
}

// SetLayout stores and saves one component's layout; invalid input is ignored.
func (c *overlayCore) SetLayout(id string, l app.OverlayLayout) {
	if !app.ValidOverlayID(id) || !app.ValidOverlayLayout(l) {
		return
	}
	c.saveMu.Lock()
	c.mu.Lock()
	c.layouts[id] = l
	c.mu.Unlock()
	c.emitState()
	if err := c.d.saveLayout(id, l); err != nil {
		logger.Printf("save overlay layout failed: %v", err)
	}
	c.saveMu.Unlock()
}

// RemoveLayout forgets a deleted component's layout; an unknown id is ignored.
func (c *overlayCore) RemoveLayout(id string) {
	c.saveMu.Lock()
	defer c.saveMu.Unlock()
	c.mu.Lock()
	_, ok := c.layouts[id]
	delete(c.layouts, id)
	c.mu.Unlock()
	if !ok {
		return
	}
	c.emitState()
	if err := c.d.removeLayout(id); err != nil {
		logger.Printf("remove overlay layout failed: %v", err)
	}
}

func (c *overlayCore) SetLocked(on bool) {
	c.opMu.Lock()
	defer c.opMu.Unlock()
	c.mu.Lock()
	c.locked = on
	c.mu.Unlock()
	c.d.setClickThrough(on)
	c.emitState()
}

func (c *overlayCore) ToggleLocked() {
	c.opMu.Lock()
	defer c.opMu.Unlock()
	c.mu.Lock()
	next := !c.locked
	c.locked = next
	c.mu.Unlock()
	logger.Printf("overlay lock toggled: locked=%v", next)
	c.d.setClickThrough(next)
	c.emitState()
}

// ToggleHidden hides the overlay, or shows it again.
func (c *overlayCore) ToggleHidden() {
	c.opMu.Lock()
	defer c.opMu.Unlock()
	c.mu.Lock()
	next := !c.hidden
	c.mu.Unlock()
	c.setHidden(next)
}

func (c *overlayCore) SetHidden(on bool) {
	c.opMu.Lock()
	defer c.opMu.Unlock()
	c.setHidden(on)
}

// setHidden hides or shows the window; it stays open. Nothing is saved.
// Caller holds opMu.
func (c *overlayCore) setHidden(on bool) {
	c.mu.Lock()
	if c.hidden == on {
		c.mu.Unlock()
		return
	}
	c.hidden = on
	c.mu.Unlock()
	logger.Printf("overlay visibility toggled: hidden=%v", on)
	if !on {
		c.openIfNeeded()
	}
	c.applyGame()
	c.emitState()
}

// SetHotkey switches the lock hotkey; on failure the old one stays active.
func (c *overlayCore) SetHotkey(h string) { c.setKey(keyLock, h) }

// SetVisibleHotkey switches the show/hide hotkey, like SetHotkey.
func (c *overlayCore) SetVisibleHotkey(h string) { c.setKey(keyVisible, h) }

func (c *overlayCore) setKey(i int, h string) {
	c.hotkeyMu.Lock()
	defer c.hotkeyMu.Unlock()
	n, ok := normalizeHotkey(h)
	c.mu.Lock()
	old, wasReg := c.keys[i].accel, c.keys[i].registered
	other := c.keys[1-i]
	c.mu.Unlock()
	if !ok {
		c.setKeyErr(i, fmt.Sprintf("快捷鍵 %s 格式不正確，需包含 Ctrl 或 Alt，加上 A–Z、0–9 或 F1–F12", h))
		return
	}
	if n == old && wasReg {
		c.setKeyErr(i, "")
		return
	}
	if n == other.accel {
		c.setKeyErr(i, fmt.Sprintf("快捷鍵 %s 已用於「%s」", n, other.name))
		return
	}
	act := c.keyAction(i)
	if wasReg {
		if err := c.d.unregister(old); err != nil {
			logger.Printf("unregister hotkey failed: %v", err)
		}
	}
	if err := c.d.register(n, act); err != nil {
		reg := false
		if wasReg {
			reg = c.d.register(old, act) == nil
		}
		c.mu.Lock()
		c.keys[i].registered = reg
		c.keys[i].err = fmt.Sprintf("無法註冊快捷鍵 %s：%v", n, err)
		c.mu.Unlock()
		c.emitState()
		return
	}
	if err := c.keySave(i)(n); err != nil {
		logger.Printf("save overlay hotkey failed: %v", err)
	}
	c.mu.Lock()
	c.keys[i] = hotkeySlot{name: c.keys[i].name, accel: n, registered: true}
	c.mu.Unlock()
	c.emitState()
}

// SetElevateError reports a relaunch as administrator that did not start.
func (c *overlayCore) SetElevateError(msg string) {
	c.mu.Lock()
	c.elevateErr = msg
	c.mu.Unlock()
	c.emitState()
}

func (c *overlayCore) setKeyErr(i int, msg string) {
	c.mu.Lock()
	c.keys[i].err = msg
	c.mu.Unlock()
	c.emitState()
}

// Shutdown stops opening windows (the app is quitting) and flushes.
func (c *overlayCore) Shutdown() {
	c.mu.Lock()
	if c.stopped {
		c.mu.Unlock()
		return
	}
	c.stopped = true
	f := c.onShutdown
	c.mu.Unlock()
	if f != nil {
		f()
	}
}
