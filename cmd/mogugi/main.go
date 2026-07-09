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
	"sync/atomic"
	"time"

	"github.com/gopacket/gopacket/pcap"
	"github.com/irusan-fanclub/mabidilmeter/lib/event"
	"github.com/irusan-fanclub/mabidilmeter/lib/packet"
	"github.com/irusan-fanclub/mabidilmeter/lib/pcaputil"
	"github.com/irusan-fanclub/mabidilmeter/lib/util"
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
var Version = "0.2.3"

var logger = util.NewLogger("mogugi")
var packetLogFilename = ""

func main() {
	logFilePath := filepath.Join(_logDir, fmt.Sprintf("dilmeter_%v.log", util.StartUnix))
	if err := util.LogInit(logFilePath); err != nil {
		logger.Println("LogInit failed:", err)
	}
	logger.Printf("log file: %s", logFilePath)

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	mode := ""
	if len(os.Args) > 1 {
		mode = os.Args[1]
	}

	logger.Printf("* mogugi v%s %s (fork from dilmatulgi)", Version, mode)

	switch mode {
	case "list":
		listNics()
		return
	case "file":
		fileName := ""
		realtime := false
		for _, a := range os.Args[2:] {
			if a == "--realtime" {
				realtime = true
			} else if fileName == "" {
				fileName = a
			}
		}
		runFile(ctx, fileName, realtime)
	default:
		runLive(ctx)
	}

	<-ctx.Done()
}

// runLive: HTTP/WS server up immediately, watchdog discovers Client.exe.
func runLive(ctx context.Context) {
	logger.Println("live mode: waiting for Client.exe")

	pub := newEventPublisher(ctx, nil)
	go runPacketWriter(ctx, pub)
	go startConnectionWatchdog(ctx, pub)
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

func serve(pub *eventPublisher) {
	startWebsocketServer(websocketHandler(pub))

	if runtime.GOOS == "windows" {
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
	http.HandleFunc("/api/license/status", httpHandlerLicenseStatus)
	http.HandleFunc("/api/license/activate", httpHandlerLicenseActivate)

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

// sameServerNet reports whether two IPv4 strings share a /24. Same-net
// channel switches don't need a new reader — the wide BPF filter already
// captures the new stream, so we only reset the session.
func sameServerNet(a, b string) bool {
	return a != "" && b != "" && util.ServerNet24(a) == util.ServerNet24(b)
}

// startConnectionWatchdog polls Client.exe TCP connections every 1s and
// reacts when the current triple disappears (channel switch). Because the
// capture filter is scoped to the whole server /24, a same-net switch only
// re-points the tracked triple and resets the session (no reader rebuild,
// so no capture gap); a different-net switch rebuilds the reader.
// A 10s packet-idle fallback catches cases the TCP poll might miss.
func startConnectionWatchdog(ctx context.Context, pub *eventPublisher) {
	pollTicker := time.NewTicker(1 * time.Second)
	defer pollTicker.Stop()

	idleTicker := time.NewTicker(10 * time.Second)
	defer idleTicker.Stop()

	var switching int32

	swap := func(reason string) {
		if !atomic.CompareAndSwapInt32(&switching, 0, 1) {
			return
		}
		defer atomic.StoreInt32(&switching, 0)

		nicName, err := pcaputil.FindNic()
		if err != nil {
			logger.Println("watchdog: discover failed:", err)
			return
		}

		newR, err := packet.NewGameServerPacketReader(&packet.GameServerPacketReaderOpt{
			Ctx:     ctx,
			NicName: nicName,
			Filter:  pcaputil.CurrentFilter(),
		})
		if err != nil {
			logger.Println("watchdog: open new reader failed:", err)
			return
		}

		pub.SwitchReader(newR, reason)
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
			cur := pcaputil.Current()
			alive := false
			for _, c := range conns {
				if c.ServerIP == cur.ServerIP &&
					c.ServerPort == cur.ServerPort &&
					c.LocalPort == cur.LocalPort {
					alive = true
					break
				}
			}
			if alive {
				continue
			}
			if cur.ServerIP == "" {
				// Empty triple = first-ever discovery, not a real switch.
				swap("initial")
				continue
			}

			// Prefer a same-/24 candidate: the wide filter already captures
			// it, so we can re-point without rebuilding the reader (no gap).
			var sameNet *pcaputil.ClientConnection
			for i := range conns {
				if sameServerNet(conns[i].ServerIP, cur.ServerIP) {
					sameNet = &conns[i]
					break
				}
			}
			if sameNet != nil {
				logger.Printf("watchdog: same-net switch -> %s:%s (no reader rebuild)",
					sameNet.ServerIP, sameNet.ServerPort)
				pcaputil.ApplyConnectionFilter(*sameNet)
				pub.ResetSession("channel_switch")
				continue
			}

			logger.Printf("watchdog: current connection gone, %d candidate(s); switching", len(conns))
			swap("channel_switch")

		case <-idleTicker.C:
			if time.Since(pub.LastPacketAt()) <= 60*time.Second {
				continue
			}
			conns, err := pcaputil.PollClientConnections()
			if err != nil || len(conns) == 0 {
				continue
			}
			logger.Println("watchdog: idle 60s, fallback re-discover")
			swap("idle_fallback")
		}
	}
}

func startPacketWriter(ctx context.Context, ch <-chan []event.IEvent) error {
	if err := os.MkdirAll(_logDir, os.ModePerm); err != nil {
		logger.Println("Failed to create log directory:", err)
		return err
	}

	packetLogBaseName := fmt.Sprintf("packet_log_%v.ndjson", util.StartUnix)
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
