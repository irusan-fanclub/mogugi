package license

import (
	"crypto/ed25519"
	"crypto/hmac"
	"time"
)

// ed25519PrivAlias 供測試 helper 標示回傳型別。
type ed25519PrivAlias = ed25519.PrivateKey

// Status 回報本安裝是否已啟用：存在 license.dat 且其碼簽章、MAC、
// 機器指紋皆通過。此處「不」再檢查 30 分鐘視窗 → 已啟用者永久可用。
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

// Activate 驗證新發的碼（簽章 + 30 分鐘視窗），成功則把碼綁定本機寫入
// license.dat。失敗回 ErrInvalid 或 ErrExpired。
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
		return ErrExpired // issuedAt 落在不合理的未來
	}
	d := licenseData{Code: code, ActivatedAt: now, MachineID: currentMachineID()}
	d.MAC = computeMAC(d)
	return writeLicenseData(d)
}
