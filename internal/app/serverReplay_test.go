package app

import (
	"context"
	"os"
	"path/filepath"
	"testing"
)

func TestStartServerReplayIsReadOnly(t *testing.T) {
	oldDir, oldPort, oldAuto := dataDirOverride, port, autoPort
	dataDirOverride = t.TempDir()
	t.Cleanup(func() { dataDirOverride, port, autoPort = oldDir, oldPort, oldAuto })

	// Best-effort removal: the reader holds the file until its start delay ends.
	fdir, _ := os.MkdirTemp("", "replay")
	t.Cleanup(func() { os.RemoveAll(fdir) })
	file := filepath.Join(fdir, "cap.pcapng")
	synthPcapng(t, file, snapshotPacket())
	ctx, cancel := context.WithCancel(context.Background())
	t.Cleanup(func() {
		cancel()
	})

	autoPort = true
	srv, err := StartServer(ctx, ServerOptions{Replay: &ReplayFile{Path: file}, Port: 18791})
	if err != nil {
		t.Fatal(err)
	}
	if srv.Port != 18791 || autoPort {
		t.Errorf("port override not applied: port=%d autoPort=%v", srv.Port, autoPort)
	}
	if !srv.Pub.readOnly.Load() {
		t.Error("replay server must be read-only")
	}
	if ents, _ := os.ReadDir(DataPath("logs")); len(ents) != 0 {
		t.Errorf("replay wrote log files: %v", ents)
	}
}
