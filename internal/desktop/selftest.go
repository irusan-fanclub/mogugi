package desktop

import (
	"bytes"
	"encoding/json"
	"fmt"
	"hash/fnv"
	"io"
	"net/http"
	"os"
	"regexp"
	"sync"
	"time"

	"github.com/wailsapp/wails/v3/pkg/application"
	"github.com/wailsapp/wails/v3/pkg/events"
)

// Env-gated (MOGUGI_SELFTEST=arch) architecture check. Go records what the
// TCP entry returns, the page replays the same requests through the Wails
// asset handler and reports back by event; any FAIL exits with code 1.

type probeCase struct {
	Name   string `json:"name"`
	Method string `json:"method"`
	Path   string `json:"path"`
	Body   string `json:"body"`
	Status int    `json:"status"`
	CType  string `json:"ctype"`
	Len    int    `json:"len"`
	Hash   uint32 `json:"hash"`
}

type checkResult struct {
	Name   string `json:"name"`
	Result string `json:"result"` // PASS | FAIL | SKIP
	Detail string `json:"detail"`
}

var selftestChecks = []string{"config-parity", "large-response", "websocket", "event-roundtrip"}

func tcpDo(base, method, path, body string) (probeCase, []byte) {
	c := probeCase{Method: method, Path: path, Body: body}
	req, err := http.NewRequest(method, base+path, bytes.NewReader([]byte(body)))
	if err != nil {
		return c, nil
	}
	req.Header.Set("Content-Type", "application/json")
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		c.Status = -1
		return c, nil
	}
	defer resp.Body.Close()
	b, _ := io.ReadAll(resp.Body)
	h := fnv.New32a()
	h.Write(b)
	c.Status, c.CType, c.Len, c.Hash = resp.StatusCode, resp.Header.Get("Content-Type"), len(b), h.Sum32()
	return c, b
}

func buildProbeCases(port int) (cases []probeCase, licensed bool) {
	base := fmt.Sprintf("http://127.0.0.1:%d", port)
	get, body := tcpDo(base, "GET", "/api/config", "")
	get.Name = "GET /api/config"
	licensed = get.Status == 200
	putBody := `{"port":8030}`
	if licensed {
		var v struct {
			File json.RawMessage `json:"file"`
		}
		if json.Unmarshal(body, &v) == nil && len(v.File) > 0 {
			putBody = string(v.File)
		}
	}
	put, _ := tcpDo(base, "PUT", "/api/config", putBody)
	put.Name = "PUT /api/config"
	cases = append(cases, get, put)

	if licensed {
		it, _ := tcpDo(base, "GET", "/api/item-index", "")
		it.Name = "GET /api/item-index"
		cases = append(cases, it)
	}
	// Largest script/asset referenced by desktop.html, available without a license.
	_, idx := tcpDo(base, "GET", "/desktop.html", "")
	var best probeCase
	for _, m := range regexp.MustCompile(`(?:src|href)="(/[^"]+\.(?:js|css))"`).FindAllSubmatch(idx, -1) {
		c, _ := tcpDo(base, "GET", string(m[1]), "")
		if c.Len > best.Len {
			best = c
		}
	}
	best.Name = "GET largest static " + best.Path
	cases = append(cases, best)
	return cases, licensed
}

const probeJS = `(async () => {
const E = %s;
const emit = (r) => window.wails.Events.Emit('selftest-result', r);
const fnv = (u8) => { let h = 0x811c9dc5; for (const b of u8) { h ^= b; h = Math.imul(h, 0x01000193) >>> 0; } return h >>> 0; };
window.wails.Events.On('selftest-ping', () => emit({ name: 'event-roundtrip', result: 'PASS', detail: 'Go->JS ping received, JS->Go reply delivered' }));
window.wails.Events.Emit('selftest-ready', 1);
(async () => {
  const bad = [];
  for (const c of E.cases) {
    try {
      const r = await fetch(c.path, { method: c.method, body: c.method === 'PUT' ? c.body : undefined, headers: { 'Content-Type': 'application/json' } });
      const u8 = new Uint8Array(await r.arrayBuffer());
      const got = { status: r.status, ctype: r.headers.get('content-type') || '', len: u8.length, hash: fnv(u8) };
      const same = got.status === c.status && got.ctype === c.ctype && got.len === c.len && got.hash === c.hash;
      c.out = same ? 'same' : 'DIFF got=' + JSON.stringify(got) + ' want=' + JSON.stringify({ status: c.status, ctype: c.ctype, len: c.len, hash: c.hash });
      c.det = c.name + ' status=' + c.status + ' type=' + c.ctype + ' len=' + c.len + ' ' + c.out;
    } catch (e) { c.out = 'ERR ' + e; c.det = c.name + ' ' + c.out; }
  }
  const part = (pred) => E.cases.filter(pred);
  const rep = (name, list, extra) => {
    const ok = list.length > 0 && list.every(c => c.out === 'same');
    emit({ name, result: ok ? 'PASS' : 'FAIL', detail: (extra || '') + list.map(c => c.det).join(' | ') });
  };
  rep('config-parity', part(c => c.path === '/api/config'), 'origin=' + location.origin + '; licensed=' + E.licensed + '; ');
  rep('large-response', part(c => c.path !== '/api/config'));
  const ws = 'ws://127.0.0.1:' + E.port + '/ws';
  if (!E.licensed) { emit({ name: 'websocket', result: 'FAIL', detail: 'NOT VERIFIED: license inactive, /ws is license-gated (' + ws + ')' }); return; }
  // Real UI path: the app's SocketClient(wsUrl()) must reach connected state.
  let ok = false;
  for (let i = 0; i < 40 && !ok; i++) { ok = /後端[\s ]*已連線/.test(document.body.textContent || ''); if (!ok) await new Promise(r => setTimeout(r, 250)); }
  emit({ name: 'websocket', result: ok ? 'PASS' : 'FAIL', detail: (ok ? 'UI shows 後端 已連線 via ' : 'UI never showed 後端 已連線 for ') + ws + ' from ' + location.origin });
})();
})()`

func startArchSelftest(app *application.App, win *application.WebviewWindow, port int) {
	var mu sync.Mutex
	results := map[string]checkResult{}
	finished := false

	finish := func() {
		mu.Lock()
		defer mu.Unlock()
		if finished {
			return
		}
		finished = true
		code := 0
		for _, n := range selftestChecks {
			r, ok := results[n]
			if !ok {
				r = checkResult{n, "FAIL", "no result before timeout"}
			}
			if r.Result == "FAIL" {
				code = 1
			}
			logger.Printf("SELFTEST %s: %s %s", n, r.Result, r.Detail)
		}
		logger.Printf("SELFTEST exit=%d", code)
		os.Exit(code)
	}

	app.Event.On("selftest-ready", func(*application.CustomEvent) {
		logger.Println("SELFTEST page ready")
		win.EmitEvent("selftest-ping", "ping")
	})
	app.Event.On("selftest-result", func(e *application.CustomEvent) {
		raw, _ := json.Marshal(e.Data)
		var r checkResult
		if json.Unmarshal(raw, &r) != nil {
			var arr []checkResult
			if json.Unmarshal(raw, &arr) != nil || len(arr) == 0 {
				return
			}
			r = arr[0]
		}
		mu.Lock()
		results[r.Name] = r
		n := len(results)
		mu.Unlock()
		if n == len(selftestChecks) {
			finish()
		}
	})

	win.OnWindowEvent(events.Common.WindowRuntimeReady, func(*application.WindowEvent) {
		go func() {
			logger.Println("SELFTEST runtime ready, running probe")
			cases, licensed := buildProbeCases(port)
			payload, _ := json.Marshal(map[string]any{"cases": cases, "licensed": licensed, "port": port})
			logger.Printf("SELFTEST cases built (licensed=%v, %d bytes), injecting", licensed, len(payload))
			win.ExecJS(fmt.Sprintf(probeJS, payload))
		}()
	})
	go func() { time.Sleep(60 * time.Second); finish() }()
}
