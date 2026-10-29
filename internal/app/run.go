package app

import (
	"context"
	"embed"
	"encoding/json"
	"fmt"
	"os"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/gopacket/gopacket/pcap"
	"github.com/irusan-fanclub/mogugi/lib/clientver"
	"github.com/irusan-fanclub/mogugi/lib/event"
	"github.com/irusan-fanclub/mogugi/lib/packet"
	"github.com/irusan-fanclub/mogugi/lib/pcaputil"
	"github.com/irusan-fanclub/mogugi/lib/util"
	"golang.org/x/net/websocket"
)

// port is the HTTP listen port; loaded from mogugi-config.toml at start.
var port = 8030

// all: keeps Vite chunks whose names start with "_".
//go:embed all:static
var staticFiles embed.FS

// Version is the build version. Override at link time via:
//
//	go build -ldflags "-X github.com/irusan-fanclub/mogugi/internal/app.Version=x.y.z"
var Version = "0.6.0"

var logger = util.NewLogger("mogugi")
var (
	packetLogMu       sync.Mutex
	packetLogFilename = ""
)

func packetLogPath() string {
	packetLogMu.Lock()
	defer packetLogMu.Unlock()
	return packetLogFilename
}

func setPacketLogPath(p string) {
	packetLogMu.Lock()
	packetLogFilename = p
	packetLogMu.Unlock()
}

// itemDB is the SQLite item store; nil disables item-index writes entirely
// (every writer nil-checks it) so a failed open never blocks metering.
var itemDB *itemStore

// noPcapFile skips writing logs/packet_capture_*.pcapng; noBrowser skips
// opening the UI tab on start. All come from mogugi-config.toml.
var (
	noPcapFile bool
	noBrowser  bool
	autoPort   bool // pick the first free port in 8030-8040 and refuse to start twice
	allowLan   bool // listen on 0.0.0.0 (effective value of this run)
	// savePacketLogRun gates the packet_log writer (effective value of this run).
	savePacketLogRun bool
)

// logNics writes the capture devices to the log once, to help diagnose a
// failed capture start (no NIC found, pcap open failed).
func logNics() {
	nicsLogOnce.Do(func() {
		nics, err := pcap.FindAllDevs()
		if err != nil {
			logger.Println("FindAllDevs failed:", err)
			return
		}
		sb := strings.Builder{}
		for i, nic := range nics {
			ipStr := "unknownAddress"
			if len(nic.Addresses) > 0 {
				ipStr = nic.Addresses[0].IP.String()
			}
			fmt.Fprintln(&sb, "* nic", i, "name:", nic.Name, "ip:", ipStr)
		}
		logger.Println("capture devices:\n" + sb.String())
	})
}

var nicsLogOnce sync.Once

func runPacketWriter(ctx context.Context, pub *eventPublisher) {
	if !savePacketLogRun {
		return
	}
	// Deliberately never close ch: the publisher (flushNow) may send to it
	// from another goroutine, and closing while it's still registered would
	// panic. The client is dropped when its ctx is cancelled or the channel
	// backs up; an abandoned channel is just GC'd.
	ch := make(chan []event.IEvent, 10000)

	pub.addClientOpt(ctx, ch, true) // replay events never reach the live log
	if err := startPacketWriter(ctx, ch, nil); err != nil {
		logger.Println("startPacketWriter failed:", err)
	}
}

func websocketHandler(pub *eventPublisher) func(*websocket.Conn) {
	return func(ws *websocket.Conn) {
		logger.Printf("Client connected from %s", ws.RemoteAddr())
		wsCtx, wsCtxCancel := context.WithCancel(ws.Request().Context())
		defer wsCtxCancel()

		// Generous buffer: WS send drains slower than the publisher emits under load.
		// Never closed: flushNow sends from another goroutine, and close()
		// racing that send would panic. wsCtxCancel unregisters the client
		// (flushNow drops it on ctx.Done); the channel is then GC'd.
		ch := make(chan []event.IEvent, 10000)

		q := ws.Request().URL.Query()
		if h := q.Get("history"); h == "1" {
			go pub.addClientWithHistory(wsCtx, ch, historyOpts{})
		} else if h == "current" {
			o := historyOpts{currentOnly: true}
			if q.Get("scope") == "overlay" {
				o.filter = overlayWants
			}
			go pub.addClientWithHistory(wsCtx, ch, o)
		} else {
			go pub.addClient(wsCtx, ch)
		}
		go drainIncoming(ws, wsCtx, wsCtxCancel)

		for {
			select {
			case <-wsCtx.Done():
				logger.Printf("Client disconnected from %s", ws.RemoteAddr())
				return
			case events := <-ch:
				if err := websocket.JSON.Send(ws, events); err != nil {
					logger.Printf("Can't send: %s", err.Error())
					return
				}
			}
		}
	}
}

// drainIncoming receives and discards browser messages; on socket error
// it cancels wsCtx to surface the disconnect to the outbound goroutine.
func drainIncoming(ws *websocket.Conn, wsCtx context.Context, cancel context.CancelFunc) {
	for wsCtx.Err() == nil {
		var msg string
		if err := websocket.JSON.Receive(ws, &msg); err != nil {
			logger.Printf("Receive failed: %s; closing connection...", err.Error())
			if cerr := ws.Close(); cerr != nil {
				logger.Println("Error closing connection:", cerr.Error())
			}
			cancel()
			return
		}
		logger.Println("Received:", msg)
	}
}

// pickDetectPID prefers the followed PID while it still has a connection;
// otherwise the first polled client, so a restarted client is noticed.
func pickDetectPID(current uint32, conns []pcaputil.ClientConnection) uint32 {
	for _, c := range conns {
		if c.PID == current {
			return current
		}
	}
	if len(conns) > 0 {
		return conns[0].PID
	}
	return current
}

// startConnectionWatchdog polls Client.exe TCP connections every 500ms and
// keeps the live capture filter equal to the client's own local ports (see
// pcaputil.FilterForConns). A new connection (mission instance, channel
// switch) is captured as soon as the next poll widens the filter; a closed
// one is dropped. Only the initial install and a 60s packet-idle fallback
// rebuild the reader.
func startConnectionWatchdog(ctx context.Context, pub *eventPublisher, ctl *captureControl, setClient func(string)) {
	pollTicker := time.NewTicker(500 * time.Millisecond)
	defer pollTicker.Stop()

	idleTicker := time.NewTicker(10 * time.Second)
	defer idleTicker.Stop()

	var switching int32
	installed := false
	lastFilter := ""
	npcapOk := checkNpcapOk()

	// lastStatus/hasStatus dedupe live publishes to state changes only, but
	// still force one publish up front so /api/status and new clients never
	// see a permanently-nil status.
	var lastStatus event.EventCaptureStatus
	hasStatus := false
	publishStatus := func(gameDetected bool) {
		// LastRealPacketAt (not LastPacketAt) is the genuine liveness signal:
		// SwitchReader stamps LastPacketAt on every rebuild for its own
		// idle-retry grace period, which would otherwise read as "capturing".
		lastPacketAtUnix := int64(0)
		if real := pub.LastRealPacketAt(); !real.IsZero() {
			lastPacketAtUnix = real.Unix()
		}
		status := deriveCaptureStatus(npcapOk, gameDetected, lastPacketAtUnix, time.Now())
		if !shouldPublishStatus(hasStatus, lastStatus, status) {
			return
		}
		hasStatus = true
		lastStatus = status
		pub.PublishCaptureStatus(status)
	}

	// Detect only when the followed PID changes; off the watchdog goroutine
	// so a slow process query can never delay capture.
	var detectedPID atomic.Uint32
	var detectGen atomic.Uint64
	var clientMu sync.Mutex // guards gate and the gen-check + setClient pair
	var gate clientRetryGate
	noteClient := func(pid uint32) {
		if pid == 0 || pid == detectedPID.Load() || setClient == nil {
			return
		}
		clientMu.Lock()
		allowed := gate.allow(pid, time.Now())
		clientMu.Unlock()
		if !allowed {
			return
		}
		gen := detectGen.Add(1)
		// Marked before the goroutine starts, so a fast failure's reset below sticks.
		detectedPID.Store(pid)
		go func() {
			v, err := clientver.Detect(pid)
			clientMu.Lock()
			defer clientMu.Unlock()
			// A newer PID's detection supersedes this one.
			if detectGen.Load() != gen {
				return
			}
			if err != nil {
				if gate.fail(pid, time.Now()) {
					logger.Println("client version unavailable:", err)
				}
			} else {
				gate.ok()
			}
			// Unknown for this client (never the previous client's value); retry later.
			setClient(v)
			if v == "" {
				detectedPID.CompareAndSwap(pid, 0)
			}
		}()
	}

	rebuild := func(reason string) {
		if !atomic.CompareAndSwapInt32(&switching, 0, 1) {
			return
		}
		defer atomic.StoreInt32(&switching, 0)

		nicName, err := pcaputil.FindNic()
		if err != nil {
			logger.Println("watchdog: discover failed:", err)
			logNics()
			npcapOk = checkNpcapOk()
			return
		}
		conns, _ := pcaputil.PollClientConnections()
		lastFilter = pcaputil.FilterForConns(conns)

		newR, err := packet.NewGameServerPacketReader(&packet.GameServerPacketReaderOpt{
			Ctx:           ctx,
			NicName:       nicName,
			Filter:        lastFilter,
			VetLocalPort:  pcaputil.IsClientLocalPort,
			NoCaptureFile: noPcapFile,
			LogDir:        DataPath("logs"),
		})
		if err != nil {
			logger.Println("watchdog: open new reader failed:", err)
			logNics()
			return
		}
		if !ctl.switchIfLive(func() { pub.SwitchReader(newR, reason) }) {
			newR.Close()
			return
		}
		installed = true
		noteClient(pcaputil.CurrentPID())
		publishStatus(true)
	}

	for {
		select {
		case <-ctx.Done():
			return

		case <-pollTicker.C:
			if ctl.paused() {
				continue
			}
			if ctl.takeReinstall() {
				// Resumed after a pause: attach to Client.exe from scratch.
				installed, lastFilter = false, ""
			}
			conns, err := pcaputil.PollClientConnections()
			if err != nil {
				logger.Println("watchdog: poll failed:", err)
				continue
			}
			publishStatus(len(conns) > 0)
			if len(conns) == 0 {
				continue
			}
			if !installed {
				rebuild("initial")
				continue
			}
			// A restarted client has a new PID; follow it.
			noteClient(pickDetectPID(pcaputil.CurrentPID(), conns))
			// Keep the filter equal to the current game server nets.
			if want := pcaputil.FilterForConns(conns); want != "" && want != lastFilter {
				if err := pub.SetReaderFilter(want); err != nil {
					logger.Println("watchdog: set filter failed:", err)
					continue
				}
				logger.Printf("watchdog: capture filter -> %s", want)
				lastFilter = want
			}

		case <-idleTicker.C:
			if ctl.paused() || !installed || time.Since(pub.LastPacketAt()) <= 60*time.Second {
				continue
			}
			conns, err := pcaputil.PollClientConnections()
			if err != nil || len(conns) == 0 {
				continue
			}
			logger.Println("watchdog: idle 60s, fallback re-discover")
			rebuild("idle_fallback")
		}
	}
}

// skip reports whether events should be dropped right now (replay).
func startPacketWriter(ctx context.Context, ch <-chan []event.IEvent, skip func() bool) error {
	if err := os.MkdirAll(DataPath("logs"), os.ModePerm); err != nil {
		logger.Println("Failed to create log directory:", err)
		return err
	}

	packetLogBaseName := fmt.Sprintf("packet_log_%s.ndjson", util.StartStamp)
	plPath := DataPath("logs", packetLogBaseName)
	setPacketLogPath(plPath)

	fd, err := os.OpenFile(plPath, os.O_CREATE|os.O_TRUNC|os.O_WRONLY, 0644)
	if err != nil {
		logger.Println("packetWriter open file failed:", err)
		return err
	}
	defer fd.Close()

	flushTicker := time.NewTicker(5 * time.Second)
	defer flushTicker.Stop()

	for {
		select {
		case <-ctx.Done():
			return nil

		case events := <-ch:
			if skip != nil && skip() {
				continue
			}
			for _, e := range events {
				// System-level events (negative IDs) are runtime-only and
				// should not be persisted.
				if e.GetEventId() < 0 {
					continue
				}
				b, err := json.Marshal(e)
				if err != nil {
					continue
				}
				b = append(b, '\n')
				if _, err := fd.Write(b); err != nil {
					logger.Println("packetWriter write failed:", err)
					return err
				}
			}

		case <-flushTicker.C:
			_ = fd.Sync()
		}
	}
}

// AllowLan reports the configured LAN-listen setting (valid after Startup).
func AllowLan() bool { return appCfg.AllowLan }
