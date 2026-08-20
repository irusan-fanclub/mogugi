package util

import (
	"testing"
	"time"
)

func TestFileStampIsSortableAndFilenameSafe(t *testing.T) {
	got := FileStamp(time.Date(2026, 8, 17, 9, 5, 3, 0, time.UTC))
	if want := "20260817_090503"; got != want {
		t.Fatalf("FileStamp = %q, want %q", got, want)
	}
}

// Lexical order must match chronological order, or the file list sorts wrong.
func TestFileStampSortsChronologically(t *testing.T) {
	a := FileStamp(time.Date(2026, 8, 17, 9, 5, 3, 0, time.UTC))
	b := FileStamp(time.Date(2026, 8, 17, 10, 0, 0, 0, time.UTC))
	if !(a < b) {
		t.Fatalf("%q should sort before %q", a, b)
	}
}

func TestStartStampIsSet(t *testing.T) {
	if len(StartStamp) != len("20260817_090503") {
		t.Fatalf("StartStamp = %q", StartStamp)
	}
}
