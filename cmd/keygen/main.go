package main

import (
	"crypto/ed25519"
	"crypto/rand"
	"encoding/hex"
	"fmt"
)

// keygen generates an Ed25519 key pair and one HMAC secret key.
// The private key goes to the Discord bot (environment variable); the public key and MAC key are injected at build time.
func main() {
	pub, priv, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		panic(err)
	}
	macKey := make([]byte, 32)
	if _, err := rand.Read(macKey); err != nil {
		panic(err)
	}

	fmt.Println("# SECRET — give to the Discord bot, never commit to git:")
	fmt.Printf("MOGU_ED25519_PRIV=%s\n\n", hex.EncodeToString(priv.Seed()))
	fmt.Println("# Build injection values (store in license-build.txt):")
	fmt.Printf("PublicKeyHex=%s\n", hex.EncodeToString(pub))
	fmt.Printf("MacKeyHex=%s\n", hex.EncodeToString(macKey))
}
