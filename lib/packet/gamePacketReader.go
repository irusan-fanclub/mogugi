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
	"time"

	"github.com/gopacket/gopacket"
	"github.com/gopacket/gopacket/layers"
	"github.com/gopacket/gopacket/pcap"
	"github.com/gopacket/gopacket/pcapgo"
	"github.com/irusan-fanclub/mabidilmeter/lib/constants"
	"github.com/irusan-fanclub/mabidilmeter/lib/util"
)

type GameServerPacketReader struct {
	// non-mutable
	ctx       context.Context
	ctxCancel context.CancelFunc
	packetCh  chan *GamePacket
	quiet     bool

	// mutable
	handle *pcap.Handle
	fd     *os.File

	logHandle *pcapgo.NgWriter
	logFd     *os.File
	linkType  layers.LinkType

	// statistics
	payloadCount    uint64    // number of received TCP payloads
	parsedCount     uint64    // number of successfully parsed game packets
	parseErrorCount uint64    // number of parse errors
	lastErrorTime   time.Time // timestamp of the most recent error
}

type GameServerPacketReaderOpt struct {
	Ctx      context.Context
	FileName string
	NicName  string
	// Quiet suppresses informational logs and skips opening the pcapng
	// log file. Used by short-lived test readers (NIC discovery probes)
	// so they don't spam the log or stomp on the live capture file.
	Quiet bool
}

type gamePacketPayload struct {
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

func NewGameServerPacketReader(opt *GameServerPacketReaderOpt) (*GameServerPacketReader, error) {
	if opt == nil {
		return nil, errors.New("opt is nil")
	}

	filter := constants.PCAP_GAMESERVER_FILTER

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
		linkType:  layers.LinkTypeNull, // default, will be updated when opening
	}

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
	// Maintain a list of TCP-segment-sized payloads alongside a
	// concatenated byte buffer. On parse failure we drop the frontmost
	// payload (a full segment worth) and retry — this gives granular
	// recovery without the cascading false positives of byte-level scans.
	buffer := bytes.NewBuffer(nil)
	lastRelSeq, lastAt := uint32(0), time.Now()
	payloads := make([]gamePacketPayload, 0, packetQueueSize)

	// skipPayload advances the front of the payloads list by n bytes
	// after a successful parse.
	skipPayload := func(n int) {
		for n > 0 && len(payloads) > 0 {
			if n < len(payloads[0].data) {
				lastRelSeq, lastAt = payloads[0].relSeq, payloads[0].at
				payloads[0].data = payloads[0].data[n:]
				return
			}
			n -= len(payloads[0].data)
			lastRelSeq, lastAt = payloads[0].relSeq, payloads[0].at
			payloads = payloads[1:]
		}
	}

	// nextPayload drops the frontmost payload (one TCP segment) and
	// rebuilds the buffer from the remaining payloads. Called on parse error.
	nextPayload := func() {
		buffer.Reset()
		if len(payloads) < 1 {
			return
		}
		payloads = payloads[1:]
		if len(payloads) < 1 {
			return
		}
		for _, v := range payloads {
			buffer.Write(v.data)
		}
		lastRelSeq, lastAt = payloads[0].relSeq, payloads[0].at
	}

	pushPayload := func(payloadData gamePacketPayload) {
		if buffer.Len() < 1 {
			buffer.Reset()
		}
		if len(payloads) < 1 {
			lastRelSeq, lastAt = payloadData.relSeq, payloadData.at
		}
		payloads = append(payloads, payloadData)
		buffer.Write(payloadData.data)
	}

	for {
		select {
		case <-t.ctx.Done():
			if !t.quiet {
				logger.Printf("[Stats] Payloads: %d, Parsed: %d, Errors: %d",
					t.payloadCount, t.parsedCount, t.parseErrorCount)
			}
			return

		case payloadData := <-payloadCh:
			t.payloadCount++
			pushPayload(payloadData)
		}

	readerLoop:
		for {
			msg, consumed, err := parseGamePacket(buffer.Bytes(), lastAt)
			if err != nil {
				if err == io.EOF {
					break readerLoop
				}
				t.parseErrorCount++
				t.lastErrorTime = time.Now()
				logger.Printf("[ParseError #%d] relSeq=%d %v", t.parseErrorCount, lastRelSeq, err)
				nextPayload()
				continue
			}

			if msg != nil {
				buffer.Next(consumed)
				t.parsedCount++
				t.packetCh <- msg
				skipPayload(consumed)
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

	if err := handle.SetBPFFilter(filter); err != nil { // optional
		logger.Println(err)
		return nil, err
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
	fileName := filepath.Join(logDir, fmt.Sprintf("packet_capture_%v.pcapng", constants.SERVER_START_AT))
	fd, err := os.OpenFile(fileName, os.O_CREATE|os.O_TRUNC|os.O_WRONLY, 0644)
	if err != nil {
		logger.Println(err)
		return err
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

	// Sequence number tracking.
	baseSeq := uint32(0)
	nextSeq, prevDstPort := uint32(0), layers.TCPPort(0)
	pendingTcpLayers := make([]pendingTcpLayer, 0, packetQueueSize)

	lastDropped := 0
	for i := 0; t.ctx.Err() == nil; i++ {
		b, ci, err := t.handle.ReadPacketData()
		if err != nil {
			// Expected on Close() / channel-switch — pcap handle goes
			// away and ReadPacketData returns EOF. No diagnostic value.
			break
		}

		if t.logHandle != nil {
			_ = t.logHandle.WritePacket(ci, b)
		}

		// Poll pcap stats every 100 packets to detect kernel-level drops.
		if i%100 == 0 {
			if stats, err := t.handle.Stats(); err == nil {
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

		if i == 0 {
			baseSeq = tcp.Seq
		}

		for _, layer := range packetLayers {
			if layer != layers.LayerTypeTCP || len(tcp.Payload) < 1 {
				continue
			}

			if nextSeq != 0 && tcp.Seq != nextSeq {
				// Connection switch (channel change etc.).
				if prevDstPort != tcp.DstPort {
					for _, v := range pendingTcpLayers {
						ch <- gamePacketPayload{
							relSeq: v.tcpLayer.Seq - baseSeq,
							data:   v.tcpLayer.Payload,
							at:     v.ci.Timestamp,
						}
					}
					pendingTcpLayers = pendingTcpLayers[:0]
					prevDstPort = tcp.DstPort

					baseSeq = tcp.Seq
					nextSeq = tcp.Seq + uint32(len(tcp.Payload))

					if len(tcp.Payload) == 4 {
						// Encryption key packet on a new connection; skip.
						continue
					}

					ch <- gamePacketPayload{
						relSeq: tcp.Seq - baseSeq,
						data:   tcp.Payload,
						at:     ci.Timestamp,
					}
					continue
				}

				// Sequence number is out of alignment.
				logger.Println("packet align error", i, nextSeq, tcp.Seq)

				if tcp.Seq < nextSeq {
					// Retransmission or overlap: if the segment overlaps
					// but extends past nextSeq, trim the overlapping prefix
					// and send only the fresh bytes.
					if tcp.Seq+uint32(len(tcp.Payload)) >= nextSeq {
						payload := tcp.Payload[nextSeq-tcp.Seq:]
						if len(payload) > 0 {
							ch <- gamePacketPayload{
								relSeq: nextSeq - baseSeq,
								data:   payload,
								at:     ci.Timestamp,
							}
						}
						nextSeq = tcp.Seq + uint32(len(tcp.Payload))
						continue
					}
				}

				if len(pendingTcpLayers) >= packetQueueSize {
					// Pending buffer is full: flush everything and give up
					// waiting for the missing segment.
					for _, v := range pendingTcpLayers {
						ch <- gamePacketPayload{
							relSeq: v.tcpLayer.Seq - baseSeq,
							data:   v.tcpLayer.Payload,
							at:     v.ci.Timestamp,
						}
					}
					pendingTcpLayers = pendingTcpLayers[:0]

					ch <- gamePacketPayload{
						relSeq: tcp.Seq - baseSeq,
						data:   tcp.Payload,
						at:     ci.Timestamp,
					}
					nextSeq = tcp.Seq + uint32(len(tcp.Payload))
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
				pendingTcpLayers = append(pendingTcpLayers, pendingTcpLayer{
					tcpLayer: tcpCopy,
					ci:       ci,
				})
				continue
			}

			// In-order segment: forward immediately.
			ch <- gamePacketPayload{
				relSeq: tcp.Seq - baseSeq,
				data:   tcp.Payload,
				at:     ci.Timestamp,
			}
			nextSeq = tcp.Seq + uint32(len(tcp.Payload))
			prevDstPort = tcp.DstPort

			// Drain any buffered out-of-order segments that have now
			// become contiguous with nextSeq.
			if len(pendingTcpLayers) > 0 {
				for len(pendingTcpLayers) > 0 {
					v := pendingTcpLayers[0]
					if v.tcpLayer.Seq == nextSeq {
						ch <- gamePacketPayload{
							relSeq: v.tcpLayer.Seq - baseSeq,
							data:   v.tcpLayer.Payload,
							at:     v.ci.Timestamp,
						}
						nextSeq = v.tcpLayer.Seq + uint32(len(v.tcpLayer.Payload))
						pendingTcpLayers = pendingTcpLayers[1:]
						continue
					}
					if v.tcpLayer.Seq < nextSeq {
						// Retransmission/overlap case.
						if v.tcpLayer.Seq+uint32(len(v.tcpLayer.Payload)) < nextSeq {
							pendingTcpLayers = pendingTcpLayers[1:]
							continue
						}
						payload := v.tcpLayer.Payload[nextSeq-v.tcpLayer.Seq:]
						if len(payload) > 0 {
							ch <- gamePacketPayload{
								relSeq: nextSeq - baseSeq,
								data:   payload,
								at:     v.ci.Timestamp,
							}
						}
						nextSeq = v.tcpLayer.Seq + uint32(len(v.tcpLayer.Payload))
						pendingTcpLayers = pendingTcpLayers[1:]
						continue
					}
					// An earlier segment is still missing; stop draining.
					break
				}
			}
		}

		// Throttle the loop to avoid pegging the CPU at 100%.
		if i&((1<<10)-1) == 0 {
			time.Sleep(5 * time.Millisecond)
		}
	}

	// Loop ended: flush any remaining pending segments.
	for _, v := range pendingTcpLayers {
		ch <- gamePacketPayload{
			relSeq: v.tcpLayer.Seq - baseSeq,
			data:   v.tcpLayer.Payload,
			at:     v.ci.Timestamp,
		}
	}
}

func (t *GameServerPacketReader) Close() {
	if !t.quiet {
		logger.Printf("[Close Stats] Payloads: %d, Parsed: %d, Errors: %d",
			t.payloadCount, t.parsedCount, t.parseErrorCount)

		if t.parseErrorCount > 0 {
			logger.Printf("[Close Stats] Last error at: %v", t.lastErrorTime)
		}
	}

	if t.ctxCancel != nil {
		t.ctxCancel()
		t.ctxCancel = nil
	}

	if t.handle != nil {
		t.handle.Close()
		t.handle = nil
	}

	if t.fd != nil {
		t.fd.Close()
		t.fd = nil
	}

	if t.logHandle != nil {
		t.logHandle.Flush()
		t.logHandle = nil
	}

	if t.logFd != nil {
		t.logFd.Close()
		t.logFd = nil
	}
}

func (t *GameServerPacketReader) PacketCh() <-chan *GamePacket {
	return t.packetCh
}

func (t *GameServerPacketReader) GetStats() (payloads, parsed, errors uint64) {
	return t.payloadCount, t.parsedCount, t.parseErrorCount
}

// parseGamePacket attempts to parse a single game packet from data.
// Returns:
//   - packet:   the parsed packet on success (nil on error)
//   - consumed: on success, the number of bytes this packet occupies;
//               always 0 on error and on io.EOF
//   - err:      io.EOF when more data is needed; any other error
//               indicates a malformed header or body
//
// Design invariant: errors never consume bytes. The caller decides how
// to advance (typically by one byte and retrying). This avoids trusting
// `length` when the header turned out to be a false positive.
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
