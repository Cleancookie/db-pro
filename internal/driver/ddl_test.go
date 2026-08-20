package driver

import (
	"strings"
	"testing"
)

func TestBuildTruncatePerDialect(t *testing.T) {
	ref := ObjectRef{Database: "shop", Schema: "public", Name: "orders"}

	cases := []struct {
		kind Kind
		want string
	}{
		{KindMySQL, "TRUNCATE TABLE `shop`.`orders`"},
		{KindPostgres, `TRUNCATE TABLE "public"."orders"`},
		{KindMSSQL, "TRUNCATE TABLE [shop].[public].[orders]"},
		// SQLite has no TRUNCATE; the substitution is the whole reason
		// TruncateIsDelete exists on Capabilities.
		{KindSQLite, `DELETE FROM "orders"`},
	}
	for _, c := range cases {
		got, err := mustGet(t, c.kind).BuildTruncate(ref)
		if err != nil {
			t.Fatalf("%s: %v", c.kind, err)
		}
		if got != c.want {
			t.Errorf("%s:\n got %q\nwant %q", c.kind, got, c.want)
		}
	}
}

func TestTruncateIsDeleteMatchesTheStatement(t *testing.T) {
	ref := ObjectRef{Name: "orders"}
	for _, k := range Kinds() {
		d := mustGet(t, k)
		got, err := d.BuildTruncate(ref)
		if err != nil {
			t.Fatalf("%s: %v", k, err)
		}
		isDelete := strings.HasPrefix(got, "DELETE ")
		if isDelete != d.Caps().TruncateIsDelete {
			t.Errorf("%s: statement %q but TruncateIsDelete = %v", k, got, d.Caps().TruncateIsDelete)
		}
	}
}

func TestBuildDropNamesTheObjectType(t *testing.T) {
	ref := ObjectRef{Database: "shop", Schema: "public", Name: "orders"}

	cases := []struct {
		kind Kind
		typ  ObjectType
		want string
	}{
		{KindMySQL, ObjectTable, "DROP TABLE `shop`.`orders`"},
		{KindMySQL, ObjectView, "DROP VIEW `shop`.`orders`"},
		{KindPostgres, ObjectTable, `DROP TABLE "public"."orders"`},
		{KindSQLite, ObjectView, `DROP VIEW "orders"`},
		{KindMSSQL, ObjectTable, "DROP TABLE [shop].[public].[orders]"},
	}
	for _, c := range cases {
		got, err := mustGet(t, c.kind).BuildDrop(ref, c.typ)
		if err != nil {
			t.Fatalf("%s %s: %v", c.kind, c.typ, err)
		}
		if got != c.want {
			t.Errorf("%s %s:\n got %q\nwant %q", c.kind, c.typ, got, c.want)
		}
	}
}

// A function or procedure cannot be named in a DROP without its signature on at
// least one dialect, so the menu refuses rather than emitting something that
// will fail confusingly.
func TestBuildDropRefusesCallables(t *testing.T) {
	ref := ObjectRef{Name: "calc_total"}
	for _, k := range Kinds() {
		for _, typ := range []ObjectType{ObjectFunction, ObjectProcedure} {
			if _, err := mustGet(t, k).BuildDrop(ref, typ); err == nil {
				t.Errorf("%s: dropping a %s should be refused", k, typ)
			}
		}
	}
}

func TestBuildCreateTable(t *testing.T) {
	spec := CreateTableSpec{
		Ref: ObjectRef{Database: "shop", Schema: "public", Name: "orders"},
		Columns: []NewColumn{
			{Name: "id", Type: "bigserial", PrimaryKey: true},
			{Name: "customer", Type: "text"},
			{Name: "total", Type: "numeric(10,2)", Nullable: true, Default: "0"},
		},
	}

	got, err := mustGet(t, KindPostgres).BuildCreateTable(spec)
	if err != nil {
		t.Fatalf("postgres: %v", err)
	}
	want := `CREATE TABLE "public"."orders" (` + "\n" +
		`  "id" bigserial NOT NULL,` + "\n" +
		`  "customer" text NOT NULL,` + "\n" +
		`  "total" numeric(10,2) NULL DEFAULT 0,` + "\n" +
		`  PRIMARY KEY ("id")` + "\n)"
	if got != want {
		t.Errorf("postgres:\n got %q\nwant %q", got, want)
	}
}

// A primary key column is NOT NULL on every engine we support, and emitting
// "NULL" beside it is an error on some of them rather than a no-op.
func TestBuildCreateTableForcesPrimaryKeyNotNull(t *testing.T) {
	spec := CreateTableSpec{
		Ref:     ObjectRef{Name: "t"},
		Columns: []NewColumn{{Name: "id", Type: "INTEGER", PrimaryKey: true, Nullable: true}},
	}
	got, err := mustGet(t, KindSQLite).BuildCreateTable(spec)
	if err != nil {
		t.Fatalf("sqlite: %v", err)
	}
	if !strings.Contains(got, `"id" INTEGER NOT NULL`) {
		t.Errorf("primary key column should be NOT NULL, got %q", got)
	}
}

func TestBuildCreateTableCompositePrimaryKey(t *testing.T) {
	spec := CreateTableSpec{
		Ref: ObjectRef{Database: "shop", Name: "order_lines"},
		Columns: []NewColumn{
			{Name: "order_id", Type: "bigint", PrimaryKey: true},
			{Name: "line_no", Type: "int", PrimaryKey: true},
		},
	}
	got, err := mustGet(t, KindMySQL).BuildCreateTable(spec)
	if err != nil {
		t.Fatalf("mysql: %v", err)
	}
	if !strings.Contains(got, "PRIMARY KEY (`order_id`, `line_no`)") {
		t.Errorf("composite key should be one table-level clause, got %q", got)
	}
}

// SQL Server accepts a database qualifier on CREATE TABLE only when it names the
// current database, and this driver reaches other databases by qualifying rather
// than switching — so the statement is sent to the target database's own
// sp_executesql instead.
func TestMSSQLCreateTableRunsInTheTargetDatabase(t *testing.T) {
	spec := CreateTableSpec{
		Ref:     ObjectRef{Database: "shop", Schema: "sales", Name: "orders"},
		Columns: []NewColumn{{Name: "id", Type: "bigint", PrimaryKey: true}},
	}
	got, err := mustGet(t, KindMSSQL).BuildCreateTable(spec)
	if err != nil {
		t.Fatalf("mssql: %v", err)
	}
	if !strings.HasPrefix(got, "EXEC [shop].[sys].[sp_executesql] N'") {
		t.Errorf("should run through the target database's sp_executesql, got %q", got)
	}
	// The inner statement must be two-part, or CREATE rejects it.
	if !strings.Contains(got, "CREATE TABLE [sales].[orders]") {
		t.Errorf("inner statement should not be database-qualified, got %q", got)
	}
	if strings.Contains(got, "USE ") {
		t.Errorf("a USE would leak to the next caller of the pooled connection: %q", got)
	}
}

func TestMSSQLCreateTableEscapesQuotesInTheNestedStatement(t *testing.T) {
	spec := CreateTableSpec{
		Ref:     ObjectRef{Database: "shop", Name: "notes"},
		Columns: []NewColumn{{Name: "body", Type: "nvarchar(50)", Nullable: true, Default: "'none'"}},
	}
	got, err := mustGet(t, KindMSSQL).BuildCreateTable(spec)
	if err != nil {
		t.Fatalf("mssql: %v", err)
	}
	// Doubled, so the literal survives being nested inside another literal.
	if !strings.Contains(got, "DEFAULT ''none''") {
		t.Errorf("quotes in the nested statement should be doubled, got %q", got)
	}
}

func TestBuildCreateTableRejectsIncompleteSpecs(t *testing.T) {
	cases := []struct {
		name string
		spec CreateTableSpec
	}{
		{"no name", CreateTableSpec{Columns: []NewColumn{{Name: "id", Type: "int"}}}},
		{"no columns", CreateTableSpec{Ref: ObjectRef{Name: "t"}}},
		{"unnamed column", CreateTableSpec{
			Ref:     ObjectRef{Name: "t"},
			Columns: []NewColumn{{Type: "int"}},
		}},
		{"untyped column", CreateTableSpec{
			Ref:     ObjectRef{Name: "t"},
			Columns: []NewColumn{{Name: "id"}},
		}},
		{"duplicate column", CreateTableSpec{
			Ref:     ObjectRef{Name: "t"},
			Columns: []NewColumn{{Name: "id", Type: "int"}, {Name: "id", Type: "int"}},
		}},
		// The type and the default are raw fragments by design, but neither may
		// turn one statement into two.
		{"semicolon in type", CreateTableSpec{
			Ref:     ObjectRef{Name: "t"},
			Columns: []NewColumn{{Name: "id", Type: "int; DROP TABLE users"}},
		}},
		{"comment in default", CreateTableSpec{
			Ref:     ObjectRef{Name: "t"},
			Columns: []NewColumn{{Name: "id", Type: "int", Default: "0 -- nope"}},
		}},
	}
	for _, c := range cases {
		for _, k := range Kinds() {
			if _, err := mustGet(t, k).BuildCreateTable(c.spec); err == nil {
				t.Errorf("%s: %s should be rejected", k, c.name)
			}
		}
	}
}

// Every dialect must offer something for the new-table dialog's type field, or
// that field is an empty box on a dialect the user is least likely to know.
func TestEveryDialectSuggestsTypes(t *testing.T) {
	for _, k := range Kinds() {
		if len(mustGet(t, k).Caps().CommonTypes) == 0 {
			t.Errorf("%s: Caps().CommonTypes is empty", k)
		}
	}
}
