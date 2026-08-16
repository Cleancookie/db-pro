// Package api is the whole application surface. It knows nothing about Wails
// or HTTP; both transports are thin pass-throughs to the methods here.
package api

import (
	"context"
	"fmt"
	"strings"
	"time"

	"github.com/alexlaw/db-pro/internal/config"
	"github.com/alexlaw/db-pro/internal/driver"
	"github.com/alexlaw/db-pro/internal/engine"
)

// testConnectionTimeout bounds the "Test connection" button so a wrong host
// cannot leave the dialog spinning indefinitely.
const testConnectionTimeout = 20 * time.Second

// Service is the API. One instance per running app.
type Service struct {
	store  *config.Store
	engine *engine.Engine
}

func New(store *config.Store, eng *engine.Engine) *Service {
	return &Service{store: store, engine: eng}
}

func (s *Service) Shutdown() { s.engine.Shutdown() }

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

	dbs, err := sess.Driver.ListDatabases(ctx, sess.DB)
	if err != nil {
		return nil, fmt.Errorf("listing databases: %w", err)
	}
	out.Databases = dbs
	if out.DefaultDatabase == "" && len(dbs) > 0 {
		out.DefaultDatabase = dbs[0].Name
	}
	return out, nil
}

func (s *Service) Disconnect(connID string) { s.engine.Disconnect(connID) }

func (s *Service) ConnectedIDs() []string { return s.engine.Connected() }

// --- browsing ----------------------------------------------------------------------

func (s *Service) ListDatabases(ctx context.Context, connID string) ([]driver.Database, error) {
	sess, err := s.session(ctx, connID, "")
	if err != nil {
		return nil, err
	}
	if !sess.Driver.Caps().ServerHostsDatabases {
		return []driver.Database{{Name: "main"}}, nil
	}
	return sess.Driver.ListDatabases(ctx, sess.DB)
}

func (s *Service) ListObjects(ctx context.Context, connID, database string) ([]driver.SchemaObject, error) {
	sess, err := s.session(ctx, connID, database)
	if err != nil {
		return nil, err
	}
	objs, err := sess.Driver.ListObjects(ctx, sess.DB, database)
	if err != nil {
		return nil, err
	}
	if objs == nil {
		objs = []driver.SchemaObject{}
	}
	return objs, nil
}

func (s *Service) ListColumns(ctx context.Context, connID string, ref driver.ObjectRef) ([]driver.Column, error) {
	sess, err := s.session(ctx, connID, ref.Database)
	if err != nil {
		return nil, err
	}
	cols, err := sess.Driver.ListColumns(ctx, sess.DB, ref)
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

	cols, err := sess.Driver.ListColumns(ctx, sess.DB, req.Ref)
	if err != nil {
		// Column metadata is a nicety; a view the user can select from but not
		// introspect should still be browsable.
		cols = []driver.Column{}
	}

	page := req.Pagination.Page
	if page < 1 {
		page = 1
	}
	opts := driver.ReadOptions{
		Filter:  req.Filter,
		OrderBy: req.OrderBy,
	}
	if req.Pagination.Enabled {
		size := req.Pagination.PageSize
		if size <= 0 {
			size = 100
		}
		// One extra row, trimmed before returning, is how HasMore is known.
		opts.Limit = size + 1
		opts.Offset = (page - 1) * size
	}

	query, err := sess.Driver.BuildSelect(req.Ref, opts, cols)
	if err != nil {
		return nil, err
	}
	rs, err := driver.RunQuery(ctx, sess.DB, query, driver.HardRowCap)
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
	var n int64
	q := sess.Driver.BuildCount(req.Ref, req.Filter)
	if err := sess.DB.QueryRowContext(ctx, q).Scan(&n); err != nil {
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
	if returnsRows(stmt) {
		return driver.RunQuery(ctx, sess.DB, stmt, req.MaxRows)
	}
	return driver.Exec(ctx, sess.DB, stmt)
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
