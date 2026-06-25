package main

import (
	"crypto/ed25519"
	"encoding/base64"
	"encoding/binary"
	"encoding/hex"
	"fmt"
	"os"
	"strconv"
	"time"
)

// mintcode mints a MOGU code from MOGU_ED25519_PRIV (mirrors the bot). Local testing only.
// Usage: mintcode <discordUserID> <displayName>
func main() {
	seed, err := hex.DecodeString(os.Getenv("MOGU_ED25519_PRIV"))
	if err != nil || len(seed) != ed25519.SeedSize {
		fmt.Fprintln(os.Stderr, "set MOGU_ED25519_PRIV to the 32-byte seed hex from cmd/keygen")
		os.Exit(1)
	}
	if len(os.Args) < 3 {
		fmt.Fprintln(os.Stderr, "usage: mintcode <discordUserID> <displayName>")
		os.Exit(1)
	}
	userID, err := strconv.ParseUint(os.Args[1], 10, 64)
	if err != nil {
		fmt.Fprintln(os.Stderr, "discordUserID must be a uint64")
		os.Exit(1)
	}
	name := os.Args[2]
	priv := ed25519.NewKeyFromSeed(seed)

	payload := make([]byte, 12+len(name))
	binary.BigEndian.PutUint32(payload[0:], uint32(time.Now().Unix()))
	binary.BigEndian.PutUint64(payload[4:], userID)
	copy(payload[12:], name)
	sig := ed25519.Sign(priv, payload)
	fmt.Println("MOGU-" + base64.RawURLEncoding.EncodeToString(append(payload, sig...)))
}
