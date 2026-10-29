//go:build windows

package clientver

import (
	"fmt"
	"path/filepath"

	"github.com/irusan-fanclub/mogugi/lib/pcaputil"
	"github.com/irusan-fanclub/mogugi/lib/util"
)

var logger = util.NewLogger("clientver")

// Detect returns e.g. "tw169" for the game process; an error means the version is unreadable.
func Detect(pid uint32) (string, error) {
	path, err := pcaputil.ProcessImagePath(pid)
	if err != nil {
		return "", fmt.Errorf("image path: %w", err)
	}
	ver, err := ReadVersionDat(filepath.Dir(path))
	if err != nil {
		return "", fmt.Errorf("version.dat: %w", err)
	}
	region := ""
	if cmd, err := ProcessCommandLine(pid); err != nil {
		logger.Println("command line unavailable:", err)
	} else {
		region = RegionFromCommandLine(cmd)
	}
	return Format(region, ver), nil
}
