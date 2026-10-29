package desktop

import (
	"fmt"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"golang.org/x/sys/windows"
)

// waitPidFlag is passed to an elevated relaunch so it starts only after the
// old instance has released the single-instance lock and the port.
const waitPidFlag = "--wait-pid="

// relaunchWait caps how long a relaunch waits for the old instance.
const relaunchWait = 15 * time.Second

// isElevated reports whether mogugi runs as administrator; the game does,
// and a keyboard hook in a lower process never sees its keys.
func isElevated() bool { return windows.GetCurrentProcessToken().IsElevated() }

// relaunchElevated starts this exe as administrator (UAC prompt). It returns
// an error, ERROR_CANCELLED when declined, and then the caller keeps running.
func relaunchElevated() error {
	exe, err := os.Executable()
	if err != nil {
		return err
	}
	verb, _ := windows.UTF16PtrFromString("runas")
	file, _ := windows.UTF16PtrFromString(exe)
	args, _ := windows.UTF16PtrFromString(waitPidFlag + strconv.Itoa(os.Getpid()))
	dir, _ := windows.UTF16PtrFromString(filepath.Dir(exe))
	return windows.ShellExecute(0, verb, file, args, dir, windows.SW_SHOWNORMAL)
}

// WaitForRelaunch strips --wait-pid=N from args and, when present, waits for
// process N to exit (up to relaunchWait) before returning the rest.
func WaitForRelaunch(args []string) []string {
	out := args[:0:0]
	pid := 0
	for _, a := range args {
		if v, ok := strings.CutPrefix(a, waitPidFlag); ok {
			pid, _ = strconv.Atoi(v)
			continue
		}
		out = append(out, a)
	}
	if pid > 0 {
		if h, err := windows.OpenProcess(windows.SYNCHRONIZE, false, uint32(pid)); err == nil {
			_, _ = windows.WaitForSingleObject(h, uint32(relaunchWait/time.Millisecond))
			windows.CloseHandle(h)
		}
	}
	return out
}

// elevateErrorText is shown when the relaunch did not start.
func elevateErrorText(err error) string {
	if err == windows.ERROR_CANCELLED {
		return "已取消，仍以一般權限執行"
	}
	return fmt.Sprintf("無法以系統管理員身分重新啟動：%v", err)
}
