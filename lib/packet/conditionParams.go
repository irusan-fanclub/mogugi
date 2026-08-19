package packet

import "strings"

// ParseConditionParams splits a character-condition parameter string —
// a list of KEY:type:value; triples — into key -> value. The type token
// is dropped; malformed entries are skipped rather than failing the packet.
func ParseConditionParams(s string) map[string]string {
	out := map[string]string{}
	for _, entry := range strings.Split(s, ";") {
		if entry == "" {
			continue
		}
		parts := strings.SplitN(entry, ":", 3)
		if len(parts) != 3 || parts[0] == "" {
			continue
		}
		out[parts[0]] = parts[2]
	}
	return out
}
