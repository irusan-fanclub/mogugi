package desktop

import (
	"errors"
	"reflect"
	"testing"

	"golang.org/x/sys/windows"
)

func TestWaitForRelaunchStripsFlag(t *testing.T) {
	// A pid that cannot exist returns at once.
	got := WaitForRelaunch([]string{"--wait-pid=0", "x"})
	if !reflect.DeepEqual(got, []string{"x"}) {
		t.Fatalf("got %q", got)
	}
	if got := WaitForRelaunch(nil); len(got) != 0 {
		t.Fatalf("got %q", got)
	}
}

func TestElevateErrorText(t *testing.T) {
	if s := elevateErrorText(windows.ERROR_CANCELLED); s != "已取消，仍以一般權限執行" {
		t.Fatal(s)
	}
	if s := elevateErrorText(errors.New("boom")); s != "無法以系統管理員身分重新啟動：boom" {
		t.Fatal(s)
	}
}
