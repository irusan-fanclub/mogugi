package app

import (
	"io/fs"
	"net/http"

	"golang.org/x/net/websocket"
)

// NewMux builds a private route table (never http.DefaultServeMux) so the
// same handler can serve a TCP listener and the desktop asset handler.
func NewMux(pub *eventPublisher) *http.ServeMux {
	mux := http.NewServeMux()
	mux.Handle("/ws", requireLicense(websocket.Handler(websocketHandler(pub))))
	mux.Handle("/api/packet_log", requireLicense(http.HandlerFunc(httpHandlerPacketLog)))
	mux.Handle("/api/item-index", requireLicense(http.HandlerFunc(httpHandlerItemIndex)))
	mux.Handle("/api/battles", requireLicense(http.HandlerFunc(httpHandlerBattleIndex)))
	mux.Handle("/api/battles/content", requireLicense(http.HandlerFunc(httpHandlerBattleContent)))
	mux.Handle("/api/battles/reveal", requireLicense(http.HandlerFunc(httpHandlerBattleReveal)))
	mux.Handle("/api/battles/note", requireLicense(http.HandlerFunc(httpHandlerBattleNote)))
	mux.Handle("/api/battles/delete", requireLicense(http.HandlerFunc(httpHandlerBattleDelete)))
	mux.Handle("/api/config", requireLicense(http.HandlerFunc(httpHandlerConfig)))
	mux.Handle("/api/ui-settings", requireLicense(http.HandlerFunc(httpHandlerUiSettings)))
	mux.Handle("/api/files/config/open", requireLicense(http.HandlerFunc(httpHandlerConfigOpen)))
	mux.Handle("/api/files/config/reveal", requireLicense(http.HandlerFunc(httpHandlerConfigReveal)))
	mux.Handle("/api/logs/open", requireLicense(http.HandlerFunc(httpHandlerLogsOpen)))
	mux.Handle("/api/logs/usage", requireLicense(http.HandlerFunc(httpHandlerLogsUsage)))
	mux.Handle("/api/logs/clear", requireLicense(http.HandlerFunc(httpHandlerLogsClear)))
	mux.Handle("/api/logs/pack", requireLicense(http.HandlerFunc(httpHandlerLogsPack)))
	mux.HandleFunc("/api/license/status", httpHandlerLicenseStatus)
	mux.HandleFunc("/api/license/oauth/start", httpHandlerLicenseOAuthStart)
	mux.HandleFunc("/api/status", httpHandlerStatus)
	mux.HandleFunc("/api/instance", httpHandlerInstance)

	htmlContent, err := fs.Sub(fs.FS(staticFiles), "static")
	if err != nil {
		logger.Fatal(err)
	}
	mux.Handle("/", http.FileServer(http.FS(htmlContent)))
	return mux
}
