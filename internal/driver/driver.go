// Package driver defines the dialect abstraction that the rest of db-pro is
// written against. Each supported database implements Driver.
//
// The interface is introspection-shaped, not SQL-shaped: it hands back
// []Database, []SchemaObject and []Column rather than raw rows, because the
// four dialects disagree fundamentally about how those questions are asked.
// See ARCHITECTURE.md for the table of asymmetries this absorbs.
package driver

import (
	"context"
	"database/sql"
	"fmt"
	"sort"
	"strings"
)

// Kind identifies a dialect. These strings are persisted in connections.json
// and sent to the frontend, so they are part of the app's public surface.
type Kind string

const (
	KindMySQL    Kind = "mysql" // also serves MariaDB
	KindPostgres Kind = "postgres"
	KindMSSQL    Kind = "mssql"
	KindSQLite   Kind = "sqlite"
)

// ConnConfig is everything needed to open a connection. Database may be
// overridden per-request when the dialect supports switching.
type ConnConfig struct {
	Kind     Kind              `json:"kind"`
	Host     string            `json:"host"`
	Port     int               `json:"port"`
	User     string            `json:"user"`
	Password string            `json:"password"`
	Database string            `json:"database"`
	File     string            `json:"file"`    // SQLite only
	SSLMode  string            `json:"sslMode"` // postgres: disable/require/verify-full; mysql: tls param
	Params   map[string]string `json:"params"`  // escape hatch, appended to the DSN
}

// Capabilities lets the UI adapt without switching on Kind.
type Capabilities struct {
	// ServerHostsDatabases is false for SQLite, where the connection *is* the
	// database and the database list is meaningless.
	ServerHostsDatabases bool `json:"serverHostsDatabases"`
	// HasSchemas is true where objects live in a schema within a database
	// (postgres, mssql) and false where the database is the schema (mysql,
	// sqlite). Drives whether the tree renders a schema level.
	HasSchemas bool `json:"hasSchemas"`
	// DatabasePerConnection is true for postgres, where you cannot switch
	// database on an open connection and the engine must dial again.
	DatabasePerConnection bool `json:"databasePerConnection"`
	// SupportsFunctions is false for SQLite, which has no catalog of them.
	SupportsFunctions bool   `json:"supportsFunctions"`
	DefaultPort       int    `json:"defaultPort"`
	DisplayName       string `json:"displayName"`
}

type Database struct {
	Name string `json:"name"`
}

type ObjectType string

const (
	ObjectTable     ObjectType = "table"
	ObjectView      ObjectType = "view"
	ObjectFunction  ObjectType = "function"
	ObjectProcedure ObjectType = "procedure"
)

// SchemaObject is one entry in the object tree.
type SchemaObject struct {
	Schema string     `json:"schema"` // empty where the dialect has no schemas
	Name   string     `json:"name"`
	Type   ObjectType `json:"type"`
	// RowEstimate is the planner's estimate where one is cheaply available.
	// It is an estimate and is labelled as such in the UI; nil means unknown.
	RowEstimate *int64 `json:"rowEstimate,omitempty"`
}

type Column struct {
	Name       string  `json:"name"`
	DataType   string  `json:"dataType"`
	Nullable   bool    `json:"nullable"`
	PrimaryKey bool    `json:"primaryKey"`
	Default    *string `json:"default,omitempty"`
	Ordinal    int     `json:"ordinal"`
}

// ObjectRef identifies a table or view to read from.
type ObjectRef struct {
	Database string `json:"database"`
	Schema   string `json:"schema"`
	Name     string `json:"name"`
}

type Sort struct {
	Column string `json:"column"`
	Desc   bool   `json:"desc"`
}

// ReadOptions describes one page of a table browse.
type ReadOptions struct {
	// Filter is a raw SQL fragment placed directly after WHERE. It is not
	// parsed, escaped or validated — see docs/adr/0002-raw-sql-filter.md.
	Filter  string `json:"filter"`
	OrderBy []Sort `json:"orderBy"`
	// Limit of 0 means "no LIMIT clause" — pagination switched off. The engine
	// still applies a hard row cap so this cannot exhaust memory.
	Limit  int `json:"limit"`
	Offset int `json:"offset"`
}

type ResultColumn struct {
	Name string `json:"name"`
	// DBType is the database's own type name (VARCHAR, int4, …) where the
	// driver reports one. Used by the grid for alignment and formatting.
	DBType string `json:"dbType"`
}

// ResultSet is a page of rows in a JSON-safe form. Values are limited to
// string, float64, bool and nil — see scan.go.
type ResultSet struct {
	Columns   []ResultColumn `json:"columns"`
	Rows      [][]any        `json:"rows"`
	Truncated bool           `json:"truncated"` // hard row cap trimmed the result
	ElapsedMS int64          `json:"elapsedMs"`
	// RowsAffected is set for statements that are not queries (INSERT/UPDATE…).
	RowsAffected *int64 `json:"rowsAffected,omitempty"`
	Query        string `json:"query"` // the SQL actually executed, for the UI
}

// Driver is the per-dialect contract. Implementations must be stateless and
// safe for concurrent use — they receive the *sql.DB on every call.
type Driver interface {
	Kind() Kind
	Caps() Capabilities

	// SQLDriverName is the name registered with database/sql.
	SQLDriverName() string
	// DSN builds a connection string. database overrides cfg.Database when
	// non-empty, which is how postgres reaches a second database.
	DSN(cfg ConnConfig, database string) (string, error)

	ListDatabases(ctx context.Context, db *sql.DB) ([]Database, error)
	// ListObjects returns tables, views, functions and procedures. database is
	// passed because MySQL and MSSQL can query across databases on one
	// connection; postgres and sqlite ignore it.
	ListObjects(ctx context.Context, db *sql.DB, database string) ([]SchemaObject, error)
	ListColumns(ctx context.Context, db *sql.DB, ref ObjectRef) ([]Column, error)

	// QuoteIdent quotes a single identifier for this dialect.
	QuoteIdent(ident string) string
	// BuildSelect assembles the row-browse query. cols is supplied so dialects
	// that need a deterministic sort for pagination (mssql) can pick one.
	BuildSelect(ref ObjectRef, opts ReadOptions, cols []Column) (string, error)
	BuildCount(ref ObjectRef, filter string) string
}

var registry = map[Kind]Driver{}

func register(d Driver) { registry[d.Kind()] = d }

// Get returns the driver for a kind.
func Get(k Kind) (Driver, error) {
	d, ok := registry[k]
	if !ok {
		return nil, fmt.Errorf("unsupported database kind %q", k)
	}
	return d, nil
}

// All returns every registered driver's capabilities, keyed by kind. The
// frontend uses this to build the "new connection" form without hardcoding
// dialect knowledge.
func All() map[Kind]Capabilities {
	out := make(map[Kind]Capabilities, len(registry))
	for k, d := range registry {
		out[k] = d.Caps()
	}
	return out
}

// Kinds returns the registered kinds in a stable order.
func Kinds() []Kind {
	ks := make([]Kind, 0, len(registry))
	for k := range registry {
		ks = append(ks, k)
	}
	sort.Slice(ks, func(i, j int) bool { return ks[i] < ks[j] })
	return ks
}

// --- shared query-building helpers -------------------------------------------------

// quoteWith quotes an identifier by doubling any occurrence of the closing
// character, which is the correct escape for every dialect we support: a
// backtick is doubled in MySQL, a double-quote in postgres and sqlite, and a
// closing square bracket in MSSQL.
func quoteWith(open, close, ident string) string {
	return open + strings.ReplaceAll(ident, close, close+close) + close
}

// qualify joins the non-empty parts of a reference with dots, quoting each.
func qualify(d Driver, parts ...string) string {
	out := make([]string, 0, len(parts))
	for _, p := range parts {
		if p != "" {
			out = append(out, d.QuoteIdent(p))
		}
	}
	return strings.Join(out, ".")
}

// whereClause renders the raw user filter. The fragment is interpolated
// verbatim by design; see docs/adr/0002-raw-sql-filter.md.
func whereClause(filter string) string {
	f := strings.TrimSpace(filter)
	if f == "" {
		return ""
	}
	// Tolerate the user typing the keyword themselves, which is a common
	// reflex when moving over from a tool that expects the full clause.
	if len(f) >= 5 && strings.EqualFold(f[:5], "where") && (len(f) == 5 || isSpace(f[5])) {
		f = strings.TrimSpace(f[5:])
		if f == "" {
			return ""
		}
	}
	return " WHERE " + f
}

func isSpace(b byte) bool {
	return b == ' ' || b == '\t' || b == '\n' || b == '\r'
}

// orderByClause renders sorts, quoting each column. Unlike the filter, sort
// columns are identifiers and are always quoted.
func orderByClause(d Driver, sorts []Sort) string {
	if len(sorts) == 0 {
		return ""
	}
	parts := make([]string, 0, len(sorts))
	for _, s := range sorts {
		if strings.TrimSpace(s.Column) == "" {
			continue
		}
		dir := " ASC"
		if s.Desc {
			dir = " DESC"
		}
		parts = append(parts, d.QuoteIdent(s.Column)+dir)
	}
	if len(parts) == 0 {
		return ""
	}
	return " ORDER BY " + strings.Join(parts, ", ")
}

// limitOffsetClause is the MySQL/Postgres/SQLite form. MSSQL overrides this.
func limitOffsetClause(opts ReadOptions) string {
	var b strings.Builder
	if opts.Limit > 0 {
		fmt.Fprintf(&b, " LIMIT %d", opts.Limit)
		if opts.Offset > 0 {
			fmt.Fprintf(&b, " OFFSET %d", opts.Offset)
		}
	} else if opts.Offset > 0 {
		// An OFFSET with no LIMIT is only legal alongside one in MySQL, so
		// emit the maximum rather than special-casing per dialect.
		fmt.Fprintf(&b, " LIMIT %d OFFSET %d", int64(1)<<62, opts.Offset)
	}
	return b.String()
}

// buildStandardSelect is shared by every dialect using LIMIT/OFFSET.
func buildStandardSelect(d Driver, ref ObjectRef, opts ReadOptions, target string) string {
	return "SELECT * FROM " + target +
		whereClause(opts.Filter) +
		orderByClause(d, opts.OrderBy) +
		limitOffsetClause(opts)
}
