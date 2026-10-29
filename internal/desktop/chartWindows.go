package desktop

import (
	"fmt"
	"net/url"
	"os"
	"regexp"
	"sort"
	"sync"
	"time"

	"github.com/irusan-fanclub/mogugi/internal/app"
	"github.com/wailsapp/wails/v3/pkg/application"
	"github.com/wailsapp/wails/v3/pkg/events"
)

var (
	chartIDRe  = regexp.MustCompile(`^[a-z0-9-]{1,40}$`)
	chartKinds = map[string]bool{"condition": true, "hitlog": true}
	// Dark theme background, shown before the page paints.
	windowBackground = application.NewRGB(0x16, 0x18, 0x1d)
)

// chartOpenReq is a validated window:open payload.
type chartOpenReq struct{ ID, Kind, Title, Spec string }

// validChartOpen checks a JS window:open payload; spec is required, title optional.
func validChartOpen(p map[string]any) (chartOpenReq, bool) {
	id, _ := p["id"].(string)
	kind, _ := p["kind"].(string)
	spec, specOK := p["spec"].(string)
	title := ""
	if v, present := p["title"]; present {
		t, ok := v.(string)
		if !ok {
			return chartOpenReq{}, false
		}
		title = t
	}
	if !chartIDRe.MatchString(id) || !chartKinds[kind] || !specOK {
		return chartOpenReq{}, false
	}
	return chartOpenReq{ID: id, Kind: kind, Title: title, Spec: spec}, true
}

// chartURL builds the relative chart window URL with escaped spec and title.
func chartURL(id, kind, spec, title string) string {
	q := url.Values{"id": {id}, "kind": {kind}, "spec": {spec}, "title": {title}}
	return "/chart.html?" + q.Encode()
}

// chartRegistry tracks the ids of open chart windows.
type chartRegistry struct {
	mu  sync.Mutex
	ids map[string]struct{}
}

func (r *chartRegistry) add(id string) {
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.ids == nil {
		r.ids = map[string]struct{}{}
	}
	r.ids[id] = struct{}{}
}

func (r *chartRegistry) remove(id string) {
	r.mu.Lock()
	defer r.mu.Unlock()
	delete(r.ids, id)
}

func (r *chartRegistry) has(id string) bool {
	r.mu.Lock()
	defer r.mu.Unlock()
	_, ok := r.ids[id]
	return ok
}

func (r *chartRegistry) all() []string {
	r.mu.Lock()
	defer r.mu.Unlock()
	out := make([]string, 0, len(r.ids))
	for id := range r.ids {
		out = append(out, id)
	}
	sort.Strings(out)
	return out
}

// trackWindow saves a window's last non-maximised bounds through saver on
// every move/resize; start is the geometry the window was created with.
func trackWindow(win *application.WebviewWindow, start windowState, saver *stateSaver) {
	normal := start
	var mu sync.Mutex
	track := func(*application.WindowEvent) {
		if win.IsMinimised() {
			return
		}
		mu.Lock()
		defer mu.Unlock()
		maxed := win.IsMaximised()
		if !maxed {
			b := win.Bounds()
			normal = windowState{X: b.X, Y: b.Y, Width: b.Width, Height: b.Height}
		}
		next := normal
		next.Maximized = maxed
		saver.Update(next)
	}
	win.OnWindowEvent(events.Common.WindowDidMove, track)
	win.OnWindowEvent(events.Common.WindowDidResize, track)
}

// chartManager owns the chart windows opened by the main window's JS.
type chartManager struct {
	wapp   *application.App
	port   int
	flags  func(string) string
	reg    chartRegistry
	mu     sync.Mutex
	savers map[string]*stateSaver // by window id
	kinds  map[string]string      // window id -> kind, for cascading
	openMu sync.Mutex             // serialises open so one id never gets two windows
}

func setupChartWindows(wapp *application.App, port int, flags func(string) string) *chartManager {
	m := &chartManager{wapp: wapp, port: port, flags: flags, savers: map[string]*stateSaver{}, kinds: map[string]string{}}
	wapp.Event.On("window:open", func(e *application.CustomEvent) {
		p, _ := e.Data.(map[string]any)
		req, ok := validChartOpen(p)
		if !ok {
			logger.Printf("window:open ignored: invalid payload %v", e.Data)
			return
		}
		m.open(req)
	})
	return m
}

func (m *chartManager) open(req chartOpenReq) {
	name := "chart-" + req.ID
	m.openMu.Lock()
	defer m.openMu.Unlock()
	if m.reg.has(req.ID) {
		if w, ok := m.wapp.Window.GetByName(name); ok {
			if w.IsMinimised() {
				w.UnMinimise()
			}
			w.Show()
			w.Focus()
			return
		}
		m.reg.remove(req.ID) // stale entry: window is gone
	}
	saved := app.LoadChartWindowStates()[req.Kind]
	st := clampState(cascadeState(saved, m.openOfKind(req.Kind)), screenRects(m.wapp), chartLimits)
	opts := application.WebviewWindowOptions{
		Name:             name,
		Title:            req.Title,
		Width:            st.Width,
		Height:           st.Height,
		MinWidth:         minChartWidth,
		MinHeight:        minChartHeight,
		Frameless:        true,
		BackgroundColour: windowBackground,
		Windows:          application.WindowsWindow{DisableFramelessWindowDecorations: false},
		URL:              m.flags(chartURL(req.ID, req.Kind, req.Spec, req.Title) + fmt.Sprintf("&wsPort=%d", m.port)),
		DevToolsEnabled:  os.Getenv("MOGUGI_DEVTOOLS") == "1",
	}
	if saved.Width > 0 {
		opts.X, opts.Y, opts.InitialPosition = st.X, st.Y, application.WindowXY
	} else {
		opts.InitialPosition = application.WindowCentered
	}
	if opts.Title == "" {
		opts.Title = "mogugi"
	}
	m.reg.add(req.ID)
	win := m.wapp.Window.NewWithOptions(opts)

	kind := req.Kind
	saver := newStateSaver(500*time.Millisecond, func(w windowState) {
		if err := app.SaveChartWindowState(kind, w); err != nil {
			logger.Printf("save chart window state failed: %v", err)
		}
	})
	m.mu.Lock()
	m.savers[req.ID] = saver
	m.kinds[req.ID] = kind
	m.mu.Unlock()
	trackWindow(win, st, saver)
	win.OnWindowEvent(events.Common.WindowClosing, func(*application.WindowEvent) {
		saver.Flush()
		m.mu.Lock()
		delete(m.savers, req.ID)
		delete(m.kinds, req.ID)
		m.mu.Unlock()
		m.reg.remove(req.ID)
		m.wapp.Event.Emit("window:closed", map[string]any{"id": req.ID})
	})
}

func (m *chartManager) openOfKind(kind string) int {
	m.mu.Lock()
	defer m.mu.Unlock()
	n := 0
	for _, k := range m.kinds {
		if k == kind {
			n++
		}
	}
	return n
}

// cascadeStep is the per-window offset so same-kind windows do not stack exactly.
const cascadeStep = 30

// cascadeState shifts a remembered position by cascadeStep per already-open
// window of the same kind. A state with no saved size is left alone (centred).
func cascadeState(s windowState, open int) windowState {
	if s.Width > 0 && open > 0 {
		s.X += cascadeStep * open
		s.Y += cascadeStep * open
	}
	return s
}

// CloseAll closes every chart window (used when switching to web mode).
func (m *chartManager) CloseAll() {
	for _, id := range m.reg.all() {
		if w, ok := m.wapp.Window.GetByName("chart-" + id); ok {
			w.Close()
		}
	}
}

// Flush saves any pending chart geometry immediately.
func (m *chartManager) Flush() {
	m.mu.Lock()
	list := make([]*stateSaver, 0, len(m.savers))
	for _, s := range m.savers {
		list = append(list, s)
	}
	m.mu.Unlock()
	for _, s := range list {
		s.Flush()
	}
}
