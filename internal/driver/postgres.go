package driver

import (
	"context"
	"database/sql"
	"fmt"
	"net"
	"net/url"
	"strconv"

	_ "github.com/jackc/pgx/v5/stdlib"
)

func init() { register(postgresDriver{}) }

type postgresDriver struct{}

func (postgresDriver) Kind() Kind { return KindPostgres }

func (postgresDriver) Caps() Capabilities {
	return Capabilities{
		DisplayName:          "PostgreSQL",
		ServerHostsDatabases: true,
		HasSchemas:           true,
		// Postgres cannot switch database on an open connection, so the
		// engine dials again per database. This is the reason its session
		// pool is keyed on (connection, database).
		DatabasePerConnection: true,
		SupportsFunctions:     true,
		DefaultPort:           5432,
	}
}

func (postgresDriver) SQLDriverName() string { return "pgx" }

func (postgresDriver) DSN(cfg ConnConfig, database string) (string, error) {
	if database == "" {
		database = cfg.Database
	}
	if database == "" {
		// Postgres requires a database to connect to at all; this is the
		// conventional bootstrap target for "show me what's on this server".
		database = "postgres"
	}
	host := cfg.Host
	if host == "" {
		host = "127.0.0.1"
	}
	port := cfg.Port
	if port == 0 {
		port = 5432
	}
	sslMode := cfg.SSLMode
	if sslMode == "" {
		sslMode = "prefer"
	}

	q := url.Values{}
	q.Set("sslmode", sslMode)
	for k, v := range cfg.Params {
		q.Set(k, v)
	}

	u := &url.URL{
		Scheme:   "postgres",
		User:     url.UserPassword(cfg.User, cfg.Password),
		Host:     net.JoinHostPort(host, strconv.Itoa(port)),
		Path:     "/" + database,
		RawQuery: q.Encode(),
	}
	return u.String(), nil
}

func (postgresDriver) QuoteIdent(ident string) string { return quoteWith(`"`, `"`, ident) }

// capText casts before cutting: left() takes text, and json/jsonb/xml are not
// text as far as postgres is concerned. The cast is free on a column that
// already is text.
func (postgresDriver) capText(expr string, n int) string {
	return fmt.Sprintf("left(%s::text, %d)", expr, n)
}

func (d postgresDriver) ListDatabases(ctx context.Context, db *sql.DB) ([]Database, error) {
	rows, err := db.QueryContext(ctx, `
		SELECT datname FROM pg_database
		WHERE datistemplate = false AND has_database_privilege(datname, 'CONNECT')
		ORDER BY datname`)
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

// ListObjects ignores the database argument: the connection is already bound
// to one database, and the engine guarantees it is the right one.
func (d postgresDriver) ListObjects(ctx context.Context, db *sql.DB, _ string) ([]SchemaObject, error) {
	var out []SchemaObject

	// reltuples is the planner's estimate, refreshed by ANALYZE. It is -1 on
	// a table that has never been analysed, which is filtered out below.
	rows, err := db.QueryContext(ctx, `
		SELECT n.nspname, c.relname,
		       CASE c.relkind WHEN 'v' THEN 'view' WHEN 'm' THEN 'view' ELSE 'table' END,
		       c.reltuples::bigint
		FROM pg_class c
		JOIN pg_namespace n ON n.oid = c.relnamespace
		WHERE c.relkind IN ('r','p','v','m','f')
		  AND n.nspname NOT IN ('pg_catalog','information_schema')
		  AND n.nspname NOT LIKE 'pg_toast%'
		  AND n.nspname NOT LIKE 'pg_temp%'
		ORDER BY n.nspname, c.relname`)
	if err != nil {
		return nil, err
	}
	if err := func() error {
		defer rows.Close()
		for rows.Next() {
			var schema, name, kind string
			var est int64
			if err := rows.Scan(&schema, &name, &kind, &est); err != nil {
				return err
			}
			o := SchemaObject{Schema: schema, Name: name, Type: ObjectTable}
			if kind == "view" {
				o.Type = ObjectView
			} else if est >= 0 {
				e := est
				o.RowEstimate = &e
			}
			out = append(out, o)
		}
		return rows.Err()
	}(); err != nil {
		return nil, err
	}

	// prokind was added in PG11 (2018); on older servers this query errors and
	// the routine list is simply omitted rather than failing the whole tree.
	rrows, err := db.QueryContext(ctx, `
		SELECT n.nspname, p.proname,
		       CASE p.prokind WHEN 'p' THEN 'procedure' ELSE 'function' END
		FROM pg_proc p
		JOIN pg_namespace n ON n.oid = p.pronamespace
		WHERE n.nspname NOT IN ('pg_catalog','information_schema')
		ORDER BY n.nspname, p.proname`)
	if err != nil {
		return out, nil
	}
	recs, err := scanStrings(rrows, 3)
	if err != nil {
		return out, nil
	}
	for _, r := range recs {
		t := ObjectFunction
		if r[2] == "procedure" {
			t = ObjectProcedure
		}
		out = append(out, SchemaObject{Schema: r[0], Name: r[1], Type: t})
	}
	return out, nil
}

func (d postgresDriver) ListColumns(ctx context.Context, db *sql.DB, ref ObjectRef) ([]Column, error) {
	// Reading pg_attribute directly rather than information_schema gives the
	// fully-qualified type via format_type (numeric(10,2), varchar(50)) rather
	// than the bare "numeric" that information_schema.data_type reports.
	rows, err := db.QueryContext(ctx, `
		SELECT a.attname,
		       format_type(a.atttypid, a.atttypmod),
		       NOT a.attnotnull,
		       pg_get_expr(ad.adbin, ad.adrelid),
		       a.attnum,
		       COALESCE(i.indisprimary, false)
		FROM pg_attribute a
		LEFT JOIN pg_attrdef ad ON ad.adrelid = a.attrelid AND ad.adnum = a.attnum
		LEFT JOIN pg_index i ON i.indrelid = a.attrelid AND i.indisprimary
		                     AND a.attnum = ANY(i.indkey)
		WHERE a.attrelid = $1::regclass AND a.attnum > 0 AND NOT a.attisdropped
		ORDER BY a.attnum`, d.target(ref))
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var out []Column
	for rows.Next() {
		var (
			name, typ string
			nullable  bool
			def       sql.NullString
			ord       int
			pk        bool
		)
		if err := rows.Scan(&name, &typ, &nullable, &def, &ord, &pk); err != nil {
			return nil, err
		}
		c := Column{Name: name, DataType: typ, Nullable: nullable, PrimaryKey: pk, Ordinal: ord}
		if def.Valid {
			v := def.String
			c.Default = &v
		}
		out = append(out, c)
	}
	return out, rows.Err()
}

// target omits the database: the connection is already bound to it, and a
// cross-database reference is not possible in postgres anyway.
func (d postgresDriver) target(ref ObjectRef) string {
	if ref.Schema == "" {
		return qualify(d, "public", ref.Name)
	}
	return qualify(d, ref.Schema, ref.Name)
}

func (d postgresDriver) BuildSelect(ref ObjectRef, opts ReadOptions, cols []Column) (string, error) {
	if ref.Name == "" {
		return "", fmt.Errorf("postgres: no table specified")
	}
	return buildStandardSelect(d, ref, opts, d.target(ref), cols), nil
}

func (d postgresDriver) BuildCount(ref ObjectRef, filter string) string {
	return "SELECT count(*) FROM " + d.target(ref) + whereClause(filter)
}
