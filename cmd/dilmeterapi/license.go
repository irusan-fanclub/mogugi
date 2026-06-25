package main

import (
	"encoding/json"
	"errors"
	"net/http"

	"github.com/irusan-fanclub/mabidilmeter/lib/license"
)

// requireLicense wraps data endpoints: returns 403 if the license is not activated.
func requireLicense(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !license.Status() {
			http.Error(w, "license required", http.StatusForbidden)
			return
		}
		next.ServeHTTP(w, r)
	})
}

func httpHandlerLicenseStatus(w http.ResponseWriter, _ *http.Request) {
	if uid, name, ok := license.Identity(); ok {
		writeLicenseJSON(w, http.StatusOK, map[string]any{
			"activated": true, "userId": uid, "displayName": name,
		})
		return
	}
	writeLicenseJSON(w, http.StatusOK, map[string]any{"activated": false})
}

func httpHandlerLicenseActivate(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Code string `json:"code"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeLicenseJSON(w, http.StatusBadRequest, map[string]any{"ok": false, "error": "invalid"})
		return
	}
	switch err := license.Activate(body.Code); {
	case err == nil:
		writeLicenseJSON(w, http.StatusOK, map[string]any{"ok": true})
	case errors.Is(err, license.ErrExpired):
		writeLicenseJSON(w, http.StatusBadRequest, map[string]any{"ok": false, "error": "expired"})
	default:
		writeLicenseJSON(w, http.StatusBadRequest, map[string]any{"ok": false, "error": "invalid"})
	}
}

func writeLicenseJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}
