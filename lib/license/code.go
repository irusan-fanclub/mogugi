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

// ErrInvalid：碼格式錯誤或簽章驗不過。
var ErrInvalid = errors.New("invalid")

// ErrExpired：碼為真但已超出啟用視窗。
var ErrExpired = errors.New("expired")

// PublicKeyHex 為 build 時注入的 Ed25519 公鑰（hex）：
//
//	-ldflags "-X github.com/irusan-fanclub/mabidilmeter/lib/license.PublicKeyHex=<hex>"
//
// 未注入（dev build）時一律拒絕（fail closed）。
var PublicKeyHex = ""

const (
	codePrefix = "MOGU-"
	payloadLen = 8 // issuedAt(uint32) + serial(uint32)

	// ActivationWindow：碼可被首次啟用的時間長度。
	ActivationWindow = 30 * time.Minute
	// clockSkew：容許 issuedAt 稍微落在未來的偏移量。
	clockSkew = 5 * time.Minute
)

// decodeCode 解析 MOGU 碼、以內嵌公鑰驗簽，回傳 issuedAt（unix 秒）。
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
