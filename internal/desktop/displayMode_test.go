package desktop

import "testing"

func TestDecideModeDesktopURL(t *testing.T) {
	if d := decideMode("", "desktop", 8030, true, true); d.URL != "/desktop.html?wsPort=8030" {
		t.Fatal(d.URL)
	}
	if d := decideMode("desktop", "web", 8030, false, true); d.URL != "/desktop.html?wsPort=8030" {
		t.Fatal(d.URL)
	}
}

func TestDecideMode(t *testing.T) {
	cases := []struct {
		name               string
		prev, next         string
		startup, autoOpen  bool
		wantURL            string
		wantOpen, wantNoop bool
	}{
		{"startup desktop", "", "desktop", true, true, "/desktop.html?wsPort=8030", false, false},
		{"startup web autoOpen", "", "web", true, true, "/desktop.html?wsPort=8030", true, false},
		{"startup web no autoOpen", "", "web", true, false, "/desktop.html?wsPort=8030", false, false},
		{"switch to web ignores autoOpen", "desktop", "web", false, false, "/desktop.html?wsPort=8030", true, false},
		{"switch to desktop", "web", "desktop", false, true, "/desktop.html?wsPort=8030", false, false},
		{"same mode is no-op", "web", "web", false, true, "", false, true},
		{"empty means desktop", "web", "", false, true, "/desktop.html?wsPort=8030", false, false},
	}
	for _, c := range cases {
		d := decideMode(c.prev, c.next, 8030, c.startup, c.autoOpen)
		if d.Noop != c.wantNoop || d.URL != c.wantURL || d.OpenBrowser != c.wantOpen {
			t.Errorf("%s: got %+v", c.name, d)
		}
	}
}
