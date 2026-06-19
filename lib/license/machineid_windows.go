//go:build windows

package license

import (
	"crypto/sha256"
	"encoding/hex"
	"os"

	"golang.org/x/sys/windows/registry"
)

// currentMachineID 回傳穩定的本機指紋雜湊。Windows 取 OS MachineGuid；
// 讀不到則退回 hostname。
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
