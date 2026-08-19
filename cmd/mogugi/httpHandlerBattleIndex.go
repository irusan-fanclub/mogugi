package main

import (
	"encoding/json"
	"net/http"
)

// battleIndexResponse wraps the list so the JSON shape is {"battles": [...]}.
type battleIndexResponse struct {
	Battles []BattleRecord `json:"battles"`
}

// httpHandlerBattleIndex serves the recorded-dungeon-run index for the
// frontend battle-records tab.
func httpHandlerBattleIndex(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")

	// Old-format files get their summary computed and appended on first
	// sight, so the index has data columns for the whole history.
	backfillSummaries(dungeonLogDirPath)

	records, err := scanBattleRecords(dungeonLogDirPath)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	_ = json.NewEncoder(w).Encode(battleIndexResponse{Battles: records})
}
