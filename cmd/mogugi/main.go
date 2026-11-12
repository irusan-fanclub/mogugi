package main

import (
	"context"
	"errors"
	"fmt"
	"os"

	"github.com/irusan-fanclub/mogugi/internal/app"
	"github.com/irusan-fanclub/mogugi/internal/desktop"
	"github.com/irusan-fanclub/mogugi/lib/util"
)

func main() {
	attachParentConsole()
	// An elevated relaunch waits here for the old instance to exit.
	args := desktop.WaitForRelaunch(os.Args[1:])
	proceed, code, ignored := app.ParseStartupLenient(args, os.Stdout)
	if !proceed {
		os.Exit(code)
	}

	// Another mogugi exe: wait in a small window until the player quits it.
	desktop.WaitForOtherInstance(args)
	// A second instance exits inside NewShell, before any file is written.
	shell := desktop.NewShell()
	app.InitRuntime()
	if len(ignored) > 0 {
		util.NewLogger("mogugi").Printf("ignoring unknown arguments: %q", ignored)
	}
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	srv, err := app.StartServer(ctx, app.ServerOptions{AllowLan: app.AllowLan(),
		OnServeError: func(err error) {
			desktop.FatalDialog("mogugi", fmt.Sprintf("網頁服務意外停止：%v", err))
			os.Exit(1)
		},
	})
	if err != nil {
		var pe *app.PortError
		if errors.As(err, &pe) {
			desktop.FatalDialog("mogugi", pe.Error())
		} else {
			desktop.FatalDialog("mogugi", fmt.Sprintf("啟動失敗：%v", err))
		}
		os.Exit(1)
	}
	if err := shell.Run(srv, cancel); err != nil {
		desktop.FatalDialog("mogugi", fmt.Sprintf("視窗啟動失敗：%v", err))
		os.Exit(1)
	}
}
