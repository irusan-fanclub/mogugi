package main

import (
	"context"
	"crypto/rand"
	"crypto/subtle"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"net"
	"net/http"
	"net/url"
	"os"
	"strings"
	"sync"
	"time"

	"github.com/irusan-fanclub/mogugi/lib/license"
)

// Discord OAuth2 activation.
//
// The user presses a button, authorises in the browser, and comes back
// activated. Discord redirects to a loopback listener this process opens for
// the duration of the flow; the code is then exchanged server-side, which is
// where the signing key lives.
//
// Discord has no wildcard-port support, so these three are registered on the
// Application and tried in order. With no paste fallback left, all three busy
// is a dead end the user can only escape by freeing a port — hence the 409,
// which the frontend turns into a message naming them.
var callbackPorts = [...]int{53682, 53683, 53684}

const (
	// Shared with MushSoup — one Discord Application, so the three loopback
	// redirect URIs below are already registered and need no Discord-side
	// change. Not a secret: a client id appears in every authorisation URL,
	// and the exchange that needs the secret happens on the server.
	oauthClientID = "1521768044593025034"

	// Redirecting this cannot forge an activation: Activate() verifies the
	// Ed25519 signature against the public key compiled into this binary, so a
	// substituted server can only fail, never mint. That is why an env
	// override is safe here while MushSoup bakes its equivalents in.
	defaultAuthBaseURL = "https://mabinogi.elden-mogu.com"

	// The listener exists only while the user is authorising. Two minutes is
	// long enough to log in and press approve, short enough that a forgotten
	// tab does not leave a port open.
	oauthWindow = 2 * time.Minute

	oauthScope = "identify"
)

// authBaseURL allows pointing at a local server during development, mirroring
// MOGUGI_LICENSE_DIR.
func authBaseURL() string {
	if v := strings.TrimSpace(os.Getenv("MOGUGI_AUTH_BASE_URL")); v != "" {
		return strings.TrimRight(v, "/")
	}
	return defaultAuthBaseURL
}

// oauthFlow is the single in-flight authorisation. Starting a new one cancels
// the previous — the user pressing the button twice means they want a new
// attempt, not two listeners racing to activate.
type oauthFlow struct {
	mu     sync.Mutex
	cancel context.CancelFunc
}

var currentOAuth oauthFlow

func (f *oauthFlow) replace(cancel context.CancelFunc) {
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.cancel != nil {
		f.cancel()
	}
	f.cancel = cancel
}

func (f *oauthFlow) clear() {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.cancel = nil
}

func newState() (string, error) {
	buf := make([]byte, 16) // 128 bits
	if _, err := rand.Read(buf); err != nil {
		return "", err
	}
	return hex.EncodeToString(buf), nil
}

// httpHandlerLicenseOAuthStart binds a callback port, opens a one-shot
// listener and returns the URL the frontend should open.
func httpHandlerLicenseOAuthStart(w http.ResponseWriter, _ *http.Request) {
	listener, port, err := listenCallback()
	if err != nil {
		writeLicenseJSON(w, http.StatusConflict, map[string]any{
			"ok": false, "error": "ports_busy",
		})
		return
	}

	state, err := newState()
	if err != nil {
		_ = listener.Close()
		writeLicenseJSON(w, http.StatusInternalServerError, map[string]any{
			"ok": false, "error": "internal",
		})
		return
	}

	redirectURI := fmt.Sprintf("http://127.0.0.1:%d/callback", port)
	ctx, cancel := context.WithTimeout(context.Background(), oauthWindow)
	currentOAuth.replace(cancel)
	go serveCallback(ctx, cancel, listener, state, redirectURI)

	q := url.Values{
		"client_id":     {oauthClientID},
		"redirect_uri":  {redirectURI},
		"response_type": {"code"},
		"scope":         {oauthScope},
		"state":         {state},
	}
	writeLicenseJSON(w, http.StatusOK, map[string]any{
		"ok":      true,
		"authUrl": "https://discord.com/oauth2/authorize?" + q.Encode(),
	})
}

func listenCallback() (net.Listener, int, error) {
	for _, port := range callbackPorts {
		l, err := net.Listen("tcp", fmt.Sprintf("127.0.0.1:%d", port))
		if err == nil {
			return l, port, nil
		}
	}
	return nil, 0, fmt.Errorf("all callback ports are in use")
}

// serveCallback runs the temporary listener. It closes on the first callback
// or when the window expires, whichever comes first.
func serveCallback(ctx context.Context, cancel context.CancelFunc,
	listener net.Listener, state, redirectURI string) {
	defer cancel()
	defer currentOAuth.clear()

	mux := http.NewServeMux()
	// Anything on the machine can reach a loopback port, so the path is
	// deliberately narrow: only this one, everything else 404.
	mux.HandleFunc("/callback", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			http.NotFound(w, r)
			return
		}
		msg := handleCallback(r, state, redirectURI)
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		fmt.Fprintf(w, callbackPage, msg)
		cancel()
	})
	mux.HandleFunc("/", http.NotFound)

	srv := &http.Server{Handler: mux, ReadHeaderTimeout: 5 * time.Second}
	go func() {
		<-ctx.Done()
		shutdown, stop := context.WithTimeout(context.Background(), 2*time.Second)
		defer stop()
		_ = srv.Shutdown(shutdown)
	}()
	_ = srv.Serve(listener)
}

// handleCallback verifies the state, exchanges the code and activates.
// It returns the message to show in the browser tab.
func handleCallback(r *http.Request, wantState, redirectURI string) string {
	got := r.URL.Query().Get("state")
	// Constant-time and length-checked: without a matching state we cannot
	// tell this code came from the authorisation we started, and any local
	// process can hit a loopback port.
	if len(got) != len(wantState) ||
		subtle.ConstantTimeCompare([]byte(got), []byte(wantState)) != 1 {
		logger.Println("oauth: state mismatch, discarding callback")
		return "驗證失敗，請回到 mogugi 重新按一次。"
	}
	code := r.URL.Query().Get("code")
	if code == "" {
		if e := r.URL.Query().Get("error"); e != "" {
			logger.Printf("oauth: discord returned %s", e)
		}
		return "授權未完成，請回到 mogugi 重新按一次。"
	}

	licenceCode, err := exchangeCode(code, redirectURI)
	if err != nil {
		logger.Printf("oauth: exchange failed: %v", err)
		return err.Error()
	}
	if err := license.Activate(licenceCode); err != nil {
		logger.Printf("oauth: activate failed: %v", err)
		return "啟用失敗，請回到 mogugi 重新按一次。"
	}
	if onLicenseActivated != nil {
		onLicenseActivated()
	}
	logger.Println("oauth: activated")
	return "授權完成，可以關閉這個分頁了。"
}

// exchangeCode trades the Discord authorisation code for a mogugi activation
// code. The error is what the browser tab shows, so it is written for the
// user, not the log.
func exchangeCode(code, redirectURI string) (string, error) {
	payload, _ := json.Marshal(map[string]string{
		"code": code, "redirectUri": redirectURI,
	})
	req, err := http.NewRequest(http.MethodPost,
		authBaseURL()+"/mogugi/auth/exchange", strings.NewReader(string(payload)))
	if err != nil {
		return "", fmt.Errorf("無法連線，請稍後再試。")
	}
	req.Header.Set("Content-Type", "application/json")

	res, err := (&http.Client{Timeout: 20 * time.Second}).Do(req)
	if err != nil {
		return "", fmt.Errorf("無法連線，請稍後再試。")
	}
	defer res.Body.Close()

	switch res.StatusCode {
	case http.StatusOK:
	case http.StatusForbidden:
		return "", fmt.Errorf("你的 Discord 帳號沒有權限。")
	case http.StatusTooManyRequests:
		return "", fmt.Errorf("請求過於頻繁，請稍後再試。")
	case http.StatusServiceUnavailable:
		// Explicitly not "no permission": Discord being unreachable says
		// nothing about this user's eligibility.
		return "", fmt.Errorf("暫時無法驗證資格，請稍後再試。")
	default:
		return "", fmt.Errorf("取得驗證碼失敗（%d）。", res.StatusCode)
	}

	var body struct {
		Code string `json:"code"`
	}
	if err := json.NewDecoder(res.Body).Decode(&body); err != nil || body.Code == "" {
		return "", fmt.Errorf("取得驗證碼失敗。")
	}
	return body.Code, nil
}

const callbackPage = `<!doctype html>
<html lang="zh-Hant"><head><meta charset="utf-8"><title>mogugi</title>
<style>body{font-family:system-ui,sans-serif;display:flex;flex-direction:column;
align-items:center;justify-content:center;height:100vh;margin:0;gap:12px;
background:#1e1e1e;color:#eee}
p{font-size:1.1rem;margin:0}
a{color:#7aa2f7}</style></head><body><p>%s</p>
</body></html>`
