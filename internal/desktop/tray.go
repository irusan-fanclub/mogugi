package desktop

import (
	_ "embed"
	"fmt"

	"github.com/wailsapp/wails/v3/pkg/application"
)

//go:embed trayicon.png
var trayIcon []byte

// showMainWindow brings the hidden or minimised main window back to front.
func showMainWindow(win *application.WebviewWindow) {
	if win.IsMinimised() {
		win.UnMinimise()
	}
	win.Show()
	win.Focus()
}

// setupTray adds the system tray icon with its menu.
func setupTray(wapp *application.App, win *application.WebviewWindow, port int, toggleOverlayLock, toggleOverlayHidden func(), quit func()) {
	menu := wapp.Menu.New()
	menu.Add("顯示主視窗").OnClick(func(*application.Context) { showMainWindow(win) })
	menu.Add("開啟網頁").OnClick(func(*application.Context) {
		if err := wapp.Browser.OpenURL(fmt.Sprintf("http://127.0.0.1:%d/", port)); err != nil {
			logger.Printf("open browser failed: %v", err)
		}
	})
	// Off the main thread, like the hotkey: the toggle may wait on an overlay opening.
	menu.Add("切換 overlay 鎖定").OnClick(func(*application.Context) { go toggleOverlayLock() })
	menu.Add("顯示／隱藏 overlay").OnClick(func(*application.Context) { go toggleOverlayHidden() })
	menu.Add("結束").OnClick(func(*application.Context) { quit() })

	tray := wapp.SystemTray.New()
	tray.SetIcon(trayIcon)
	tray.SetTooltip("mogugi")
	tray.SetMenu(menu)
	tray.OnClick(func() { showMainWindow(win) })
}
