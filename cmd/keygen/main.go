package main

import (
	"crypto/ed25519"
	"crypto/rand"
	"encoding/hex"
	"fmt"
)

// keygen 產生一組 Ed25519 金鑰對與一把 HMAC 密鑰。
// 私鑰交給 Discord bot（環境變數），公鑰與 MAC 密鑰供 build 注入。
func main() {
	pub, priv, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		panic(err)
	}
	macKey := make([]byte, 32)
	if _, err := rand.Read(macKey); err != nil {
		panic(err)
	}

	fmt.Println("# SECRET — 交給 Discord bot，切勿進 git：")
	fmt.Printf("MOGU_ED25519_PRIV=%s\n\n", hex.EncodeToString(priv.Seed()))
	fmt.Println("# Build 注入（存進 license-build.txt）：")
	fmt.Printf("PublicKeyHex=%s\n", hex.EncodeToString(pub))
	fmt.Printf("MacKeyHex=%s\n", hex.EncodeToString(macKey))
}
