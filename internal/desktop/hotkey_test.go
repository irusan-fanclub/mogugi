package desktop

import "testing"

func TestNormalizeHotkey(t *testing.T) {
	ok := map[string]string{
		"ctrl+alt+l":   "Ctrl+Alt+L",
		"Alt+Ctrl+F9":  "Ctrl+Alt+F9",
		"Shift+Ctrl+1": "Ctrl+Shift+1",
		" Ctrl + F12 ": "Ctrl+F12",
	}
	for in, want := range ok {
		if got, good := normalizeHotkey(in); !good || got != want {
			t.Errorf("normalizeHotkey(%q) = %q,%v want %q", in, got, good, want)
		}
	}
	for _, in := range []string{"L", "Shift+L", "Ctrl+Alt+Space", "Ctrl+Alt+F13", "", "Ctrl+Alt", "Ctrl+Ctrl+L", "Ctrl+A+B", "Ctrl+F0"} {
		if got, good := normalizeHotkey(in); good {
			t.Errorf("normalizeHotkey(%q) = %q, want rejected", in, got)
		}
	}
}
