package desktop

import (
	"regexp"
	"strings"
)

var hotkeyKeyRe = regexp.MustCompile(`^([a-z0-9]|f([1-9]|1[0-2]))$`)

// normalizeHotkey validates a global hotkey and returns its canonical form
// Ctrl+Alt+Shift+<Key>: at least one of Ctrl/Alt, one key from A-Z, 0-9, F1-F12.
func normalizeHotkey(s string) (string, bool) {
	var ctrl, alt, shift bool
	key := ""
	for _, part := range strings.Split(s, "+") {
		p := strings.ToLower(strings.TrimSpace(part))
		switch p {
		case "ctrl", "control":
			if ctrl {
				return "", false
			}
			ctrl = true
		case "alt":
			if alt {
				return "", false
			}
			alt = true
		case "shift":
			if shift {
				return "", false
			}
			shift = true
		default:
			if key != "" || !hotkeyKeyRe.MatchString(p) {
				return "", false
			}
			key = p
		}
	}
	if key == "" || (!ctrl && !alt) {
		return "", false
	}
	var out []string
	if ctrl {
		out = append(out, "Ctrl")
	}
	if alt {
		out = append(out, "Alt")
	}
	if shift {
		out = append(out, "Shift")
	}
	return strings.Join(append(out, strings.ToUpper(key)), "+"), true
}
