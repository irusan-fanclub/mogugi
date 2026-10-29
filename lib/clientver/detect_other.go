//go:build !windows

package clientver

// Detect is unsupported off Windows.
func Detect(pid uint32) (string, error) { return "", nil }
