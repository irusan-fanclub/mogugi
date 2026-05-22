package main

import (
	"context"
	"embed"
	"encoding/json"
	"fmt"
	"io/fs"
	"net/http"
	"net/http/httputil"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"sync/atomic"
	"time"

	"github.com/gopacket/gopacket/pcap"
	"github.com/irusan-fanclub/mabidilmeter/lib/constants"
	"github.com/irusan-fanclub/mabidilmeter/lib/event"
	"github.com/irusan-fanclub/mabidilmeter/lib/license"
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

var logger = util.NewLogger("dilmeterapi")
var packetLogFilename = ""

func main() {
	logFilePath := filepath.Join(_logDir, fmt.Sprintf("dilmeter_%v.log", constants.SERVER_START_AT))
	if err := util.LogInit(logFilePath); err != nil {
		logger.Println("LogInit failed:", err)
	}
	logger.Printf("log file: %s", logFilePath)

	if err := license.Verify(); err != nil {
		logger.Println("license check failed:", err)
		os.Exit(1)
	}

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	mode := ""
	if len(os.Args) > 1 {
		mode = os.Args[1]
	}

	logger.Printf("* dilmatulgi v%s %s", constants.Version, mode)

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
		messagebox(fmt.Sprintf("NewGameServerPacketReader failed: %v", err))
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
		messagebox(fmt.Sprintf("FindAllDevs failed: %v", err))
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

	s := sb.String()
	messagebox(s)
	logger.Println(s)
}

func runPacketWriter(ctx context.Context, pub *eventPublisher) {
	ch := make(chan []event.IEvent, 10000)
	defer close(ch)

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
		ch := make(chan []event.IEvent, 10000)
		defer close(ch)

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
	remote, err := url.Parse("https://mabires.pril.cc")
	if err != nil {
		panic(err)
	}

	handler := func(p *httputil.ReverseProxy) func(http.ResponseWriter, *http.Request) {
		return func(w http.ResponseWriter, r *http.Request) {
			r.URL.Path = r.URL.Path[4:] // strip /res/
			r.Host = remote.Host
			p.ServeHTTP(w, r)
		}
	}

	proxy := httputil.NewSingleHostReverseProxy(remote)
	proxy.ModifyResponse = func(r *http.Response) error {
		r.Header.Set("Access-Control-Allow-Origin", "*")
		return nil
	}

	// /res/* — serve from ./resources if present, else reverse-proxy to remote.
	resourceHandler := func(w http.ResponseWriter, r *http.Request) {
		localPath := "./resources" + r.URL.Path[4:]
		if _, err := os.Stat(localPath); err == nil {
			w.Header().Set("Access-Control-Allow-Origin", "*")
			http.ServeFile(w, r, localPath)
			return
		}
		handler(proxy)(w, r)
	}

	http.Handle("/ws", websocket.Handler(newClientCb))
	http.HandleFunc("/api/packet_log", httpHandlerPacketLog)
	http.HandleFunc("/res/", resourceHandler)

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
			messagebox(fmt.Sprintf("ListenAndServe failed: %v", err))
			logger.Fatalln(err)
		}
	}()

	<-time.After(1 * time.Second)
}

// startConnectionWatchdog polls Client.exe TCP connections every 3s and
// swaps the reader when the current triple disappears (channel switch).
// A 60s packet-idle fallback catches cases the TCP poll might miss.
func startConnectionWatchdog(ctx context.Context, pub *eventPublisher) {
	pollTicker := time.NewTicker(3 * time.Second)
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
			alive := false
			for _, c := range conns {
				if c.ServerIP == constants.ServerIP &&
					c.ServerPort == constants.ServerSrcPort &&
					c.LocalPort == constants.ServerDstPort {
					alive = true
					break
				}
			}
			if alive {
				continue
			}
			reason := "channel_switch"
			if constants.ServerIP == "" {
				// Empty triple = first-ever discovery, not a real switch.
				reason = "initial"
			} else {
				logger.Printf("watchdog: current connection gone, %d candidate(s); switching", len(conns))
			}
			go swap(reason)

		case <-idleTicker.C:
			if time.Since(pub.LastPacketAt()) <= 60*time.Second {
				continue
			}
			conns, err := pcaputil.PollClientConnections()
			if err != nil || len(conns) == 0 {
				continue
			}
			logger.Println("watchdog: idle 60s, fallback re-discover")
			go swap("idle_fallback")
		}
	}
}

func startPacketWriter(ctx context.Context, ch <-chan []event.IEvent) error {
	if err := os.MkdirAll(_logDir, os.ModePerm); err != nil {
		logger.Println("Failed to create log directory:", err)
		return err
	}

	packetLogBaseName := fmt.Sprintf("packet_log_%v.ndjson", constants.SERVER_START_AT)
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
