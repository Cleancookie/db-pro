package driver

import (
	"context"
	"database/sql"
	"fmt"
	"net/url"
	"strings"

	_ "github.com/go-sql-driver/mysql"
)

func init() { register(mysqlDriver{}) }

// mysqlDriver serves both MySQL and MariaDB. The information_schema queries
// used here are common to both.
type mysqlDriver struct{}

func (mysqlDriver) Kind() Kind { return KindMySQL }

func (mysqlDriver) Caps() Capabilities {
	return Capabilities{
		DisplayName:          "MySQL / MariaDB",
		ServerHostsDatabases: true,
		// MySQL uses "schema" and "database" interchangeably — there is no
		// nesting, so the tree has no schema level.
		HasSchemas:            false,
		DatabasePerConnection: false,
		SupportsFunctions:     true,
		DefaultPort:           3306,
	}
}

func (mysqlDriver) SQLDriverName() string { return "mysql" }

func (mysqlDriver) DSN(cfg ConnConfig, database string) (string, error) {
	if database == "" {
		database = cfg.Database
	}
	host := cfg.Host
	if host == "" {
		host = "127.0.0.1"
	}
	port := cfg.Port
	if port == 0 {
		port = 3306
	}

	q := url.Values{}
	// parseTime makes DATE/DATETIME arrive as time.Time rather than []byte,
	// so scan.go can format them consistently across dialects.
	q.Set("parseTime", "true")
	q.Set("loc", "UTC")
	if cfg.SSLMode != "" {
		q.Set("tls", cfg.SSLMode)
	}
	for k, v := range cfg.Params {
		q.Set(k, v)
	}

	// The password is not URL-escaped here: go-sql-driver parses the DSN by
	// splitting on the last '@' before the address, so raw passwords are fine
	// and escaping them would corrupt any containing a '%'.
	return fmt.Sprintf("%s:%s@tcp(%s:%d)/%s?%s",
		cfg.User, cfg.Password, host, port, database, q.Encode()), nil
}

func (mysqlDriver) QuoteIdent(ident string) string { return quoteWith("`", "`", ident) }

// capText uses LEFT, which counts characters rather than bytes and coerces a
// JSON column to text on the way — the two things the cap needs.
func (mysqlDriver) capText(expr string, n int) string {
	return fmt.Sprintf("LEFT(%s, %d)", expr, n)
}

func (d mysqlDriver) ListDatabases(ctx context.Context, db *sql.DB) ([]Database, error) {
	rows, err := db.QueryContext(ctx,
		`SELECT schema_name FROM information_schema.schemata ORDER BY schema_name`)
	if err != nil {
		return nil, err
	}
	recs, err := scanStrings(rows, 1)
	if err != nil {
		return nil, err
	}
	out := make([]Database, 0, len(recs))
	for _, r := range recs {
		out = append(out, Database{Name: r[0]})
	}
	return out, nil
}

func (d mysqlDriver) ListObjects(ctx context.Context, db *sql.DB, database string) ([]SchemaObject, error) {
	var out []SchemaObject

	// table_rows is the storage engine's estimate — exact for MyISAM, a rough
	// guess for InnoDB. Surfaced as an estimate, never as a count.
	tables, err := d.listTables(ctx, db, database)
	if err != nil {
		return nil, err
	}
	out = append(out, tables...)

	rrows, err := db.QueryContext(ctx, `
		SELECT routine_name, routine_type
		FROM information_schema.routines
		WHERE routine_schema = ?
		ORDER BY routine_type, routine_name`, database)
	if err != nil {
		return nil, err
	}
	recs, err := scanStrings(rrows, 2)
	if err != nil {
		return nil, err
	}
	for _, r := range recs {
		t := ObjectFunction
		if strings.EqualFold(r[1], "PROCEDURE") {
			t = ObjectProcedure
		}
		out = append(out, SchemaObject{Name: r[0], Type: t})
	}
	return out, nil
}

// listTables reads tables and views, carrying the storage engine's row
// estimate where one is available. table_rows is exact for MyISAM and only a
// guess for InnoDB, so it is surfaced as an estimate and never as a count.
func (d mysqlDriver) listTables(ctx context.Context, db *sql.DB, database string) ([]SchemaObject, error) {
	rows, err := db.QueryContext(ctx, `
		SELECT table_name, table_type, IFNULL(table_rows, -1)
		FROM information_schema.tables
		WHERE table_schema = ?
		ORDER BY table_type, table_name`, database)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var out []SchemaObject
	for rows.Next() {
		var name, typ string
		var est int64
		if err := rows.Scan(&name, &typ, &est); err != nil {
			return nil, err
		}
		o := SchemaObject{Name: name, Type: ObjectTable}
		if strings.EqualFold(typ, "VIEW") {
			o.Type = ObjectView
		} else if est >= 0 {
			e := est
			o.RowEstimate = &e
		}
		out = append(out, o)
	}
	return out, rows.Err()
}

func (d mysqlDriver) ListColumns(ctx context.Context, db *sql.DB, ref ObjectRef) ([]Column, error) {
	rows, err := db.QueryContext(ctx, `
		SELECT column_name, column_type, is_nullable, column_default,
		       ordinal_position, column_key
		FROM information_schema.columns
		WHERE table_schema = ? AND table_name = ?
		ORDER BY ordinal_position`, ref.Database, ref.Name)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var out []Column
	for rows.Next() {
		var (
			name, typ, nullable, key string
			def                      sql.NullString
			ord                      int
		)
		if err := rows.Scan(&name, &typ, &nullable, &def, &ord, &key); err != nil {
			return nil, err
		}
		c := Column{
			Name:       name,
			DataType:   typ,
			Nullable:   strings.EqualFold(nullable, "YES"),
			PrimaryKey: key == "PRI",
			Ordinal:    ord,
		}
		if def.Valid {
			v := def.String
			c.Default = &v
		}
		out = append(out, c)
	}
	return out, rows.Err()
}

// target qualifies with the database, since MySQL can read across databases
// on a single connection and the UI's "current database" is only a default.
func (d mysqlDriver) target(ref ObjectRef) string {
	return qualify(d, ref.Database, ref.Name)
}

func (d mysqlDriver) BuildSelect(ref ObjectRef, opts ReadOptions, cols []Column) (string, error) {
	return buildStandardSelect(d, ref, opts, d.target(ref), cols), nil
}

func (d mysqlDriver) BuildCount(ref ObjectRef, filter string) string {
	return "SELECT count(*) FROM " + d.target(ref) + whereClause(filter)
}
