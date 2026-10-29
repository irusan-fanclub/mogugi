//go:build windows

package clientver

import (
	"errors"
	"unsafe"

	"golang.org/x/sys/windows"
)

const (
	processQueryLimitedInfo       = 0x1000
	processCommandLineInformation = 60
)

// ProcessCommandLine reads a process's command line; it may fail for protected processes.
func ProcessCommandLine(pid uint32) (string, error) {
	h, err := windows.OpenProcess(processQueryLimitedInfo, false, pid)
	if err != nil {
		return "", err
	}
	defer windows.CloseHandle(h)

	// []uint64 keeps the buffer 8-byte aligned; the kernel rejects a misaligned
	// one with STATUS_DATATYPE_MISALIGNMENT, and a []byte has no alignment guarantee.
	buf := make([]uint64, 32*1024/8)
	var ret uint32
	query := func() error {
		return windows.NtQueryInformationProcess(h, processCommandLineInformation,
			unsafe.Pointer(&buf[0]), uint32(len(buf)*8), &ret)
	}
	err = query()
	// Too small: reallocate to the size the kernel reported and retry once.
	if errors.Is(err, windows.STATUS_INFO_LENGTH_MISMATCH) && ret > uint32(len(buf)*8) {
		buf = make([]uint64, (ret+7)/8)
		err = query()
	}
	if err != nil {
		return "", err
	}
	us := (*windows.NTUnicodeString)(unsafe.Pointer(&buf[0]))
	if us.Length == 0 || us.Buffer == nil {
		return "", errors.New("empty command line")
	}
	return us.String(), nil
}
