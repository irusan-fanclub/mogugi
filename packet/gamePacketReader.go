package packet

import (
	"bytes"
	"context"
	"encoding/binary"
	"errors"
	"fmt"
	"io"
	"os"
	"time"

	"github.com/gopacket/gopacket"
	"github.com/gopacket/gopacket/layers"
	"github.com/gopacket/gopacket/pcap"
	"github.com/gopacket/gopacket/pcapgo"
	"gitlab.com/prilus/mabidilmeter/constants"
	"gitlab.com/prilus/mabidilmeter/util"
)

type GameServerPacketReader struct {
	// non-mutable
	ctx      context.Context
	packetCh chan *GamePacket

	// mutable
	handle *pcap.Handle
	fd     *os.File

	logHandle *pcapgo.NgWriter
	logFd     *os.File

	// statistics
	payloadCount    uint64    // 收到的 TCP payload 數量
	parsedCount     uint64    // 成功解析的封包數量
	parseErrorCount uint64    // 解析錯誤的次數
	lastErrorTime   time.Time // 最後一次錯誤時間
}

type GameServerPacketReaderOpt struct {
	Ctx      context.Context
	FileName string
	NicName  string
	ClientIp string
}

type gamePacketPayload struct {
	relSeq uint32
	data   []byte
	at     time.Time
}

type pendingTcpLayer struct {
	tcp layers.TCP
	ci  gopacket.CaptureInfo
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
	if opt.ClientIp != "" {
		// Client to server packets are encrypted anyway
		filter = " dst host " + opt.ClientIp
	}

	logger.Println("game packet filter...", filter)

	v := &GameServerPacketReader{
		ctx:      opt.Ctx,
		packetCh: make(chan *GamePacket, packetQueueSize),
	}

	if err := v.openLog(); err != nil {
		logger.Println("openLog failed", err)
		return nil, err
	}

	payloadCh := (<-chan gamePacketPayload)(nil)
	err := error(nil)
	if opt.FileName != "" {
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

	go v.packetLoop(payloadCh)

	return v, nil
}

func (t *GameServerPacketReader) packetLoop(payloadCh <-chan gamePacketPayload) {
	// After using PSH mechanism, received payload should be complete application layer data
	// But still need to accumulate processing because it may contain multiple game packets
	buffer := bytes.NewBuffer(nil)
	lastAt := time.Now()
	parsedInCurrentPayload := 0

	for {
		select {
		case <-t.ctx.Done():
			logger.Printf("[Stats] Payloads: %d, Parsed: %d, Errors: %d",
				t.payloadCount, t.parsedCount, t.parseErrorCount)
			return

		case payloadData := <-payloadCh:
			t.payloadCount++
			parsedInCurrentPayload = 0

			// Accumulate data to buffer (don't reset)
			prevBufferLen := buffer.Len()
			buffer.Write(payloadData.data)
			lastAt = payloadData.at

			if prevBufferLen > 0 {
				logger.Printf("[Buffer] Received %d bytes, buffer now %d bytes (accumulated from previous)",
					len(payloadData.data), buffer.Len())
			}

			// Try to parse game packets (may contain multiple game packets)
			for buffer.Len() > 0 {
				bufferLenBefore := buffer.Len()
				msg, err := gamePacketReader(buffer, lastAt)
				if err != nil {
					if err == io.EOF {
						// Data incomplete, wait for more data
						if parsedInCurrentPayload == 0 && prevBufferLen == 0 {
							logger.Printf("[Wait] Payload %d bytes incomplete, waiting for more (buffer: %d bytes)",
								len(payloadData.data), buffer.Len())
						}
						break
					}

					t.parseErrorCount++
					t.lastErrorTime = time.Now()

					// 顯示錯誤的詳細資訊
					bufferPreview := buffer.Bytes()
					previewLen := 32
					if len(bufferPreview) < previewLen {
						previewLen = len(bufferPreview)
					}

					logger.Printf("[ParseError #%d] %v | Buffer: %d bytes | Preview: % X | Parsed: %d in current payload",
						t.parseErrorCount, err, buffer.Len(), bufferPreview[:previewLen], parsedInCurrentPayload)

					// Parse error, clear buffer and restart
					buffer.Reset()
					break
				}

				if msg != nil {
					t.parsedCount++
					parsedInCurrentPayload++
					bufferConsumed := bufferLenBefore - buffer.Len()

					if false {
						logger.Printf("[Parsed #%d] Op=0x%04X Id=%d MsgLen=%d Consumed=%d Remaining=%d",
							t.parsedCount, msg.Op, msg.Id, len(msg.Msg), bufferConsumed, buffer.Len())
					}

					t.packetCh <- msg
				}
			}

			if parsedInCurrentPayload > 0 && buffer.Len() == 0 {
				if false {
					logger.Printf("[Complete] Parsed %d packets from payload, buffer cleared", parsedInCurrentPayload)
				}
			}
		}
	}
}

func (t *GameServerPacketReader) openNic(nic string, filter string) (<-chan gamePacketPayload, error) {
	handle, err := pcap.OpenLive(nic, pcapBufferSize, pcapPromisc, pcap.BlockForever)
	if err != nil {
		logger.Println(err)
		return nil, err
	}
	t.handle = handle

	if err := handle.SetBPFFilter(filter); err != nil { // optional
		return nil, err
	}

	ch := make(chan gamePacketPayload, pcapQueueSize)
	// ps := gopacket.NewPacketSource(handle, handle.LinkType())

	go t.readPacketLoop(ch)

	return ch, nil
}

func (t *GameServerPacketReader) openFile(file string, filter string) (<-chan gamePacketPayload, error) {
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

	ch := make(chan gamePacketPayload, pcapQueueSize)

	time.AfterFunc(20*time.Second, func() {
		logger.Println("start readPacketLoop", file)
		go t.readPacketLoop(ch)
	})

	return ch, nil
}

func (t *GameServerPacketReader) openLog() error {
	fileName := fmt.Sprintf("packet_capture_%v.pcapng", constants.SERVER_START_AT)
	fd, err := os.OpenFile(fileName, os.O_CREATE|os.O_TRUNC|os.O_WRONLY, 0644)
	if err != nil {
		logger.Println(err)
		return err
	}

	t.logFd = fd

	handle, err := pcapgo.NewNgWriter(fd, layers.LinkTypeEthernet)
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

	layerParser := gopacket.NewDecodingLayerParser(layers.LayerTypeEthernet, &eth, &ip4, &tcp, &payload)
	packetLayers := []gopacket.LayerType(nil)

	// TCP fragment reassembly based on PSH flag
	baseSeq := uint32(0)
	firstPacket := true
	prevDstPort := layers.TCPPort(0)

	// Current accumulating fragment buffer
	currentBuffer := bytes.NewBuffer(nil)
	currentBaseSeq := uint32(0)
	currentTimestamp := time.Time{}

	// Store out-of-order fragments (key: seq)
	outOfOrderFragments := make(map[uint32]pendingTcpLayer)

	for i := 0; t.ctx.Err() == nil; i++ {
		b, ci, err := t.handle.ReadPacketData()
		if err != nil {
			logger.Println(err, i)
			break
		}

		if t.logHandle != nil {
			_ = t.logHandle.WritePacket(ci, b)
		}

		if err := layerParser.DecodeLayers(b, &packetLayers); err != nil {
			logger.Println(err)
			continue
		}

		if len(tcp.Payload) < 1 {
			continue
		}

		// if true {
		if false {
			logger.Printf("[TCP] #%d: %s:%s -> %s:%s | Seq: %10d | Nxt: %10d | Ack: %10d | Payload: %5d bytes | ACK: %5v | PSH: %5v",
				i,
				ip4.SrcIP.String(), tcp.SrcPort,
				ip4.DstIP.String(), tcp.DstPort,
				tcp.Seq, tcp.Seq+uint32(len(tcp.Payload)),
				tcp.Ack, len(tcp.Payload), tcp.ACK, tcp.PSH)
		}

		// Initialize sequence number
		if firstPacket {
			baseSeq = tcp.Seq
			currentBaseSeq = tcp.Seq
			currentTimestamp = ci.Timestamp
			prevDstPort = tcp.DstPort
			firstPacket = false
		}

		// Detect connection changes (channel switches, etc.)
		if prevDstPort != tcp.DstPort {
			// Send accumulated data
			if currentBuffer.Len() > 0 {
				data := make([]byte, currentBuffer.Len())
				copy(data, currentBuffer.Bytes())
				ch <- gamePacketPayload{
					relSeq: currentBaseSeq - baseSeq,
					data:   data,
					at:     currentTimestamp,
				}
				currentBuffer.Reset()
			}

			// Clear out-of-order cache
			outOfOrderFragments = make(map[uint32]pendingTcpLayer)

			// Reset state
			baseSeq = tcp.Seq
			currentBaseSeq = tcp.Seq
			currentTimestamp = ci.Timestamp
			prevDstPort = tcp.DstPort
		}

		// Skip encryption key packet (4 bytes)
		if len(tcp.Payload) == 4 {
			continue
		}

		if tcp.PSH {
			currentBuffer.Write(tcp.Payload)

			// Send accumulated buffer
			data := make([]byte, currentBuffer.Len())
			copy(data, currentBuffer.Bytes())
			// logger.Printf("[PSH] seq=%d, buffered %d bytes",
			// 	tcp.Seq, currentBuffer.Len())
			ch <- gamePacketPayload{
				relSeq: currentBaseSeq - baseSeq,
				data:   data,
				at:     currentTimestamp,
			}
			currentBuffer.Reset()
		} else {
			// Sequence matches: append to buffer
			if currentBuffer.Len() == 0 {
				currentBaseSeq = tcp.Seq
				currentTimestamp = ci.Timestamp
			}
			currentBuffer.Write(tcp.Payload)
		}
		continue

	}

	// Process remaining buffered data after loop ends
	if currentBuffer.Len() > 0 {
		data := make([]byte, currentBuffer.Len())
		copy(data, currentBuffer.Bytes())
		ch <- gamePacketPayload{
			relSeq: currentBaseSeq - baseSeq,
			data:   data,
			at:     currentTimestamp,
		}
	}

	// Process remaining out-of-order fragments
	for _, fragment := range outOfOrderFragments {
		data := make([]byte, len(fragment.tcp.Payload))
		copy(data, fragment.tcp.Payload)
		ch <- gamePacketPayload{
			relSeq: fragment.tcp.Seq - baseSeq,
			data:   data,
			at:     fragment.ci.Timestamp,
		}
	}
}

func (t *GameServerPacketReader) Close() {
	logger.Printf("[Close Stats] Payloads: %d, Parsed: %d, Errors: %d",
		t.payloadCount, t.parsedCount, t.parseErrorCount)

	if t.parseErrorCount > 0 {
		logger.Printf("[Close Stats] Last error at: %v", t.lastErrorTime)
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

func gamePacketReader(buffer *bytes.Buffer, at time.Time) (*GamePacket, error) {
	headerSize := 6

	rawPacketBuffer := bytes.NewBuffer(nil)
	b := buffer.Bytes()

	// Not enough data to read header yet
	if len(b) < 6 {
		return nil, io.EOF
	}

	sign := b[0]

	// Total packet size (including header)
	length := le.Uint32(b[1:])
	// maybe
	flag := b[5]

	// ?
	if length == 0 || length > 0x100_0000 {
		err := fmt.Errorf("invalid packet length %v", length)
		return nil, err
	}

	if flag > 4 {
		err := fmt.Errorf("invalid flag %v", flag)
		return nil, err
	}

	isShortPacket := flag == 1 || // heartbeat
		flag == 2 // ? server only

	if isShortPacket {
		// Packet is still insufficient
		if len(b) < int(length)-6 {
			return nil, io.EOF
		}

		shortBody := b[6:int(length)]
		rawPacketBuffer.Write(shortBody)

		buffer.Next(int(length))

		// checksum := uint32(0)
		v := &GamePacket{
			At:     at,
			Sign:   sign,
			Length: length,
			Flag:   flag,

			IsShortPacket: true,
			ShortBody:     shortBody,

			RawPacket: rawPacketBuffer.Bytes(),
		}

		return v, nil
	}

	// too small
	if int(length) < headerSize+0xd {
		buffer.Next(int(length))
		return nil, ErrTooShortPacket
	}

	if buffer.Len() < int(length) {
		return nil, io.EOF
	}

	body := b[:int(length)]
	rawPacketBuffer.Write(body)

	buffer.Next(int(length))

	body = body[headerSize:]

	op := be.Uint32(body)
	body = body[4:]

	id := be.Uint64(body)
	body = body[8:]

	_, lenbytes := binary.Uvarint(body)
	if lenbytes <= 0 {
		err := fmt.Errorf("invalid message length %v", lenbytes)
		return nil, err
	}

	if len(body) < lenbytes {
		err := fmt.Errorf("invalid message length %v %v", len(body), lenbytes)
		return nil, err
	}

	body = body[lenbytes:]

	msg, err := NewMessage(bytes.NewReader(body))
	if err != nil {
		logger.Println("gameProxy packetHeader body read error", err)
		return nil, err
	}

	p := &GamePacket{
		At:     at,
		Sign:   sign,
		Length: length,
		Flag:   flag,

		Op:  op,
		Id:  id,
		Msg: msg,

		RawPacket: rawPacketBuffer.Bytes(),
	}

	return p, nil
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
