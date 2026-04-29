package packet

import (
	"time"

	"github.com/irusan-fanclub/mabidilmeter/lib/util"
)

var logger = util.NewLogger("packet")

type GamePacket struct {
	At     time.Time
	Sign   uint8
	Length uint32
	Flag   uint8

	// short packet body (when Flag is a short-packet flag)
	IsShortPacket bool
	ShortBody     []byte

	// normal packet fields
	Op  OpCode
	Id  uint64
	Msg Message

	// checksum uint32

	RawPacket []byte
}
