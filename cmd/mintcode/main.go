package main

import (
	"crypto/ed25519"
	"encoding/base64"
	"encoding/binary"
	"encoding/hex"
	"fmt"
	"math/rand"
	"os"
	"time"
)

// mintcode mints a code using MOGU_ED25519_PRIV (mirrors the bot's signing logic), for local testing only.
func main() {
	seed, err := hex.DecodeString(os.Getenv("MOGU_ED25519_PRIV"))
	if err != nil || len(seed) != ed25519.SeedSize {
		fmt.Fprintln(os.Stderr, "set MOGU_ED25519_PRIV to the 32-byte seed hex from cmd/keygen")
		os.Exit(1)
	}
	priv := ed25519.NewKeyFromSeed(seed)

	payload := make([]byte, 8)
	binary.BigEndian.PutUint32(payload[0:], uint32(time.Now().Unix()))
	binary.BigEndian.PutUint32(payload[4:], rand.Uint32())
	sig := ed25519.Sign(priv, payload)
	fmt.Println("MOGU-" + base64.RawURLEncoding.EncodeToString(append(payload, sig...)))
}
