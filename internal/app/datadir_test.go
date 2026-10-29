package app

import (
	"path/filepath"
	"testing"

	"github.com/irusan-fanclub/mogugi/lib/license"
)

func TestDataDirEnv(t *testing.T) {
	t.Setenv("MOGUGI_DATA_DIR", `C:\tmp\mg`)
	if got := DataDir(); got != `C:\tmp\mg` {
		t.Fatalf("DataDir=%q", got)
	}
	if got := DataPath("logs"); got != filepath.Join(`C:\tmp\mg`, "logs") {
		t.Fatalf("DataPath=%q", got)
	}
	t.Setenv("MOGUGI_DATA_DIR", "")
	t.Setenv("MOGUGI_LICENSE_DIR", `C:\old`)
	if got := DataDir(); got == `C:\old` {
		t.Fatalf("old env honoured: %q", got)
	}
}

func TestLicenseLandsInDataDir(t *testing.T) {
	dir := t.TempDir()
	t.Setenv("MOGUGI_DATA_DIR", dir)
	if got, want := license.FilePath(), filepath.Join(DataDir(), "license.dat"); got != want {
		t.Fatalf("license path %q want %q", got, want)
	}
}
