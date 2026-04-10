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
	linkType  layers.LinkType

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
}

type gamePacketPayload struct {
	relSeq uint32
	data   []byte
	at     time.Time
}

// tcpFragment 保存亂序到達的 TCP 片段
type tcpFragment struct {
	seq     uint32
	payload []byte
	psh     bool
	ci      gopacket.CaptureInfo
}

// seqAfter 回傳 a 是否在 TCP 序號空間中位於 b 之後（支援環繞）
func seqAfter(a, b uint32) bool {
	return int32(a-b) > 0
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

	logger.Println("game packet filter...", filter)

	v := &GameServerPacketReader{
		ctx:      opt.Ctx,
		packetCh: make(chan *GamePacket, packetQueueSize),
		linkType: layers.LinkTypeNull, // default, will be updated when opening
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

	// openLog 必須在 openNic/openFile 之後，確保 t.linkType 已取得正確值
	if err := v.openLog(); err != nil {
		logger.Println("openLog failed", err)
		return nil, err
	}

	// 啟動 readPacketLoop：檔案模式延遲 20 秒，NIC 模式立即開始
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

// trySkipToNextPacket 嘗試在 buffer 中向前掃描，找到下一個看似合法的封包起始位置。
// 找到則回傳 true 並已前進 buffer；找不到則回傳 false（buffer 不變）。
func trySkipToNextPacket(buffer *bytes.Buffer) bool {
	b := buffer.Bytes()
	for i := 1; i+5 < len(b); i++ {
		length := le.Uint32(b[i+1 : i+5])
		flag := b[i+5]
		// 正常封包最小長度為 headerSize(6) + 0xd(13) = 19
		if length >= 19 && length <= 0x1_0000 && flag <= 4 {
			buffer.Next(i)
			return true
		}
	}
	return false
}

func (t *GameServerPacketReader) packetLoop(payloadCh <-chan gamePacketPayload) {
	// After using PSH mechanism, received payload should be complete application layer data
	// But still need to accumulate processing because it may contain multiple game packets
	buffer := bytes.NewBuffer(nil)
	lastAt := time.Now()
	parsedInCurrentPayload := 0
	sessionPacketsParsed := uint64(0) // 本次 session 累計成功解析數（用於區分握手階段）

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
			buffer.Write(payloadData.data)
			lastAt = payloadData.at

			// Try to parse game packets (may contain multiple game packets)
			for buffer.Len() > 0 {
				bufferLenBefore := buffer.Len()
				msg, err := gamePacketReader(buffer, lastAt)
				if err != nil {
					if err == io.EOF {
						// Data incomplete, wait for more data
						break
					}

					t.parseErrorCount++
					t.lastErrorTime = time.Now()

					bufferPreview := buffer.Bytes()
					previewLen := 32
					if len(bufferPreview) < previewLen {
						previewLen = len(bufferPreview)
					}

					if sessionPacketsParsed == 0 {
						// 尚未成功解析過任何封包（握手階段），此 payload 可能是連線握手資料，直接丟棄
						logger.Printf("[ParseError #%d] handshake/unknown data, discarding %d bytes | %v | Preview: % X",
							t.parseErrorCount, buffer.Len(), err, bufferPreview[:previewLen])
						buffer.Reset()
					} else if parsedInCurrentPayload > 0 {
						// 本 payload 已有成功解析的封包，嘗試向前掃描找下一個封包起始
						skipped := bufferLenBefore - buffer.Len()
						if trySkipToNextPacket(buffer) {
							logger.Printf("[ParseError #%d] %v | skipped %d bytes to next packet | Remaining: %d bytes | Preview: % X",
								t.parseErrorCount, err, skipped, buffer.Len(), bufferPreview[:previewLen])
							// 繼續嘗試解析（不 break）
							continue
						}
						logger.Printf("[ParseError #%d] %v | no valid packet found, discarding %d bytes | Preview: % X",
							t.parseErrorCount, err, buffer.Len(), bufferPreview[:previewLen])
						buffer.Reset()
					} else {
						// 本 payload 從頭就解析失敗，直接丟棄
						logger.Printf("[ParseError #%d] %v | Buffer: %d bytes | Preview: % X | Parsed: %d in current payload",
							t.parseErrorCount, err, buffer.Len(), bufferPreview[:previewLen], parsedInCurrentPayload)
						buffer.Reset()
					}
					break
				}

				if msg != nil {
					t.parsedCount++
					parsedInCurrentPayload++
					sessionPacketsParsed++
					bufferConsumed := bufferLenBefore - buffer.Len()

					if false {
						logger.Printf("[Parsed #%d] Op=0x%04X Id=%d MsgLen=%d Consumed=%d Remaining=%d",
							t.parsedCount, msg.Op, msg.Id, len(msg.Msg), bufferConsumed, buffer.Len())
					}

					t.packetCh <- msg
				}
			}
		}
	}
}

// openNic 僅開啟 NIC 並設定 filter、取得 LinkType；不啟動 readPacketLoop goroutine
func (t *GameServerPacketReader) openNic(nic string, filter string) (chan gamePacketPayload, error) {
	handle, err := pcap.OpenLive(nic, pcapBufferSize, pcapPromisc, pcap.BlockForever)
	if err != nil {
		logger.Println(err)
		return nil, err
	}
	t.handle = handle
	t.linkType = handle.LinkType()
	logger.Printf("Interface %s LinkType: %v", nic, t.linkType)

	if err := handle.SetBPFFilter(filter); err != nil { // optional
		return nil, err
	}

	ch := make(chan gamePacketPayload, pcapQueueSize)
	return ch, nil
}

// openFile 僅開啟檔案並設定 filter、取得 LinkType；不啟動 readPacketLoop goroutine
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
	fileName := fmt.Sprintf("packet_capture_%v.pcapng", constants.SERVER_START_AT)
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
	logger.Printf("pcapng writer initialized with LinkType: %v", linkType)

	return nil
}

func (t *GameServerPacketReader) readPacketLoop(ch chan<- gamePacketPayload) {
	eth := layers.Ethernet{}
	ip4 := layers.IPv4{}
	tcp := layers.TCP{}
	payload := gopacket.Payload{}

	// Determine parser based on LinkType
	var layerParser *gopacket.DecodingLayerParser
	switch t.linkType {
	case layers.LinkTypeNull, layers.LinkTypeLoop:
		// For loopback, start from IPv4
		layerParser = gopacket.NewDecodingLayerParser(layers.LayerTypeIPv4, &ip4, &tcp, &payload)
	default:
		// For other types (Ethernet, etc.), include full layers
		layerParser = gopacket.NewDecodingLayerParser(layers.LayerTypeEthernet, &eth, &ip4, &tcp, &payload)
	}

	packetLayers := []gopacket.LayerType(nil)

	// TCP 重組狀態
	baseSeq := uint32(0)
	expectedSeq := uint32(0)
	firstPacket := true
	prevDstPort := layers.TCPPort(0)

	// 當前正在累積的片段 buffer
	currentBuffer := bytes.NewBuffer(nil)
	currentBaseSeq := uint32(0)
	currentTimestamp := time.Time{}

	// 亂序片段暫存（key: TCP seq）
	// 設為 4，讓少量真正亂序時有機會還原，同時避免 pcap 丟包時積壓太多
	const maxOOOFragments = 4
	outOfOrderFragments := make(map[uint32]*tcpFragment, maxOOOFragments)

	// processSegment 將一個有序片段寫入 currentBuffer，PSH 時 flush 到 channel
	processSegment := func(seq uint32, segPayload []byte, psh bool, timestamp time.Time) {
		if currentBuffer.Len() == 0 {
			currentBaseSeq = seq
		}
		currentTimestamp = timestamp
		currentBuffer.Write(segPayload)

		if psh {
			data := make([]byte, currentBuffer.Len())
			copy(data, currentBuffer.Bytes())
			ch <- gamePacketPayload{
				relSeq: currentBaseSeq - baseSeq,
				data:   data,
				at:     currentTimestamp,
			}
			currentBuffer.Reset()
		}
	}

	// drainFragments 嘗試依序取出已到齊的亂序片段並處理
	drainFragments := func() {
		for {
			frag, ok := outOfOrderFragments[expectedSeq]
			if !ok {
				break
			}
			delete(outOfOrderFragments, expectedSeq)
			logger.Printf("[OOO] restored seq=%d (%d bytes, PSH=%v), remaining fragments: %d",
				frag.seq, len(frag.payload), frag.psh, len(outOfOrderFragments))
			processSegment(frag.seq, frag.payload, frag.psh, frag.ci.Timestamp)
			expectedSeq += uint32(len(frag.payload))
		}
	}

	lastDropped := 0
	for i := 0; t.ctx.Err() == nil; i++ {
		b, ci, err := t.handle.ReadPacketData()
		if err != nil {
			logger.Println(err, i)
			break
		}

		if t.logHandle != nil {
			_ = t.logHandle.WritePacket(ci, b)
		}

		// 每 100 個封包檢查一次 pcap 統計，若有新增掉包則立即警告
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

		// For loopback, skip the 4-byte family field before IPv4 header
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

		if len(tcp.Payload) < 1 {
			continue
		}

		if false {
			logger.Printf("[TCP] #%d: %s:%s -> %s:%s | Seq: %10d | Nxt: %10d | Ack: %10d | Payload: %5d bytes | ACK: %5v | PSH: %5v",
				i,
				ip4.SrcIP.String(), tcp.SrcPort,
				ip4.DstIP.String(), tcp.DstPort,
				tcp.Seq, tcp.Seq+uint32(len(tcp.Payload)),
				tcp.Ack, len(tcp.Payload), tcp.ACK, tcp.PSH)
		}

		// 初始化序號
		if firstPacket {
			baseSeq = tcp.Seq
			expectedSeq = tcp.Seq
			currentBaseSeq = tcp.Seq
			currentTimestamp = ci.Timestamp
			prevDstPort = tcp.DstPort
			firstPacket = false
		}

		// 偵測連線切換（換頻道等）
		if prevDstPort != tcp.DstPort {
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
			outOfOrderFragments = make(map[uint32]*tcpFragment, maxOOOFragments)
			baseSeq = tcp.Seq
			expectedSeq = tcp.Seq
			currentBaseSeq = tcp.Seq
			currentTimestamp = ci.Timestamp
			prevDstPort = tcp.DstPort
		}

		// 跳過加密 key 封包（4 bytes）
		if len(tcp.Payload) == 4 {
			if tcp.Seq == expectedSeq {
				expectedSeq += 4
				drainFragments()
			}
			continue
		}

		// 亂序判斷
		if tcp.Seq != expectedSeq {
			if seqAfter(tcp.Seq, expectedSeq) {
				// 超前到達
				if len(outOfOrderFragments) < maxOOOFragments {
					// 暫存，等待缺失的片段補齊（真正亂序）
					p := make([]byte, len(tcp.Payload))
					copy(p, tcp.Payload)
					outOfOrderFragments[tcp.Seq] = &tcpFragment{
						seq:     tcp.Seq,
						payload: p,
						psh:     tcp.PSH,
						ci:      ci,
					}
					logger.Printf("[OOO] buffered seq=%d (expected=%d, gap=%d bytes, fragments=%d)",
						tcp.Seq, expectedSeq, int32(tcp.Seq-expectedSeq), len(outOfOrderFragments))
				} else {
					// 暫存已滿：推測為 pcap 丟包，進行重新同步
					// 找出目前已知的最小序號（最舊的 OOO 片段）
					minSeq := tcp.Seq
					for seq := range outOfOrderFragments {
						if seqAfter(minSeq, seq) {
							minSeq = seq
						}
					}
					logger.Printf("[OOO] pcap drop detected: discarding %d accumulated bytes, resyncing expected=%d -> %d (skipping %d bytes)",
						currentBuffer.Len(), expectedSeq, minSeq, int32(minSeq-expectedSeq))
					currentBuffer.Reset()
					expectedSeq = minSeq
					drainFragments()

					// 處理本次 segment
					if tcp.Seq == expectedSeq {
						// 重新同步後剛好輪到本包，直接 fall through
					} else if seqAfter(tcp.Seq, expectedSeq) {
						// 仍然超前，繼續暫存
						p := make([]byte, len(tcp.Payload))
						copy(p, tcp.Payload)
						outOfOrderFragments[tcp.Seq] = &tcpFragment{
							seq:     tcp.Seq,
							payload: p,
							psh:     tcp.PSH,
							ci:      ci,
						}
						continue
					} else {
						// 重新同步後已過期，忽略
						continue
					}
				}
			}
			// seq < expectedSeq：重傳或重複，忽略
			if tcp.Seq != expectedSeq {
				continue
			}
		}

		// 有序片段：處理並嘗試排空亂序暫存
		processSegment(tcp.Seq, tcp.Payload, tcp.PSH, ci.Timestamp)
		expectedSeq = tcp.Seq + uint32(len(tcp.Payload))
		drainFragments()
	}

	// 迴圈結束後，送出剩餘累積資料
	if currentBuffer.Len() > 0 {
		data := make([]byte, currentBuffer.Len())
		copy(data, currentBuffer.Bytes())
		ch <- gamePacketPayload{
			relSeq: currentBaseSeq - baseSeq,
			data:   data,
			at:     currentTimestamp,
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
		if len(b) < int(length) {
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
