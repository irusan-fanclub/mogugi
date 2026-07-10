//go:build !windows

package license

import (
	"crypto/sha256"
	"encoding/hex"
	"os"
)

// currentMachineID uses the hostname as the fingerprint source on non-Windows platforms.
func currentMachineID() string {
	host, _ := os.Hostname()
	sum := sha256.Sum256([]byte("host:" + host))
	return hex.EncodeToString(sum[:])
}
