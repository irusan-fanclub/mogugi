package license

import (
	"crypto/ed25519"
	"encoding/base64"
	"encoding/binary"
	"encoding/hex"
	"errors"
	"strings"
	"time"
	"unicode/utf8"
)

// ErrInvalid: code is malformed or the signature does not verify.
var ErrInvalid = errors.New("invalid")

// ErrExpired: code is authentic but the activation window has passed.
var ErrExpired = errors.New("expired")

// PublicKeyHex is the Ed25519 public key (hex) injected at build time:
//
//	-ldflags "-X github.com/irusan-fanclub/mogugi/lib/license.PublicKeyHex=<hex>"
//
// If not injected (dev build), all codes are rejected (fail closed).
var PublicKeyHex = ""

const (
	codePrefix = "MOGUGI-"
	headerLen  = 12 // issuedAt(4)+userID(8)

	// activationWindow: how long a freshly issued code may be activated for the first time.
	activationWindow = 30 * time.Minute
	// clockSkew: tolerance for issuedAt values that are slightly in the future.
	clockSkew = 5 * time.Minute
	// validityWindow: how long an activated code stays valid after issuance;
	// past this, Status/Identity report not-activated and a fresh code is needed.
	validityWindow = 30 * 24 * time.Hour
)

// codeInfo is the verified content of a MOGUGI code.
type codeInfo struct {
	IssuedAt    int64  // unix seconds the code was signed
	UserID      uint64 // Discord user ID
	DisplayName string // snapshot of the user's display name at issue time
}

// decodeCode parses a MOGUGI code, verifies its signature against the embedded
// public key, and returns its content.
func decodeCode(code string) (codeInfo, error) {
	pubHex := strings.TrimSpace(PublicKeyHex)
	if pubHex == "" {
		return codeInfo{}, ErrInvalid
	}
	pub, err := hex.DecodeString(pubHex)
	if err != nil || len(pub) != ed25519.PublicKeySize {
		return codeInfo{}, ErrInvalid
	}

	code = strings.TrimSpace(code)
	if !strings.HasPrefix(code, codePrefix) {
		return codeInfo{}, ErrInvalid
	}
	raw, err := base64.RawURLEncoding.DecodeString(code[len(codePrefix):])
	if err != nil || len(raw) < headerLen+ed25519.SignatureSize {
		return codeInfo{}, ErrInvalid
	}

	sig := raw[len(raw)-ed25519.SignatureSize:]
	payload := raw[:len(raw)-ed25519.SignatureSize]
	if !ed25519.Verify(ed25519.PublicKey(pub), payload, sig) {
		return codeInfo{}, ErrInvalid
	}

	name := payload[headerLen:]
	if !utf8.Valid(name) {
		return codeInfo{}, ErrInvalid
	}
	return codeInfo{
		IssuedAt:    int64(binary.BigEndian.Uint32(payload[0:4])),
		UserID:      binary.BigEndian.Uint64(payload[4:12]),
		DisplayName: string(name),
	}, nil
}
