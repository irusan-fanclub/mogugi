package desktop

import (
	"github.com/irusan-fanclub/mogugi/internal/app"
	"github.com/wailsapp/wails/v3/pkg/application"
)

// replayOpenFilter is the file dialog filter for replay sources.
const (
	replayFilterName    = "封包紀錄 (*.pcapng;*.pcap;*.ndjson;*.ndjson.gz)"
	replayFilterPattern = "*.pcapng;*.pcap;*.ndjson;*.ndjson.gz"
)

// importBattlesFrom reads {importBattles: bool} from a Wails event payload.
func importBattlesFrom(data any) bool {
	m, ok := data.(map[string]any)
	if !ok {
		return false
	}
	v, _ := m["importBattles"].(bool)
	return v
}

// setupReplay wires the front-end replay:open / replay:stop events to the
// source controller. Errors surface through the SourceChanged banner.
func setupReplay(wapp *application.App, win *application.WebviewWindow, src *app.SourceController) {
	wapp.Event.On("replay:open", func(e *application.CustomEvent) {
		opt := app.ReplayOptions{ImportBattles: importBattlesFrom(e.Data)}
		go func() {
			path, err := wapp.Dialog.OpenFile().
				SetTitle("匯入封包紀錄").
				AddFilter(replayFilterName, replayFilterPattern).
				AttachToWindow(win).
				PromptForSingleSelection()
			if err != nil || path == "" {
				if err != nil {
					logger.Printf("replay: file dialog: %v", err)
				}
				return
			}
			if err := src.StartReplay(path, opt); err != nil {
				logger.Printf("replay: %v", err)
			}
		}()
	})
	wapp.Event.On("replay:stop", func(*application.CustomEvent) { src.StopReplay() })
}
