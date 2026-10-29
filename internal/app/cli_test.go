package app

import (
	"bytes"
	"os"
	"strings"
	"testing"
)

func TestParseCLI(t *testing.T) {
	cases := []struct {
		args    []string
		want    CLIAction
		wantErr bool
	}{
		{nil, CLIRun, false},
		{[]string{"-h"}, CLIHelp, false},
		{[]string{"--help"}, CLIHelp, false},
		{[]string{"--version"}, CLIVersion, false},
		{[]string{"file", "x.pcapng"}, 0, true},
		{[]string{"list"}, 0, true},
		{[]string{"itemcsv"}, 0, true},
		{[]string{"--no-pcap"}, 0, true},
		{[]string{"--no-browser"}, 0, true},
	}
	for _, c := range cases {
		got, err := ParseCLI(c.args)
		if (err != nil) != c.wantErr {
			t.Errorf("ParseCLI(%v) err=%v wantErr=%v", c.args, err, c.wantErr)
			continue
		}
		if !c.wantErr && got != c.want {
			t.Errorf("ParseCLI(%v)=%v want %v", c.args, got, c.want)
		}
	}
}

func TestUsageTextIsMinimal(t *testing.T) {
	u := UsageText()
	for _, want := range []string{"--help", "--version", "MOGUGI_DATA_DIR"} {
		if !strings.Contains(u, want) {
			t.Errorf("usage lacks %q", want)
		}
	}
	for _, bad := range []string{"--no-pcap", "--no-browser", "itemcsv", "list"} {
		if strings.Contains(u, bad) {
			t.Errorf("usage still mentions %q", bad)
		}
	}
}

func TestHelpCreatesNoFiles(t *testing.T) {
	dir := t.TempDir()
	old := dataDirOverride
	dataDirOverride = dir
	t.Cleanup(func() { dataDirOverride = old })

	for _, args := range [][]string{{"-h"}, {"--version"}, {"--bogus"}} {
		var out bytes.Buffer
		proceed, code := Startup(args, &out)
		if proceed {
			t.Errorf("Startup(%v) proceed=true", args)
		}
		wantCode := 0
		if args[0] == "--bogus" {
			wantCode = 2
		}
		if code != wantCode {
			t.Errorf("Startup(%v) code=%d want %d", args, code, wantCode)
		}
		if out.Len() == 0 {
			t.Errorf("Startup(%v) printed nothing", args)
		}
	}
	var out bytes.Buffer
	Startup([]string{"--version"}, &out)
	if out.String() != "mogugi v"+Version+"\n" {
		t.Errorf("version output %q", out.String())
	}
	if es, _ := os.ReadDir(dir); len(es) != 0 {
		t.Fatalf("files created: %v", es)
	}
}

func TestParseStartupLenient(t *testing.T) {
	var out bytes.Buffer
	proceed, code, ignored := ParseStartupLenient([]string{"-ToastActivated", "--x=1"}, &out)
	if !proceed || code != 0 || len(ignored) != 2 || out.Len() != 0 {
		t.Fatalf("unknown args: %v %d %v %q", proceed, code, ignored, out.String())
	}
	if proceed, _, _ := ParseStartupLenient([]string{"--version"}, &out); proceed || out.Len() == 0 {
		t.Fatal("--version must still print and stop")
	}
	if proceed, code, ig := ParseStartupLenient(nil, &out); !proceed || code != 0 || ig != nil {
		t.Fatal("no args must run")
	}
}
