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
	// Flip one bit inside a payload byte: the last base64 char only carries
	// padding bits, so tampering it may decode to the same bytes (flaky).
	raw, err := base64.RawURLEncoding.DecodeString(code[len(codePrefix):])
	if err != nil {
		t.Fatal(err)
	}
	raw[0] ^= 1
	bad := codePrefix + base64.RawURLEncoding.EncodeToString(raw)
	if _, err := decodeCode(bad); !errors.Is(err, ErrInvalid) {
		t.Fatalf("err=%v want ErrInvalid", err)
	}
}

func TestDecodeCode_InvalidUTF8Name(t *testing.T) {
	priv := setTestKey(t)
	// Build a signed payload whose displayName bytes are not valid UTF-8.
	payload := make([]byte, 12+2)
	binary.BigEndian.PutUint32(payload[0:], uint32(time.Now().Unix()))
	binary.BigEndian.PutUint64(payload[4:], 1)
	payload[12], payload[13] = 0xff, 0xfe // invalid UTF-8 sequence
	sig := ed25519.Sign(priv, payload)
	code := codePrefix + base64.RawURLEncoding.EncodeToString(append(payload, sig...))
	if _, err := decodeCode(code); !errors.Is(err, ErrInvalid) {
		t.Fatalf("err=%v want ErrInvalid for non-UTF-8 name", err)
	}
}

func TestDecodeCode_NoKey(t *testing.T) {
	old := PublicKeyHex
	PublicKeyHex = ""
	t.Cleanup(func() { PublicKeyHex = old })
	if _, err := decodeCode("MOGUGI-anything"); !errors.Is(err, ErrInvalid) {
		t.Fatalf("err=%v want ErrInvalid", err)
	}
}
