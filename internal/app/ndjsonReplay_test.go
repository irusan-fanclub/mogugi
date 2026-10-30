package app

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/irusan-fanclub/mogugi/lib/event"
	"github.com/irusan-fanclub/mogugi/lib/packet"
)

func evBase(id event.EventId, who string) event.EventBase {
	return event.EventBase{EventId: id, At: 1700000000, Id: who}
}

// sampleEvents has one fully populated event per positive EventId.
func sampleEvents() []event.IEvent {
	return []event.IEvent{
		&event.EventEntityAppear{EventBase: evBase(event.EventIdEntityAppear, "1"), Name: "n", RaceId: 9, Height: 1.5, Weight: 2.5, Upper: 3.5, Lower: 4.5, GuildName: "g", OwnerId: "7"},
		&event.EventEntityDisappear{EventBase: evBase(event.EventIdEntityDisappear, "1")},
		&event.EventDamage{EventBase: evBase(event.EventIdDamage, "1"), TargetId: "2", SkillId: 3, Damage: 123.5, IsCritical: true, IsDelayed: true},
		&event.EventCharacterConditionEnable{EventBase: evBase(event.EventIdCharacterConditionEnable, "1"), CCId: 680, DisableAt: 99, AttackerId: "2", Params: map[string]string{"A": "1"}},
		&event.EventCharacterConditionDisable{EventBase: evBase(event.EventIdCharacterConditionDisable, "1"), CCId: 680},
		&event.EventFinish{EventBase: evBase(event.EventIdFinish, "1"), AttackerId: "2"},
		&event.EventEntityEquipItem{EventBase: evBase(event.EventIdEntityEquipItem, "1"), PocketType: 3, ItemId: 4, Color1: "a", Color2: "b", Color3: "c", Color5: "d", Color6: "e", Color7: "f"},
		&event.EventEntityUnequipItem{EventBase: evBase(event.EventIdEntityUnequipItem, "1"), PocketType: 3},
		&event.EventEntityUpdateBody{EventBase: evBase(event.EventIdEntityUpdateBody, "1"), Height: 1, Weight: 2, Upper: 3, Lower: 4},
		&event.EventStatUpdate{EventBase: evBase(event.EventIdStatUpdate, "1"), Data: []byte{1, 2, 3}},
		&event.EventChat{EventBase: evBase(event.EventIdChat, "1"), Channel: 2, From: "f", Message: "m"},
		&event.EventNotice{EventBase: evBase(event.EventIdNotice, "1"), Category: 4, Message: "m"},
		&event.EventChangeStance{EventBase: evBase(event.EventIdChangeStance, "1"), Stance: 2},
		&event.EventOwnerCharacter{EventBase: evBase(event.EventIdOwnerCharacter, "1"), Name: "me"},
		&event.EventSkillCast{EventBase: evBase(event.EventIdSkillCast, "1"), SkillId: 5},
		&event.EventBardsong{EventBase: evBase(event.EventIdBardsong, "1"), Performer: "p", Song: "s", Bonuses: map[string]float64{"x": 1.5}, IsEnd: true},
		&event.EventSkillUse{EventBase: evBase(event.EventIdSkillUse, "1"), SkillId: 6},
		&event.EventSkillPrepareStart{EventBase: evBase(event.EventIdSkillPrepareStart, "1"), SkillId: 7},
		&event.EventSkillStop{EventBase: evBase(event.EventIdSkillStop, "1"), SkillId: 8},
		&event.EventMaxLife{EventBase: evBase(event.EventIdMaxLife, "1"), MaxLife: 1e6},
		&event.EventEntityDown{EventBase: evBase(event.EventIdEntityDown, "1")},
		&event.EventCaptureStatus{EventBase: evBase(event.EventIdCaptureStatus, "0"), NpcapOk: true, GameDetected: true, Capturing: true, LastPacketAt: 5},
		&event.EventOwnerEquipment{EventBase: evBase(event.EventIdOwnerEquipment, "1"), Items: []event.EquipmentItem{{Pocket: 1, EID: "9", Item: map[string]any{"k": "v"}}}},
		&event.EventOwnerStats{EventBase: evBase(event.EventIdOwnerStats, "1"), Panel: packet.Panel{}},
		&event.EventBardsongPulse{EventBase: evBase(event.EventIdBardsongPulse, "1"), Targets: []string{"2", "3"}, Stop: true},
		&event.EventOwnerProfile{EventBase: evBase(event.EventIdOwnerProfile, "1"), Profile: packet.OwnerProfile{
			Titles:     &packet.OwnerTitles{TitleId: 10700, OptionTitleId: 9180},
			Talent:     &packet.OwnerTalent{GrandmasterTalentId: 10, OwnedTitleIds: []uint16{20016}},
			MultiClass: &packet.OwnerMultiClass{CurrentClassId: 10, Classes: []packet.OwnerClass{{ClassId: 10, Exp: 55455, ArcanaLevel: 10}}},
		}},
	}
}

func TestNdjsonRoundTrip(t *testing.T) {
	seen := map[event.EventId]bool{}
	for _, e := range sampleEvents() {
		seen[e.GetEventId()] = true
		line, err := json.Marshal(e) // the packet writer's encoder
		if err != nil {
			t.Fatal(err)
		}
		got, err := decodeNdjsonEvent(line)
		if err != nil || got == nil {
			t.Fatalf("id %d: got %v err %v", e.GetEventId(), got, err)
		}
		if !reflect.DeepEqual(got, e) {
			t.Errorf("id %d: round trip mismatch\n got %#v\nwant %#v", e.GetEventId(), got, e)
		}
	}
	// A new event type appended to lib/event must get a sample and a decoder.
	for id := event.EventId(1); id <= event.EventIdBardsongPulse; id++ {
		if !seen[id] {
			t.Errorf("no sample for event id %d", id)
		}
	}
	if !seen[event.EventIdOwnerProfile] {
		t.Error("no sample for EventOwnerProfile")
	}
	if got, err := decodeNdjsonEvent([]byte(`{"EventId":26}`)); got != nil || err != nil {
		t.Errorf("event id past the last known must be skipped, got %v %v", got, err)
	}
}

func TestNdjsonDecodeEdgeCases(t *testing.T) {
	for _, line := range []string{`{"EventId":999,"At":1}`, `{"EventId":-2,"Reason":"x"}`, `{"EventId":0}`, `{}`} {
		if got, err := decodeNdjsonEvent([]byte(line)); got != nil || err != nil {
			t.Errorf("%s: want (nil,nil), got %v %v", line, got, err)
		}
	}
	for _, line := range []string{`{"EventId":3,"Dama`, `not json`, ``} {
		if _, err := decodeNdjsonEvent([]byte(line)); err == nil {
			t.Errorf("%q: want error", line)
		}
	}
}

func writeNdjson(t *testing.T, evs ...event.IEvent) string {
	t.Helper()
	var sb strings.Builder
	for _, e := range evs {
		b, err := json.Marshal(e)
		if err != nil {
			t.Fatal(err)
		}
		sb.Write(b)
		sb.WriteByte('\n')
	}
	p := filepath.Join(t.TempDir(), "packet_log_test.ndjson")
	if err := os.WriteFile(p, []byte(sb.String()), 0o644); err != nil {
		t.Fatal(err)
	}
	return p
}

func damageEvents(n int) []event.IEvent {
	out := make([]event.IEvent, n)
	for i := range out {
		out[i] = &event.EventDamage{EventBase: event.EventBase{EventId: event.EventIdDamage, At: int64(i), Id: "1"}, TargetId: "2", SkillId: 1, Damage: float32(i + 1)}
	}
	return out
}

func collectDamage(ch <-chan []event.IEvent, want int, timeout time.Duration) []*event.EventDamage {
	var got []*event.EventDamage
	deadline := time.After(timeout)
	for len(got) < want {
		select {
		case b := <-ch:
			for _, e := range b {
				if d, ok := e.(*event.EventDamage); ok {
					got = append(got, d)
				}
			}
		case <-deadline:
			return got
		}
	}
	return got
}

func TestReplayNdjsonDeliversEvents(t *testing.T) {
	c, pub, hook := sourceFixture(t)
	const n = 350 // spans several publisher batches
	client := make(chan []event.IEvent, 1000)
	pub.addClient(context.Background(), client)
	file := writeNdjson(t, damageEvents(n)...)
	t.Cleanup(c.StopReplay)
	if err := c.StartReplay(file, ReplayOptions{}); err != nil {
		t.Fatal(err)
	}
	got := collectDamage(client, n, 10*time.Second)
	if len(got) != n {
		t.Fatalf("client got %d damage events, want %d", len(got), n)
	}
	for i, d := range got {
		if d.Damage != float32(i+1) {
			t.Fatalf("event %d out of order: %v", i, d.Damage)
		}
	}
	waitFinished(t, c)
	st := c.State()
	if st.Mode != "replay" || st.Err != "" || st.Total == 0 || st.Done != st.Total {
		t.Fatalf("bad final state: %+v", st)
	}
	if !pub.readOnly.Load() {
		t.Fatal("ndjson replay must be read-only")
	}
	c.StopReplay()
	if pub.readOnly.Load() {
		t.Fatal("read-only not cleared after stop")
	}
	if p, r := hook.counts(); p != 1 || r != 1 {
		t.Fatalf("capture pause/resume = %d/%d", p, r)
	}
}

func TestReplayNdjsonSkipsJunkAndReportsIt(t *testing.T) {
	c, pub, _ := sourceFixture(t)
	client := make(chan []event.IEvent, 100)
	pub.addClient(context.Background(), client)
	file := writeNdjson(t, damageEvents(3)...)
	f, _ := os.OpenFile(file, os.O_APPEND|os.O_WRONLY, 0o644)
	// unknown id, runtime id, truncated tail
	f.WriteString("{\"EventId\":999}\n{\"EventId\":-2}\n{\"EventId\":3,\"Dama")
	f.Close()
	t.Cleanup(c.StopReplay)
	if err := c.StartReplay(file, ReplayOptions{}); err != nil {
		t.Fatal(err)
	}
	if got := collectDamage(client, 3, 5*time.Second); len(got) != 3 {
		t.Fatalf("got %d", len(got))
	}
	waitFinished(t, c)
	if st := c.State(); st.Err != "" || st.Notice == "" {
		t.Fatalf("unparseable line must be a notice, not an error: %+v", st)
	}
}

func TestReplayNdjsonSkipsCaptureStatus(t *testing.T) {
	c, pub, _ := sourceFixture(t)
	client := make(chan []event.IEvent, 100)
	pub.addClient(context.Background(), client)
	file := writeNdjson(t, &event.EventCaptureStatus{EventBase: evBase(event.EventIdCaptureStatus, "0"), Capturing: true}, damageEvents(1)[0])
	t.Cleanup(c.StopReplay)
	if err := c.StartReplay(file, ReplayOptions{}); err != nil {
		t.Fatal(err)
	}
	waitFinished(t, c)
	for len(client) > 0 {
		for _, e := range <-client {
			if e.GetEventId() == event.EventIdCaptureStatus {
				t.Fatal("recorded capture status leaked into the live status")
			}
		}
	}
}

// Stop must wait for the feeder to leave the publisher before read-only drops.
func TestStopNdjsonReplayKeepsReadOnlyUntilFeederDrains(t *testing.T) {
	c, pub, _ := sourceFixture(t)
	entered, release := make(chan struct{}), make(chan struct{})
	var calls atomic.Int32
	pub.onReplayBatch = func() {
		if calls.Add(1) == 1 {
			close(entered)
			<-release
		}
	}
	file := writeNdjson(t, damageEvents(2000)...)
	t.Cleanup(c.StopReplay)
	if err := c.StartReplay(file, ReplayOptions{}); err != nil {
		t.Fatal(err)
	}
	select {
	case <-entered:
	case <-time.After(5 * time.Second):
		t.Fatal("feeder never published a batch")
	}
	stopped := make(chan struct{})
	go func() { c.StopReplay(); close(stopped) }()
	time.Sleep(150 * time.Millisecond)
	if !pub.readOnly.Load() {
		t.Fatal("read-only dropped while the feeder was still inside the publisher")
	}
	close(release)
	select {
	case <-stopped:
	case <-time.After(5 * time.Second):
		t.Fatal("StopReplay did not finish")
	}
	after := calls.Load()
	time.Sleep(200 * time.Millisecond)
	if calls.Load() != after {
		t.Fatal("feeder published after stop returned")
	}
	if st := c.State(); st.Mode != "live" {
		t.Fatalf("state after stop: %+v", st)
	}
}

// The feeder must wait for a backed-up client instead of overflowing its queue.
func TestReplayNdjsonWaitsForSlowClient(t *testing.T) {
	c, pub, _ := sourceFixture(t)
	slow := make(chan []event.IEvent, 4) // tiny queue, nobody reading yet
	id := pub.addClient(context.Background(), slow)
	const n = 3000
	file := writeNdjson(t, damageEvents(n)...)
	t.Cleanup(c.StopReplay)
	if err := c.StartReplay(file, ReplayOptions{}); err != nil {
		t.Fatal(err)
	}
	time.Sleep(300 * time.Millisecond)
	pub.Lock()
	_, alive := pub.clientMap[id]
	pub.Unlock()
	if !alive {
		t.Fatal("slow client was dropped by replay flooding")
	}
	if got := collectDamage(slow, n, 15*time.Second); len(got) != n {
		t.Fatalf("slow client got %d of %d", len(got), n)
	}
}

func TestReplayNdjsonImportBattlesNotice(t *testing.T) {
	c, pub, _ := sourceFixture(t)
	file := writeNdjson(t, damageEvents(3)...)
	t.Cleanup(c.StopReplay)
	if err := c.StartReplay(file, ReplayOptions{ImportBattles: true}); err != nil {
		t.Fatal(err)
	}
	if pub.importBattles.Load() {
		t.Fatal("importBattles must stay off for ndjson")
	}
	if c.State().Notice != ndjsonNoBattleNotice {
		t.Fatalf("notice missing at start: %+v", c.State())
	}
	waitFinished(t, c)
	if st := c.State(); st.Notice != ndjsonNoBattleNotice || st.Err != "" {
		t.Fatalf("notice lost in final state: %+v", st)
	}
}

func TestReplayNdjsonDisconnectedBackloggedClientDoesNotStall(t *testing.T) {
	c, pub, _ := sourceFixture(t)
	dead := make(chan []event.IEvent, 4)
	dead <- nil
	dead <- nil // half full, nobody reads
	ctx, cancel := context.WithCancel(context.Background())
	pub.addClient(ctx, dead)
	live := make(chan []event.IEvent, 1000)
	pub.addClient(context.Background(), live)
	file := writeNdjson(t, damageEvents(300)...)
	t.Cleanup(c.StopReplay)
	if err := c.StartReplay(file, ReplayOptions{}); err != nil {
		t.Fatal(err)
	}
	// Disconnect while the feeder waits: only the backlog check can notice it.
	time.Sleep(50 * time.Millisecond)
	cancel()
	if got := collectDamage(live, 300, 3*time.Second); len(got) != 300 {
		t.Fatalf("replay stalled behind a disconnected client: %d", len(got))
	}
}

func TestReplayNdjsonDropsClientStuckBacklogged(t *testing.T) {
	old := backlogGiveUp
	backlogGiveUp = 200 * time.Millisecond
	t.Cleanup(func() { backlogGiveUp = old })
	c, pub, _ := sourceFixture(t)
	stuck := make(chan []event.IEvent, 4)
	stuck <- nil
	stuck <- nil // half full, alive, never drains
	id := pub.addClient(context.Background(), stuck)
	file := writeNdjson(t, damageEvents(300)...)
	t.Cleanup(c.StopReplay)
	if err := c.StartReplay(file, ReplayOptions{}); err != nil {
		t.Fatal(err)
	}
	waitFinished(t, c)
	pub.Lock()
	_, alive := pub.clientMap[id]
	pub.Unlock()
	if alive {
		t.Fatal("stuck client was never dropped")
	}
}

func TestNdjsonOnlyUnknownEventsReturnsLiveWithErr(t *testing.T) {
	c, _, _ := sourceFixture(t)
	p := filepath.Join(t.TempDir(), "x.ndjson")
	body := `{"EventId":999}` + "\n" + `{"EventId":-2}` + "\n"
	if err := os.WriteFile(p, []byte(body), 0o644); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(c.StopReplay)
	if err := c.StartReplay(p, ReplayOptions{}); err != nil {
		t.Fatal(err)
	}
	if st := waitReturnedLive(t, c); st.Err != errNoGameContent {
		t.Fatalf("err=%q", st.Err)
	}
}
