package main

import (
	"encoding/json"
	"net/http"
)

// httpHandlerItemIndex serves the aggregated item index from the SQLite
// item store (itemDB) as JSON for the frontend item-index tab.
func httpHandlerItemIndex(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	if itemDB == nil {
		_, _ = w.Write([]byte("[]"))
		return
	}
	idx, err := itemDB.ReadIndex()
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	_ = json.NewEncoder(w).Encode(idx)
}
