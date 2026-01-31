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

	buffer := bytes.NewBuffer(nil)
	lastRelSeq, lastAt := uint32(0), time.Now()
	payloads := make([]gamePacketPayload, 0, 100)

	skipPayload := func(n int) {
		for n > 0 {
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

		lastRelSeq = payloads[0].relSeq
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
			return

		case payloadData := <-payloadCh:
			pushPayload(payloadData)
		}

	readerLoop:
		for {
			msg, err := gamePacketReader(buffer, lastAt)
			if err != nil {
				if err == io.EOF {
					break readerLoop
				}

				logger.Printf("game packet parse error %v %v", lastRelSeq, err)
				nextPayload()
				continue
			}

			if msg != nil {
				// logger.Println("game packet", msg.Op, msg.Id, len(msg.Msg), lastRelSeq, lastAt)
				t.packetCh <- msg
				skipPayload(len(msg.RawPacket))
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
	ethLayer := layers.Ethernet{}
	ip4Layer := layers.IPv4{}
	tcpLayer := layers.TCP{}
	payload := gopacket.Payload{}

	layerParser := gopacket.NewDecodingLayerParser(layers.LayerTypeEthernet, &ethLayer, &ip4Layer, &tcpLayer, &payload)
	packetLayers := []gopacket.LayerType(nil)

	// Quick fix for packet order shuffling
	baseSeq := uint32(0)
	nextSeq, prevDstPort := uint32(0), layers.TCPPort(0)
	pendingTcpLayers := make([]pendingTcpLayer, 0, packetQueueSize)

	for i := 0; t.ctx.Err() == nil; i++ {
		b, ci, err := t.handle.ReadPacketData()
		if err != nil {
			logger.Println(err, i)
			break
		}

		if t.logHandle != nil {
			// ignore error
			_ = t.logHandle.WritePacket(ci, b)
		}

		if err := layerParser.DecodeLayers(b, &packetLayers); err != nil {
			logger.Println(err)
			continue
		}

		if i == 0 {
			baseSeq = tcpLayer.Seq
		}

		for _, layer := range packetLayers {
			if layer != layers.LayerTypeTCP || len(tcpLayer.Payload) < 1 {
				continue
			}

			if nextSeq != 0 && tcpLayer.Seq != nextSeq {
				// When connection changed (channel move, etc.)
				if prevDstPort != tcpLayer.DstPort {
					for _, v := range pendingTcpLayers {
						ch <- gamePacketPayload{
							relSeq: v.tcpLayer.Seq - baseSeq,
							data:   v.tcpLayer.Payload,
							at:     v.ci.Timestamp,
						}
					}

					pendingTcpLayers = pendingTcpLayers[:0]
					prevDstPort = tcpLayer.DstPort

					baseSeq = tcpLayer.Seq
					nextSeq = tcpLayer.Seq + uint32(len(tcpLayer.Payload))

					if len(tcpLayer.Payload) == 4 {
						// crypt key
						continue
					}

					ch <- gamePacketPayload{
						relSeq: tcpLayer.Seq - baseSeq,
						data:   tcpLayer.Payload,
						at:     ci.Timestamp,
					}

					continue
				}

				// Alignment mismatch
				logger.Println("packet align error", i, nextSeq, tcpLayer.Seq)

				if tcpLayer.Seq < nextSeq {
					if tcpLayer.Seq+uint32(len(tcpLayer.Payload)) >= nextSeq {
						// Case solved by discarding overlapping part
						payload := tcpLayer.Payload[nextSeq-tcpLayer.Seq:]
						if len(payload) > 0 {
							ch <- gamePacketPayload{
								relSeq: nextSeq - baseSeq,
								data:   payload,
								at:     ci.Timestamp,
							}
						}

						nextSeq = tcpLayer.Seq + uint32(len(tcpLayer.Payload))
						continue
					}
				}

				if len(pendingTcpLayers) >= packetQueueSize {
					// When full, send pending list and clear it
					for _, v := range pendingTcpLayers {
						ch <- gamePacketPayload{
							relSeq: v.tcpLayer.Seq - baseSeq,
							data:   v.tcpLayer.Payload,
							at:     v.ci.Timestamp,
						}
					}

					pendingTcpLayers = pendingTcpLayers[:0]

					ch <- gamePacketPayload{
						relSeq: tcpLayer.Seq - baseSeq,
						data:   tcpLayer.Payload,
						at:     ci.Timestamp,
					}
					nextSeq = tcpLayer.Seq + uint32(len(tcpLayer.Payload))
					continue
				}

				pendingTcpLayers = append(pendingTcpLayers, pendingTcpLayer{
					tcpLayer: tcpLayer,
					ci:       ci,
				})
				continue
			}

			ch <- gamePacketPayload{
				relSeq: tcpLayer.Seq - baseSeq,
				data:   tcpLayer.Payload,
				at:     ci.Timestamp,
			}
			nextSeq = tcpLayer.Seq + uint32(len(tcpLayer.Payload))
			prevDstPort = tcpLayer.DstPort

			if len(pendingTcpLayers) > 0 {
				/*
					Cases where alignment is mismatched:
					1. Retransmission - overlapping parts must be discarded
					2. Out of order - earlier packets arrive later
				*/

				for _, v := range pendingTcpLayers {
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
						payload := v.tcpLayer.Payload

						if v.tcpLayer.Seq+uint32(len(v.tcpLayer.Payload)) < nextSeq {
							pendingTcpLayers = pendingTcpLayers[1:]
							continue
						}

						// Discard overlapping part
						payload = payload[nextSeq-v.tcpLayer.Seq:]
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

					// There are still packets not received
					break
				}
			}

			continue
		}

		if i&((1<<10)-1) == 0 {
			time.Sleep(5 * time.Millisecond)
		}
	}

	for _, v := range pendingTcpLayers {
		ch <- gamePacketPayload{
			relSeq: v.tcpLayer.Seq - baseSeq,
			data:   v.tcpLayer.Payload,
			at:     v.ci.Timestamp,
		}
	}
}

func (t *GameServerPacketReader) Close() {
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
