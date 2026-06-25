package license

import (
	"crypto/ed25519"
	"crypto/hmac"
	"time"
)

// ed25519PrivAlias is used by test helpers to annotate the return type.
type ed25519PrivAlias = ed25519.PrivateKey

// Status reports whether this installation is activated: license.dat must exist and its
// code signature, MAC, and machine fingerprint must all pass. The 30-minute window is
// NOT checked here — once activated, the license is permanently valid.
func Status() bool {
	if MacKeyHex == "" {
		return false
	}
	d, err := readLicenseData()
	if err != nil {
		return false
	}
	if _, err := decodeCode(d.Code); err != nil {
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
	// Fail closed if the MAC key wasn't injected: otherwise we would write a
	// license.dat that Status() can never accept (it requires MacKeyHex).
	if MacKeyHex == "" {
		return ErrInvalid
	}
	issuedAt, err := decodeCode(code)
	if err != nil {
		return err
	}
	now := time.Now().Unix()
	if now-issuedAt > int64(ActivationWindow.Seconds()) {
		return ErrExpired
	}
	if issuedAt-now > int64(clockSkew.Seconds()) {
		return ErrExpired // issuedAt is unreasonably far in the future
	}
	d := licenseData{Code: code, ActivatedAt: now, MachineID: currentMachineID()}
	d.MAC = computeMAC(d)
	return writeLicenseData(d)
}
