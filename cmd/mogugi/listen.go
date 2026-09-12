package main

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"os"
	"os/exec"
	"runtime"
	"time"
)

// Ports tried in order when autoPort is on.
const (
	autoPortMin = 8030
	autoPortMax = 8040
)

// instanceInfo is what /api/instance returns so a second mogugi can
// recognise a running one behind an occupied port.
type instanceInfo struct {
	App     string `json:"app"`
	Version string `json:"version"`
	PID     int    `json:"pid"`
}

func httpHandlerInstance(w http.ResponseWriter, _ *http.Request) {
	writeLicenseJSON(w, http.StatusOK, instanceInfo{App: "mogugi", Version: Version, PID: os.Getpid()})
}

// probeMogugi reports whether a mogugi answers on 127.0.0.1:port.
func probeMogugi(port int, timeout time.Duration) (instanceInfo, bool) {
	c := http.Client{Timeout: timeout}
	resp, err := c.Get(fmt.Sprintf("http://127.0.0.1:%d/api/instance", port))
	if err != nil {
		return instanceInfo{}, false
	}
	defer resp.Body.Close()
	var info instanceInfo
	body := io.LimitReader(resp.Body, 4096)
	if resp.StatusCode != http.StatusOK || json.NewDecoder(body).Decode(&info) != nil || info.App != "mogugi" {
		return instanceInfo{}, false
	}
	return info, true
}

// candidatePorts is the bind order: the auto range, or just the configured port.
func candidatePorts(cfgPort int, auto bool) []int {
	if !auto {
		return []int{cfgPort}
	}
	ports := make([]int, 0, autoPortMax-autoPortMin+1)
	for p := autoPortMin; p <= autoPortMax; p++ {
		ports = append(ports, p)
	}
	return ports
}

// listenOutcome explains why no candidate could be bound.
type listenOutcome struct {
	AlreadyRunning bool // a mogugi answered on Port
	Port           int  // the port that decided the outcome
	Err            error
}

// listenFirstFree binds the first free candidate. An occupied port is probed
// first: another mogugi stops the search, anything else moves on.
func listenFirstFree(candidates []int, listen func(int) (net.Listener, error), isMogugi func(int) bool) (net.Listener, int, *listenOutcome) {
	if len(candidates) == 0 {
		return nil, 0, &listenOutcome{Err: errors.New("no candidate ports")}
	}
	var lastErr error
	last := 0
	for _, p := range candidates {
		ln, err := listen(p)
		if err == nil {
			return ln, p, nil
		}
		if isMogugi(p) {
			return nil, 0, &listenOutcome{AlreadyRunning: true, Port: p, Err: err}
		}
		lastErr, last = err, p
	}
	return nil, 0, &listenOutcome{Port: last, Err: lastErr}
}

func tcpListen(port int) (net.Listener, error) {
	return net.Listen("tcp", fmt.Sprintf("127.0.0.1:%d", port))
}

// openBrowser hands the URL to the shell without waiting; Start (not a
// background Run) so the process may exit right after.
func openBrowser(url string) {
	if runtime.GOOS != "windows" || noBrowser {
		return
	}
	if err := exec.Command("explorer", url).Start(); err != nil {
		logger.Println("open browser failed:", err)
	}
}

// openBrowserAndWait blocks until explorer returns, for the hand-off to an
// already-running mogugi. explorer exits non-zero even on success, so only
// a failure to spawn it at all is logged.
func openBrowserAndWait(url string) {
	if runtime.GOOS != "windows" || noBrowser {
		return
	}
	if err := exec.Command("explorer", url).Run(); errors.As(err, new(*exec.Error)) {
		logger.Println("open browser failed:", err)
	}
}
