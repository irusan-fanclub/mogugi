package license

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"os"
	"path/filepath"
	"strconv"
	"strings"
)

// MacKeyHex 為 build 時與 PublicKeyHex 一同注入的 HMAC 密鑰（hex）。
// 用來提高手改 license.dat 繞過視窗的門檻（僅嚇阻；它內嵌於執行檔）。
var MacKeyHex = ""

const licenseFileName = "license.dat"

// pathOverride 非空時取代 exe 目錄解析；測試用。
var pathOverride string

type licenseData struct {
	Code        string `json:"code"`
	ActivatedAt int64  `json:"activatedAt"`
	MachineID   string `json:"machineId"`
	MAC         string `json:"mac"`
}

func licenseFilePath() string {
	if pathOverride != "" {
		return filepath.Join(pathOverride, licenseFileName)
	}
	if exe, err := os.Executable(); err == nil {
		return filepath.Join(filepath.Dir(exe), licenseFileName)
	}
	return licenseFileName
}

// computeMAC 對 code|activatedAt|machineId 以 MacKeyHex 做 HMAC-SHA256。
func computeMAC(d licenseData) string {
	key, _ := hex.DecodeString(strings.TrimSpace(MacKeyHex))
	mac := hmac.New(sha256.New, key)
	mac.Write([]byte(d.Code + "|" + strconv.FormatInt(d.ActivatedAt, 10) + "|" + d.MachineID))
	return hex.EncodeToString(mac.Sum(nil))
}

func readLicenseData() (*licenseData, error) {
	b, err := os.ReadFile(licenseFilePath())
	if err != nil {
		return nil, err
	}
	var d licenseData
	if err := json.Unmarshal(b, &d); err != nil {
		return nil, err
	}
	return &d, nil
}

func writeLicenseData(d licenseData) error {
	b, err := json.MarshalIndent(d, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(licenseFilePath(), b, 0600)
}
