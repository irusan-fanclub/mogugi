package desktop

import (
	"testing"
	"time"
)

func TestParseHotkey(t *testing.T) {
	for _, c := range []struct {
		in   string
		want keyCombo
	}{
		{"Ctrl+Alt+L", keyCombo{vk: 'L', ctrl: true, alt: true}},
		{"alt+shift+7", keyCombo{vk: '7', alt: true, shift: true}},
		{"Ctrl+F1", keyCombo{vk: 0x70, ctrl: true}},
		{"Ctrl+Alt+F12", keyCombo{vk: 0x7B, ctrl: true, alt: true}},
	} {
		got, ok := parseHotkey(c.in)
		if !ok || got != c.want {
			t.Errorf("parseHotkey(%q) = %+v,%v want %+v", c.in, got, ok, c.want)
		}
	}
	if _, ok := parseHotkey("L"); ok {
		t.Error("a bare key must be rejected")
	}
}

func TestHotkeyDispatchExactModifiersOncePerPress(t *testing.T) {
	n := 0
	d := hotkeyDispatch{binds: map[string]hookBinding{
		"Ctrl+Alt+L": {combo: keyCombo{vk: 'L', ctrl: true, alt: true}, cb: func() { n++ }},
	}}
	fire := func(swallow bool, cb func()) bool {
		if cb != nil {
			cb()
		}
		return swallow
	}
	if fire(d.onKey('L', true, true, false, false)) || n != 0 {
		t.Fatal("Ctrl+L must not match Ctrl+Alt+L")
	}
	if fire(d.onKey('L', true, true, true, true)) || n != 0 {
		t.Fatal("an extra Shift must not match")
	}
	if !fire(d.onKey('L', true, true, true, false)) || n != 1 {
		t.Fatalf("match must swallow and fire once, n=%d", n)
	}
	if !fire(d.onKey('L', true, true, true, false)) || n != 1 {
		t.Fatalf("auto-repeat must be swallowed without firing, n=%d", n)
	}
	if !fire(d.onKey('L', false, true, true, false)) {
		t.Fatal("the matching key-up must be swallowed too")
	}
	if fire(d.onKey('L', false, true, true, false)) {
		t.Fatal("a stray key-up passes through")
	}
	if !fire(d.onKey('L', true, true, true, false)) || n != 2 {
		t.Fatalf("a new press fires again, n=%d", n)
	}
	if fire(d.onKey('K', true, true, true, false)) {
		t.Fatal("other keys pass through")
	}
}

func TestHookHotkeysRejectsDuplicateAndBadAccel(t *testing.T) {
	h := &hookHotkeys{}
	h.once.Do(func() {}) // skip installing a real hook in tests
	if err := h.Register("nope", func() {}); err == nil {
		t.Fatal("invalid accel must fail")
	}
	if err := h.Register("Ctrl+Alt+L", func() {}); err != nil {
		t.Fatal(err)
	}
	if err := h.Register("Ctrl+Alt+L", func() {}); err == nil {
		t.Fatal("duplicate must fail")
	}
	_ = h.Unregister("Ctrl+Alt+L")
	if err := h.Register("Ctrl+Alt+L", func() {}); err != nil {
		t.Fatalf("re-register after unregister: %v", err)
	}
}

func TestHookHotkeysCloseDropsBindsAndBlocksRegister(t *testing.T) {
	h := &hookHotkeys{}
	h.once.Do(func() {}) // skip installing a real hook in tests
	if err := h.Register("Ctrl+Alt+L", func() {}); err != nil {
		t.Fatal(err)
	}
	h.Close()
	h.Close() // idempotent
	if n := len(h.dispatch.binds); n != 0 {
		t.Fatalf("binds after Close = %d", n)
	}
	if err := h.Register("Ctrl+Alt+O", func() {}); err == nil {
		t.Fatal("Register after Close must fail")
	}

	// Closed before first use: the hook is never installed.
	never := &hookHotkeys{}
	never.Close()
	if err := never.Register("Ctrl+Alt+L", func() {}); err == nil {
		t.Fatal("Register after Close must fail")
	}
}

func TestHookHotkeysCloseStopsRealHookThread(t *testing.T) {
	h := &hookHotkeys{}
	if err := h.Register("Ctrl+Alt+F12", func() {}); err != nil {
		t.Skipf("no keyboard hook here: %v", err)
	}
	done := make(chan struct{})
	go func() { h.Close(); close(done) }()
	select {
	case <-done:
	case <-time.After(3 * time.Second):
		t.Fatal("Close did not stop the hook thread")
	}
}
