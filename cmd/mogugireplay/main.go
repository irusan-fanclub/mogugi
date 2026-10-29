// Command mogugireplay is a dev tool: it replays a pcapng capture through the
// same server as the desktop app, read-only, and serves it to the browser.
package main

import (
	"context"
	"errors"
	"fmt"
	"io"
	"os"
	"os/signal"
	"path/filepath"
	"strconv"
	"strings"

	"github.com/irusan-fanclub/mogugi/internal/app"
)

const usage = `mogugireplay — mogugi 封包重播開發工具

用法：
  mogugireplay <檔案.pcapng> [--realtime] [--port N]
  mogugireplay -h, --help

選項：
  --realtime   依封包時間戳記的間隔重播（預設不限速）
  --port N     固定使用此 port（不寫入設定檔）

重播為唯讀：不寫 items.db、封包記錄、pcapng 與戰鬥紀錄。
資料目錄規則同 mogugi（MOGUGI_DATA_DIR，預設為 exe 所在目錄）。
按 Ctrl+C 結束。
`

type replayArgs struct {
	Path     string
	Realtime bool
	Port     int // 0 = use the configured port
	Help     bool
}

// parseReplayArgs parses args (without the program name).
func parseReplayArgs(args []string) (replayArgs, error) {
	var a replayArgs
	for i := 0; i < len(args); i++ {
		arg := args[i]
		switch {
		case arg == "-h" || arg == "--help":
			a.Help = true
			return a, nil
		case arg == "--realtime":
			a.Realtime = true
		case arg == "--port" || strings.HasPrefix(arg, "--port="):
			val := strings.TrimPrefix(arg, "--port=")
			if arg == "--port" {
				if i+1 >= len(args) {
					return a, errors.New("--port 需要一個數值")
				}
				i++
				val = args[i]
			}
			n, err := strconv.Atoi(val)
			if err != nil || n < 1 || n > 65535 {
				return a, fmt.Errorf("無效的 port：%q", val)
			}
			a.Port = n
		case strings.HasPrefix(arg, "-"):
			return a, fmt.Errorf("未知的參數 %q", arg)
		default:
			if a.Path != "" {
				return a, fmt.Errorf("只能指定一個檔案，多出 %q", arg)
			}
			a.Path = arg
		}
	}
	if a.Path == "" {
		return a, errors.New("缺少封包檔參數")
	}
	if strings.EqualFold(filepath.Ext(a.Path), ".ndjson") {
		return a, errors.New("不支援 .ndjson，僅支援 .pcapng／.pcap")
	}
	return a, nil
}

func run(args []string, out, errOut io.Writer) int {
	a, err := parseReplayArgs(args)
	if err != nil {
		fmt.Fprintf(errOut, "%v\n\n%s", err, usage)
		return 2
	}
	if a.Help {
		fmt.Fprint(out, usage)
		return 0
	}
	if _, err := os.Stat(a.Path); err != nil {
		fmt.Fprintf(errOut, "無法開啟檔案：%v\n", err)
		return 2
	}

	app.InitRuntime()
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt)
	defer stop()
	srv, err := app.StartServer(ctx, app.ServerOptions{
		Replay: &app.ReplayFile{Path: a.Path, Realtime: a.Realtime},
		Port:   a.Port,
	})
	if err != nil {
		fmt.Fprintf(errOut, "啟動失敗：%v\n", err)
		return 1
	}
	url := fmt.Sprintf("http://127.0.0.1:%d", srv.Port)
	fmt.Fprintf(out, "重播 %s\n網址：%s\n按 Ctrl+C 結束\n", a.Path, url)
	app.OpenBrowser(url)
	<-ctx.Done()
	return 0
}

func main() {
	os.Exit(run(os.Args[1:], os.Stdout, os.Stderr))
}
