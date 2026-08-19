package main

import (
	"context"
	"embed"
	"encoding/json"
	"fmt"
	"io/fs"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/gopacket/gopacket/pcap"
	"github.com/irusan-fanclub/mogugi/lib/event"
	"github.com/irusan-fanclub/mogugi/lib/license"
	"github.com/irusan-fanclub/mogugi/lib/packet"
	"github.com/irusan-fanclub/mogugi/lib/pcaputil"
	"github.com/irusan-fanclub/mogugi/lib/util"
	"golang.org/x/net/websocket"
)

const (
	port    = 8030
	_logDir = "logs"
)

//go:embed static
var staticFiles embed.FS

// Version is the build version. Override at link time via:
//
//	go build -ldflags "-X main.Version=x.y.z"
var Version = "0.4.4"

var logger = util.NewLogger("mogugi")
var packetLogFilename = ""

// itemDB is the SQLite item store; nil disables item-index writes entirely
// (every writer nil-checks it) so a failed open never blocks metering.
var itemDB *itemStore

func main() {
	logFilePath := filepath.Join(_logDir, fmt.Sprintf("dilmeter_%s.log", util.StartStamp))
	if err := util.LogInit(logFilePath); err != nil {
		logger.Println("LogInit failed:", err)
	}
	logger.Printf("log file: %s", logFilePath)

	if db, err := openItemStore(filepath.Join(itemsLogDirPath, "items.db")); err != nil {
		itemLogger.Printf("open item store failed: %v", err)
	} else {
		itemDB = db
		defer itemDB.Close()
	}

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	// Flags may sit anywhere on the command line; whatever remains keeps
	// the positional mode/argument behaviour below.
	rest := make([]string, 0, len(os.Args)-1)
	for _, a := range os.Args[1:] {
		switch a {
		case "--no-pcap":
			noPcapFile = true
		case "--no-browser":
			noBrowser = true
		default:
			rest = append(rest, a)
		}
	}
	mode := ""
	if len(rest) > 0 {
		mode = rest[0]
	}

	logger.Printf("* mogugi v%s %s (fork from dilmatulgi)", Version, mode)

	switch mode {
	case "list":
		listNics()
		return
	case "file":
		fileName := ""
		realtime := false
		for _, a := range rest[1:] {
			if a == "--realtime" {
				realtime = true
			} else if fileName == "" {
				fileName = a
			}
		}
		runFile(ctx, fileName, realtime)
	case "itemcsv":
		outDir := "items_log_export"
		if len(rest) > 1 {
			outDir = rest[1]
		}
		exportItemCSV(outDir)
		return
	default:
		runLive(ctx)
	}

	<-ctx.Done()
}

// onLicenseActivated starts capture the moment the license becomes valid
// (set by runLive, called by the activate handler). Guarded so scanning
// starts exactly once.
var onLicenseActivated func()

// runLive: HTTP/WS server up immediately. TCP scanning (the watchdog) is
// held back until the license is active — either already, or via the
// activate endpoint — so we don't touch the network before activation.
func runLive(ctx context.Context) {
	pub := newEventPublisher(ctx, nil)
	go runPacketWriter(ctx, pub)

	var once sync.Once
	onLicenseActivated = func() {
		once.Do(func() {
			logger.Println("live mode: license active, scanning for Client.exe")
			go startConnectionWatchdog(ctx, pub)
		})
	}
	if license.Status() {
		onLicenseActivated()
	} else {
		logger.Println("live mode: waiting for license activation")
	}
	serve(pub)
}

// runFile: replay a capture from disk. No watchdog.
func runFile(ctx context.Context, fileName string, realtime bool) {
	logger.Println("file replay mode:", fileName, "realtime:", realtime)

	r, err := packet.NewGameServerPacketReader(&packet.GameServerPacketReaderOpt{
		Ctx:      ctx,
		FileName: fileName,
		Realtime: realtime,
	})
	if err != nil {
		logger.Fatalln("NewGameServerPacketReader failed:", err)
	}

	pub := newEventPublisher(ctx, r)
	go runPacketWriter(ctx, pub)
	serve(pub)
}

// noPcapFile skips writing logs/packet_capture_*.pcapng; noBrowser skips
// opening the UI tab on start. Both set from --no-pcap / --no-browser.
var (
	noPcapFile bool
	noBrowser  bool
)

func serve(pub *eventPublisher) {
	startWebsocketServer(websocketHandler(pub))

	if runtime.GOOS == "windows" && !noBrowser {
		go exec.Command("explorer", fmt.Sprintf("http://127.0.0.1:%v", port)).Run()
	}
}

func listNics() {
	nics, err := pcap.FindAllDevs()
	if err != nil {
		logger.Fatalln("FindAllDevs failed:", err)
	}

	sb := strings.Builder{}
	for i, nic := range nics {
		ipStr := "unknownAddress"
		if len(nic.Addresses) > 0 {
			ipStr = nic.Addresses[0].IP.String()
		}
		fmt.Fprintln(&sb, "* nic", i, "name:", nic.Name, "ip:", ipStr)
	}

	logger.Println(sb.String())
}

func runPacketWriter(ctx context.Context, pub *eventPublisher) {
	// Deliberately never close ch: the publisher (flushNow) may send to it
	// from another goroutine, and closing while it's still registered would
	// panic. The client is dropped when its ctx is cancelled or the channel
	// backs up; an abandoned channel is just GC'd.
	ch := make(chan []event.IEvent, 10000)

	pub.addClient(ctx, ch)
	if err := startPacketWriter(ctx, ch); err != nil {
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

		go pub.addClient(wsCtx, ch)
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

func startWebsocketServer(newClientCb func(*websocket.Conn)) {
	http.Handle("/ws", requireLicense(websocket.Handler(newClientCb)))
	http.Handle("/api/packet_log", requireLicense(http.HandlerFunc(httpHandlerPacketLog)))
	http.Handle("/api/item-index", requireLicense(http.HandlerFunc(httpHandlerItemIndex)))
	http.Handle("/api/battles", requireLicense(http.HandlerFunc(httpHandlerBattleIndex)))
	http.Handle("/api/battles/content", requireLicense(http.HandlerFunc(httpHandlerBattleContent)))
	http.Handle("/api/battles/reveal", requireLicense(http.HandlerFunc(httpHandlerBattleReveal)))
	http.Handle("/api/battles/note", requireLicense(http.HandlerFunc(httpHandlerBattleNote)))
	http.Handle("/api/battles/delete", requireLicense(http.HandlerFunc(httpHandlerBattleDelete)))
	http.HandleFunc("/api/license/status", httpHandlerLicenseStatus)
	http.HandleFunc("/api/license/oauth/start", httpHandlerLicenseOAuthStart)

	var staticFS = fs.FS(staticFiles)
	htmlContent, err := fs.Sub(staticFS, "static")
	if err != nil {
		logger.Fatal(err)
	}

	http.Handle("/", http.FileServer(http.FS(htmlContent)))

	logger.Printf("Server listening on port %d", port)

	go func() {
		err := http.ListenAndServe(fmt.Sprintf("127.0.0.1:%d", port), nil)
		if err != nil {
			logger.Fatalf("ListenAndServe failed: %v", err)
		}
	}()

	<-time.After(1 * time.Second)
}

// startConnectionWatchdog polls Client.exe TCP connections every 500ms and
// keeps the live capture filter equal to the client's own local ports (see
// pcaputil.FilterForConns). A new connection (mission instance, channel
// switch) is captured as soon as the next poll widens the filter; a closed
// one is dropped. Only the initial install and a 60s packet-idle fallback
// rebuild the reader.
func startConnectionWatchdog(ctx context.Context, pub *eventPublisher) {
	pollTicker := time.NewTicker(500 * time.Millisecond)
	defer pollTicker.Stop()

	idleTicker := time.NewTicker(10 * time.Second)
	defer idleTicker.Stop()

	var switching int32
	installed := false
	lastFilter := ""

	rebuild := func(reason string) {
		if !atomic.CompareAndSwapInt32(&switching, 0, 1) {
			return
		}
		defer atomic.StoreInt32(&switching, 0)

		nicName, err := pcaputil.FindNic()
		if err != nil {
			logger.Println("watchdog: discover failed:", err)
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
		})
		if err != nil {
			logger.Println("watchdog: open new reader failed:", err)
			return
		}
		pub.SwitchReader(newR, reason)
		installed = true
	}

	for {
		select {
		case <-ctx.Done():
			return

		case <-pollTicker.C:
			conns, err := pcaputil.PollClientConnections()
			if err != nil {
				logger.Println("watchdog: poll failed:", err)
				continue
			}
			if len(conns) == 0 {
				continue
			}
			if !installed {
				rebuild("initial")
				continue
			}
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
			if !installed || time.Since(pub.LastPacketAt()) <= 60*time.Second {
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

func startPacketWriter(ctx context.Context, ch <-chan []event.IEvent) error {
	if err := os.MkdirAll(_logDir, os.ModePerm); err != nil {
		logger.Println("Failed to create log directory:", err)
		return err
	}

	packetLogBaseName := fmt.Sprintf("packet_log_%s.ndjson", util.StartStamp)
	packetLogFilename = filepath.Join(_logDir, packetLogBaseName)

	fd, err := os.OpenFile(packetLogFilename, os.O_CREATE|os.O_TRUNC|os.O_WRONLY, 0644)
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
