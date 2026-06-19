//go:build !windows

package license

import (
	"crypto/sha256"
	"encoding/hex"
	"os"
)

// currentMachineID 在非 Windows 平台以 hostname 為指紋來源。
func currentMachineID() string {
	host, _ := os.Hostname()
	sum := sha256.Sum256([]byte("host:" + host))
	return hex.EncodeToString(sum[:])
}
