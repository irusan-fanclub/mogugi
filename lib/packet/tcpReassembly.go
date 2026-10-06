package packet

import (
	"sort"
	"time"
)

// reassemblyMaxPendingBytes bounds how much out-of-order data one stream
// may hold while waiting for a lost segment. It must outlast a retransmit
// timeout at full rate: the ~1 MB 0x5209 snapshot at login is the burst.
const reassemblyMaxPendingBytes = 4 << 20

// reassemblyGapTimeout is how long a hole may wait for its retransmit.
const reassemblyGapTimeout = 3 * time.Second

// pendingSegment buffers a TCP segment that arrived out of order,
// waiting for earlier sequence numbers to fill in the gap.
type pendingSegment struct {
	seq  uint32
	data []byte
	at   time.Time
}

// tcpStreamState reassembles one server->client TCP stream into
// in-order payloads for packetLoop.
type tcpStreamState struct {
	id           uint32
	baseSeq      uint32
	nextSeq      uint32
	synced       bool             // nextSeq is valid
	pending      []pendingSegment // sorted by seq, all after nextSeq
	pendingBytes int
	gapSince     time.Time // capture time the current hole was first seen
	gapNext      bool      // flag the next emitted payload as following a hole
	rejected     bool      // not a Client.exe connection: don't parse, don't record
}

// seqBefore reports a < b in TCP sequence space (wrap-safe).
func seqBefore(a, b uint32) bool { return int32(a-b) < 0 }

func (st *tcpStreamState) emit(send func(gamePacketPayload), seq uint32, data []byte, at time.Time) {
	send(gamePacketPayload{stream: st.id, relSeq: seq - st.baseSeq, data: data, at: at, gap: st.gapNext})
	st.gapNext = false
}

// push feeds one captured segment. payload may be reused by the caller
// after push returns; anything kept in pending is copied.
func (st *tcpStreamState) push(seq uint32, payload []byte, at time.Time, send func(gamePacketPayload)) {
	if !st.synced {
		st.nextSeq, st.synced = seq, true
	}
	end := seq + uint32(len(payload))
	if !seqBefore(st.nextSeq, end) {
		return // retransmit of data already delivered
	}
	if seqBefore(st.nextSeq, seq) {
		if len(st.pending) == 0 {
			st.gapSince = at
		}
		st.insertPending(seq, payload, at)
		if st.pendingBytes > reassemblyMaxPendingBytes {
			st.skipGap(send)
		}
		return
	}
	st.emit(send, st.nextSeq, payload[st.nextSeq-seq:], at)
	st.nextSeq = end
	st.drain(send)
}

// insertPending keeps pending sorted; a same-seq duplicate keeps the longer copy.
func (st *tcpStreamState) insertPending(seq uint32, payload []byte, at time.Time) {
	off := seq - st.nextSeq
	i := sort.Search(len(st.pending), func(i int) bool { return st.pending[i].seq-st.nextSeq >= off })
	if i < len(st.pending) && st.pending[i].seq == seq {
		if len(payload) <= len(st.pending[i].data) {
			return
		}
		st.pendingBytes -= len(st.pending[i].data)
		st.pending[i] = pendingSegment{seq: seq, data: append([]byte(nil), payload...), at: at}
		st.pendingBytes += len(payload)
		return
	}
	st.pending = append(st.pending, pendingSegment{})
	copy(st.pending[i+1:], st.pending[i:])
	st.pending[i] = pendingSegment{seq: seq, data: append([]byte(nil), payload...), at: at}
	st.pendingBytes += len(payload)
}

// drain emits pending segments that are now contiguous with nextSeq.
func (st *tcpStreamState) drain(send func(gamePacketPayload)) {
	for len(st.pending) > 0 {
		v := st.pending[0]
		if seqBefore(st.nextSeq, v.seq) {
			return // an earlier segment is still missing
		}
		st.pending = st.pending[1:]
		st.pendingBytes -= len(v.data)
		end := v.seq + uint32(len(v.data))
		if seqBefore(st.nextSeq, end) {
			st.emit(send, st.nextSeq, v.data[st.nextSeq-v.seq:], v.at)
			st.nextSeq = end
		}
	}
}

// skipGap gives up on the missing bytes before the first pending segment.
func (st *tcpStreamState) skipGap(send func(gamePacketPayload)) {
	if len(st.pending) == 0 {
		return
	}
	st.nextSeq = st.pending[0].seq
	st.gapNext = true
	st.drain(send)
	if len(st.pending) > 0 {
		st.gapSince = st.pending[0].at // the next hole starts its own wait
	}
}

// expire skips a hole whose retransmit is overdue at capture time now.
func (st *tcpStreamState) expire(now time.Time, send func(gamePacketPayload)) {
	if len(st.pending) > 0 && now.Sub(st.gapSince) >= reassemblyGapTimeout {
		st.skipGap(send)
	}
}

// flush emits whatever is still pending (reader shutdown).
func (st *tcpStreamState) flush(send func(gamePacketPayload)) {
	for len(st.pending) > 0 {
		st.skipGap(send)
	}
}
