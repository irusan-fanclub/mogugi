package license

import (
	"errors"
	"testing"
	"time"
)

// setupActivated injects the test key pair and MAC key, and redirects license.dat to a temp directory.
func setupActivated(t *testing.T) (priv ed25519PrivAlias) {
	t.Helper()
	p := setTestKey(t)
	oldMac, oldPath := MacKeyHex, pathOverride
	MacKeyHex, pathOverride = "00112233445566778899aabbccddeeff", t.TempDir()
	resetIdentityCache()
	t.Cleanup(func() { MacKeyHex, pathOverride = oldMac, oldPath; resetIdentityCache() })
	return p
}

func TestActivateAndStatus(t *testing.T) {
	priv := setupActivated(t)
	if err := Activate(mintCode(t, priv, time.Now().Unix(), 42, "u")); err != nil {
		t.Fatalf("Activate: %v", err)
	}
	if !Status() {
		t.Fatal("Status=false after Activate")
	}
}

func TestActivate_Expired(t *testing.T) {
	priv := setupActivated(t)
	old := time.Now().Add(-31 * time.Minute).Unix()
	if err := Activate(mintCode(t, priv, old, 42, "u")); !errors.Is(err, ErrExpired) {
		t.Fatalf("err=%v want ErrExpired", err)
	}
}

func TestActivate_NoMacKey(t *testing.T) {
	priv := setTestKey(t) // public key injected, but MacKeyHex left empty
	oldMac, oldPath := MacKeyHex, pathOverride
	MacKeyHex, pathOverride = "", t.TempDir()
	t.Cleanup(func() { MacKeyHex, pathOverride = oldMac, oldPath })
	if err := Activate(mintCode(t, priv, time.Now().Unix(), 42, "u")); !errors.Is(err, ErrInvalid) {
		t.Fatalf("err=%v want ErrInvalid", err)
	}
}

func TestStatus_TamperedMAC(t *testing.T) {
	priv := setupActivated(t)
	if err := Activate(mintCode(t, priv, time.Now().Unix(), 42, "u")); err != nil {
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
	if err := Activate(mintCode(t, priv, time.Now().Unix(), 42, "u")); err != nil {
		t.Fatal(err)
	}
	d, _ := readLicenseData()
	d.MachineID = "someoneelse"
	d.MAC = computeMAC(*d) // recompute MAC so the machine fingerprint is the only changed field
	_ = writeLicenseData(*d)
	if Status() {
		t.Fatal("Status=true with mismatched machineId")
	}
}

func TestActivate_FutureBeyondClockSkew(t *testing.T) {
	priv := setupActivated(t)
	// issuedAt is further in the future than clockSkew tolerance allows.
	future := time.Now().Add(clockSkew + time.Minute).Unix()
	if err := Activate(mintCode(t, priv, future, 42, "u")); !errors.Is(err, ErrExpired) {
		t.Fatalf("err=%v want ErrExpired", err)
	}
}

func TestActivate_FutureWithinClockSkew(t *testing.T) {
	priv := setupActivated(t)
	// issuedAt slightly in the future but within tolerance is accepted.
	future := time.Now().Add(clockSkew - time.Minute).Unix()
	if err := Activate(mintCode(t, priv, future, 42, "u")); err != nil {
		t.Fatalf("Activate: %v want nil (within clock skew)", err)
	}
}

func TestIdentity_HappyPath(t *testing.T) {
	priv := setupActivated(t)
	const uid uint64 = 123456789012345678
	const name = "DisplayName"
	if err := Activate(mintCode(t, priv, time.Now().Unix(), uid, name)); err != nil {
		t.Fatalf("Activate: %v", err)
	}
	gotID, gotName, ok := Identity()
	if !ok {
		t.Fatal("Identity ok=false after Activate")
	}
	if gotID != "123456789012345678" || gotName != name {
		t.Fatalf("Identity=(%q,%q) want (%q,%q)", gotID, gotName, "123456789012345678", name)
	}
}

func TestIdentity_NotActivated(t *testing.T) {
	setupActivated(t) // key+path set up, but no license.dat written
	if _, _, ok := Identity(); ok {
		t.Fatal("Identity ok=true with no license")
	}
}

func TestIdentity_CachedAcrossCalls(t *testing.T) {
	priv := setupActivated(t)
	if err := Activate(mintCode(t, priv, time.Now().Unix(), 7, "n")); err != nil {
		t.Fatal(err)
	}
	id1, n1, ok1 := Identity()
	id2, n2, ok2 := Identity() // second call served from cache; must be identical
	if id1 != id2 || n1 != n2 || ok1 != ok2 || !ok1 {
		t.Fatalf("Identity not stable across calls: (%q,%q,%v) vs (%q,%q,%v)", id1, n1, ok1, id2, n2, ok2)
	}
}

func TestStatus_MalformedMacKeyFailsClosed(t *testing.T) {
	priv := setupActivated(t)
	if err := Activate(mintCode(t, priv, time.Now().Unix(), 42, "u")); err != nil {
		t.Fatal(err)
	}
	if !Status() {
		t.Fatal("precondition: Status=false after Activate")
	}
	// Inject a non-hex MAC key: verification must fail closed, not degrade.
	oldMac := MacKeyHex
	MacKeyHex = "zznothex"
	t.Cleanup(func() { MacKeyHex = oldMac })
	if Status() {
		t.Fatal("Status=true with malformed MacKeyHex; should fail closed")
	}
	if _, _, ok := Identity(); ok {
		t.Fatal("Identity ok=true with malformed MacKeyHex; should fail closed")
	}
}

func TestStatus_OldCodeStillValidOnceStored(t *testing.T) {
	priv := setupActivated(t)
	oldCode := mintCode(t, priv, time.Now().Add(-48*time.Hour).Unix(), 42, "u")
	d := licenseData{Code: oldCode, ActivatedAt: time.Now().Unix(), MachineID: currentMachineID()}
	d.MAC = computeMAC(d)
	if err := writeLicenseData(d); err != nil {
		t.Fatal(err)
	}
	if !Status() {
		t.Fatal("Status=false; window should not be checked once the code is stored")
	}
}

// writeActivatedAt installs an activated license whose code was issued at the
// given time, bypassing Activate's 30-minute first-activation window.
func writeActivatedAt(t *testing.T, priv ed25519PrivAlias, issuedAt int64) {
	t.Helper()
	code := mintCode(t, priv, issuedAt, 42, "u")
	d := licenseData{Code: code, ActivatedAt: issuedAt, MachineID: currentMachineID()}
	d.MAC = computeMAC(d)
	if err := writeLicenseData(d); err != nil {
		t.Fatal(err)
	}
	resetIdentityCache()
}

func TestStatus_WithinValidityWindow(t *testing.T) {
	priv := setupActivated(t)
	writeActivatedAt(t, priv, time.Now().Add(-29*24*time.Hour).Unix())
	if !Status() {
		t.Fatal("Status=false for a 29-day-old code, want true")
	}
	if _, _, ok := Identity(); !ok {
		t.Fatal("Identity ok=false for a 29-day-old code, want true")
	}
}

func TestStatus_ExpiredAfterValidityWindow(t *testing.T) {
	priv := setupActivated(t)
	writeActivatedAt(t, priv, time.Now().Add(-31*24*time.Hour).Unix())
	if Status() {
		t.Fatal("Status=true for a 31-day-old code, want false (expired)")
	}
	if _, _, ok := Identity(); ok {
		t.Fatal("Identity ok=true for a 31-day-old code, want false (expired)")
	}
}

func TestCodeExpiredBoundaries(t *testing.T) {
	now := time.Now().Unix()
	cases := []struct {
		name     string
		issuedAt int64
		want     bool
	}{
		{"fresh", now, false},
		{"just inside", now - int64(validityWindow.Seconds()) + 60, false},
		{"just outside", now - int64(validityWindow.Seconds()) - 60, true},
		{"future beyond skew", now + int64(clockSkew.Seconds()) + 60, true},
		{"future within skew", now + int64(clockSkew.Seconds()) - 60, false},
	}
	for _, c := range cases {
		if got := codeExpired(c.issuedAt, now); got != c.want {
			t.Errorf("%s: codeExpired=%v want %v", c.name, got, c.want)
		}
	}
}
