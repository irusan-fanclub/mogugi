package app

import (
	"bytes"
	"context"
	"encoding/binary"
	"net"
	"os"
	"path/filepath"
	"sync"
	"testing"
	"time"

	"github.com/gopacket/gopacket"
	"github.com/gopacket/gopacket/layers"
	"github.com/gopacket/gopacket/pcapgo"
	"github.com/irusan-fanclub/mogugi/lib/event"
	"github.com/irusan-fanclub/mogugi/lib/packet"
)

const replayTestEntity = 0x10000000000001

// wireBytes encodes a GamePacket the way the game server sends it.
func wireBytes(p *packet.GamePacket) []byte {
	msg := p.Msg.Bytes()
	var body bytes.Buffer
	_ = binary.Write(&body, binary.BigEndian, uint32(p.Op))
	_ = binary.Write(&body, binary.BigEndian, p.Id)
	body.Write(binary.AppendUvarint(nil, uint64(len(msg))))
	body.Write(msg)
	out := make([]byte, 6, 6+body.Len())
	binary.LittleEndian.PutUint32(out[1:], uint32(6+body.Len()))
	return append(out, body.Bytes()...)
}

// synthPcapng writes a tiny Ethernet/IPv4/TCP capture carrying the given
// game packets on one stream (4-byte key packet first, as the game does).
func synthPcapng(t *testing.T, path string, pkts ...*packet.GamePacket) {
	t.Helper()
	f, err := os.Create(path)
	if err != nil {
		t.Fatal(err)
	}
	defer f.Close()
	w, err := pcapgo.NewNgWriter(f, layers.LinkTypeEthernet)
	if err != nil {
		t.Fatal(err)
	}
	seq := uint32(1000)
	at := time.Now()
	write := func(payload []byte) {
		eth := &layers.Ethernet{SrcMAC: net.HardwareAddr{0, 1, 2, 3, 4, 5}, DstMAC: net.HardwareAddr{6, 7, 8, 9, 10, 11}, EthernetType: layers.EthernetTypeIPv4}
		ip := &layers.IPv4{Version: 4, IHL: 5, TTL: 64, Protocol: layers.IPProtocolTCP, SrcIP: net.IP{10, 0, 0, 1}, DstIP: net.IP{10, 0, 0, 2}}
		tcp := &layers.TCP{SrcPort: 11020, DstPort: 50000, Seq: seq, ACK: true, Window: 65535}
		_ = tcp.SetNetworkLayerForChecksum(ip)
		buf := gopacket.NewSerializeBuffer()
		if err := gopacket.SerializeLayers(buf, gopacket.SerializeOptions{FixLengths: true, ComputeChecksums: true},
			eth, ip, tcp, gopacket.Payload(payload)); err != nil {
			t.Fatal(err)
		}
		ci := gopacket.CaptureInfo{Timestamp: at, CaptureLength: len(buf.Bytes()), Length: len(buf.Bytes())}
		at = at.Add(time.Millisecond)
		if err := w.WritePacket(ci, buf.Bytes()); err != nil {
			t.Fatal(err)
		}
		seq += uint32(len(payload))
	}
	write([]byte{1, 2, 3, 4})
	for _, p := range pkts {
		write(wireBytes(p))
	}
	if err := w.Flush(); err != nil {
		t.Fatal(err)
	}
}

type fakeHook struct {
	mu             sync.Mutex
	pauses, resume int
}

func (f *fakeHook) Pause()  { f.mu.Lock(); f.pauses++; f.mu.Unlock() }
func (f *fakeHook) Resume() { f.mu.Lock(); f.resume++; f.mu.Unlock() }
func (f *fakeHook) counts() (int, int) {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.pauses, f.resume
}

// sourceFixture builds a publisher + controller on a temp data dir.
func sourceFixture(t *testing.T) (*SourceController, *eventPublisher, *fakeHook) {
	t.Helper()
	ctx, cancel := context.WithCancel(context.Background())
	t.Cleanup(cancel)
	oldDir := dataDirOverride
	dataDirOverride = t.TempDir()
	t.Cleanup(func() { dataDirOverride = oldDir })
	pub := newEventPublisher(ctx, nil)
	hook := &fakeHook{}
	c := NewSourceController(&Server{Pub: pub, ctx: ctx})
	c.hook = hook
	return c, pub, hook
}

func waitFinished(t *testing.T, c *SourceController) {
	t.Helper()
	deadline := time.Now().Add(10 * time.Second)
	for time.Now().Before(deadline) {
		if c.State().Finished {
			return
		}
		time.Sleep(20 * time.Millisecond)
	}
	t.Fatalf("replay did not finish: %+v", c.State())
}

func snapshotPacket() *packet.GamePacket {
	return channelCharacterInfoPacket(replayTestEntity, 10002, "重播角色")
}

func TestReplayPcapngReadOnly(t *testing.T) {
	db := withTestItemDB(t)

	// Control: outside a replay the same packet does write the item store.
	live := &eventPublisher{entityCache: make(entityCache)}
	live.handleChannelCharacterInfo(snapshotPacket())
	if n, _ := db.CountItems(replayTestEntity, "inventory"); n == 0 {
		t.Fatal("fixture packet does not write the item store; test would prove nothing")
	}
	if err := db.ReplaceStorage(entityMeta{Id: replayTestEntity, Name: "重播角色"}, "inventory", nil); err != nil {
		t.Fatal(err)
	}

	c, pub, hook := sourceFixture(t)
	file := filepath.Join(t.TempDir(), "cap.pcapng")
	synthPcapng(t, file, snapshotPacket())
	t.Cleanup(c.StopReplay) // release the file before TempDir removal

	if err := c.StartReplay(file, ReplayOptions{}); err != nil {
		t.Fatal(err)
	}
	if st := c.State(); st.Mode != "replay" || st.File != "cap.pcapng" {
		t.Fatalf("state=%+v", st)
	}
	waitFinished(t, c)

	if n, _ := db.CountItems(replayTestEntity, "inventory"); n != 0 {
		t.Fatalf("item store written during replay: %d rows", n)
	}
	pub.Lock()
	handled := !pub.lastRealPacketAt.IsZero()
	pub.Unlock()
	if !handled {
		t.Fatal("publisher never handled a replayed packet")
	}
	if !pub.readOnly.Load() {
		t.Fatal("publisher must stay read-only until StopReplay")
	}
	if ents, err := os.ReadDir(DataPath("logs")); err == nil && len(ents) != 0 {
		t.Fatalf("replay created files under logs/: %v", ents)
	}
	if p, _ := hook.counts(); p != 1 {
		t.Fatalf("live capture paused %d times", p)
	}
}

func TestReplayBadFileReturnsToLive(t *testing.T) {
	c, _, hook := sourceFixture(t)
	dir := t.TempDir()
	bad := filepath.Join(dir, "x.pcapng")
	if err := os.WriteFile(bad, []byte("not a pcap"), 0o644); err != nil {
		t.Fatal(err)
	}
	for _, name := range []string{"x.pcapng", "x.txt", "missing.pcapng", "a.ndjson"} {
		if err := c.StartReplay(filepath.Join(dir, name), ReplayOptions{}); err == nil {
			t.Fatalf("%s: expected error", name)
		}
		if st := c.State(); st.Mode != "live" || st.Err == "" || st.File != name {
			t.Fatalf("%s: state=%+v", name, st)
		}
	}
	if p, _ := hook.counts(); p != 0 {
		t.Fatalf("failed starts must not pause live capture, got %d", p)
	}
}

func TestStopReplayResumesLive(t *testing.T) {
	c, pub, hook := sourceFixture(t)
	file := filepath.Join(t.TempDir(), "cap.pcapng")
	synthPcapng(t, file, snapshotPacket())
	t.Cleanup(c.StopReplay) // release the file before TempDir removal

	ch := make(chan []event.IEvent, 100)
	pub.addClient(context.Background(), ch)

	if err := c.StartReplay(file, ReplayOptions{}); err != nil {
		t.Fatal(err)
	}
	c.StopReplay()
	c.StopReplay() // second stop is a no-op
	if p, r := hook.counts(); p != 1 || r != 1 {
		t.Fatalf("pause/resume = %d/%d, want 1/1", p, r)
	}
	if st := c.State(); st.Mode != "live" {
		t.Fatalf("state=%+v", st)
	}
	if pub.readOnly.Load() {
		t.Fatal("still read-only after StopReplay")
	}

	resets := 0
	deadline := time.After(2 * time.Second)
	for resets < 2 {
		select {
		case batch := <-ch:
			for _, e := range batch {
				if e.GetEventId() == event.EventIdSessionReset {
					resets++
				}
			}
		case <-deadline:
			t.Fatalf("saw %d SessionReset, want 2 (one per switch)", resets)
		}
	}
}

func TestNewClientGetsSourceState(t *testing.T) {
	c, pub, _ := sourceFixture(t)
	file := filepath.Join(t.TempDir(), "cap.pcapng")
	synthPcapng(t, file, snapshotPacket())
	t.Cleanup(c.StopReplay) // release the file before TempDir removal
	if err := c.StartReplay(file, ReplayOptions{}); err != nil {
		t.Fatal(err)
	}
	ch := make(chan []event.IEvent, 10)
	pub.addClient(context.Background(), ch)
	n := 0
	for _, e := range <-ch {
		if se, ok := e.(*event.EventSourceChanged); ok {
			n++
			if se.Mode != "replay" || se.File != "cap.pcapng" {
				t.Fatalf("source event %+v", se)
			}
		}
	}
	if n != 1 {
		t.Fatalf("initial batch has %d SourceChanged events, want 1", n)
	}
}

// Stopping mid-replay must keep the publisher read-only until the packet the
// loop is handling has been processed, or replay data reaches items.db.
func TestStopReplayKeepsReadOnlyUntilLoopDrains(t *testing.T) {
	db := withTestItemDB(t)
	c, pub, _ := sourceFixture(t)
	entered, release := make(chan struct{}), make(chan struct{})
	var once sync.Once
	pub.onPacket = func(*packet.GamePacket) {
		once.Do(func() { close(entered) })
		<-release
	}
	file := filepath.Join(t.TempDir(), "cap.pcapng")
	synthPcapng(t, file, snapshotPacket(), snapshotPacket())
	t.Cleanup(c.StopReplay)
	if err := c.StartReplay(file, ReplayOptions{}); err != nil {
		t.Fatal(err)
	}
	select {
	case <-entered:
	case <-time.After(5 * time.Second):
		t.Fatal("loop never started handling a replay packet")
	}
	stopped := make(chan struct{})
	go func() { c.StopReplay(); close(stopped) }()
	time.Sleep(150 * time.Millisecond)
	if !pub.readOnly.Load() {
		t.Fatal("read-only dropped while a replay packet was still being handled")
	}
	close(release)
	select {
	case <-stopped:
	case <-time.After(5 * time.Second):
		t.Fatal("StopReplay did not finish")
	}
	if n, _ := db.CountItems(replayTestEntity, "inventory"); n != 0 {
		t.Fatalf("replay packet wrote the item store during stop: %d rows", n)
	}
}

// The packet-log writer client must never see replay events.
func TestReplayEventsSkipPacketWriterClient(t *testing.T) {
	c, pub, _ := sourceFixture(t)
	writer := make(chan []event.IEvent, 100)
	pub.addClientOpt(context.Background(), writer, true)
	file := filepath.Join(t.TempDir(), "cap.pcapng")
	synthPcapng(t, file, snapshotPacket())
	t.Cleanup(c.StopReplay)
	if err := c.StartReplay(file, ReplayOptions{}); err != nil {
		t.Fatal(err)
	}
	waitFinished(t, c)
	c.StopReplay()
	for len(writer) > 0 {
		for _, e := range <-writer {
			if e.GetEventId() > 0 {
				t.Fatalf("packet writer received replay event %d", e.GetEventId())
			}
		}
	}
}

func TestReplayTruncatedFileReportsError(t *testing.T) {
	c, _, _ := sourceFixture(t)
	file := filepath.Join(t.TempDir(), "cap.pcapng")
	synthPcapng(t, file, snapshotPacket(), snapshotPacket(), snapshotPacket())
	b, err := os.ReadFile(file)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(file, b[:len(b)-40], 0o644); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(c.StopReplay)
	if err := c.StartReplay(file, ReplayOptions{}); err != nil {
		t.Fatal(err)
	}
	st := waitReturnedLive(t, c)
	if st.File != "cap.pcapng" {
		t.Fatalf("file name lost: %+v", st)
	}
}

// waitReturnedLive waits for a failed replay to fall back to live capture
// with its Err kept in the state.
func waitReturnedLive(t *testing.T, c *SourceController) SourceState {
	t.Helper()
	deadline := time.Now().Add(10 * time.Second)
	for time.Now().Before(deadline) {
		if st := c.State(); st.Mode == "live" && st.Err != "" {
			return st
		}
		time.Sleep(20 * time.Millisecond)
	}
	t.Fatalf("replay did not return to live with Err: %+v", c.State())
	return SourceState{}
}

func TestReplayNoGameStreamReturnsLiveWithErr(t *testing.T) {
	c, pub, hook := sourceFixture(t)
	file := filepath.Join(t.TempDir(), "cap.pcapng")
	synthPcapng(t, file) // valid capture, key packet only, no game packets
	t.Cleanup(c.StopReplay)
	if err := c.StartReplay(file, ReplayOptions{}); err != nil {
		t.Fatal(err)
	}
	st := waitReturnedLive(t, c)
	if st.Err != errNoGameContent {
		t.Fatalf("err=%q", st.Err)
	}
	if pub.readOnly.Load() {
		t.Fatal("still read-only after returning to live")
	}
	hook.mu.Lock()
	defer hook.mu.Unlock()
	if hook.resume != 1 {
		t.Fatalf("resume=%d", hook.resume)
	}
}
