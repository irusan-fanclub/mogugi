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

// pendingTcpLayer 保存亂序到達的 TCP segment
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

func (t *GameServerPacketReader) packetLoop(payloadCh <-chan gamePacketPayload) {
	// 仿原始版本：保留 payloads slice，每個 TCP segment 是一個 payload
	// 解析失敗時丟掉最前面那個 segment 重試
	buffer := bytes.NewBuffer(nil)
	lastRelSeq, lastAt := uint32(0), time.Now()
	payloads := make([]gamePacketPayload, 0, packetQueueSize)

	// skipPayload 在成功解析後將 payloads 前端推進 n bytes
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

	// nextPayload 在解析失敗時丟掉最前面那個 payload 並重建 buffer
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
			logger.Printf("[Stats] Payloads: %d, Parsed: %d, Errors: %d",
				t.payloadCount, t.parsedCount, t.parseErrorCount)
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

	// 根據 LinkType 決定解析器（支援 Ethernet 與 loopback）
	var layerParser *gopacket.DecodingLayerParser
	switch t.linkType {
	case layers.LinkTypeNull, layers.LinkTypeLoop:
		layerParser = gopacket.NewDecodingLayerParser(layers.LayerTypeIPv4, &ip4, &tcp, &payload)
	default:
		layerParser = gopacket.NewDecodingLayerParser(layers.LayerTypeEthernet, &eth, &ip4, &tcp, &payload)
	}
	packetLayers := []gopacket.LayerType(nil)

	// 序號追蹤
	baseSeq := uint32(0)
	nextSeq, prevDstPort := uint32(0), layers.TCPPort(0)
	pendingTcpLayers := make([]pendingTcpLayer, 0, packetQueueSize)

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

		// 每 100 個封包查一次 pcap 統計，看有沒有 kernel buffer 丟包
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

		// Loopback 情況下要跳過前 4 bytes 的 family 欄位
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
				// 連線切換（換頻道等）
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
						// 加密 key
						continue
					}

					ch <- gamePacketPayload{
						relSeq: tcp.Seq - baseSeq,
						data:   tcp.Payload,
						at:     ci.Timestamp,
					}
					continue
				}

				// 序號錯位
				logger.Println("packet align error", i, nextSeq, tcp.Seq)

				if tcp.Seq < nextSeq {
					// 重傳或重疊：若與之前資料重疊但又延伸了一些，截掉重疊部分使用新 bytes
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
					// pending 滿了：flush 全部並放棄等待
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

				// 亂序：暫存等待缺失的前段 segment
				// 必須 copy payload，因為 tcpLayer 會在下一輪被 parser 重用
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

			// 有序片段：直接送出
			ch <- gamePacketPayload{
				relSeq: tcp.Seq - baseSeq,
				data:   tcp.Payload,
				at:     ci.Timestamp,
			}
			nextSeq = tcp.Seq + uint32(len(tcp.Payload))
			prevDstPort = tcp.DstPort

			// 嘗試排空已在 pending 中的亂序片段
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
						// 重傳/重疊
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
					// 還有更前面的 segment 未到
					break
				}
			}
		}

		// Rate-limit 避免 CPU 100%
		if i&((1<<10)-1) == 0 {
			time.Sleep(5 * time.Millisecond)
		}
	}

	// 迴圈結束：flush pending
	for _, v := range pendingTcpLayers {
		ch <- gamePacketPayload{
			relSeq: v.tcpLayer.Seq - baseSeq,
			data:   v.tcpLayer.Payload,
			at:     v.ci.Timestamp,
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

// parseGamePacket 從 data 嘗試解析一個 game packet。
// 回傳:
//   - packet: 解析成功的封包（失敗時為 nil）
//   - consumed: 成功時為此封包佔用的 bytes 數；失敗/EOF 時永遠為 0
//   - err: io.EOF 表示需要更多資料；其他錯誤表示 header/body 有問題
//
// 設計原則：任何錯誤都不會 consume bytes，由呼叫者決定如何前進（通常是 offset++ 重試）。
// 這樣可以避免在 header 是 false positive 時錯誤地信任 length 而跳到錯誤的位置。
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
		// 太短則視為無效，由呼叫者前進 1 byte 重試
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

	// 正常封包最小長度（header 6 + op 4 + id 8 + varint 1 = 19）
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
		// 注意：message 解析失敗代表 header 可能是 false positive
		// 不要消耗 length bytes，由呼叫者前進 1 byte 重試
		return nil, 0, err
	}

	rawPacket := make([]byte, int(length))
	copy(rawPacket, data[:int(length)])

	return &GamePacket{
		At:        at,
		Sign:      sign,
		Length:    length,
		Flag:      flag,
		Op:        op,
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
