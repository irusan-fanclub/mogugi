package main

import (
	"bytes"
	"strings"
	"testing"
)

func TestParseReplayArgs(t *testing.T) {
	ok := []struct {
		args []string
		want replayArgs
	}{
		{[]string{"a.pcapng"}, replayArgs{Path: "a.pcapng"}},
		{[]string{"a.pcapng", "--realtime", "--port", "8123"}, replayArgs{Path: "a.pcapng", Realtime: true, Port: 8123}},
		{[]string{"--port=9000", "a.pcap"}, replayArgs{Path: "a.pcap", Port: 9000}},
		{[]string{"-h"}, replayArgs{Help: true}},
	}
	for _, c := range ok {
		got, err := parseReplayArgs(c.args)
		if err != nil || got != c.want {
			t.Errorf("%v: got %+v, %v want %+v", c.args, got, err, c.want)
		}
	}
	bad := [][]string{
		nil, {"--realtime"}, {"a.pcapng", "--port"}, {"a.pcapng", "--port", "x"},
		{"a.pcapng", "--port", "70000"}, {"a.pcapng", "--bogus"}, {"a.pcapng", "b.pcapng"}, {"a.ndjson"},
	}
	for _, args := range bad {
		if _, err := parseReplayArgs(args); err == nil {
			t.Errorf("%v: expected error", args)
		}
	}
}

func TestRunExitCodes(t *testing.T) {
	var out, errOut bytes.Buffer
	if c := run(nil, &out, &errOut); c != 2 || !strings.Contains(errOut.String(), "用法") {
		t.Errorf("no args: code %d, stderr %q", c, errOut.String())
	}
	errOut.Reset()
	if c := run([]string{"definitely-missing.pcapng"}, &out, &errOut); c != 2 || errOut.Len() == 0 {
		t.Errorf("missing file: code %d", c)
	}
	if c := run([]string{"--help"}, &out, &errOut); c != 0 || out.Len() == 0 {
		t.Errorf("help: code %d", c)
	}
}
