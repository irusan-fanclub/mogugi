//go:build windows

package license

import (
	"crypto/sha256"
	"encoding/hex"
	"os"

	"golang.org/x/sys/windows/registry"
)

// currentMachineID returns a stable machine fingerprint hash. On Windows it reads the OS MachineGuid;
// falls back to hostname if that is unavailable.
func currentMachineID() string {
	if guid, err := readMachineGUID(); err == nil && guid != "" {
		return hashID("guid:" + guid)
	}
	host, _ := os.Hostname()
	return hashID("host:" + host)
}

func readMachineGUID() (string, error) {
	k, err := registry.OpenKey(registry.LOCAL_MACHINE,
		`SOFTWARE\Microsoft\Cryptography`, registry.QUERY_VALUE|registry.WOW64_64KEY)
	if err != nil {
		return "", err
	}
	defer k.Close()
	v, _, err := k.GetStringValue("MachineGuid")
	return v, err
}

func hashID(s string) string {
	sum := sha256.Sum256([]byte(s))
	return hex.EncodeToString(sum[:])
}
