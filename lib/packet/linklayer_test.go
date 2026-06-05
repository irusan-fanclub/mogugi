package packet

import (
	"bytes"
	"testing"

	"github.com/gopacket/gopacket"
	"github.com/gopacket/gopacket/layers"
)

// buildIPv4TCP serializes a minimal IPv4/TCP segment carrying payload and
// returns the raw bytes starting at the IPv4 header.
func buildIPv4TCP(t *testing.T, payload []byte) []byte {
	t.Helper()
	ip := &layers.IPv4{
		Version:  4,
		IHL:      5,
		TTL:      64,
		Protocol: layers.IPProtocolTCP,
		SrcIP:    []byte{1, 2, 3, 4},
		DstIP:    []byte{5, 6, 7, 8},
	}
	tcp := &layers.TCP{
		SrcPort: 11022,
		DstPort: 54321,
		Seq:     1000,
	}
	if err := tcp.SetNetworkLayerForChecksum(ip); err != nil {
		t.Fatalf("SetNetworkLayerForChecksum: %v", err)
	}
	buf := gopacket.NewSerializeBuffer()
	opts := gopacket.SerializeOptions{FixLengths: true, ComputeChecksums: true}
	if err := gopacket.SerializeLayers(buf, opts, ip, tcp, gopacket.Payload(payload)); err != nil {
		t.Fatalf("SerializeLayers: %v", err)
	}
	return buf.Bytes()
}

// ethFrame prepends a 14-byte Ethernet II header with the given EtherType.
func ethFrame(etherType uint16, rest []byte) []byte {
	hdr := make([]byte, 14)
	// dst + src MAC left zero; EtherType in bytes 12-13.
	hdr[12] = byte(etherType >> 8)
	hdr[13] = byte(etherType)
	return append(hdr, rest...)
}

// pppoeFrame wraps an IPv4-onward slice in PPPoE session + PPP headers and a
// PPPoE Ethernet frame (EtherType 0x8864).
func pppoeFrame(pppProto uint16, ipOnward []byte) []byte {
	pppoe := []byte{
		0x11,       // version 1, type 1
		0x00,       // code 0x00 = session data
		0x00, 0x01, // session id
		0x00, 0x00, // length (ignored by our offset logic)
	}
	ppp := []byte{byte(pppProto >> 8), byte(pppProto)}
	return ethFrame(0x8864, append(append(pppoe, ppp...), ipOnward...))
}

func TestIPv4PayloadOffset_PlainEthernet(t *testing.T) {
	want := []byte("hello-game-packet")
	inner := buildIPv4TCP(t, want)
	frame := ethFrame(0x0800, inner)

	off, ok := ipv4PayloadOffset(layers.LinkTypeEthernet, frame)
	if !ok {
		t.Fatalf("expected ok for plain Ethernet IPv4 frame")
	}
	if off != 14 {
		t.Fatalf("offset = %d, want 14", off)
	}
	assertTCPPayload(t, layers.LinkTypeEthernet, frame[off:], want)
}

func TestIPv4PayloadOffset_PPPoE(t *testing.T) {
	want := []byte("hello-over-pppoe!")
	inner := buildIPv4TCP(t, want)
	frame := pppoeFrame(0x0021, inner) // 0x0021 = IPv4 over PPP

	off, ok := ipv4PayloadOffset(layers.LinkTypeEthernet, frame)
	if !ok {
		t.Fatalf("expected ok for PPPoE-encapsulated IPv4 frame")
	}
	if off != 22 { // 14 eth + 6 pppoe + 2 ppp
		t.Fatalf("offset = %d, want 22", off)
	}
	assertTCPPayload(t, layers.LinkTypeEthernet, frame[off:], want)
}

func TestIPv4PayloadOffset_Loopback(t *testing.T) {
	want := []byte("loopback-payload")
	inner := buildIPv4TCP(t, want)
	frame := append([]byte{2, 0, 0, 0}, inner...) // 4-byte AF prefix

	off, ok := ipv4PayloadOffset(layers.LinkTypeNull, frame)
	if !ok {
		t.Fatalf("expected ok for loopback frame")
	}
	if off != 4 {
		t.Fatalf("offset = %d, want 4", off)
	}
}

func TestIPv4PayloadOffset_Skips(t *testing.T) {
	cases := []struct {
		name     string
		linkType layers.LinkType
		frame    []byte
	}{
		{"non-ip ethertype (ARP)", layers.LinkTypeEthernet, ethFrame(0x0806, make([]byte, 28))},
		{"pppoe non-ipv4 proto", layers.LinkTypeEthernet, pppoeFrame(0xc021, make([]byte, 8))}, // LCP
		{"ethernet too short", layers.LinkTypeEthernet, make([]byte, 10)},
		{"pppoe too short", layers.LinkTypeEthernet, ethFrame(0x8864, make([]byte, 4))},
		{"loopback too short", layers.LinkTypeNull, make([]byte, 2)},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			if _, ok := ipv4PayloadOffset(c.linkType, c.frame); ok {
				t.Fatalf("expected skip (ok=false) for %s", c.name)
			}
		})
	}
}

// assertTCPPayload decodes data (starting at the IPv4 header) and checks the
// TCP payload equals want, mirroring how readPacketLoop consumes frames.
func assertTCPPayload(t *testing.T, _ layers.LinkType, data, want []byte) {
	t.Helper()
	var ip4 layers.IPv4
	var tcp layers.TCP
	var payload gopacket.Payload
	parser := gopacket.NewDecodingLayerParser(layers.LayerTypeIPv4, &ip4, &tcp, &payload)
	decoded := []gopacket.LayerType{}
	if err := parser.DecodeLayers(data, &decoded); err != nil {
		t.Fatalf("DecodeLayers: %v", err)
	}
	if !bytes.Equal(tcp.Payload, want) {
		t.Fatalf("tcp payload = %q, want %q", tcp.Payload, want)
	}
}
