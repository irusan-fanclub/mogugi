package license

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

// KeyHashes is the comma-separated list of accepted SHA256 hashes (hex).
// Override at link time via:
//
//	go build -ldflags "-X github.com/irusan-fanclub/mabidilmeter/lib/license.KeyHashes=h1,h2,h3"
//
// Empty value (un-injected build) rejects all keys so dev builds without
// the ldflags step also fail closed.
var KeyHashes = ""

const licenseFile = "license.key"

// Verify reads license.key beside the executable (with a cwd fallback for
// `go run`) and checks its SHA256 against KeyHashes.
func Verify() error {
	if KeyHashes == "" {
		return errors.New("no keys configured in this build")
	}

	data, err := readLicense()
	if err != nil {
		return err
	}

	sum := sha256.Sum256(bytes.TrimSpace(data))
	got := hex.EncodeToString(sum[:])

	for _, want := range strings.Split(KeyHashes, ",") {
		if strings.TrimSpace(want) == got {
			return nil
		}
	}
	return errors.New("invalid key")
}

func readLicense() ([]byte, error) {
	if exe, err := os.Executable(); err == nil {
		if data, err := os.ReadFile(filepath.Join(filepath.Dir(exe), licenseFile)); err == nil {
			return data, nil
		}
	}
	if data, err := os.ReadFile(licenseFile); err == nil {
		return data, nil
	}
	return nil, fmt.Errorf("%s not found beside exe or in cwd", licenseFile)
}
