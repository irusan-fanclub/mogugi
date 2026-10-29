package desktop

import (
	"errors"
	"github.com/wailsapp/wails/v3/pkg/application"
	"regexp"
	"testing"
)

func TestUniqueID(t *testing.T) {
	re := regexp.MustCompile(`^mogugi-[0-9a-f]{12}$`)
	a := UniqueID(`D:\Data\Mogugi`)
	if !re.MatchString(a) {
		t.Fatalf("bad format %q", a)
	}
	if a != UniqueID(`d:\data\mogugi`) {
		t.Error("case must not matter")
	}
	if a == UniqueID(`D:\Data\Other`) {
		t.Error("different dirs must differ")
	}
}

func TestRouteError(t *testing.T) {
	var dlg, lg []string
	d := func(m string) { dlg = append(dlg, m) }
	l := func(m string) { lg = append(lg, m) }
	routeError(errors.New("plain"), d, l)
	if len(dlg) != 0 || len(lg) != 1 {
		t.Fatalf("non-fatal: dlg=%v log=%v", dlg, lg)
	}
	routeError(&application.FatalError{}, d, l)
	if len(dlg) != 1 || len(lg) != 1 {
		t.Fatalf("fatal: dlg=%v log=%v", dlg, lg)
	}
}
