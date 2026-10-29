package desktop

import (
	"errors"
	"fmt"
	"runtime"
	"strings"
	"sync"
	"syscall"
	"unsafe"

	"golang.org/x/sys/windows"
)

// The game swallows RegisterHotKey hotkeys while it has focus, so global
// hotkeys come from a low-level keyboard hook instead (as Mabika does).
// Against an elevated game the hook only sees keys when mogugi is elevated too.

var (
	hkUser32           = windows.NewLazySystemDLL("user32.dll")
	hkSetWindowsHookEx = hkUser32.NewProc("SetWindowsHookExW")
	hkCallNextHookEx   = hkUser32.NewProc("CallNextHookEx")
	hkGetMessage       = hkUser32.NewProc("GetMessageW")
	hkUnhookWindowsHk  = hkUser32.NewProc("UnhookWindowsHookEx")
	hkPostThreadMsg    = hkUser32.NewProc("PostThreadMessageW")
	hkGetAsyncKeyState = hkUser32.NewProc("GetAsyncKeyState")
	hkGetModuleHandle  = windows.NewLazySystemDLL("kernel32.dll").NewProc("GetModuleHandleW")
)

const (
	whKeyboardLL = 13
	wmQuit       = 0x0012
	wmKeyDown    = 0x0100
	wmKeyUp      = 0x0101
	wmSysKeyDown = 0x0104
	wmSysKeyUp   = 0x0105
	vkShift      = 0x10
	vkControl    = 0x11
	vkMenu       = 0x12
)

// keyCombo is a hotkey as a virtual key plus the exact modifiers it needs.
type keyCombo struct {
	vk               uint32
	ctrl, alt, shift bool
}

// parseHotkey turns a hotkey (any form normalizeHotkey accepts) into a combo.
func parseHotkey(h string) (keyCombo, bool) {
	n, ok := normalizeHotkey(h)
	if !ok {
		return keyCombo{}, false
	}
	var c keyCombo
	for _, p := range strings.Split(n, "+") {
		switch p {
		case "Ctrl":
			c.ctrl = true
		case "Alt":
			c.alt = true
		case "Shift":
			c.shift = true
		default:
			if len(p) == 1 { // A-Z and 0-9 share their ASCII code as VK
				c.vk = uint32(p[0])
			} else { // F1-F12
				var f uint32
				fmt.Sscanf(p[1:], "%d", &f)
				c.vk = 0x70 + f - 1
			}
		}
	}
	return c, true
}

type hookBinding struct {
	combo keyCombo
	cb    func()
}

// hotkeyDispatch is the hook's decision logic, free of Windows calls.
type hotkeyDispatch struct {
	mu    sync.Mutex
	binds map[string]hookBinding
	held  map[uint32]bool // a fired key stays held until its key-up, so auto-repeat fires once
}

// onKey reports whether to swallow the event, and the callback to run, if any.
func (d *hotkeyDispatch) onKey(vk uint32, down, ctrl, alt, shift bool) (bool, func()) {
	d.mu.Lock()
	defer d.mu.Unlock()
	if !down {
		if d.held[vk] {
			delete(d.held, vk)
			return true, nil
		}
		return false, nil
	}
	for _, b := range d.binds {
		c := b.combo
		if c.vk != vk || c.ctrl != ctrl || c.alt != alt || c.shift != shift {
			continue
		}
		if d.held[vk] {
			return true, nil
		}
		if d.held == nil {
			d.held = map[uint32]bool{}
		}
		d.held[vk] = true
		return true, b.cb
	}
	return false, nil
}

// hookHotkeys registers global hotkeys on one shared low-level hook.
type hookHotkeys struct {
	dispatch hotkeyDispatch
	once     sync.Once
	startErr error
	thread   uint32        // hook thread id, 0 if never started
	done     chan struct{} // closed when the hook thread exits
	closed   bool          // guarded by dispatch.mu
}

var errHotkeysClosed = errors.New("hotkeys closed")

func newHookHotkeys() *hookHotkeys { return &hookHotkeys{} }

// Register binds accel to cb; the hook thread starts on first use.
func (h *hookHotkeys) Register(accel string, cb func()) error {
	c, ok := parseHotkey(accel)
	if !ok {
		return fmt.Errorf("invalid hotkey %q", accel)
	}
	h.once.Do(func() { h.startErr = h.start() })
	if h.startErr != nil {
		return h.startErr
	}
	d := &h.dispatch
	d.mu.Lock()
	defer d.mu.Unlock()
	if h.closed {
		return errHotkeysClosed
	}
	if _, dup := d.binds[accel]; dup {
		return errors.New("hotkey already registered")
	}
	if d.binds == nil {
		d.binds = map[string]hookBinding{}
	}
	d.binds[accel] = hookBinding{combo: c, cb: cb}
	return nil
}

func (h *hookHotkeys) Unregister(accel string) error {
	d := &h.dispatch
	d.mu.Lock()
	defer d.mu.Unlock()
	delete(d.binds, accel)
	return nil
}

func keyDown(vk uintptr) bool {
	r, _, _ := hkGetAsyncKeyState.Call(vk)
	return r&0x8000 != 0
}

type kbdLLHookStruct struct {
	VkCode, ScanCode, Flags, Time uint32
	ExtraInfo                     uintptr
}

// Close drops all bindings and removes the hook; later Register calls fail.
func (h *hookHotkeys) Close() {
	h.once.Do(func() { h.startErr = errHotkeysClosed })
	d := &h.dispatch
	d.mu.Lock()
	h.closed = true
	d.binds = nil
	d.mu.Unlock()
	if h.thread != 0 {
		hkPostThreadMsg.Call(uintptr(h.thread), wmQuit, 0, 0)
		<-h.done
		h.thread = 0
	}
}

// start installs the hook on its own locked thread; that thread must pump
// messages for the hook to be called.
func (h *hookHotkeys) start() error {
	errc := make(chan error, 1)
	h.done = make(chan struct{})
	go func() {
		defer close(h.done)
		runtime.LockOSThread()
		var hook uintptr
		proc := syscall.NewCallback(func(code, wp, lp uintptr) uintptr {
			if int32(code) == 0 {
				// lp points at a KBDLLHOOKSTRUCT owned by the system for this call.
				k := *(**kbdLLHookStruct)(unsafe.Pointer(&lp))
				switch wp {
				case wmKeyDown, wmSysKeyDown, wmKeyUp, wmSysKeyUp:
					down := wp == wmKeyDown || wp == wmSysKeyDown
					swallow, cb := h.dispatch.onKey(k.VkCode, down,
						keyDown(vkControl), keyDown(vkMenu), keyDown(vkShift))
					if cb != nil {
						go cb() // the hook must return fast or Windows drops it
					}
					if swallow {
						return 1
					}
				}
			}
			r, _, _ := hkCallNextHookEx.Call(hook, code, wp, lp)
			return r
		})
		var err error
		mod, _, _ := hkGetModuleHandle.Call(0)
		hook, _, err = hkSetWindowsHookEx.Call(whKeyboardLL, proc, mod, 0)
		if hook == 0 {
			errc <- fmt.Errorf("install keyboard hook: %w", err)
			return
		}
		defer hkUnhookWindowsHk.Call(hook)
		h.thread = windows.GetCurrentThreadId()
		errc <- nil
		var msg [48]byte
		for {
			if r, _, _ := hkGetMessage.Call(uintptr(unsafe.Pointer(&msg[0])), 0, 0, 0); int32(r) <= 0 {
				return
			}
		}
	}()
	return <-errc
}
