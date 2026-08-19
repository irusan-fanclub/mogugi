package main

import (
	"net"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strconv"
	"strings"
	"testing"
)

// The state check is the only thing standing between this loopback listener
// and any other process on the machine feeding it an authorisation code.
func TestCallbackRejectsWrongState(t *testing.T) {
	for _, got := range []string{"", "short", strings.Repeat("a", 32), "WRONG"} {
		r := httptest.NewRequest(http.MethodGet,
			"/callback?code=c&state="+url.QueryEscape(got), nil)
		msg := handleCallback(r, strings.Repeat("b", 32), "http://127.0.0.1:53682/callback")
		if !strings.Contains(msg, "驗證失敗") {
			t.Fatalf("state %q was accepted: %s", got, msg)
		}
	}
}

// Discord sends ?error=access_denied when the user declines. That is not a
// state failure and should read differently.
func TestCallbackWithoutCodeIsNotAStateFailure(t *testing.T) {
	state := strings.Repeat("b", 32)
	r := httptest.NewRequest(http.MethodGet, "/callback?error=access_denied&state="+state, nil)
	msg := handleCallback(r, state, "http://127.0.0.1:53682/callback")
	if !strings.Contains(msg, "授權未完成") {
		t.Fatalf("unexpected message: %s", msg)
	}
}

func TestStateIsRandomAnd128Bits(t *testing.T) {
	seen := map[string]bool{}
	for i := 0; i < 100; i++ {
		s, err := newState()
		if err != nil {
			t.Fatal(err)
		}
		if len(s) != 32 { // 16 bytes hex
			t.Fatalf("state is %d chars, want 32", len(s))
		}
		if seen[s] {
			t.Fatal("state repeated")
		}
		seen[s] = true
	}
}

func TestStartReturnsAuthUrlAndBindsAPort(t *testing.T) {
	w := httptest.NewRecorder()
	httpHandlerLicenseOAuthStart(w, httptest.NewRequest(http.MethodPost, "/api/license/oauth/start", nil))
	defer currentOAuth.replace(func() {})

	if w.Code != http.StatusOK {
		t.Fatalf("status %d, want 200", w.Code)
	}
	body := w.Body.String()
	for _, want := range []string{
		"https://discord.com/oauth2/authorize",
		"client_id=" + oauthClientID,
		"scope=identify",
		"response_type=code",
		"127.0.0.1%3A5368",
	} {
		if !strings.Contains(body, want) {
			t.Fatalf("authUrl missing %q: %s", want, body)
		}
	}
	// prompt would break a first-time user: without a prior grant Discord has
	// no consent to skip. MushSoup's working flow omits it too.
	if strings.Contains(body, "prompt") {
		t.Fatalf("authUrl should not carry prompt: %s", body)
	}
}

// All three ports busy is a dead end with no fallback left, so the frontend
// has to tell it apart from a transient failure: only this case can be
// answered with "go free one of these ports".
func TestAllPortsBusyReturns409(t *testing.T) {
	var held []net.Listener
	for _, p := range callbackPorts {
		l, err := net.Listen("tcp", "127.0.0.1:"+strconv.Itoa(p))
		if err != nil {
			t.Skipf("port %d already in use outside the test", p)
		}
		held = append(held, l)
	}
	defer func() {
		for _, l := range held {
			_ = l.Close()
		}
	}()

	w := httptest.NewRecorder()
	httpHandlerLicenseOAuthStart(w, httptest.NewRequest(http.MethodPost, "/api/license/oauth/start", nil))
	if w.Code != http.StatusConflict {
		t.Fatalf("status %d, want 409", w.Code)
	}
	if !strings.Contains(w.Body.String(), "ports_busy") {
		t.Fatalf("body should name the cause: %s", w.Body.String())
	}
}

func TestAuthBaseURLOverride(t *testing.T) {
	t.Setenv("MOGUGI_AUTH_BASE_URL", "http://localhost:8080/")
	if got := authBaseURL(); got != "http://localhost:8080" {
		t.Fatalf("got %q, trailing slash should be trimmed", got)
	}
	t.Setenv("MOGUGI_AUTH_BASE_URL", "  ")
	if got := authBaseURL(); got != defaultAuthBaseURL {
		t.Fatalf("blank override should fall back, got %q", got)
	}
}
