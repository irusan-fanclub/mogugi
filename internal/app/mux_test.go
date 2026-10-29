package app

import (
	"context"
	"errors"
	"fmt"
	"net"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestNewMuxRoutes(t *testing.T) {
	mux := NewMux(newEventPublisher(context.Background(), nil))
	for _, p := range []string{"/api/status", "/api/instance", "/api/license/status", "/"} {
		rec := httptest.NewRecorder()
		mux.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, p, nil))
		if rec.Code == http.StatusNotFound {
			t.Fatalf("%s: 404", p)
		}
	}
	// License is inactive in tests: gated routes must still be gated.
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/api/config", nil))
	if rec.Code != http.StatusForbidden {
		t.Fatalf("/api/config without license: %d", rec.Code)
	}
	_, pattern := http.DefaultServeMux.Handler(httptest.NewRequest(http.MethodGet, "/api/status", nil))
	if pattern != "" {
		t.Fatalf("DefaultServeMux must stay untouched, got pattern %q", pattern)
	}
}

func TestStartServerAllPortsBusy(t *testing.T) {
	oldAuto, oldPort := autoPort, port
	defer func() { autoPort, port = oldAuto, oldPort }()
	autoPort, port = true, autoPortMin

	// A port already held by another process is busy too; just hold the rest.
	var held []net.Listener
	defer func() {
		for _, l := range held {
			l.Close()
		}
	}()
	for p := autoPortMin; p <= autoPortMax; p++ {
		if l, err := net.Listen("tcp", fmt.Sprintf("127.0.0.1:%d", p)); err == nil {
			held = append(held, l)
		}
	}

	_, err := StartServer(context.Background(), ServerOptions{})
	var pe *PortError
	if !errors.As(err, &pe) || !pe.Auto {
		t.Fatalf("want *PortError with Auto, got %v", err)
	}
}
