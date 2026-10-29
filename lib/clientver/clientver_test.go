package clientver

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestRegionFromCommandLine(t *testing.T) {
	base := `Client.exe code:1622 ver:147 logip:1.2.3.4 logport:11000 chatip:1.2.3.5 chatport:8004 setting:"file://data/features.xml=Regular, %s" /N:abc /V:xyz /T:gamania`
	cases := map[string]string{"Taiwan": "tw", "USA": "us", "Korea": "kr", "Japan": "jp", "New Land": "newland"}
	for loc, want := range cases {
		cmd := fmt.Sprintf(base, loc)
		if got := RegionFromCommandLine(cmd); got != want {
			t.Errorf("%s: got %q want %q", loc, got, want)
		}
	}
	if got := RegionFromCommandLine(`Client.exe setting:"file://x.xml=Regular,   Taiwan " /N:abc`); got != "tw" {
		t.Errorf("extra spaces: got %q", got)
	}
	// Unbalanced quote must never leak the account or otp into the region.
	got := RegionFromCommandLine(`Client.exe setting:"file://x.xml=Regular, /N:acct1 /V:otp2`)
	if got != "" || strings.Contains(got, "acct1") || strings.Contains(got, "otp2") {
		t.Errorf("unbalanced quote: got %q", got)
	}
	if got := RegionFromCommandLine(`Client.exe code:1622 /N:abc`); got != "" {
		t.Errorf("no setting: got %q", got)
	}
}

func TestReadVersionDat(t *testing.T) {
	dir := t.TempDir()
	if _, err := ReadVersionDat(dir); err == nil {
		t.Error("missing file should error")
	}
	p := filepath.Join(dir, "version.dat")
	os.WriteFile(p, []byte{1, 2}, 0o644)
	if _, err := ReadVersionDat(dir); err == nil {
		t.Error("short file should error")
	}
	os.WriteFile(p, []byte{0xA9, 0, 0, 0}, 0o644)
	if v, err := ReadVersionDat(dir); err != nil || v != 169 {
		t.Errorf("got %d %v", v, err)
	}
}

func TestFormat(t *testing.T) {
	if got := Format("tw", 169); got != "tw169" {
		t.Error(got)
	}
	if got := Format("", 169); got != "169" {
		t.Error(got)
	}
}
