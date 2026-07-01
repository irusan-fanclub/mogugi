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

// mintCode mints a code using the test private key.
func mintCode(t *testing.T, priv ed25519.PrivateKey, issuedAt int64, userID uint64, name string) string {
	t.Helper()
	payload := make([]byte, 12+len(name))
	binary.BigEndian.PutUint32(payload[0:], uint32(issuedAt))
	binary.BigEndian.PutUint64(payload[4:], userID)
	copy(payload[12:], name)
	sig := ed25519.Sign(priv, payload)
	return codePrefix + base64.RawURLEncoding.EncodeToString(append(payload, sig...))
}

// setTestKey generates a key pair, injects the public key into PublicKeyHex, and returns the private key.
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
	info, err := decodeCode(mintCode(t, priv, now, 123456789012345678, "Tester"))
	if err != nil {
		t.Fatalf("decodeCode: %v", err)
	}
	if info.IssuedAt != now || info.UserID != 123456789012345678 || info.DisplayName != "Tester" {
		t.Fatalf("got %+v", info)
	}
}

func TestDecodeCode_Tampered(t *testing.T) {
	priv := setTestKey(t)
	code := mintCode(t, priv, time.Now().Unix(), 1, "x")
	bad := code[:len(code)-1] + string(rune(code[len(code)-1]^1))
	if _, err := decodeCode(bad); !errors.Is(err, ErrInvalid) {
		t.Fatalf("err=%v want ErrInvalid", err)
	}
}

func TestDecodeCode_NoKey(t *testing.T) {
	old := PublicKeyHex
	PublicKeyHex = ""
	t.Cleanup(func() { PublicKeyHex = old })
	if _, err := decodeCode("MOMETER-anything"); !errors.Is(err, ErrInvalid) {
		t.Fatalf("err=%v want ErrInvalid", err)
	}
}
