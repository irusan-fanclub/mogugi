package main

import (
	"errors"
	"fmt"
	"net"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"sync"
	"testing"
	"time"

	"golang.org/x/net/websocket"
)

func TestCandidatePorts(t *testing.T) {
	auto := candidatePorts(9000, true)
	if len(auto) != 11 || auto[0] != 8030 || auto[10] != 8040 {
		t.Fatalf("auto=%v", auto)
	}
	if fixed := candidatePorts(9000, false); len(fixed) != 1 || fixed[0] != 9000 {
		t.Fatalf("fixed=%v", fixed)
	}
}

// fakeListener is a closed net.Listener stand-in for the policy tests.
type fakeListener struct{ net.Listener }

func TestListenFirstFree_Policy(t *testing.T) {
	busy := errors.New("bind: address already in use")
	listenFn := func(free map[int]bool) func(int) (net.Listener, error) {
		return func(p int) (net.Listener, error) {
			if free[p] {
				return fakeListener{}, nil
			}
			return nil, busy
		}
	}
	never := func(int) bool { return false }

	ln, p, out := listenFirstFree([]int{8030, 8031, 8032}, listenFn(map[int]bool{8030: true}), never)
	if out != nil || p != 8030 || ln == nil {
		t.Fatalf("first free: p=%d out=%+v", p, out)
	}

	_, p, out = listenFirstFree([]int{8030, 8031, 8032}, listenFn(map[int]bool{8032: true}), never)
	if out != nil || p != 8032 {
		t.Fatalf("skip busy: p=%d out=%+v", p, out)
	}

	probed := []int{}
	isMogugi := func(p int) bool { probed = append(probed, p); return p == 8031 }
	_, _, out = listenFirstFree([]int{8030, 8031, 8032}, listenFn(map[int]bool{8032: true}), isMogugi)
	if out == nil || !out.AlreadyRunning || out.Port != 8031 || len(probed) != 2 {
		t.Fatalf("mogugi on 8031: out=%+v probed=%v", out, probed)
	}

	_, _, out = listenFirstFree([]int{8030, 8031}, listenFn(nil), never)
	if out == nil || out.AlreadyRunning || out.Port != 8031 || !errors.Is(out.Err, busy) {
		t.Fatalf("exhausted: out=%+v", out)
	}

	if _, _, out = listenFirstFree(nil, listenFn(nil), never); out == nil || out.Err == nil {
		t.Fatalf("empty candidates: out=%+v", out)
	}
}

func portOf(t *testing.T, addr string) int {
	t.Helper()
	_, ps, err := net.SplitHostPort(addr)
	if err != nil {
		t.Fatal(err)
	}
	p, _ := strconv.Atoi(ps)
	return p
}

func TestProbeMogugi(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(httpHandlerInstance))
	defer srv.Close()
	info, ok := probeMogugi(portOf(t, strings.TrimPrefix(srv.URL, "http://")), time.Second)
	if !ok || info.App != "mogugi" || info.PID == 0 {
		t.Fatalf("ok=%v info=%+v", ok, info)
	}

	other := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		fmt.Fprint(w, `{"app":"something-else"}`)
	}))
	defer other.Close()
	if _, ok := probeMogugi(portOf(t, strings.TrimPrefix(other.URL, "http://")), time.Second); ok {
		t.Fatal("non-mogugi server must not match")
	}

	// A port nobody listens on: must return false quickly.
	spare, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	free := portOf(t, spare.Addr().String())
	spare.Close()
	start := time.Now()
	if _, ok := probeMogugi(free, 500*time.Millisecond); ok || time.Since(start) > 2*time.Second {
		t.Fatalf("closed port: ok=%v took=%v", ok, time.Since(start))
	}
}

func TestProbeMogugi_TimeoutAndBadResponses(t *testing.T) {
	slow := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		time.Sleep(time.Second)
		w.WriteHeader(http.StatusOK)
	}))
	defer func() {
		slow.CloseClientConnections() // handler is still sleeping; Close() alone would block on it
		slow.Close()
	}()
	start := time.Now()
	if _, ok := probeMogugi(portOf(t, strings.TrimPrefix(slow.URL, "http://")), 500*time.Millisecond); ok || time.Since(start) > 1500*time.Millisecond {
		t.Fatalf("slow server: ok=%v took=%v", ok, time.Since(start))
	}

	badStatus := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusInternalServerError)
		fmt.Fprint(w, `{"app":"mogugi"}`)
	}))
	defer badStatus.Close()
	if _, ok := probeMogugi(portOf(t, strings.TrimPrefix(badStatus.URL, "http://")), time.Second); ok {
		t.Fatal("500 status must not match")
	}

	badBody := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		fmt.Fprint(w, "not json")
	}))
	defer badBody.Close()
	if _, ok := probeMogugi(portOf(t, strings.TrimPrefix(badBody.URL, "http://")), time.Second); ok {
		t.Fatal("non-JSON body must not match")
	}
}

// registerRoutesOnce guards http.DefaultServeMux: registering twice panics.
var registerRoutesOnce sync.Once

func TestRegisterRoutes_InstanceIsOpen(t *testing.T) {
	registerRoutesOnce.Do(func() {
		registerRoutes(func(*websocket.Conn) {})
	})
	h, _ := http.DefaultServeMux.Handler(httptest.NewRequest(http.MethodGet, "/api/instance", nil))
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/api/instance", nil))
	if rec.Code != http.StatusOK {
		t.Fatalf("status=%d", rec.Code)
	}
	if !strings.Contains(rec.Body.String(), `"app":"mogugi"`) {
		t.Fatalf("body=%s", rec.Body.String())
	}
}

func TestListenFirstFree_RealSockets(t *testing.T) {
	occupied, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer occupied.Close()
	busyPort := portOf(t, occupied.Addr().String())
	spare, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	freePort := portOf(t, spare.Addr().String())
	spare.Close()

	ln, p, out := listenFirstFree([]int{busyPort, freePort}, tcpListen, func(int) bool { return false })
	if ln != nil {
		defer ln.Close()
	}
	if out != nil || p != freePort || ln == nil {
		t.Fatalf("p=%d out=%+v", p, out)
	}
}
