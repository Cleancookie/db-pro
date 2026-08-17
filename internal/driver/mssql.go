package driver

import (
	"context"
	"database/sql"
	"fmt"
	"net"
	"net/url"
	"strconv"
	"strings"

	_ "github.com/microsoft/go-mssqldb"
)

func init() { register(mssqlDriver{}) }

type mssqlDriver struct{}

func (mssqlDriver) Kind() Kind { return KindMSSQL }

func (mssqlDriver) Caps() Capabilities {
	return Capabilities{
		DisplayName:          "SQL Server",
		ServerHostsDatabases: true,
		HasSchemas:           true,
		// USE works on an open connection, and three-part names let a single
		// connection read any database on the server.
		DatabasePerConnection: false,
		SupportsFunctions:     true,
		DefaultPort:           1433,
	}
}

func (mssqlDriver) SQLDriverName() string { return "sqlserver" }

func (mssqlDriver) DSN(cfg ConnConfig, database string) (string, error) {
	if database == "" {
		database = cfg.Database
	}
	host := cfg.Host
	if host == "" {
		host = "127.0.0.1"
	}
	port := cfg.Port
	if port == 0 {
		port = 1433
	}

	q := url.Values{}
	if database != "" {
		q.Set("database", database)
	}
	// go-mssqldb defaults to encrypt=true and will refuse a self-signed
	// certificate, which is what a local or containerised SQL Server has.
	// Trusting the cert by default matches what every other GUI does; the
	// user can override via Params.
	q.Set("encrypt", "true")
	q.Set("TrustServerCertificate", "true")
	if cfg.SSLMode != "" {
		q.Set("encrypt", cfg.SSLMode)
	}
	for k, v := range cfg.Params {
		q.Set(k, v)
	}

	u := &url.URL{
		Scheme:   "sqlserver",
		User:     url.UserPassword(cfg.User, cfg.Password),
		Host:     net.JoinHostPort(host, strconv.Itoa(port)),
		RawQuery: q.Encode(),
	}
	return u.String(), nil
}

func (mssqlDriver) QuoteIdent(ident string) string { return quoteWith("[", "]", ident) }

// capText casts to nvarchar(max) first: SUBSTRING is not defined on xml, and
// on the deprecated text/ntext types it returns a differently-typed value. The
// cast makes every capped column arrive as ordinary unicode text.
func (mssqlDriver) capText(expr string, n int) string {
	return fmt.Sprintf("SUBSTRING(CAST(%s AS nvarchar(max)), 1, %d)", expr, n)
}

func (d mssqlDriver) ListDatabases(ctx context.Context, db *sql.DB) ([]Database, error) {
	rows, err := db.QueryContext(ctx, `
		SELECT name FROM sys.databases
		WHERE HAS_DBACCESS(name) = 1
		ORDER BY name`)
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

func (d mssqlDriver) ListObjects(ctx context.Context, db *sql.DB, database string) ([]SchemaObject, error) {
	if database == "" {
		return nil, fmt.Errorf("mssql: a database must be selected")
	}
	// Three-part naming reaches into the target database without a USE, so a
	// single pooled connection can serve the whole server. The database name
	// is quoted, not parameterised, because it is part of the object path
	// rather than a value.
	q := fmt.Sprintf(`
		SELECT s.name, o.name,
		       CASE o.type WHEN 'U' THEN 'table'
		                   WHEN 'V' THEN 'view'
		                   WHEN 'P' THEN 'procedure'
		                   ELSE 'function' END
		FROM %s.sys.objects o
		JOIN %s.sys.schemas s ON s.schema_id = o.schema_id
		WHERE o.type IN ('U','V','P','FN','IF','TF')
		ORDER BY o.type, s.name, o.name`,
		d.QuoteIdent(database), d.QuoteIdent(database))

	rows, err := db.QueryContext(ctx, q)
	if err != nil {
		return nil, err
	}
	recs, err := scanStrings(rows, 3)
	if err != nil {
		return nil, err
	}
	out := make([]SchemaObject, 0, len(recs))
	for _, r := range recs {
		var t ObjectType
		switch r[2] {
		case "table":
			t = ObjectTable
		case "view":
			t = ObjectView
		case "procedure":
			t = ObjectProcedure
		default:
			t = ObjectFunction
		}
		out = append(out, SchemaObject{Schema: r[0], Name: r[1], Type: t})
	}
	return out, nil
}

func (d mssqlDriver) ListColumns(ctx context.Context, db *sql.DB, ref ObjectRef) ([]Column, error) {
	schema := ref.Schema
	if schema == "" {
		schema = "dbo"
	}
	dbq := d.QuoteIdent(ref.Database)

	rows, err := db.QueryContext(ctx, fmt.Sprintf(`
		SELECT COLUMN_NAME, DATA_TYPE, IS_NULLABLE, COLUMN_DEFAULT, ORDINAL_POSITION
		FROM %s.INFORMATION_SCHEMA.COLUMNS
		WHERE TABLE_SCHEMA = @p1 AND TABLE_NAME = @p2
		ORDER BY ORDINAL_POSITION`, dbq), schema, ref.Name)
	if err != nil {
		return nil, err
	}

	var out []Column
	if err := func() error {
		defer rows.Close()
		for rows.Next() {
			var (
				name, typ, nullable string
				def                 sql.NullString
				ord                 int
			)
			if err := rows.Scan(&name, &typ, &nullable, &def, &ord); err != nil {
				return err
			}
			c := Column{
				Name:     name,
				DataType: typ,
				Nullable: strings.EqualFold(nullable, "YES"),
				Ordinal:  ord,
			}
			if def.Valid {
				v := def.String
				c.Default = &v
			}
			out = append(out, c)
		}
		return rows.Err()
	}(); err != nil {
		return nil, err
	}

	pk, err := d.primaryKeyColumns(ctx, db, dbq, schema, ref.Name)
	if err != nil {
		// A missing PK is not worth failing the column list over — the grid
		// just loses its row-identity hint.
		return out, nil
	}
	for i := range out {
		if pk[out[i].Name] {
			out[i].PrimaryKey = true
		}
	}
	return out, nil
}

func (d mssqlDriver) primaryKeyColumns(ctx context.Context, db *sql.DB, dbq, schema, table string) (map[string]bool, error) {
	rows, err := db.QueryContext(ctx, fmt.Sprintf(`
		SELECT ku.COLUMN_NAME
		FROM %s.INFORMATION_SCHEMA.TABLE_CONSTRAINTS tc
		JOIN %s.INFORMATION_SCHEMA.KEY_COLUMN_USAGE ku
		  ON tc.CONSTRAINT_NAME = ku.CONSTRAINT_NAME
		 AND tc.CONSTRAINT_SCHEMA = ku.CONSTRAINT_SCHEMA
		WHERE tc.CONSTRAINT_TYPE = 'PRIMARY KEY'
		  AND ku.TABLE_SCHEMA = @p1 AND ku.TABLE_NAME = @p2`, dbq, dbq), schema, table)
	if err != nil {
		return nil, err
	}
	recs, err := scanStrings(rows, 1)
	if err != nil {
		return nil, err
	}
	pk := make(map[string]bool, len(recs))
	for _, r := range recs {
		pk[r[0]] = true
	}
	return pk, nil
}

func (d mssqlDriver) target(ref ObjectRef) string {
	schema := ref.Schema
	if schema == "" {
		schema = "dbo"
	}
	return qualify(d, ref.Database, schema, ref.Name)
}

// BuildSelect uses OFFSET/FETCH, which SQL Server only permits alongside an
// ORDER BY. When the user has not chosen a sort we must invent one, or paging
// would return rows in an order the server is free to vary between pages —
// meaning rows could be skipped or repeated as you page through.
func (d mssqlDriver) BuildSelect(ref ObjectRef, opts ReadOptions, cols []Column) (string, error) {
	var b strings.Builder
	b.WriteString("SELECT " + selectList(d, opts, cols) + " FROM " + d.target(ref))
	b.WriteString(whereClause(opts.Filter))

	paging := opts.Limit > 0 || opts.Offset > 0
	order := orderByClause(d, opts.OrderBy)
	if order == "" && paging {
		order = " ORDER BY " + d.stableSortKey(cols)
	}
	b.WriteString(order)

	if paging {
		fmt.Fprintf(&b, " OFFSET %d ROWS", opts.Offset)
		if opts.Limit > 0 {
			fmt.Fprintf(&b, " FETCH NEXT %d ROWS ONLY", opts.Limit)
		}
	}
	return b.String(), nil
}

// stableSortKey picks the primary key, else the first column. (SELECT NULL) is
// the last resort — it satisfies the parser but gives no real ordering, so it
// is only reached when the column list could not be read at all.
func (d mssqlDriver) stableSortKey(cols []Column) string {
	var pk []string
	for _, c := range cols {
		if c.PrimaryKey {
			pk = append(pk, d.QuoteIdent(c.Name))
		}
	}
	if len(pk) > 0 {
		return strings.Join(pk, ", ")
	}
	if len(cols) > 0 {
		return d.QuoteIdent(cols[0].Name)
	}
	return "(SELECT NULL)"
}

func (d mssqlDriver) BuildCount(ref ObjectRef, filter string) string {
	return "SELECT count_big(*) FROM " + d.target(ref) + whereClause(filter)
}
