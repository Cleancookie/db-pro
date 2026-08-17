package config

import (
	"encoding/json"
	"fmt"
	"os"
	"sync"
)

// Settings are the user's preferences, persisted alongside connections.
type Settings struct {
	// FontSizePx is the root font size. Every dimension in the UI is
	// expressed in rem, so this scales the whole interface, not just text.
	FontSizePx int `json:"fontSizePx"`
	// DefaultPageSize and PaginationEnabled seed a newly opened table.
	DefaultPageSize   int  `json:"defaultPageSize"`
	PaginationEnabled bool `json:"paginationEnabled"`
	// RowCap bounds any single result, including with pagination off.
	RowCap int `json:"rowCap"`
	// TextCapChars cuts long text-shaped columns (text, json, nvarchar(max) …)
	// to this many characters. The cut is made by the server, in the emitted
	// SQL, so a table of megabyte documents is not hauled over the wire before
	// being shortened. 0 turns it off, which is the setting to reach for when
	// a query's whole point is the long values.
	TextCapChars int `json:"textCapChars"`
	// ShowSystemObjects reveals the server's own databases (mysql, tempdb,
	// pg_catalog and friends). Off by default: they bury the user's own
	// tables in the sidebar and the command palette.
	ShowSystemObjects bool `json:"showSystemObjects"`
	// AutoCount runs the background COUNT(*) after each page. Worth turning
	// off against very large tables where the count costs more than the page.
	AutoCount bool `json:"autoCount"`
	// ConfirmDestructive asks before deleting a connection.
	ConfirmDestructive bool `json:"confirmDestructive"`
}

// DefaultSettings is also the fallback for any field missing from disk.
func DefaultSettings() Settings {
	return Settings{
		FontSizePx:        16,
		DefaultPageSize:   100,
		PaginationEnabled: true,
		RowCap:            100_000,
		// ~1 kB, which is the figure DBeaver uses and the one that was asked
		// for. Enough to recognise a value, far too little to slow a browse.
		TextCapChars:       1024,
		ShowSystemObjects:  false,
		AutoCount:          true,
		ConfirmDestructive: true,
	}
}

// clamp keeps hand-edited or stale settings files from producing a UI that
// cannot be used to fix them — a 2px font would be unreadable, and a page
// size of zero would return nothing.
func (s Settings) clamp() Settings {
	d := DefaultSettings()
	if s.FontSizePx < 10 || s.FontSizePx > 28 {
		s.FontSizePx = d.FontSizePx
	}
	if s.DefaultPageSize < 1 || s.DefaultPageSize > 100_000 {
		s.DefaultPageSize = d.DefaultPageSize
	}
	if s.RowCap < 1 || s.RowCap > 1_000_000 {
		s.RowCap = d.RowCap
	}
	// 0 is meaningful here — it means "do not cap" — so only a negative or
	// absurd value falls back.
	if s.TextCapChars < 0 || s.TextCapChars > 1_000_000 {
		s.TextCapChars = d.TextCapChars
	}
	return s
}

// SettingsStore persists Settings. Safe for concurrent use.
type SettingsStore struct {
	mu    sync.RWMutex
	path  string
	value Settings
}

func OpenSettings(path string) (*SettingsStore, error) {
	s := &SettingsStore{path: path, value: DefaultSettings()}

	b, err := os.ReadFile(path)
	if os.IsNotExist(err) {
		return s, nil
	}
	if err != nil {
		return nil, fmt.Errorf("reading settings: %w", err)
	}

	// Unmarshalling onto the defaults means a field added in a later version
	// keeps its default rather than becoming a zero value.
	loaded := DefaultSettings()
	if err := json.Unmarshal(b, &loaded); err != nil {
		return nil, fmt.Errorf("parsing settings: %w", err)
	}
	s.value = loaded.clamp()
	return s, nil
}

func (s *SettingsStore) Get() Settings {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.value
}

func (s *SettingsStore) Set(v Settings) (Settings, error) {
	v = v.clamp()

	s.mu.Lock()
	defer s.mu.Unlock()
	prev := s.value
	s.value = v

	b, err := json.MarshalIndent(v, "", "  ")
	if err != nil {
		s.value = prev
		return prev, err
	}
	if err := writeFileAtomic(s.path, b); err != nil {
		s.value = prev
		return prev, err
	}
	return v, nil
}
