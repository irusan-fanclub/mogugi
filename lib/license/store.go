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

// MacKeyHex is the HMAC secret key (hex) injected at build time alongside PublicKeyHex.
// It raises the bar for manually editing license.dat to bypass the window (deterrence only; it is embedded in the binary).
var MacKeyHex = ""

const licenseFileName = "license.dat"

// pathOverride, when non-empty, replaces the executable-directory resolution; used in tests.
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

// computeMAC computes HMAC-SHA256 of code|activatedAt|machineId using MacKeyHex.
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
