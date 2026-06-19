package license

import (
	"errors"
	"testing"
	"time"
)

// setupActivated 注入測試金鑰與 MAC 密鑰，並把 license.dat 導到暫存目錄。
func setupActivated(t *testing.T) (priv ed25519PrivAlias) {
	t.Helper()
	p := setTestKey(t)
	oldMac, oldPath := MacKeyHex, pathOverride
	MacKeyHex, pathOverride = "00112233445566778899aabbccddeeff", t.TempDir()
	t.Cleanup(func() { MacKeyHex, pathOverride = oldMac, oldPath })
	return p
}

func TestActivateAndStatus(t *testing.T) {
	priv := setupActivated(t)
	if err := Activate(mintCode(t, priv, time.Now().Unix(), 7)); err != nil {
		t.Fatalf("Activate: %v", err)
	}
	if !Status() {
		t.Fatal("Status=false after Activate")
	}
}

func TestActivate_Expired(t *testing.T) {
	priv := setupActivated(t)
	old := time.Now().Add(-31 * time.Minute).Unix()
	if err := Activate(mintCode(t, priv, old, 1)); !errors.Is(err, ErrExpired) {
		t.Fatalf("err=%v want ErrExpired", err)
	}
}

func TestActivate_NoMacKey(t *testing.T) {
	priv := setTestKey(t) // public key injected, but MacKeyHex left empty
	oldMac, oldPath := MacKeyHex, pathOverride
	MacKeyHex, pathOverride = "", t.TempDir()
	t.Cleanup(func() { MacKeyHex, pathOverride = oldMac, oldPath })
	if err := Activate(mintCode(t, priv, time.Now().Unix(), 1)); !errors.Is(err, ErrInvalid) {
		t.Fatalf("err=%v want ErrInvalid", err)
	}
}

func TestStatus_TamperedMAC(t *testing.T) {
	priv := setupActivated(t)
	if err := Activate(mintCode(t, priv, time.Now().Unix(), 1)); err != nil {
		t.Fatal(err)
	}
	d, _ := readLicenseData()
	d.MAC = "deadbeef"
	_ = writeLicenseData(*d)
	if Status() {
		t.Fatal("Status=true with tampered MAC")
	}
}

func TestStatus_MachineMismatch(t *testing.T) {
	priv := setupActivated(t)
	if err := Activate(mintCode(t, priv, time.Now().Unix(), 1)); err != nil {
		t.Fatal(err)
	}
	d, _ := readLicenseData()
	d.MachineID = "someoneelse"
	d.MAC = computeMAC(*d) // 重算 MAC，隔離出機器指紋這一項
	_ = writeLicenseData(*d)
	if Status() {
		t.Fatal("Status=true with mismatched machineId")
	}
}

func TestStatus_OldCodeStillValidOnceStored(t *testing.T) {
	priv := setupActivated(t)
	oldCode := mintCode(t, priv, time.Now().Add(-48*time.Hour).Unix(), 1)
	d := licenseData{Code: oldCode, ActivatedAt: time.Now().Unix(), MachineID: currentMachineID()}
	d.MAC = computeMAC(d)
	if err := writeLicenseData(d); err != nil {
		t.Fatal(err)
	}
	if !Status() {
		t.Fatal("Status=false; 已儲存後不應再檢查視窗")
	}
}
