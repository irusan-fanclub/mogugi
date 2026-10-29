// Package clientver detects the game client's region and version.
package clientver

import (
	"encoding/binary"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
)

// Only the setting: locale word is extracted; the capture cannot span /N: or /V:.
var settingRe = regexp.MustCompile(`(?:^|\s)setting:"[^"]*=\s*[^,"]*,\s*([A-Za-z][A-Za-z ]{0,31})\s*"`)

// RegionFromCommandLine returns the region code, or "" when absent.
func RegionFromCommandLine(cmd string) string {
	m := settingRe.FindStringSubmatch(cmd)
	if m == nil {
		return ""
	}
	loc := strings.TrimSpace(m[1])
	switch strings.ToLower(loc) {
	case "taiwan":
		return "tw"
	case "usa":
		return "us"
	case "korea":
		return "kr"
	case "japan":
		return "jp"
	}
	return strings.ToLower(strings.ReplaceAll(loc, " ", ""))
}

// ReadVersionDat reads the 4-byte little-endian version in dir/version.dat.
func ReadVersionDat(dir string) (uint32, error) {
	b, err := os.ReadFile(filepath.Join(dir, "version.dat"))
	if err != nil {
		return 0, err
	}
	if len(b) < 4 {
		return 0, fmt.Errorf("version.dat too short: %d bytes", len(b))
	}
	return binary.LittleEndian.Uint32(b), nil
}

// Format joins region and version, e.g. "tw169"; bare number without region.
func Format(region string, ver uint32) string {
	return region + strconv.FormatUint(uint64(ver), 10)
}
