package desktop

import (
	"fmt"
	"os"
	"sync"
	"time"

	"github.com/irusan-fanclub/mogugi/internal/app"
	"github.com/irusan-fanclub/mogugi/lib/license"
	"github.com/wailsapp/wails/v3/pkg/application"
	"github.com/wailsapp/wails/v3/pkg/events"
	"github.com/wailsapp/wails/v3/pkg/w32"
)

const overlayTopInterval = 30 * time.Second

// overlayWindows is the Wails side of the overlay core.
type overlayWindows struct {
	wapp    *application.App
	port    int
	mu      sync.Mutex
	win     *application.WebviewWindow
	core    *overlayCore
	stop    chan struct{}
	hotkeys *hookHotkeys

	stopTracker func()
	gameCh      chan gameState
}

// setupOverlays wires the overlay core to Wails windows, events and the
// global hotkey. The hotkey is registered once the application has started.
func setupOverlays(wapp *application.App, port int) *overlayCore {
	hotkeys := newHookHotkeys()
	ow := &overlayWindows{wapp: wapp, port: port, stop: make(chan struct{}), hotkeys: hotkeys, gameCh: make(chan gameState, 1)}
	hotkey, visibleHotkey, layouts := app.LoadOverlayConfig()
	d := overlayDeps{
		open:            ow.open,
		close:           ow.close,
		setBounds:       ow.setBounds,
		show:            ow.show,
		hide:            ow.hide,
		raise:           ow.raise,
		setClickThrough: ow.setClickThrough,
		emit:            func(m OverlayStateMsg) { wapp.Event.Emit("overlay:state", m) },
		// A keyboard hook, not wapp.GlobalShortcut: the game swallows RegisterHotKey.
		// It runs callbacks off the main thread.
		register:          hotkeys.Register,
		unregister:        hotkeys.Unregister,
		licensed:          license.Status,
		elevated:          isElevated,
		saveLayout:        app.SaveOverlayLayout,
		saveHotkey:        app.SaveOverlayHotkey,
		saveVisibleHotkey: app.SaveOverlayVisibleHotkey,
	}
	core := newOverlayCore(d, hotkey, visibleHotkey, layouts)
	ow.core = core
	core.onShutdown = ow.shutdown

	wapp.Event.OnApplicationEvent(events.Common.ApplicationStarted, func(*application.ApplicationEvent) {
		core.Start()
		ow.startTracking()
	})
	wapp.Event.On("overlay:get-state", func(*application.CustomEvent) {
		core.CloseAllIfUnlicensed()
		core.EnsureOpen()
		wapp.Event.Emit("overlay:state", core.State())
	})
	wapp.Event.On("overlay:set-layout", func(e *application.CustomEvent) {
		p, _ := e.Data.(map[string]any)
		id, idOK := p["id"].(string)
		raw, _ := p["layout"].(map[string]any)
		l, lOK := parseLayout(raw)
		if !idOK || !lOK {
			logger.Printf("overlay:set-layout ignored: invalid payload %v", e.Data)
			return
		}
		core.SetLayout(id, l)
	})
	wapp.Event.On("overlay:set-locked", func(e *application.CustomEvent) {
		p, _ := e.Data.(map[string]any)
		on, ok := p["locked"].(bool)
		if !ok {
			logger.Printf("overlay:set-locked ignored: invalid payload %v", e.Data)
			return
		}
		core.SetLocked(on)
	})
	wapp.Event.On("overlay:set-hotkey", func(e *application.CustomEvent) {
		p, _ := e.Data.(map[string]any)
		h, ok := p["hotkey"].(string)
		if !ok {
			logger.Printf("overlay:set-hotkey ignored: invalid payload %v", e.Data)
			return
		}
		core.SetHotkey(h)
	})
	wapp.Event.On("overlay:set-visible-hotkey", func(e *application.CustomEvent) {
		p, _ := e.Data.(map[string]any)
		h, ok := p["hotkey"].(string)
		if !ok {
			logger.Printf("overlay:set-visible-hotkey ignored: invalid payload %v", e.Data)
			return
		}
		core.SetVisibleHotkey(h)
	})
	wapp.Event.On("overlay:set-hidden", func(e *application.CustomEvent) {
		p, _ := e.Data.(map[string]any)
		on, ok := p["hidden"].(bool)
		if !ok {
			logger.Printf("overlay:set-hidden ignored: invalid payload %v", e.Data)
			return
		}
		core.SetHidden(on)
	})
	go ow.keepOnTop()
	return core
}

// parseLayout reads the layout object of an overlay:set-layout payload.
func parseLayout(m map[string]any) (app.OverlayLayout, bool) {
	en, ok1 := m["enabled"].(bool)
	anchor, ok2 := m["anchor"].(string)
	x, ok3 := m["x"].(float64)
	y, ok4 := m["y"].(float64)
	w, ok5 := m["width"].(float64)
	rows, ok6 := m["maxRows"].(float64)
	if !(ok1 && ok2 && ok3 && ok4 && ok5 && ok6) {
		return app.OverlayLayout{}, false
	}
	return app.OverlayLayout{Enabled: en, Anchor: anchor, X: int(x), Y: int(y), Width: int(w), MaxRows: int(rows)}, true
}

const overlayExStyle = w32.WS_EX_CONTROLPARENT | w32.WS_EX_NOREDIRECTIONBITMAP | w32.WS_EX_TOPMOST |
	w32.WS_EX_NOACTIVATE | w32.WS_EX_TOOLWINDOW

// startTracking follows the game window. The tracker callbacks run inside a
// Win32 callback on its locked thread, so they only hand off: the latest game
// state goes through a one-slot channel to a worker, which may block on opMu.
func (ow *overlayWindows) startTracking() {
	select {
	case <-ow.stop:
		return
	default:
	}
	go ow.gameWorker()
	stop := startGameTracker(ow.queueGame, func() { go ow.core.OnGameForeground() })
	ow.mu.Lock()
	ow.stopTracker = stop
	ow.mu.Unlock()
}

// queueGame keeps only the newest state.
func (ow *overlayWindows) queueGame(g gameState) {
	for {
		select {
		case ow.gameCh <- g:
			return
		default:
			select {
			case <-ow.gameCh:
			default:
			}
		}
	}
}

func (ow *overlayWindows) gameWorker() {
	for {
		select {
		case <-ow.stop:
			return
		case g := <-ow.gameCh:
			ow.core.OnGame(g)
		}
	}
}

func (ow *overlayWindows) open() {
	win := ow.wapp.Window.NewWithOptions(application.WebviewWindowOptions{
		Name:           "overlay",
		Title:          "mogugi overlay",
		Width:          800,
		Height:         600,
		Hidden:         true,
		Frameless:      true,
		AlwaysOnTop:    true,
		BackgroundType: application.BackgroundTypeTransparent,
		// Created clickable on purpose: a window created click-through gets
		// WS_EX_LAYERED instead of DirectComposition and renders white.
		IgnoreMouseEvents: false,
		URL:               fmt.Sprintf("/overlay.html?wsPort=%d", ow.port),
		DevToolsEnabled:   os.Getenv("MOGUGI_DEVTOOLS") == "1",
		Windows: application.WindowsWindow{
			HiddenOnTaskbar:                   true,
			DisableFramelessWindowDecorations: true,
			ExStyle:                           overlayExStyle,
		},
	})
	ow.mu.Lock()
	ow.win = win
	ow.mu.Unlock()
	// A close from outside the core (Alt+F4, WebView teardown) lets the core reopen.
	win.OnWindowEvent(events.Common.WindowClosing, func(*application.WindowEvent) {
		ow.mu.Lock()
		mine := ow.win == win
		if mine {
			ow.win = nil
		}
		ow.mu.Unlock()
		if mine {
			go ow.core.OnWindowClosed()
		}
	})
	// Lock once the native window exists; read the state now, it may have toggled since open.
	win.OnWindowEvent(events.Windows.WebViewNavigationCompleted, func(*application.WindowEvent) {
		locked := ow.core.State().Locked
		ow.onWindow(win, func() {
			win.SetIgnoreMouseEvents(locked)
			setActivatable(win.NativeWindow(), !locked)
		})
	})
}

func (ow *overlayWindows) close() {
	ow.mu.Lock()
	win := ow.win
	ow.win = nil
	ow.mu.Unlock()
	if win != nil {
		win.Close()
	}
}

// current returns the open overlay window, or nil.
func (ow *overlayWindows) current() *application.WebviewWindow {
	ow.mu.Lock()
	defer ow.mu.Unlock()
	return ow.win
}

// onWindow runs f on the main thread, but only if win is still the current
// overlay window by then; a window closed in between is left alone.
func (ow *overlayWindows) onWindow(win *application.WebviewWindow, f func()) {
	if win == nil {
		return
	}
	application.InvokeAsync(func() {
		if ow.current() == win {
			f()
		}
	})
}

func (ow *overlayWindows) setBounds(r rect) {
	w := ow.current()
	ow.onWindow(w, func() {
		w.SetPhysicalBounds(application.Rect{X: r.X, Y: r.Y, Width: r.W, Height: r.H})
	})
}

func (ow *overlayWindows) show() {
	w := ow.current()
	ow.onWindow(w, func() { w.Show() })
}

func (ow *overlayWindows) hide() {
	w := ow.current()
	ow.onWindow(w, func() { w.Hide() })
}

func (ow *overlayWindows) raise() {
	w := ow.current()
	ow.onWindow(w, func() { w.SetAlwaysOnTop(true) })
}

func (ow *overlayWindows) setClickThrough(locked bool) {
	w := ow.current()
	ow.onWindow(w, func() {
		w.SetIgnoreMouseEvents(locked)
		setActivatable(w.NativeWindow(), !locked)
		if !locked {
			takeForeground(uintptr(w.NativeWindow()))
		} else if g := findGameWindow(); g != 0 && w32.GetForegroundWindow() == w32.HWND(w.NativeWindow()) {
			takeForeground(g)
		}
	})
}

// keepOnTop re-asserts always-on-top as a safety net; the tracker raises the
// overlay whenever the game takes the foreground.
func (ow *overlayWindows) keepOnTop() {
	t := time.NewTicker(overlayTopInterval)
	defer t.Stop()
	for {
		select {
		case <-ow.stop:
			return
		case <-t.C:
			ow.raise()
		}
	}
}

// shutdown stops the tracker and the ticker and releases the hotkey.
func (ow *overlayWindows) shutdown() {
	close(ow.stop)
	ow.mu.Lock()
	stop := ow.stopTracker
	ow.mu.Unlock()
	if stop != nil {
		stop()
	}
	ow.hotkeys.Close()
}
