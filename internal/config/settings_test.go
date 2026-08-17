package config

import (
	"os"
	"path/filepath"
	"testing"
)

func TestDefaultTextCapIsAKilobyte(t *testing.T) {
	if got := DefaultSettings().TextCapChars; got != 1024 {
		t.Errorf("default text cap is %d, want 1024", got)
	}
}

// 0 means "do not cap", so it must survive the clamp that exists to rescue
// nonsense values. Treating it as nonsense would make the setting impossible to
// turn off.
func TestTextCapZeroIsKept(t *testing.T) {
	s := DefaultSettings()
	s.TextCapChars = 0
	if got := s.clamp().TextCapChars; got != 0 {
		t.Errorf("a cap of 0 became %d; the cap can no longer be switched off", got)
	}
}

func TestAbsurdTextCapFallsBack(t *testing.T) {
	for _, in := range []int{-1, 2_000_000} {
		s := DefaultSettings()
		s.TextCapChars = in
		if got := s.clamp().TextCapChars; got != DefaultSettings().TextCapChars {
			t.Errorf("cap of %d clamped to %d, want the default", in, got)
		}
	}
}

// The new default must not rewrite a choice already on disk — someone who set
// 512 keeps 512 — while a file written before the setting existed picks the
// default up.
func TestSavedTextCapSurvivesADefaultChange(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "settings.json")
	if err := os.WriteFile(path, []byte(`{"fontSizePx":16,"textCapChars":512}`), 0o600); err != nil {
		t.Fatal(err)
	}
	store, err := OpenSettings(path)
	if err != nil {
		t.Fatal(err)
	}
	if got := store.Get().TextCapChars; got != 512 {
		t.Errorf("stored cap became %d, want the 512 that was on disk", got)
	}

	older := filepath.Join(dir, "older.json")
	if err := os.WriteFile(older, []byte(`{"fontSizePx":16}`), 0o600); err != nil {
		t.Fatal(err)
	}
	store, err = OpenSettings(older)
	if err != nil {
		t.Fatal(err)
	}
	if got := store.Get().TextCapChars; got != DefaultSettings().TextCapChars {
		t.Errorf("a file predating the setting got %d, want the default", got)
	}
}
