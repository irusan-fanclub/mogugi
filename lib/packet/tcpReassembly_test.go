package packet

import (
	"bytes"
	"context"
	"testing"
	"time"
)

const testMSS = 1436

// testStream returns a payload of n bytes whose content encodes its offset,
// so any reorder, duplicate or hole shows up as a byte mismatch.
func testStream(n int) []byte {
	b := make([]byte, n)
	for i := range b {
		b[i] = byte(i*7 + i/251)
	}
	return b
}

type testSeg struct {
	seq  uint32
	data []byte
}

// segment splits data (starting at seq base) into MSS-sized segments.
func segment(base uint32, data []byte) []testSeg {
	var out []testSeg
	for off := 0; off < len(data); off += testMSS {
		end := min(off+testMSS, len(data))
		out = append(out, testSeg{seq: base + uint32(off), data: data[off:end]})
	}
	return out
}

type collector struct {
	out []gamePacketPayload
}

func (c *collector) send(p gamePacketPayload) {
	c.out = append(c.out, gamePacketPayload{stream: p.stream, relSeq: p.relSeq, data: append([]byte(nil), p.data...), at: p.at, gap: p.gap})
}

func (c *collector) bytes() []byte {
	var b []byte
	for _, p := range c.out {
		b = append(b, p.data...)
	}
	return b
}

// feed pushes segs in the given order; each segment's buffer is clobbered
// after push to catch the reassembler keeping a reference to it.
func feed(st *tcpStreamState, c *collector, segs []testSeg, at time.Time) {
	for _, s := range segs {
		buf := append([]byte(nil), s.data...)
		st.push(s.seq, buf, at, c.send)
		for i := range buf {
			buf[i] = 0xEE
		}
	}
}

func newTestStream(base uint32) *tcpStreamState {
	return &tcpStreamState{baseSeq: base}
}

func assertStream(t *testing.T, c *collector, want []byte) {
	t.Helper()
	got := c.bytes()
	if !bytes.Equal(got, want) {
		n := 0
		for n < len(got) && n < len(want) && got[n] == want[n] {
			n++
		}
		t.Fatalf("reassembled stream differs at byte %d (got %d bytes, want %d)", n, len(got), len(want))
	}
	var exp uint32
	for i, p := range c.out {
		if p.relSeq != exp {
			t.Fatalf("payload %d relSeq=%d, want %d", i, p.relSeq, exp)
		}
		exp += uint32(len(p.data))
	}
}

func TestReassembly_InOrder(t *testing.T) {
	data := testStream(20 * testMSS)
	st, c := newTestStream(1000), &collector{}
	feed(st, c, segment(1000, data), time.Unix(0, 0))
	assertStream(t, c, data)
}

// The 2026-10-03 failure: one segment of the ~1 MB 0x5209 snapshot is lost
// and its retransmit arrives after more than 100 later segments.
func TestReassembly_LateRetransmitAfterManySegments(t *testing.T) {
	data := testStream(300 * testMSS)
	segs := segment(5000, data)
	order := append([]testSeg{}, segs[:10]...)
	order = append(order, segs[11:200]...)
	order = append(order, segs[10])
	order = append(order, segs[200:]...)

	st, c := newTestStream(5000), &collector{}
	feed(st, c, order, time.Unix(0, 0))
	assertStream(t, c, data)
}

// Two holes whose retransmits arrive in reverse order.
func TestReassembly_RetransmitsOutOfOrder(t *testing.T) {
	data := testStream(40 * testMSS)
	segs := segment(0x10000, data)
	order := append([]testSeg{}, segs[:5]...)
	order = append(order, segs[6:20]...)
	order = append(order, segs[21:30]...)
	order = append(order, segs[20], segs[5])
	order = append(order, segs[30:]...)

	st, c := newTestStream(0x10000), &collector{}
	feed(st, c, order, time.Unix(0, 0))
	assertStream(t, c, data)
}

// A retransmit of data already delivered must not be replayed, even when
// it lands while a later hole is pending.
func TestReassembly_StaleRetransmitDropped(t *testing.T) {
	data := testStream(20 * testMSS)
	segs := segment(0, data)
	order := append([]testSeg{}, segs[:8]...)
	order = append(order, segs[9:12]...)
	order = append(order, segs[3]) // stale duplicate while seg 8 is missing
	order = append(order, segs[8])
	order = append(order, segs[12:]...)

	st, c := newTestStream(0), &collector{}
	feed(st, c, order, time.Unix(0, 0))
	st.flush(c.send)
	assertStream(t, c, data)
}

// A retransmit re-segmented at a different boundary than the original.
func TestReassembly_ResegmentedRetransmit(t *testing.T) {
	data := testStream(10 * testMSS)
	segs := segment(0, data)
	lostEnd := segs[5].seq + uint32(len(segs[5].data))
	order := append([]testSeg{}, segs[:4]...)
	order = append(order, segs[6:]...)
	// Retransmit covers 3..5 in one big segment, overlapping delivered data.
	order = append(order, testSeg{seq: segs[3].seq, data: data[segs[3].seq:lostEnd]})

	st, c := newTestStream(0), &collector{}
	feed(st, c, order, time.Unix(0, 0))
	assertStream(t, c, data)
}

// Absolute sequence numbers are random, so a stream can cross 2^32. A stale
// pre-wrap duplicate arriving after the wrap must not block later drains.
func TestReassembly_SeqWraparound(t *testing.T) {
	data := testStream(30 * testMSS)
	base := uint32(0xFFFFFFFF - 10*testMSS)
	segs := segment(base, data)
	order := append([]testSeg{}, segs[:15]...) // crosses the wrap at seg 10
	order = append(order, segs[2])             // stale pre-wrap duplicate
	order = append(order, segs[16:20]...)      // seg 15 lost
	order = append(order, segs[15])
	order = append(order, segs[20:]...)

	st, c := newTestStream(base), &collector{}
	feed(st, c, order, time.Unix(0, 0))
	assertStream(t, c, data)
}

// holeOrder drops segs[hole] for good and returns the rest plus the bytes
// a reader should end up with.
func holeOrder(data []byte, segs []testSeg, hole int) ([]testSeg, []byte) {
	order := append(append([]testSeg{}, segs[:hole]...), segs[hole+1:]...)
	want := append(append([]byte{}, data[:hole*testMSS]...), data[(hole+1)*testMSS:]...)
	return order, want
}

func assertGapAt(t *testing.T, c *collector, relSeq uint32) {
	t.Helper()
	n := 0
	for _, p := range c.out {
		if p.gap {
			n++
			if p.relSeq != relSeq {
				t.Fatalf("gap flagged at relSeq=%d, want %d", p.relSeq, relSeq)
			}
		}
	}
	if n != 1 {
		t.Fatalf("got %d gap-flagged payloads, want 1", n)
	}
}

// A segment pcap never saw is never retransmitted: once the pending bytes
// pass the cap, skip the hole and flag the next payload.
func TestReassembly_PendingCapSkipsGap(t *testing.T) {
	n := reassemblyMaxPendingBytes/testMSS + 50
	data := testStream(n * testMSS)
	segs := segment(0, data)
	order, want := holeOrder(data, segs, 7)

	st, c := newTestStream(0), &collector{}
	feed(st, c, order, time.Unix(0, 0))
	if got := c.bytes(); !bytes.Equal(got, want[:len(got)]) || len(got) < len(want)-reassemblyMaxPendingBytes {
		t.Fatalf("stream after cap skip is wrong (got %d bytes)", len(got))
	}
	assertGapAt(t, c, 8*testMSS)
}

func TestReassembly_GapTimeout(t *testing.T) {
	data := testStream(20 * testMSS)
	segs := segment(0, data)
	order, want := holeOrder(data, segs, 7)
	t0 := time.Unix(100, 0)

	st, c := newTestStream(0), &collector{}
	feed(st, c, order, t0)
	st.expire(t0.Add(reassemblyGapTimeout-time.Millisecond), c.send)
	if len(c.bytes()) != 7*testMSS {
		t.Fatalf("expired early: %d bytes out", len(c.bytes()))
	}
	st.expire(t0.Add(reassemblyGapTimeout), c.send)
	if !bytes.Equal(c.bytes(), want) {
		t.Fatalf("stream after timeout skip is wrong")
	}
	assertGapAt(t, c, 8*testMSS)
}

// testGamePacket builds a normal (flag 0) game packet carrying one int elem.
func testGamePacket(op uint32, length int) []byte {
	b := make([]byte, 0, length)
	b = append(b, 0x01, 0, 0, 0, 0, 0)
	b = be.AppendUint32(b, op)
	b = be.AppendUint64(b, 0x10_0000_0000_0001)
	b = append(b, 0x00)       // body-length varint (unused by the parser)
	b = append(b, 0x01, 0x00) // elem count, unused byte
	b = append(b, byte(MessageElemTypeInt), 0, 0, 0, 42)
	for len(b) < length {
		b = append(b, 0) // trailing bytes the message parser ignores
	}
	le.PutUint32(b[1:5], uint32(len(b)))
	return b
}

// After a hole, the bytes of a packet cut by it must be dropped, or a
// stale header (here a 5000-byte one) swallows the packets that follow.
func TestPacketLoop_GapDropsPartialPacket(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	r := &GameServerPacketReader{ctx: ctx, packetCh: make(chan *GamePacket, 10), quiet: true}
	in := make(chan gamePacketPayload, 10)
	go r.packetLoop(in)

	at := time.Unix(0, 0)
	p1, p2, p3 := testGamePacket(0x1111, 26), testGamePacket(0x2222, 5000), testGamePacket(0x3333, 26)
	in <- gamePacketPayload{relSeq: 0, data: p1, at: at}
	in <- gamePacketPayload{relSeq: 26, data: p2[:10], at: at}
	in <- gamePacketPayload{relSeq: 2000, data: p3, at: at, gap: true}

	var ops []uint32
	timeout := time.After(time.Second)
	for len(ops) < 2 {
		select {
		case p := <-r.packetCh:
			ops = append(ops, uint32(p.Op))
		case <-timeout:
			t.Fatalf("got ops %x, want [1111 3333]", ops)
		}
	}
	if ops[0] != 0x1111 || ops[1] != 0x3333 {
		t.Fatalf("got ops %x, want [1111 3333]", ops)
	}
}
