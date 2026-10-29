package app

import (
	"context"
	"fmt"
	"net"
	"net/http"
	"sync"
	"time"

	"github.com/irusan-fanclub/mogugi/lib/license"
	"github.com/irusan-fanclub/mogugi/lib/packet"
)

// ReplayFile selects file replay instead of live capture.
type ReplayFile struct {
	Path     string
	Realtime bool
}

// ServerOptions configures StartServer.
type ServerOptions struct {
	Replay        *ReplayFile // nil = live capture
	AllowLan      bool        // listen on 0.0.0.0 instead of 127.0.0.1
	ProbeExisting bool        // refuse to start beside a running mogugi
	Port          int         // >0 pins this run's port (no auto-port, not persisted)
	// OnServeError is called when the HTTP server dies unexpectedly; nil
	// keeps the console behaviour (log and exit).
	OnServeError func(error)
}

// Server is a running mogugi backend: publisher, route table and TCP port.
type Server struct {
	Pub  *eventPublisher
	Mux  *http.ServeMux
	Port int

	// Source switches between live capture and file replay.
	Source *SourceController
	ctx    context.Context
	cap    *captureControl
}

// PortError means no candidate port could be bound.
type PortError struct {
	Port int
	Auto bool
	Err  error
}

func (e *PortError) Error() string {
	if e.Auto {
		return fmt.Sprintf("port %d 到 %d 都無法使用(被其他程式占用或系統保留),請關閉占用的程式,或在 %s 關閉自動切換並指定 port:%v", autoPortMin, autoPortMax, appConfigPath(), e.Err)
	}
	return fmt.Sprintf("port %d 無法使用(可能已被其他程式占用),請修改 %s 裡的 port 後重新啟動:%v", e.Port, appConfigPath(), e.Err)
}

func (e *PortError) Unwrap() error { return e.Err }

// ExistingInstanceError means a mogugi already answers on the port.
type ExistingInstanceError struct {
	URL  string
	Info instanceInfo
}

func (e *ExistingInstanceError) Error() string {
	return fmt.Sprintf("mogugi 已在 %s 執行中(PID %d,版本 %s),不再開第二個(如需同時開兩個,請關閉自動切換 port 並指定不同的 port)", e.URL, e.Info.PID, e.Info.Version)
}

// onLicenseActivated starts capture the moment the license becomes valid
// (set by StartServer in live mode, called by the activate handler).
var onLicenseActivated func()

// StartServer binds the port, wires publisher/mux/writer, starts capture
// (live watchdog gated by license, or file reader) and serves TCP in the
// background. It never opens a browser.
func StartServer(ctx context.Context, opt ServerOptions) (*Server, error) {
	var reader *packet.GameServerPacketReader
	if opt.Replay != nil {
		logger.Println("file replay mode:", opt.Replay.Path, "realtime:", opt.Replay.Realtime)
		r, err := packet.NewGameServerPacketReader(&packet.GameServerPacketReaderOpt{
			Ctx:      ctx,
			FileName:      opt.Replay.Path,
			Realtime:      opt.Replay.Realtime,
			NoCaptureFile: true,
			LogDir:        DataPath("logs"),
		})
		if err != nil {
			return nil, fmt.Errorf("NewGameServerPacketReader failed: %w", err)
		}
		reader = r
	}

	if opt.Port > 0 {
		port, autoPort = opt.Port, false
	}
	ln, err := bindPort(opt.ProbeExisting, opt.AllowLan)
	if err != nil {
		return nil, err
	}

	pub := newEventPublisher(ctx, reader)
	currentPub = pub
	pub.SetMemoryLimitMB(appCfg.MemoryLimitMB)
	srv := &Server{Pub: pub, Mux: NewMux(pub), Port: port, ctx: ctx, cap: &captureControl{}}
	srv.Source = NewSourceController(srv)
	if opt.Replay == nil {
		startBattleSweep(ctx, dungeonLogDirPath)
	}

	if opt.Replay != nil {
		// File replay never writes items.db, battle records or the packet log.
		pub.SetReadOnly(true)
	} else {
		go runPacketWriter(ctx, pub)
	}

	if opt.Replay == nil {
		var once sync.Once
		onLicenseActivated = func() {
			once.Do(func() {
				logger.Println("live mode: license active, scanning for Client.exe")
				go startConnectionWatchdog(ctx, pub, srv.cap, srv.Source.SetLiveClient)
			})
		}
		if license.Status() {
			onLicenseActivated()
		} else {
			logger.Println("live mode: waiting for license activation")
		}
	}

	logger.Printf("Server listening on port %d", port)
	go func() {
		if err := http.Serve(ln, srv.Mux); err != nil && ctx.Err() == nil {
			if opt.OnServeError != nil {
				logger.Printf("HTTP server stopped: %v", err)
				opt.OnServeError(err)
				return
			}
			logger.Fatalf("HTTP server stopped: %v", err)
		}
	}()
	return srv, nil
}

// bindPort binds the first free candidate port. With probe it returns an
// *ExistingInstanceError when a running mogugi owns an occupied port.
func bindPort(probe, lan bool) (net.Listener, error) {
	if autoPort && (port < autoPortMin || port > autoPortMax) {
		logger.Printf("設定的 port %d 未使用:自動切換 port 已開啟(%d 到 %d)", port, autoPortMin, autoPortMax)
	}
	var running instanceInfo
	isMogugi := func(int) bool { return false }
	if probe {
		isMogugi = func(p int) bool {
			info, ok := probeMogugi(p, 500*time.Millisecond)
			if ok {
				running = info
			}
			return ok
		}
	}
	allowLan = lan
	ln, actual, out := listenFirstFree(candidatePorts(port, autoPort), tcpListen, isMogugi)
	if out != nil {
		if out.AlreadyRunning {
			return nil, &ExistingInstanceError{URL: fmt.Sprintf("http://127.0.0.1:%d", out.Port), Info: running}
		}
		return nil, &PortError{Port: out.Port, Auto: autoPort, Err: out.Err}
	}
	port = actual
	return ln, nil
}
