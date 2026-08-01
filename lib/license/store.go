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

// licenseDirEnv relocates license.dat. dev-run.ps1 sets it to the repo root:
// `go run` builds into a fresh temp directory every time, so without it a dev
// run never sees the activation the previous one wrote. It only moves the file
// — signature, MAC, machine id and expiry are still verified as usual.
const licenseDirEnv = "MOGUGI_LICENSE_DIR"

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
	if dir := strings.TrimSpace(os.Getenv(licenseDirEnv)); dir != "" {
		return filepath.Join(dir, licenseFileName)
	}
	if exe, err := os.Executable(); err == nil {
		return filepath.Join(filepath.Dir(exe), licenseFileName)
	}
	return licenseFileName
}

// macKey decodes the build-injected MacKeyHex. ok is false when the key is
// missing or malformed, so callers can fail closed rather than silently
// degrading to an HMAC over an empty/partial key (which would weaken tamper
// detection). Note: MacKeyHex=="" is the "not built with a key" case, which
// Status/Activate already treat as fail-closed before reaching here.
func macKey() (key []byte, ok bool) {
	h := strings.TrimSpace(MacKeyHex)
	if h == "" {
		return nil, false
	}
	key, err := hex.DecodeString(h)
	if err != nil || len(key) == 0 {
		return nil, false
	}
	return key, true
}

// computeMAC computes HMAC-SHA256 of code|activatedAt|machineId using MacKeyHex.
// If the key is malformed it returns "", which never equals a real MAC, so a
// caller comparing against it fails closed.
func computeMAC(d licenseData) string {
	key, ok := macKey()
	if !ok {
		return ""
	}
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
