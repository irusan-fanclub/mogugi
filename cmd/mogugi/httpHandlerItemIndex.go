package main

import (
	"encoding/json"
	"net/http"
)

// httpHandlerItemIndex serves the aggregated item index (built from
// {exedir}/items_log/*.csv) as JSON for the frontend item-index tab.
func httpHandlerItemIndex(w http.ResponseWriter, r *http.Request) {
	dir, err := itemsLogDir()
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	idx, err := readItemIndexFrom(dir)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	_ = json.NewEncoder(w).Encode(idx)
}
