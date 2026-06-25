package license

import (
	"crypto/ed25519"
	"encoding/base64"
	"encoding/binary"
	"encoding/hex"
	"errors"
	"strings"
	"time"
)

// ErrInvalid: code is malformed or the signature does not verify.
var ErrInvalid = errors.New("invalid")

// ErrExpired: code is authentic but the activation window has passed.
var ErrExpired = errors.New("expired")

// PublicKeyHex is the Ed25519 public key (hex) injected at build time:
//
//	-ldflags "-X github.com/irusan-fanclub/mabidilmeter/lib/license.PublicKeyHex=<hex>"
//
// If not injected (dev build), all codes are rejected (fail closed).
var PublicKeyHex = ""

const (
	codePrefix = "MOGU-"
	payloadLen = 8 // issuedAt(uint32) + serial(uint32)

	// activationWindow: how long a freshly issued code may be activated for the first time.
	activationWindow = 30 * time.Minute
	// clockSkew: tolerance for issuedAt values that are slightly in the future.
	clockSkew = 5 * time.Minute
)

// decodeCode parses a MOGU code, verifies its signature against the embedded public key, and returns issuedAt (unix seconds).
func decodeCode(code string) (int64, error) {
	pubHex := strings.TrimSpace(PublicKeyHex)
	if pubHex == "" {
		return 0, ErrInvalid
	}
	pub, err := hex.DecodeString(pubHex)
	if err != nil || len(pub) != ed25519.PublicKeySize {
		return 0, ErrInvalid
	}

	code = strings.TrimSpace(code)
	if !strings.HasPrefix(code, codePrefix) {
		return 0, ErrInvalid
	}
	raw, err := base64.RawURLEncoding.DecodeString(code[len(codePrefix):])
	if err != nil || len(raw) != payloadLen+ed25519.SignatureSize {
		return 0, ErrInvalid
	}

	payload, sig := raw[:payloadLen], raw[payloadLen:]
	if !ed25519.Verify(ed25519.PublicKey(pub), payload, sig) {
		return 0, ErrInvalid
	}
	return int64(binary.BigEndian.Uint32(payload[0:4])), nil
}
