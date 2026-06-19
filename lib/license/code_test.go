package license

import (
	"crypto/ed25519"
	"crypto/rand"
	"encoding/base64"
	"encoding/binary"
	"encoding/hex"
	"errors"
	"testing"
	"time"
)

// mintCode 用測試私鑰鑄一組碼。
func mintCode(t *testing.T, priv ed25519.PrivateKey, issuedAt int64, serial uint32) string {
	t.Helper()
	payload := make([]byte, 8)
	binary.BigEndian.PutUint32(payload[0:], uint32(issuedAt))
	binary.BigEndian.PutUint32(payload[4:], serial)
	sig := ed25519.Sign(priv, payload)
	return codePrefix + base64.RawURLEncoding.EncodeToString(append(payload, sig...))
}

// setTestKey 產一組金鑰對並注入 PublicKeyHex，回傳私鑰。
func setTestKey(t *testing.T) ed25519.PrivateKey {
	t.Helper()
	pub, priv, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	old := PublicKeyHex
	PublicKeyHex = hex.EncodeToString(pub)
	t.Cleanup(func() { PublicKeyHex = old })
	return priv
}

func TestDecodeCode_Valid(t *testing.T) {
	priv := setTestKey(t)
	now := time.Now().Unix()
	got, err := decodeCode(mintCode(t, priv, now, 12345))
	if err != nil {
		t.Fatalf("decodeCode: %v", err)
	}
	if got != now {
		t.Fatalf("issuedAt=%d want %d", got, now)
	}
}

func TestDecodeCode_Tampered(t *testing.T) {
	priv := setTestKey(t)
	code := mintCode(t, priv, time.Now().Unix(), 1)
	bad := code[:len(code)-1] + string(rune(code[len(code)-1]^1))
	if _, err := decodeCode(bad); !errors.Is(err, ErrInvalid) {
		t.Fatalf("err=%v want ErrInvalid", err)
	}
}

func TestDecodeCode_NoKey(t *testing.T) {
	old := PublicKeyHex
	PublicKeyHex = ""
	t.Cleanup(func() { PublicKeyHex = old })
	if _, err := decodeCode("MOGU-anything"); !errors.Is(err, ErrInvalid) {
		t.Fatalf("err=%v want ErrInvalid", err)
	}
}
