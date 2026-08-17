// Package api is the whole application surface. It knows nothing about Wails
// or HTTP; both transports are thin pass-throughs to the methods here.
package api

import (
	"context"
	"fmt"
	"strings"
	"time"

	"github.com/alexlaw/db-pro/internal/activity"
	"github.com/alexlaw/db-pro/internal/config"
	"github.com/alexlaw/db-pro/internal/driver"
	"github.com/alexlaw/db-pro/internal/engine"
)

// testConnectionTimeout bounds the "Test connection" button so a wrong host
// cannot leave the dialog spinning indefinitely.
const testConnectionTimeout = 20 * time.Second

// Service is the API. One instance per running app.
type Service struct {
	store    *config.Store
	settings *config.SettingsStore
	engine   *engine.Engine
	activity *activity.Registry
}

func New(store *config.Store, settings *config.SettingsStore, eng *engine.Engine, act *activity.Registry) *Service {
	return &Service{store: store, settings: settings, engine: eng, activity: act}
}

func (s *Service) Shutdown() { s.engine.Shutdown() }

// --- settings ----------------------------------------------------------------------

func (s *Service) GetSettings() config.Settings { return s.settings.Get() }

func (s *Service) SaveSettings(v config.Settings) (config.Settings, error) {
	return s.settings.Set(v)
}

// --- activity ----------------------------------------------------------------------

// SessionInfo is one live connection to one database.
type SessionInfo struct {
	ConnectionID string `json:"connectionId"`
	Database     string `json:"database"`
	OpenConns    int    `json:"openConns"`
	InUse        int    `json:"inUse"`
	Idle         int    `json:"idle"`
}

// ActivityResult is everything the activity page shows: what the app has open
// and what it is currently running.
type ActivityResult struct {
	Queries  []activity.Info `json:"queries"`
	Sessions []SessionInfo   `json:"sessions"`
}

func (s *Service) Activity() ActivityResult {
	sessions := s.engine.Sessions()
	out := ActivityResult{
		Queries:  s.activity.List(),
		Sessions: make([]SessionInfo, 0, len(sessions)),
	}
	for _, sess := range sessions {
		out.Sessions = append(out.Sessions, SessionInfo{
			ConnectionID: sess.ConnectionID,
			Database:     sess.Database,
			OpenConns:    sess.OpenConns,
			InUse:        sess.InUse,
			Idle:         sess.Idle,
		})
	}
	return out
}

// CancelQuery stops one running query.
func (s *Service) CancelQuery(id string) { s.activity.Cancel(id) }

// --- connection management ---------------------------------------------------------

// Drivers describes every supported dialect, so the frontend can build the
// connection form without hardcoding dialect knowledge.
func (s *Service) Drivers() map[driver.Kind]driver.Capabilities { return driver.All() }

func (s *Service) ListConnections() []config.Connection { return s.store.List() }

// SaveConnectionRequest creates when Connection.ID is empty, otherwise
// updates. Password is nil on an edit that did not touch the password field,
// which leaves the stored one alone.
type SaveConnectionRequest struct {
	Connection config.Connection `json:"connection"`
	Password   *string           `json:"password"`
}

func (s *Service) SaveConnection(req SaveConnectionRequest) (config.Connection, error) {
	if req.Connection.ID == "" {
		pw := ""
		if req.Password != nil {
			pw = *req.Password
		}
		return s.store.Create(req.Connection, pw)
	}
	return s.store.Update(req.Connection, req.Password)
}

func (s *Service) DeleteConnection(id string) error {
	// Drop live sessions first — leaving them open would keep using
	// credentials the user has just deleted.
	s.engine.Disconnect(id)
	return s.store.Delete(id)
}

// TestConnection dials without saving, so the dialog can verify before commit.
func (s *Service) TestConnection(req SaveConnectionRequest) error {
	c := req.Connection
	pw := ""
	if req.Password != nil {
		pw = *req.Password
	} else if c.ID != "" {
		// Editing an existing connection without retyping the password.
		stored, err := s.store.Password(c.ID)
		if err != nil {
			return err
		}
		pw = stored
	}
	cfg := driver.ConnConfig{
		Kind: c.Kind, Host: c.Host, Port: c.Port, User: c.User, Password: pw,
		Database: c.Database, File: c.File, SSLMode: c.SSLMode, Params: c.Params,
	}
	ctx, cancel := context.WithTimeout(context.Background(), testConnectionTimeout)
	defer cancel()
	return s.engine.Test(ctx, cfg)
}

// ConnectResult is everything the UI needs to populate the sidebar after a
// successful connect.
type ConnectResult struct {
	Capabilities    driver.Capabilities `json:"capabilities"`
	Databases       []driver.Database   `json:"databases"`
	DefaultDatabase string              `json:"defaultDatabase"`
}

func (s *Service) Connect(ctx context.Context, connID string) (*ConnectResult, error) {
	conn, err := s.store.Get(connID)
	if err != nil {
		return nil, err
	}
	d, err := driver.Get(conn.Kind)
	if err != nil {
		return nil, err
	}
	caps := d.Caps()

	sess, err := s.session(ctx, connID, conn.Database)
	if err != nil {
		return nil, err
	}

	out := &ConnectResult{Capabilities: caps, DefaultDatabase: conn.Database}
	if !caps.ServerHostsDatabases {
		// SQLite: the file is the database. "main" keeps the shape uniform.
		out.Databases = []driver.Database{{Name: "main"}}
		out.DefaultDatabase = "main"
		return out, nil
	}

	qctx, done := s.activity.Begin(ctx, connID, conn.Database, activity.KindIntrospect, "list databases")
	dbs, err := sess.Driver.ListDatabases(qctx, sess.DB)
	done()
	if err != nil {
		return nil, fmt.Errorf("listing databases: %w", err)
	}
	out.Databases = s.filterDatabases(conn.Kind, dbs)
	if out.DefaultDatabase == "" && len(out.Databases) > 0 {
		out.DefaultDatabase = out.Databases[0].Name
	}
	return out, nil
}

func (s *Service) Disconnect(connID string) {
	// Cancel first: closing a pool with queries still running leaves those
	// goroutines blocked until the server notices the socket has gone.
	s.activity.CancelConnection(connID)
	s.engine.Disconnect(connID)
}

func (s *Service) ConnectedIDs() []string { return s.engine.Connected() }

// filterDatabases hides the server's own databases unless the user has asked
// to see them.
func (s *Service) filterDatabases(kind driver.Kind, dbs []driver.Database) []driver.Database {
	if s.settings.Get().ShowSystemObjects {
		return dbs
	}
	out := make([]driver.Database, 0, len(dbs))
	for _, d := range dbs {
		if !driver.IsSystemDatabase(kind, d.Name) {
			out = append(out, d)
		}
	}
	// Never hide everything: a server with only system databases should still
	// show them rather than presenting an empty, unexplained list.
	if len(out) == 0 {
		return dbs
	}
	return out
}

// --- browsing ----------------------------------------------------------------------

func (s *Service) ListDatabases(ctx context.Context, connID string) ([]driver.Database, error) {
	sess, err := s.session(ctx, connID, "")
	if err != nil {
		return nil, err
	}
	if !sess.Driver.Caps().ServerHostsDatabases {
		return []driver.Database{{Name: "main"}}, nil
	}

	qctx, done := s.activity.Begin(ctx, connID, "", activity.KindIntrospect, "list databases")
	defer done()
	dbs, err := sess.Driver.ListDatabases(qctx, sess.DB)
	if err != nil {
		return nil, err
	}
	return s.filterDatabases(sess.Driver.Kind(), dbs), nil
}

func (s *Service) ListObjects(ctx context.Context, connID, database string) ([]driver.SchemaObject, error) {
	sess, err := s.session(ctx, connID, database)
	if err != nil {
		return nil, err
	}

	qctx, done := s.activity.Begin(ctx, connID, database, activity.KindIntrospect, "list objects")
	defer done()
	objs, err := sess.Driver.ListObjects(qctx, sess.DB, database)
	if err != nil {
		return nil, err
	}

	showAll := s.settings.Get().ShowSystemObjects
	kind := sess.Driver.Kind()
	out := make([]driver.SchemaObject, 0, len(objs))
	for _, o := range objs {
		if showAll || !driver.IsSystemSchema(kind, o.Schema) {
			out = append(out, o)
		}
	}
	return out, nil
}

func (s *Service) ListColumns(ctx context.Context, connID string, ref driver.ObjectRef) ([]driver.Column, error) {
	sess, err := s.session(ctx, connID, ref.Database)
	if err != nil {
		return nil, err
	}

	qctx, done := s.activity.Begin(ctx, connID, ref.Database, activity.KindIntrospect, "describe "+ref.Name)
	defer done()
	cols, err := sess.Driver.ListColumns(qctx, sess.DB, ref)
	if err != nil {
		return nil, err
	}
	if cols == nil {
		cols = []driver.Column{}
	}
	return cols, nil
}

// Pagination carries the three modes the UI offers: paged, or off entirely.
type Pagination struct {
	// Enabled false means no LIMIT is emitted. driver.HardRowCap still applies.
	Enabled  bool `json:"enabled"`
	Page     int  `json:"page"` // 1-based
	PageSize int  `json:"pageSize"`
}

type ReadRowsRequest struct {
	ConnectionID string           `json:"connectionId"`
	Ref          driver.ObjectRef `json:"ref"`
	// Filter is raw SQL appended after WHERE — see docs/adr/0002-raw-sql-filter.md.
	Filter     string        `json:"filter"`
	OrderBy    []driver.Sort `json:"orderBy"`
	Pagination Pagination    `json:"pagination"`
}

type ReadRowsResult struct {
	Result  *driver.ResultSet `json:"result"`
	Columns []driver.Column   `json:"columns"`
	Page    int               `json:"page"`
	// HasMore is derived by asking for one row more than the page size, which
	// tells the UI whether to enable "next page" without a COUNT(*).
	HasMore bool `json:"hasMore"`
}

func (s *Service) ReadRows(ctx context.Context, req ReadRowsRequest) (*ReadRowsResult, error) {
	sess, err := s.session(ctx, req.ConnectionID, req.Ref.Database)
	if err != nil {
		return nil, err
	}

	cols, err := s.ListColumns(ctx, req.ConnectionID, req.Ref)
	if err != nil {
		// Column metadata is a nicety; a view the user can select from but not
		// introspect should still be browsable.
		cols = []driver.Column{}
	}

	settings := s.settings.Get()
	page := req.Pagination.Page
	if page < 1 {
		page = 1
	}
	opts := driver.ReadOptions{
		Filter:  req.Filter,
		OrderBy: req.OrderBy,
		TextCap: settings.TextCapChars,
	}
	if req.Pagination.Enabled {
		size := req.Pagination.PageSize
		if size <= 0 {
			size = settings.DefaultPageSize
		}
		// One extra row, trimmed before returning, is how HasMore is known.
		opts.Limit = size + 1
		opts.Offset = (page - 1) * size
	}

	query, err := sess.Driver.BuildSelect(req.Ref, opts, cols)
	if err != nil {
		return nil, err
	}

	qctx, done := s.activity.Begin(ctx, req.ConnectionID, req.Ref.Database, activity.KindBrowse, query)
	defer done()
	rs, err := driver.RunQuery(qctx, sess.DB, query, driver.QueryOptions{
		RowCap:  settings.RowCap,
		TextCap: settings.TextCapChars,
	})
	if err != nil {
		return nil, err
	}

	out := &ReadRowsResult{Result: rs, Columns: cols, Page: page}
	if req.Pagination.Enabled {
		size := opts.Limit - 1
		if len(rs.Rows) > size {
			out.HasMore = true
			rs.Rows = rs.Rows[:size]
		}
	}
	return out, nil
}

// ReadCellRequest asks for one cell in full — the escape hatch from the text
// cap, for the value the user has actually stopped to look at.
//
// The cell is addressed in the coordinates the grid is already displaying: the
// filter and sort that produced the page, plus the row's absolute offset within
// that result. Re-running the same query for one column of one row works on
// any table or view, with or without a primary key, which a key-based lookup
// would not. The trade is that the row is identified by position, so on a
// table being written to concurrently — or ordered only by whatever the server
// felt like — the value fetched may not be the one that was on screen.
type ReadCellRequest struct {
	ConnectionID string           `json:"connectionId"`
	Ref          driver.ObjectRef `json:"ref"`
	Column       string           `json:"column"`
	// Filter and OrderBy must be the ones the page was read with, or the
	// offset addresses a different row.
	Filter  string        `json:"filter"`
	OrderBy []driver.Sort `json:"orderBy"`
	// RowOffset is 0-based and absolute, not relative to the page.
	RowOffset int `json:"rowOffset"`
}

func (s *Service) ReadCell(ctx context.Context, req ReadCellRequest) (*driver.Cell, error) {
	if strings.TrimSpace(req.Column) == "" {
		return nil, fmt.Errorf("no column given")
	}
	if req.RowOffset < 0 {
		return nil, fmt.Errorf("row offset must not be negative")
	}
	sess, err := s.session(ctx, req.ConnectionID, req.Ref.Database)
	if err != nil {
		return nil, err
	}

	// Columns are needed for the same reason as in ReadRows: mssql pages with
	// OFFSET/FETCH and has to invent an ORDER BY, and it must invent the same
	// one here or the offset points at a different row.
	cols, err := s.ListColumns(ctx, req.ConnectionID, req.Ref)
	if err != nil {
		cols = []driver.Column{}
	}
	if len(cols) > 0 && !hasColumn(cols, req.Column) {
		return nil, fmt.Errorf("no column %q on %s", req.Column, req.Ref.Name)
	}

	// TextCap is deliberately absent: this call exists to defeat it.
	query, err := sess.Driver.BuildSelect(req.Ref, driver.ReadOptions{
		Filter:  req.Filter,
		OrderBy: req.OrderBy,
		Select:  []string{req.Column},
		Limit:   1,
		Offset:  req.RowOffset,
	}, cols)
	if err != nil {
		return nil, err
	}

	qctx, done := s.activity.Begin(ctx, req.ConnectionID, req.Ref.Database, activity.KindBrowse, query)
	defer done()
	return driver.ReadCell(qctx, sess.DB, query, driver.MaxCellBytes)
}

func hasColumn(cols []driver.Column, name string) bool {
	for _, c := range cols {
		if c.Name == name {
			return true
		}
	}
	return false
}

type CountRowsRequest struct {
	ConnectionID string           `json:"connectionId"`
	Ref          driver.ObjectRef `json:"ref"`
	Filter       string           `json:"filter"`
}

// CountRows is deliberately separate from ReadRows: an exact COUNT(*) is slow
// on a large table and must not sit on the hot path of every page turn. The UI
// renders the page first and fills the total in behind it.
func (s *Service) CountRows(ctx context.Context, req CountRowsRequest) (int64, error) {
	sess, err := s.session(ctx, req.ConnectionID, req.Ref.Database)
	if err != nil {
		return 0, err
	}
	q := sess.Driver.BuildCount(req.Ref, req.Filter)
	qctx, done := s.activity.Begin(ctx, req.ConnectionID, req.Ref.Database, activity.KindCount, q)
	defer done()

	var n int64
	if err := sess.DB.QueryRowContext(qctx, q).Scan(&n); err != nil {
		return 0, err
	}
	return n, nil
}

// --- SQL editor --------------------------------------------------------------------

type RunSQLRequest struct {
	ConnectionID string `json:"connectionId"`
	Database     string `json:"database"`
	SQL          string `json:"sql"`
	// MaxRows caps the result; 0 uses driver.HardRowCap.
	MaxRows int `json:"maxRows"`
}

func (s *Service) RunSQL(ctx context.Context, req RunSQLRequest) (*driver.ResultSet, error) {
	stmt := strings.TrimSpace(req.SQL)
	if stmt == "" {
		return nil, fmt.Errorf("nothing to run")
	}
	sess, err := s.session(ctx, req.ConnectionID, req.Database)
	if err != nil {
		return nil, err
	}

	qctx, done := s.activity.Begin(ctx, req.ConnectionID, req.Database, activity.KindQuery, stmt)
	defer done()

	settings := s.settings.Get()
	maxRows := req.MaxRows
	if maxRows <= 0 {
		maxRows = settings.RowCap
	}
	if returnsRows(stmt) {
		// The editor's SQL is the user's own text and must not be rewritten,
		// so the text cap here is applied while scanning. It keeps the grid
		// responsive; it cannot keep the bytes off the wire.
		return driver.RunQuery(qctx, sess.DB, stmt, driver.QueryOptions{
			RowCap:  maxRows,
			TextCap: settings.TextCapChars,
		})
	}
	return driver.Exec(qctx, sess.DB, stmt)
}

// returnsRows guesses from the leading keyword whether to use Query or Exec.
// Guessing is unavoidable without a per-dialect parser, and guessing wrong is
// cheap: an Exec'd SELECT returns no rows, and a Query'd INSERT still runs.
func returnsRows(stmt string) bool {
	stmt = trimLeadingNoise(stmt)
	word := stmt
	if i := strings.IndexAny(word, " \t\n\r(;"); i >= 0 {
		word = word[:i]
	}
	switch strings.ToUpper(word) {
	case "SELECT", "WITH", "SHOW", "PRAGMA", "EXPLAIN", "DESCRIBE", "DESC", "VALUES", "TABLE", "CALL":
		return true
	}
	return false
}

// trimLeadingNoise strips whitespace, comments and opening parentheses from
// the front of a statement, so the classifier sees the first real keyword in
// "-- note\nSELECT 1", "/* note */ SELECT 1" and "(SELECT 1) UNION …" alike.
func trimLeadingNoise(s string) string {
	for {
		s = strings.TrimSpace(s)
		switch {
		case strings.HasPrefix(s, "--"):
			nl := strings.IndexByte(s, '\n')
			if nl < 0 {
				return ""
			}
			s = s[nl+1:]
		case strings.HasPrefix(s, "/*"):
			end := strings.Index(s, "*/")
			if end < 0 {
				return ""
			}
			s = s[end+2:]
		case strings.HasPrefix(s, "("):
			s = s[1:]
		default:
			return s
		}
	}
}

// --- internals ---------------------------------------------------------------------

// session resolves a live connection. For dialects that reach other databases
// through qualified names, database is left off the session key so a single
// connection serves the whole server.
func (s *Service) session(ctx context.Context, connID, database string) (*engine.Session, error) {
	cfg, err := s.store.DriverConfig(connID)
	if err != nil {
		return nil, err
	}
	d, err := driver.Get(cfg.Kind)
	if err != nil {
		return nil, err
	}
	target := ""
	if d.Caps().DatabasePerConnection {
		target = database
	}
	return s.engine.Acquire(ctx, connID, cfg, target)
}
