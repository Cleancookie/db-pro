package driver

import (
	"context"
	"database/sql"
	"fmt"
	"net/url"
	"strings"

	_ "modernc.org/sqlite" // pure-Go SQLite; no cgo, so cross-compilation works
)

func init() { register(sqliteDriver{}) }

type sqliteDriver struct{}

func (sqliteDriver) Kind() Kind { return KindSQLite }

func (sqliteDriver) Caps() Capabilities {
	return Capabilities{
		DisplayName: "SQLite",
		// A SQLite connection *is* the database — there is no server hosting
		// a list of them, so the UI skips the database level entirely.
		ServerHostsDatabases: false,
		HasSchemas:           false,
		// SQLite has no queryable catalog of user functions.
		SupportsFunctions: false,
	}
}

func (sqliteDriver) SQLDriverName() string { return "sqlite" }

func (sqliteDriver) DSN(cfg ConnConfig, _ string) (string, error) {
	if strings.TrimSpace(cfg.File) == "" {
		return "", fmt.Errorf("sqlite: no database file specified")
	}
	// A busy timeout stops routine "database is locked" errors when something
	// else holds a write lock; foreign_keys matches what most apps expect.
	q := url.Values{}
	q.Add("_pragma", "busy_timeout(5000)")
	q.Add("_pragma", "foreign_keys(1)")
	for k, v := range cfg.Params {
		q.Add(k, v)
	}
	return "file:" + cfg.File + "?" + q.Encode(), nil
}

func (sqliteDriver) QuoteIdent(ident string) string { return quoteWith(`"`, `"`, ident) }

// capText uses substr, which counts characters on a TEXT value. SQLite is
// dynamically typed, so a cap only ever reaches columns whose *declared* type
// is text-shaped — see isLongTextType.
func (sqliteDriver) capText(expr string, n int) string {
	return fmt.Sprintf("substr(%s, 1, %d)", expr, n)
}

func (d sqliteDriver) ListDatabases(_ context.Context, _ *sql.DB) ([]Database, error) {
	// "main" is the attached-database name every SQLite file has. Returned so
	// the rest of the app can treat all dialects uniformly.
	return []Database{{Name: "main"}}, nil
}

func (d sqliteDriver) ListObjects(ctx context.Context, db *sql.DB, _ string) ([]SchemaObject, error) {
	rows, err := db.QueryContext(ctx, `
		SELECT name, type
		FROM sqlite_master
		WHERE type IN ('table','view') AND name NOT LIKE 'sqlite_%'
		ORDER BY type, name`)
	if err != nil {
		return nil, err
	}
	recs, err := scanStrings(rows, 2)
	if err != nil {
		return nil, err
	}
	out := make([]SchemaObject, 0, len(recs))
	for _, r := range recs {
		t := ObjectTable
		if r[1] == "view" {
			t = ObjectView
		}
		out = append(out, SchemaObject{Name: r[0], Type: t})
	}
	return out, nil
}

func (d sqliteDriver) ListColumns(ctx context.Context, db *sql.DB, ref ObjectRef) ([]Column, error) {
	// pragma_table_info is the table-valued form of PRAGMA table_info, which
	// lets the table name be bound rather than interpolated.
	rows, err := db.QueryContext(ctx, `
		SELECT cid, name, type, "notnull", dflt_value, pk
		FROM pragma_table_info(?)
		ORDER BY cid`, ref.Name)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var out []Column
	for rows.Next() {
		var (
			cid, notNull, pk int
			name, typ        string
			def              sql.NullString
		)
		if err := rows.Scan(&cid, &name, &typ, &notNull, &def, &pk); err != nil {
			return nil, err
		}
		c := Column{
			Name:       name,
			DataType:   typ,
			Nullable:   notNull == 0,
			PrimaryKey: pk > 0,
			Ordinal:    cid + 1,
		}
		if def.Valid {
			v := def.String
			c.Default = &v
		}
		out = append(out, c)
	}
	return out, rows.Err()
}

func (d sqliteDriver) target(ref ObjectRef) string {
	return qualify(d, ref.Name)
}

func (d sqliteDriver) BuildSelect(ref ObjectRef, opts ReadOptions, cols []Column) (string, error) {
	return buildStandardSelect(d, ref, opts, d.target(ref), cols), nil
}

func (d sqliteDriver) BuildCount(ref ObjectRef, filter string) string {
	return "SELECT count(*) FROM " + d.target(ref) + whereClause(filter)
}
