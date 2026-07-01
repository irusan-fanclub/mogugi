package main

import (
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"time"
)

func httpHandlerPacketLog(w http.ResponseWriter, r *http.Request) {
	fd, err := os.Open(packetLogFilename)
	if err != nil {
		http.Error(w, err.Error(), 404)
		logger.Println("Error opening packet log file:", err.Error())

		return
	}

	defer fd.Close()

	baseName := filepath.Base(packetLogFilename)
	w.Header().Add("Content-Type", "application/json")
	w.Header().Add("Content-Disposition", fmt.Sprintf("attachment; filename=\"%s\"", baseName))

	http.ServeContent(w, r, baseName, time.Now(), fd)
}
