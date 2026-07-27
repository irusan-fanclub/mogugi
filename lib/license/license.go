package license

import (
	"crypto/ed25519"
	"crypto/hmac"
	"os"
	"strconv"
	"sync"
	"time"
)

// ed25519PrivAlias is used by test helpers to annotate the return type.
type ed25519PrivAlias = ed25519.PrivateKey

// Status reports whether this installation is activated: license.dat must exist and its
// code signature, MAC, and machine fingerprint must all pass, and the code must still be
// inside its 30-day validity window (measured from the signed issuedAt).
func Status() bool {
	// Fail closed if the MAC key is missing or malformed: without a usable key
	// we cannot verify tamper resistance, so no license may validate.
	if _, ok := macKey(); !ok {
		return false
	}
	d, err := readLicenseData()
	if err != nil {
		return false
	}
	info, err := decodeCode(d.Code)
	if err != nil {
		return false
	}
	if codeExpired(info.IssuedAt, time.Now().Unix()) {
		return false
	}
	if !hmac.Equal([]byte(d.MAC), []byte(computeMAC(*d))) {
		return false
	}
	return d.MachineID == currentMachineID()
}

// Activate validates a freshly issued code (signature + 30-minute window) and, on success,
// binds it to this machine by writing license.dat. Returns ErrInvalid or ErrExpired on failure.
func Activate(code string) error {
	// Fail closed if the MAC key wasn't injected or is malformed: otherwise we
	// would write a license.dat that Status() can never accept.
	if _, ok := macKey(); !ok {
		return ErrInvalid
	}
	info, err := decodeCode(code)
	if err != nil {
		return err
	}
	now := time.Now().Unix()
	if now-info.IssuedAt > int64(activationWindow.Seconds()) {
		return ErrExpired
	}
	if info.IssuedAt-now > int64(clockSkew.Seconds()) {
		return ErrExpired // issuedAt is unreasonably far in the future
	}
	d := licenseData{Code: code, ActivatedAt: now, MachineID: currentMachineID()}
	d.MAC = computeMAC(d)
	if err := writeLicenseData(d); err != nil {
		return err
	}
	resetIdentityCache()
	return nil
}

// identityCache memoizes the verified identity keyed by the license file's
// path+mtime+size. requireLicense calls Identity() on every request; verifying
// afresh each time means 2 disk reads + 2 Ed25519 verifies per call. A re-stat
// is cheap, so we only re-verify when the file actually changes on disk.
//
// The cache is safe because the other inputs to verification (machineID,
// MacKeyHex) are process-constant: they are set once at startup (machineID from
// the OS, MacKeyHex via -ldflags) and never change while the process runs, so
// there is nothing to invalidate on. Tests that mutate these package vars call
// resetIdentityCache to clear it.
var (
	identityMu     sync.Mutex
	identityKey    identityCacheKey
	identityValid  bool
	cachedUserID   string
	cachedName     string
	cachedIssuedAt int64
	cachedOK       bool
)

type identityCacheKey struct {
	path  string
	mtime int64
	size  int64
}

func resetIdentityCache() {
	identityMu.Lock()
	identityValid = false
	identityMu.Unlock()
}

// Identity returns the activated user's Discord ID (as a string, since 64-bit
// IDs lose precision in JSON/JS) and display name. ok is false if not activated.
func Identity() (userID string, displayName string, ok bool) {
	path := licenseFilePath()

	var key identityCacheKey
	haveKey := false
	if fi, err := os.Stat(path); err == nil {
		key = identityCacheKey{path: path, mtime: fi.ModTime().UnixNano(), size: fi.Size()}
		haveKey = true

		identityMu.Lock()
		if identityValid && identityKey == key {
			u, n, iss, o := cachedUserID, cachedName, cachedIssuedAt, cachedOK
			identityMu.Unlock()
			// Expiry can cross over while the cached file is unchanged.
			if o && codeExpired(iss, time.Now().Unix()) {
				return "", "", false
			}
			return u, n, o
		}
		identityMu.Unlock()
	}

	u, n, iss, o := verifyIdentity()

	if haveKey {
		identityMu.Lock()
		identityKey, identityValid = key, true
		cachedUserID, cachedName, cachedIssuedAt, cachedOK = u, n, iss, o
		identityMu.Unlock()
	}
	return u, n, o
}

// verifyIdentity does the full read + verify chain once (Status()-equivalent
// checks plus decode), without Status()'s extra read+verify round trip.
func verifyIdentity() (userID string, displayName string, issuedAt int64, ok bool) {
	if _, ok := macKey(); !ok {
		return "", "", 0, false
	}
	d, err := readLicenseData()
	if err != nil {
		return "", "", 0, false
	}
	info, err := decodeCode(d.Code)
	if err != nil {
		return "", "", 0, false
	}
	if !hmac.Equal([]byte(d.MAC), []byte(computeMAC(*d))) {
		return "", "", 0, false
	}
	if d.MachineID != currentMachineID() {
		return "", "", 0, false
	}
	if codeExpired(info.IssuedAt, time.Now().Unix()) {
		return "", "", info.IssuedAt, false
	}
	return strconv.FormatUint(info.UserID, 10), info.DisplayName, info.IssuedAt, true
}

// codeExpired reports whether a code's signed issuedAt is past the 30-day
// validity window, or unreasonably far in the future.
func codeExpired(issuedAt, now int64) bool {
	if now-issuedAt > int64(validityWindow.Seconds()) {
		return true
	}
	return issuedAt-now > int64(clockSkew.Seconds())
}
