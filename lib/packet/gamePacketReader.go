package packet

import (
	"bytes"
	"context"
	"encoding/binary"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"sync"
	"time"

	"github.com/gopacket/gopacket"
	"github.com/gopacket/gopacket/layers"
	"github.com/gopacket/gopacket/pcap"
	"github.com/gopacket/gopacket/pcapgo"
	"github.com/irusan-fanclub/mabidilmeter/lib/util"
)

type GameServerPacketReader struct {
	// non-mutable
	ctx       context.Context
	ctxCancel context.CancelFunc
	packetCh  chan *GamePacket
	quiet     bool
	realtime  bool

	// mutable
	handle *pcap.Handle
	fd     *os.File

	closeOnce sync.Once
	vetPort   func(port string) bool
	// resetCh signals packetLoop to drop its partial parse buffer after a
	// same-net channel switch (stale bytes from the old stream).
	resetCh chan struct{}

	logHandle *pcapgo.NgWriter
	logFd     *os.File
	linkType  layers.LinkType

	// statistics (owned by packetLoop's goroutine — do not read elsewhere)
	payloadCount    uint64 // number of received TCP payloads
	parsedCount     uint64 // number of successfully parsed game packets
	parseErrorCount uint64 // number of parse errors
}

type GameServerPacketReaderOpt struct {
	Ctx      context.Context
	FileName string
	NicName  string
	// Filter is the BPF expression for live capture (ignored for files).
	Filter string
	// VetLocalPort, when set, is asked once per new TCP stream whether the
	// local (dst) port is the game client's. Rejected streams are neither
	// parsed nor recorded. Nil accepts everything (file replay).
	VetLocalPort func(port string) bool
	// Quiet suppresses informational logs and skips opening the pcapng
	// log file. Used by short-lived test readers (NIC discovery probes)
	// so they don't spam the log or stomp on the live capture file.
	Quiet bool
	// Realtime paces file replay by capture timestamp diffs (capped at
	// 200ms per gap) so the frontend sees events at original cadence.
	Realtime bool
}

type gamePacketPayload struct {
	stream uint32 // per-connection stream id（readPacketLoop 配發）
	relSeq uint32
	data   []byte
	at     time.Time
}

// pendingTcpLayer buffers a TCP segment that arrived out of order,
// waiting for earlier sequence numbers to fill in the gap.
type pendingTcpLayer struct {
	tcpLayer layers.TCP
	ci       gopacket.CaptureInfo
}

const pcapQueueSize = 100
const pcapBufferSize = 32 * 1024 * 1024
const pcapPromisc = true
const packetQueueSize = 100

var ErrTooShortPacket = errors.New("too short packet")

func NewGameServerPacketReader(opt *GameServerPacketReaderOpt) (_ *GameServerPacketReader, retErr error) {
	if opt == nil {
		return nil, errors.New("opt is nil")
	}

	// File replays are already pre-filtered; live mode passes the BPF
	// expression via opt.Filter (built by pcaputil.CurrentFilter).
	filter := opt.Filter
	if opt.FileName != "" {
		filter = ""
	}

	if !opt.Quiet {
		logger.Println("game packet filter...", filter)
	}

	// Derive a cancellable context from the parent so Close() can stop
	// our internal goroutines without requiring the parent ctx to be
	// cancelled (e.g. on channel-switch the parent ctx is the long-lived
	// process ctx).
	ctx, cancel := context.WithCancel(opt.Ctx)

	v := &GameServerPacketReader{
		ctx:       ctx,
		ctxCancel: cancel,
		packetCh:  make(chan *GamePacket, packetQueueSize),
		quiet:     opt.Quiet,
		realtime:  opt.Realtime,
		vetPort:   opt.VetLocalPort,
		linkType:  layers.LinkTypeNull, // default, will be updated when opening
		resetCh:   make(chan struct{}, 1),
	}

	// Any failure after a handle/fd is opened must close it — the returned
	// nil object can't be Closed by the caller, so it would leak otherwise.
	defer func() {
		if retErr != nil {
			v.Close()
		}
	}()

	var payloadCh chan gamePacketPayload
	err := error(nil)
	isFile := opt.FileName != ""
	if isFile {
		payloadCh, err = v.openFile(opt.FileName, filter)
		if err != nil {
			logger.Println("openFile failed", err)
			return nil, err
		}
	} else {
		payloadCh, err = v.openNic(opt.NicName, filter)
		if err != nil {
			logger.Println("openNic failed", err)
			return nil, err
		}
	}

	// openLog must run after openNic/openFile so t.linkType is the real
	// link type (not the default) when the pcapng writer is initialised.
	// Skip for quiet/test readers — they're short-lived probes and would
	// truncate the live pcapng capture if allowed to write to it.
	if !opt.Quiet {
		if err := v.openLog(); err != nil {
			logger.Println("openLog failed", err)
			return nil, err
		}
	}

	// Start readPacketLoop. File mode delays 20 seconds so a WebSocket
	// client has time to connect before replay begins; NIC mode starts
	// immediately.
	if isFile {
		time.AfterFunc(20*time.Second, func() {
			logger.Println("start readPacketLoop", opt.FileName)
			go v.readPacketLoop(payloadCh)
		})
	} else {
		go v.readPacketLoop(payloadCh)
	}

	go v.packetLoop(payloadCh)

	return v, nil
}

func (t *GameServerPacketReader) packetLoop(payloadCh <-chan gamePacketPayload) {
	// Per-stream parse state: TCP payload bytes from different connections
	// must never be concatenated. The game itself runs several live streams
	// (field conn + mission-instance conn); sibling-service noise captured
	// by the wide filter self-classifies as junk (only-ever-errors) and is
	// squelched. On parse failure we drop the frontmost payload (a full
	// segment) of that stream and retry — granular recovery without the
	// cascading false positives of byte-level scans.
	type parseState struct {
		buffer     *bytes.Buffer
		payloads   []gamePacketPayload
		lastRelSeq uint32
		lastAt     time.Time
		errCount   int
		okCount    int
		junk       bool
	}
	states := map[uint32]*parseState{}
	const junkErrThreshold = 10

	// skipPayload advances the front of the payloads list by n bytes
	// after a successful parse.
	skipPayload := func(st *parseState, n int) {
		for n > 0 && len(st.payloads) > 0 {
			if n < len(st.payloads[0].data) {
				st.lastRelSeq, st.lastAt = st.payloads[0].relSeq, st.payloads[0].at
				st.payloads[0].data = st.payloads[0].data[n:]
				return
			}
			n -= len(st.payloads[0].data)
			st.lastRelSeq, st.lastAt = st.payloads[0].relSeq, st.payloads[0].at
			st.payloads = st.payloads[1:]
		}
	}

	// nextPayload drops the frontmost payload (one TCP segment) and
	// rebuilds the buffer from the remaining payloads. Called on parse error.
	nextPayload := func(st *parseState) {
		st.buffer.Reset()
		if len(st.payloads) < 1 {
			return
		}
		st.payloads = st.payloads[1:]
		if len(st.payloads) < 1 {
			return
		}
		for _, v := range st.payloads {
			st.buffer.Write(v.data)
		}
		st.lastRelSeq, st.lastAt = st.payloads[0].relSeq, st.payloads[0].at
	}

	pushPayload := func(st *parseState, payloadData gamePacketPayload) {
		if st.buffer.Len() < 1 {
			st.buffer.Reset()
		}
		if len(st.payloads) < 1 {
			st.lastRelSeq, st.lastAt = payloadData.relSeq, payloadData.at
		}
		st.payloads = append(st.payloads, payloadData)
		st.buffer.Write(payloadData.data)
	}

	for {
		var payloadData gamePacketPayload
		select {
		case <-t.ctx.Done():
			if !t.quiet {
				logger.Printf("[Stats] Payloads: %d, Parsed: %d, Errors: %d",
					t.payloadCount, t.parsedCount, t.parseErrorCount)
			}
			return

		case <-t.resetCh:
			// Same-net channel switch: discard every stream's partial
			// packet so new-stream bytes parse cleanly from the start.
			states = map[uint32]*parseState{}
			continue

		case payloadData = <-payloadCh:
		}

		t.payloadCount++
		st := states[payloadData.stream]
		if st == nil {
			st = &parseState{buffer: bytes.NewBuffer(nil), lastAt: time.Now()}
			states[payloadData.stream] = st
		}
		if st.junk {
			continue
		}
		pushPayload(st, payloadData)

	readerLoop:
		for {
			msg, consumed, err := parseGamePacket(st.buffer.Bytes(), st.lastAt)
			if err != nil {
				if err == io.EOF {
					break readerLoop
				}
				t.parseErrorCount++
				st.errCount++
				if st.okCount == 0 && st.errCount >= junkErrThreshold {
					// 從未成功解析過＝非遊戲協定（同網段其他服務），封鎖。
					st.junk = true
					st.buffer.Reset()
					st.payloads = nil
					logger.Printf("stream #%d squelched after %d parse errors (non-game traffic)",
						payloadData.stream, st.errCount)
					break readerLoop
				}
				logger.Printf("[ParseError #%d] stream=%d relSeq=%d %v",
					t.parseErrorCount, payloadData.stream, st.lastRelSeq, err)
				nextPayload(st)
				continue
			}

			if msg != nil {
				st.buffer.Next(consumed)
				t.parsedCount++
				st.okCount++
				select {
				case t.packetCh <- msg:
				case <-t.ctx.Done():
					return
				}
				skipPayload(st, consumed)
			}
		}
	}
}

// openNic opens the NIC, sets the BPF filter and captures the link
// type. It does NOT start readPacketLoop — the caller is expected to
// spawn it after openLog has been called.
func (t *GameServerPacketReader) openNic(nic string, filter string) (chan gamePacketPayload, error) {
	handle, err := pcap.OpenLive(nic, pcapBufferSize, pcapPromisc, pcap.BlockForever)
	if err != nil {
		logger.Println(err)
		return nil, err
	}
	t.handle = handle
	t.linkType = handle.LinkType()

	if err := handle.SetBPFFilter(filter); err != nil { // optional
		return nil, err
	}

	ch := make(chan gamePacketPayload, pcapQueueSize)
	return ch, nil
}

// openFile opens a pcapng file, sets the BPF filter and captures the
// link type. It does NOT start readPacketLoop.
func (t *GameServerPacketReader) openFile(file string, filter string) (chan gamePacketPayload, error) {
	fd, err := os.OpenFile(file, os.O_RDONLY, 0644)
	if err != nil {
		logger.Println(err)
		return nil, err
	}

	t.fd = fd

	/*
		When calling OpenOffline, fileName is passed as UTF-8,
		but libpcap opens the file with multibyte fopen -> Korean paths get corrupted

		It might be better to call pcap_init(PCAP_CHAR_ENC_UTF_8) in libpcap
	*/
	handle, err := pcap.OpenOfflineFile(fd)
	if err != nil {
		logger.Println(err)
		return nil, err
	}

	if filter != "" {
		if err := handle.SetBPFFilter(filter); err != nil { // optional
			logger.Println(err)
			return nil, err
		}
	}

	t.handle = handle
	t.linkType = handle.LinkType()
	logger.Printf("File LinkType: %v", t.linkType)

	ch := make(chan gamePacketPayload, pcapQueueSize)
	return ch, nil
}

func (t *GameServerPacketReader) openLog() error {
	logDir := "logs"
	if err := os.MkdirAll(logDir, os.ModePerm); err != nil {
		logger.Println(err)
		return err
	}
	// 換線會建立新 reader；若沿用同名檔 O_TRUNC 會把先前捕獲（含 0x5209
	// 快照）整個洗掉——曾造成 capture 無法回放（session 1783517744）。
	// 每個 reader 一個檔：用 O_EXCL 開，撞名就換下一個 suffix，永不覆寫既有檔
	// （兩個 reader 同一秒建立時，單純加時間戳仍會撞名並被 O_TRUNC 洗掉）。
	base := fmt.Sprintf("packet_capture_%v", util.StartUnix)
	var fd *os.File
	var err error
	for i := 0; ; i++ {
		name := base + ".pcapng"
		if i > 0 {
			name = fmt.Sprintf("%s_%d.pcapng", base, i)
		}
		fd, err = os.OpenFile(filepath.Join(logDir, name), os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0644)
		if err == nil {
			break
		}
		if !os.IsExist(err) {
			logger.Println(err)
			return err
		}
	}

	t.logFd = fd

	// Use actual link type from the network interface (or file)
	// Default to LinkTypeNull for loopback, which is common for localhost
	linkType := t.linkType
	if linkType == 0 {
		linkType = layers.LinkTypeNull
	}

	handle, err := pcapgo.NewNgWriter(fd, linkType)
	if err != nil {
		logger.Println(err)
		return err
	}

	t.logHandle = handle

	return nil
}

func (t *GameServerPacketReader) readPacketLoop(ch chan<- gamePacketPayload) {
	eth := layers.Ethernet{}
	ip4 := layers.IPv4{}
	tcp := layers.TCP{}
	payload := gopacket.Payload{}

	// Pick the decoding parser based on the link type (supports Ethernet
	// and loopback).
	var layerParser *gopacket.DecodingLayerParser
	switch t.linkType {
	case layers.LinkTypeNull, layers.LinkTypeLoop:
		layerParser = gopacket.NewDecodingLayerParser(layers.LayerTypeIPv4, &ip4, &tcp, &payload)
	default:
		layerParser = gopacket.NewDecodingLayerParser(layers.LayerTypeEthernet, &eth, &ip4, &tcp, &payload)
	}
	packetLayers := []gopacket.LayerType(nil)

	// Capture handle/logHandle locally: Close() may close them from another
	// goroutine, but must never race a field read here. Closing unblocks
	// ReadPacketData, which ends this loop.
	handle := t.handle
	logHandle := t.logHandle

	// send forwards a payload but bails out if the reader is shutting down,
	// so a full channel (drained by a stopped packetLoop) can't wedge us.
	send := func(p gamePacketPayload) {
		select {
		case ch <- p:
		case <-t.ctx.Done():
		}
	}

	// Per-stream TCP reassembly. The wide /24 filter captures every
	// connection to the server net — the game itself runs several live
	// streams at once (field conn + mission-instance conn), plus unrelated
	// sibling services. Each (src ip, src port, dst port) gets independent
	// sequence tracking here and an independent parse state in packetLoop;
	// noise streams squelch themselves there after consistent failures.
	type streamKey struct {
		src     [4]byte
		srcPort layers.TCPPort
		dstPort layers.TCPPort
	}
	type tcpStreamState struct {
		id       uint32
		baseSeq  uint32
		nextSeq  uint32
		pending  []pendingTcpLayer
		rejected bool // not a Client.exe connection: don't parse, don't record
	}
	streams := map[streamKey]*tcpStreamState{}
	nextStreamID := uint32(0)

	lastDropped := 0
	var prevCapTime time.Time
	for i := 0; t.ctx.Err() == nil; i++ {
		b, ci, err := handle.ReadPacketData()
		if err != nil {
			// Expected on Close() / channel-switch — pcap handle goes
			// away and ReadPacketData returns EOF. No diagnostic value.
			break
		}

		if t.realtime {
			if !prevCapTime.IsZero() {
				gap := ci.Timestamp.Sub(prevCapTime)
				if gap > 200*time.Millisecond {
					gap = 200 * time.Millisecond
				}
				if gap > 0 {
					select {
					case <-t.ctx.Done():
						return
					case <-time.After(gap):
					}
				}
			}
			prevCapTime = ci.Timestamp
		}

		// Poll pcap stats every 100 packets to detect kernel-level drops.
		if i%100 == 0 {
			if stats, err := handle.Stats(); err == nil {
				if stats.PacketsDropped > lastDropped {
					logger.Printf("[pcap] received=%d dropped=%d ifdropped=%d (+%d new drops)",
						stats.PacketsReceived, stats.PacketsDropped, stats.PacketsIfDropped,
						stats.PacketsDropped-lastDropped)
					lastDropped = stats.PacketsDropped
				}
			}
		}

		// Loopback captures have a 4-byte address-family prefix before
		// the IPv4 header that the decoding parser cannot consume; skip it.
		packetData := b
		if t.linkType == layers.LinkTypeNull || t.linkType == layers.LinkTypeLoop {
			if len(b) > 4 {
				packetData = b[4:]
			} else {
				continue
			}
		}

		if err := layerParser.DecodeLayers(packetData, &packetLayers); err != nil {
			logger.Println(err)
			continue
		}

		for _, layer := range packetLayers {
			if layer != layers.LayerTypeTCP || len(tcp.Payload) < 1 {
				continue
			}

			key := streamKey{srcPort: tcp.SrcPort, dstPort: tcp.DstPort}
			copy(key.src[:], ip4.SrcIP.To4())
			st := streams[key]
			if st == nil {
				st = &tcpStreamState{id: nextStreamID, baseSeq: tcp.Seq}
				nextStreamID++
				streams[key] = st
				if t.vetPort != nil && !t.vetPort(fmt.Sprintf("%d", uint16(tcp.DstPort))) {
					st.rejected = true
					if !t.quiet {
						logger.Printf("stream #%d rejected (local:%d not a Client.exe connection)", st.id, tcp.DstPort)
					}
				} else if !t.quiet {
					logger.Printf("stream #%d: %v:%d -> local:%d", st.id, ip4.SrcIP, tcp.SrcPort, tcp.DstPort)
				}
				// A new connection's first packet is usually the 4-byte
				// encryption key; it carries no game data.
				if len(tcp.Payload) == 4 {
					st.nextSeq = tcp.Seq + 4
					continue
				}
			}
			if st.rejected {
				continue
			}

			// Record only accepted streams (after the vet, so foreign
			// traffic never lands in the pcapng).
			if logHandle != nil {
				_ = logHandle.WritePacket(ci, b)
			}

			if st.nextSeq != 0 && tcp.Seq != st.nextSeq {
				// Sequence number is out of alignment.
				logger.Println("packet align error", i, "stream", st.id, st.nextSeq, tcp.Seq)

				if tcp.Seq < st.nextSeq {
					// Retransmission or overlap: if the segment overlaps
					// but extends past nextSeq, trim the overlapping prefix
					// and send only the fresh bytes.
					if tcp.Seq+uint32(len(tcp.Payload)) >= st.nextSeq {
						payload := tcp.Payload[st.nextSeq-tcp.Seq:]
						if len(payload) > 0 {
							send(gamePacketPayload{
								stream: st.id,
								relSeq: st.nextSeq - st.baseSeq,
								data:   payload,
								at:     ci.Timestamp,
							})
						}
						st.nextSeq = tcp.Seq + uint32(len(tcp.Payload))
						continue
					}
				}

				if len(st.pending) >= packetQueueSize {
					// Pending buffer is full: flush everything and give up
					// waiting for the missing segment.
					for _, v := range st.pending {
						send(gamePacketPayload{
							stream: st.id,
							relSeq: v.tcpLayer.Seq - st.baseSeq,
							data:   v.tcpLayer.Payload,
							at:     v.ci.Timestamp,
						})
					}
					st.pending = st.pending[:0]

					send(gamePacketPayload{
						stream: st.id,
						relSeq: tcp.Seq - st.baseSeq,
						data:   tcp.Payload,
						at:     ci.Timestamp,
					})
					st.nextSeq = tcp.Seq + uint32(len(tcp.Payload))
					continue
				}

				// Out of order: buffer this segment and wait for the
				// missing earlier one. We must copy the payload because
				// tcpLayer is reused by the decoding parser on the next
				// iteration.
				payloadCopy := make([]byte, len(tcp.Payload))
				copy(payloadCopy, tcp.Payload)
				tcpCopy := tcp
				tcpCopy.Payload = payloadCopy
				st.pending = append(st.pending, pendingTcpLayer{
					tcpLayer: tcpCopy,
					ci:       ci,
				})
				continue
			}

			// In-order segment: forward immediately.
			send(gamePacketPayload{
				stream: st.id,
				relSeq: tcp.Seq - st.baseSeq,
				data:   tcp.Payload,
				at:     ci.Timestamp,
			})
			st.nextSeq = tcp.Seq + uint32(len(tcp.Payload))

			// Drain any buffered out-of-order segments that have now
			// become contiguous with nextSeq.
			for len(st.pending) > 0 {
				v := st.pending[0]
				if v.tcpLayer.Seq == st.nextSeq {
					send(gamePacketPayload{
						stream: st.id,
						relSeq: v.tcpLayer.Seq - st.baseSeq,
						data:   v.tcpLayer.Payload,
						at:     v.ci.Timestamp,
					})
					st.nextSeq = v.tcpLayer.Seq + uint32(len(v.tcpLayer.Payload))
					st.pending = st.pending[1:]
					continue
				}
				if v.tcpLayer.Seq < st.nextSeq {
					// Retransmission/overlap case.
					if v.tcpLayer.Seq+uint32(len(v.tcpLayer.Payload)) < st.nextSeq {
						st.pending = st.pending[1:]
						continue
					}
					payload := v.tcpLayer.Payload[st.nextSeq-v.tcpLayer.Seq:]
					if len(payload) > 0 {
						send(gamePacketPayload{
							stream: st.id,
							relSeq: st.nextSeq - st.baseSeq,
							data:   payload,
							at:     v.ci.Timestamp,
						})
					}
					st.nextSeq = v.tcpLayer.Seq + uint32(len(v.tcpLayer.Payload))
					st.pending = st.pending[1:]
					continue
				}
				// An earlier segment is still missing; stop draining.
				break
			}
		}

		// Throttle the loop to avoid pegging the CPU at 100%.
		if i&((1<<10)-1) == 0 {
			time.Sleep(5 * time.Millisecond)
		}
	}

	// Loop ended: flush any remaining pending segments of every stream.
	for _, st := range streams {
		for _, v := range st.pending {
			send(gamePacketPayload{
				stream: st.id,
				relSeq: v.tcpLayer.Seq - st.baseSeq,
				data:   v.tcpLayer.Payload,
				at:     v.ci.Timestamp,
			})
		}
	}
}

// Close is safe to call multiple times and from any goroutine. It cancels
// the context (which ends packetLoop; final stats are logged there) and
// releases the pcap handle / file descriptors exactly once. It does NOT
// read the stat counters — those are owned by packetLoop's goroutine.
func (t *GameServerPacketReader) Close() {
	t.closeOnce.Do(func() {
		if t.ctxCancel != nil {
			t.ctxCancel()
		}
		if t.handle != nil {
			t.handle.Close()
		}
		if t.fd != nil {
			t.fd.Close()
		}
		if t.logHandle != nil {
			t.logHandle.Flush()
		}
		if t.logFd != nil {
			t.logFd.Close()
		}
	})
}

// ResetParseState clears packetLoop's partial parse buffer. Called on a
// same-net channel switch, where the reader is kept but the TCP stream is
// new. Non-blocking: a pending reset already covers this one.
func (t *GameServerPacketReader) ResetParseState() {
	select {
	case t.resetCh <- struct{}{}:
	default:
	}
}

func (t *GameServerPacketReader) PacketCh() <-chan *GamePacket {
	return t.packetCh
}

// parseGamePacket attempts to parse a single game packet from data.
// Returns:
//   - packet:   the parsed packet on success (nil on error)
//   - consumed: on success, the number of bytes this packet occupies;
//     always 0 on error and on io.EOF
//   - err:      io.EOF when more data is needed; any other error
//     indicates a malformed header or body
//
// Design invariant: errors never consume bytes. On error the caller
// (packetLoop.nextPayload) drops the whole frontmost TCP segment and
// retries, rather than trusting `length` from a false-positive header.
func parseGamePacket(data []byte, at time.Time) (*GamePacket, int, error) {
	const headerSize = 6

	if len(data) < headerSize {
		return nil, 0, io.EOF
	}

	sign := data[0]
	length := le.Uint32(data[1:5])
	flag := data[5]

	if length == 0 || length > 0x100_0000 {
		return nil, 0, fmt.Errorf("invalid packet length %v", length)
	}
	if flag > 4 {
		return nil, 0, fmt.Errorf("invalid flag %v", flag)
	}

	isShortPacket := flag == 1 || flag == 2

	if isShortPacket {
		if len(data) < int(length) {
			return nil, 0, io.EOF
		}
		// Too small to be a real packet. Return an error and let the
		// caller advance by 1 byte to retry.
		if int(length) < headerSize {
			return nil, 0, fmt.Errorf("short packet length %v too small", length)
		}

		shortBody := make([]byte, int(length)-headerSize)
		copy(shortBody, data[headerSize:int(length)])
		rawPacket := make([]byte, int(length))
		copy(rawPacket, data[:int(length)])

		return &GamePacket{
			At:            at,
			Sign:          sign,
			Length:        length,
			Flag:          flag,
			IsShortPacket: true,
			ShortBody:     shortBody,
			RawPacket:     rawPacket,
		}, int(length), nil
	}

	// Minimum normal-packet length: header (6) + op (4) + id (8) + varint (1) = 19.
	if int(length) < headerSize+0xd {
		return nil, 0, ErrTooShortPacket
	}
	if len(data) < int(length) {
		return nil, 0, io.EOF
	}

	body := data[headerSize:int(length)]

	op := be.Uint32(body)
	body = body[4:]
	id := be.Uint64(body)
	body = body[8:]

	_, lenbytes := binary.Uvarint(body)
	if lenbytes <= 0 {
		return nil, 0, fmt.Errorf("invalid message length %v", lenbytes)
	}
	if len(body) < lenbytes {
		return nil, 0, fmt.Errorf("invalid message length %v %v", len(body), lenbytes)
	}
	body = body[lenbytes:]

	msg, err := NewMessage(bytes.NewReader(body))
	if err != nil {
		// Message parse failure: the header may have been a false positive.
		// Do not consume `length` bytes; the caller should advance by 1 byte
		// and retry parsing.
		return nil, 0, err
	}

	rawPacket := make([]byte, int(length))
	copy(rawPacket, data[:int(length)])

	return &GamePacket{
		At:        at,
		Sign:      sign,
		Length:    length,
		Flag:      flag,
		Op:        OpCode(op),
		Id:        id,
		Msg:       msg,
		RawPacket: rawPacket,
	}, int(length), nil
}

// op, id, msg, err
func GamePacketBodyReader(r io.Reader) (uint32, uint64, Message, error) {
	b := make([]byte, 8)

	if _, err := io.ReadFull(r, b[:4]); err != nil {
		logger.Println(err)
		return 0, 0, nil, err
	}

	op := be.Uint32(b[:4])

	if _, err := io.ReadFull(r, b[:8]); err != nil {
		logger.Println(err)
		return 0, 0, nil, err
	}

	id := be.Uint64(b[:8])

	_, lenbytes, err := util.ReadUvarint(r)
	if err != nil {
		logger.Println(err)
		return 0, 0, nil, err
	}

	_ = lenbytes

	msg, err := NewMessage(r)
	if err != nil {
		logger.Println(err)
		return 0, 0, nil, err
	}

	return op, id, msg, nil
}
