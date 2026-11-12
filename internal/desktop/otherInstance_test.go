package desktop

import "testing"

func TestNeedsOtherInstanceDialog(t *testing.T) {
	self := instanceSide{Version: "0.6.2", Path: `D:\Games\mogugi\mogugi-v0.6.2.exe`}
	cases := []struct {
		name    string
		running instanceSide
		want    bool
	}{
		{"same exe, any case", instanceSide{"0.6.2", `d:\games\MOGUGI\mogugi-v0.6.2.exe`}, false},
		{"other exe in the same folder", instanceSide{"0.6.1", `D:\Games\mogugi\mogugi-v0.6.1.exe`}, true},
		{"same version in another folder", instanceSide{"0.6.2", `E:\mogugi\mogugi.exe`}, true},
		{"unreadable path, other version", instanceSide{"0.6.1", ""}, true},
		{"unreadable path, same version", instanceSide{"0.6.2", ""}, false},
	}
	for _, c := range cases {
		if got := needsOtherInstanceDialog(c.running, self); got != c.want {
			t.Errorf("%s: got %v, want %v", c.name, got, c.want)
		}
	}
}
