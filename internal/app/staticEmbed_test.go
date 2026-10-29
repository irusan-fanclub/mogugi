package app

import (
	"io/fs"
	"os"
	"path/filepath"
	"testing"
)

// Vite may emit chunks starting with "_" (e.g. _plugin-vue_export-helper),
// which a plain //go:embed pattern silently drops.
func TestStaticEmbedIncludesAllBuiltFiles(t *testing.T) {
	err := filepath.WalkDir("static", func(p string, d fs.DirEntry, err error) error {
		if err != nil || d.IsDir() {
			return err
		}
		if _, err := fs.Stat(staticFiles, filepath.ToSlash(p)); err != nil {
			t.Errorf("%s exists on disk but is not embedded", p)
		}
		return nil
	})
	if err != nil && !os.IsNotExist(err) {
		t.Fatal(err)
	}
}
