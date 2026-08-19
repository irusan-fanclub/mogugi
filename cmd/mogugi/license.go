package main

import (
	"encoding/json"
	"net/http"

	"github.com/irusan-fanclub/mogugi/lib/license"
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

// Codes are no longer pasted in: the OAuth2 callback calls license.Activate
// directly (see oauth.go). There is deliberately no endpoint that accepts a
// code over HTTP.

func writeLicenseJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}
