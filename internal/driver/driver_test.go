package driver

import (
	"strings"
	"testing"
)

func mustGet(t *testing.T, k Kind) Driver {
	t.Helper()
	d, err := Get(k)
	if err != nil {
		t.Fatalf("Get(%q): %v", k, err)
	}
	return d
}

func TestQuoteIdentEscapesClosingChar(t *testing.T) {
	cases := []struct {
		kind  Kind
		ident string
		want  string
	}{
		{KindMySQL, "users", "`users`"},
		{KindMySQL, "we`ird", "`we``ird`"},
		{KindPostgres, "users", `"users"`},
		{KindPostgres, `we"ird`, `"we""ird"`},
		{KindSQLite, "users", `"users"`},
		{KindMSSQL, "users", "[users]"},
		{KindMSSQL, "we]ird", "[we]]ird]"},
	}
	for _, c := range cases {
		if got := mustGet(t, c.kind).QuoteIdent(c.ident); got != c.want {
			t.Errorf("%s.QuoteIdent(%q) = %q, want %q", c.kind, c.ident, got, c.want)
		}
	}
}

func TestBuildSelectPagination(t *testing.T) {
	ref := ObjectRef{Database: "shop", Schema: "public", Name: "orders"}
	opts := ReadOptions{Limit: 51, Offset: 100}

	cases := []struct {
		kind Kind
		want string
	}{
		{KindMySQL, "SELECT * FROM `shop`.`orders` LIMIT 51 OFFSET 100"},
		{KindPostgres, `SELECT * FROM "public"."orders" LIMIT 51 OFFSET 100`},
		{KindSQLite, `SELECT * FROM "orders" LIMIT 51 OFFSET 100`},
	}
	for _, c := range cases {
		got, err := mustGet(t, c.kind).BuildSelect(ref, opts, nil)
		if err != nil {
			t.Fatalf("%s: %v", c.kind, err)
		}
		if got != c.want {
			t.Errorf("%s:\n got %q\nwant %q", c.kind, got, c.want)
		}
	}
}

// SQL Server rejects OFFSET/FETCH without an ORDER BY, so the driver has to
// supply one. Getting this wrong means rows silently repeat or vanish between
// pages, so each fallback tier is pinned.
func TestMSSQLPaginationAlwaysOrders(t *testing.T) {
	d := mustGet(t, KindMSSQL)
	ref := ObjectRef{Database: "shop", Schema: "dbo", Name: "orders"}
	opts := ReadOptions{Limit: 51, Offset: 100}

	t.Run("prefers the primary key", func(t *testing.T) {
		cols := []Column{{Name: "id", PrimaryKey: true}, {Name: "total"}}
		got, _ := d.BuildSelect(ref, opts, cols)
		want := "SELECT * FROM [shop].[dbo].[orders] ORDER BY [id] OFFSET 100 ROWS FETCH NEXT 51 ROWS ONLY"
		if got != want {
			t.Errorf("\n got %q\nwant %q", got, want)
		}
	})

	t.Run("composite primary key keeps every column", func(t *testing.T) {
		cols := []Column{{Name: "a", PrimaryKey: true}, {Name: "b", PrimaryKey: true}}
		got, _ := d.BuildSelect(ref, opts, cols)
		if !strings.Contains(got, "ORDER BY [a], [b] OFFSET") {
			t.Errorf("composite key not fully used: %q", got)
		}
	})

	t.Run("falls back to the first column", func(t *testing.T) {
		cols := []Column{{Name: "total"}, {Name: "created"}}
		got, _ := d.BuildSelect(ref, opts, cols)
		if !strings.Contains(got, "ORDER BY [total] OFFSET") {
			t.Errorf("first column not used: %q", got)
		}
	})

	t.Run("falls back to a constant when no columns are known", func(t *testing.T) {
		got, _ := d.BuildSelect(ref, opts, nil)
		if !strings.Contains(got, "ORDER BY (SELECT NULL) OFFSET") {
			t.Errorf("constant fallback missing: %q", got)
		}
	})

	t.Run("an explicit sort wins", func(t *testing.T) {
		o := opts
		o.OrderBy = []Sort{{Column: "created", Desc: true}}
		cols := []Column{{Name: "id", PrimaryKey: true}}
		got, _ := d.BuildSelect(ref, o, cols)
		if !strings.Contains(got, "ORDER BY [created] DESC OFFSET") {
			t.Errorf("explicit sort ignored: %q", got)
		}
	})

	t.Run("no paging means no invented sort", func(t *testing.T) {
		got, _ := d.BuildSelect(ref, ReadOptions{}, []Column{{Name: "id", PrimaryKey: true}})
		if strings.Contains(got, "ORDER BY") {
			t.Errorf("unpaged query should not be sorted: %q", got)
		}
	})
}

// Pagination-off must emit no LIMIT at all; the row cap is enforced in scan.go
// instead. A stray LIMIT here would silently truncate the user's result.
func TestPaginationOffEmitsNoLimit(t *testing.T) {
	for _, k := range []Kind{KindMySQL, KindPostgres, KindSQLite, KindMSSQL} {
		got, _ := mustGet(t, k).BuildSelect(
			ObjectRef{Database: "shop", Schema: "public", Name: "orders"},
			ReadOptions{}, nil)
		if strings.Contains(strings.ToUpper(got), "LIMIT") ||
			strings.Contains(strings.ToUpper(got), "FETCH NEXT") {
			t.Errorf("%s emitted a limit with pagination off: %q", k, got)
		}
	}
}

func TestFilterIsAppendedAfterWhere(t *testing.T) {
	d := mustGet(t, KindSQLite)
	got, _ := d.BuildSelect(ObjectRef{Name: "orders"},
		ReadOptions{Filter: "total > 100 and status = 'paid'"}, nil)
	want := `SELECT * FROM "orders" WHERE total > 100 and status = 'paid'`
	if got != want {
		t.Errorf("\n got %q\nwant %q", got, want)
	}
}

// Typing "WHERE" into the filter box is a common reflex; swallowing it beats
// handing back a syntax error for something we can unambiguously interpret.
func TestFilterToleratesLeadingWhereKeyword(t *testing.T) {
	d := mustGet(t, KindSQLite)
	for _, f := range []string{"WHERE id = 1", "where id = 1", "  Where   id = 1"} {
		got, _ := d.BuildSelect(ObjectRef{Name: "t"}, ReadOptions{Filter: f}, nil)
		want := `SELECT * FROM "t" WHERE id = 1`
		if got != want {
			t.Errorf("filter %q:\n got %q\nwant %q", f, got, want)
		}
	}
}

// "where" is also a plausible column name, so the keyword strip must only fire
// on a real keyword followed by whitespace.
func TestFilterDoesNotStripWhereLikePrefix(t *testing.T) {
	d := mustGet(t, KindSQLite)
	got, _ := d.BuildSelect(ObjectRef{Name: "t"}, ReadOptions{Filter: "wherehouse_id = 3"}, nil)
	if !strings.Contains(got, "WHERE wherehouse_id = 3") {
		t.Errorf("mangled a column starting with 'where': %q", got)
	}
}

func TestEmptyFilterProducesNoWhereClause(t *testing.T) {
	d := mustGet(t, KindSQLite)
	for _, f := range []string{"", "   ", "WHERE", "  where  "} {
		got, _ := d.BuildSelect(ObjectRef{Name: "t"}, ReadOptions{Filter: f}, nil)
		if strings.Contains(got, "WHERE") {
			t.Errorf("filter %q produced a dangling WHERE: %q", f, got)
		}
	}
}

func TestOrderByQuotesColumns(t *testing.T) {
	d := mustGet(t, KindPostgres)
	got, _ := d.BuildSelect(ObjectRef{Schema: "public", Name: "t"},
		ReadOptions{OrderBy: []Sort{{Column: "created_at", Desc: true}, {Column: "id"}}}, nil)
	if !strings.Contains(got, `ORDER BY "created_at" DESC, "id" ASC`) {
		t.Errorf("unexpected order by: %q", got)
	}
}

func TestPostgresDefaultsToPublicSchema(t *testing.T) {
	d := mustGet(t, KindPostgres)
	got, _ := d.BuildSelect(ObjectRef{Name: "t"}, ReadOptions{}, nil)
	if !strings.Contains(got, `"public"."t"`) {
		t.Errorf("expected public schema fallback: %q", got)
	}
}

func TestBuildCountUsesSameFilter(t *testing.T) {
	d := mustGet(t, KindMySQL)
	got := d.BuildCount(ObjectRef{Database: "shop", Name: "orders"}, "total > 100")
	want := "SELECT count(*) FROM `shop`.`orders` WHERE total > 100"
	if got != want {
		t.Errorf("\n got %q\nwant %q", got, want)
	}
}

// --- the text cap ------------------------------------------------------------------

// longCols is a table with one column of each shape the cap has to reason
// about: a key, a bounded string, and two that can hold a megabyte.
var longCols = []Column{
	{Name: "id", DataType: "integer", PrimaryKey: true},
	{Name: "name", DataType: "varchar(64)"},
	{Name: "body", DataType: "text"},
	{Name: "doc", DataType: "json"},
}

// The cap has to be in the SQL, not applied after the fetch — that is the whole
// point of it. Each dialect's substring is pinned, because getting one wrong
// means either a database error or megabytes silently crossing the wire.
func TestTextCapIsEmittedAsSQL(t *testing.T) {
	ref := ObjectRef{Database: "shop", Schema: "public", Name: "docs"}
	opts := ReadOptions{TextCap: 512}

	cases := []struct {
		kind Kind
		want string
	}{
		{KindMySQL, "SELECT `id`, `name`, LEFT(`body`, 513) AS `body`, LEFT(`doc`, 513) AS `doc` " +
			"FROM `shop`.`docs`"},
		{KindPostgres, `SELECT "id", "name", left("body"::text, 513) AS "body", ` +
			`left("doc"::text, 513) AS "doc" FROM "public"."docs"`},
		{KindSQLite, `SELECT "id", "name", substr("body", 1, 513) AS "body", ` +
			`substr("doc", 1, 513) AS "doc" FROM "docs"`},
		{KindMSSQL, "SELECT [id], [name], SUBSTRING(CAST([body] AS nvarchar(max)), 1, 513) AS [body], " +
			"SUBSTRING(CAST([doc] AS nvarchar(max)), 1, 513) AS [doc] FROM [shop].[public].[docs]"},
	}
	for _, c := range cases {
		got, err := mustGet(t, c.kind).BuildSelect(ref, opts, longCols)
		if err != nil {
			t.Fatalf("%s: %v", c.kind, err)
		}
		if got != c.want {
			t.Errorf("%s:\n got %q\nwant %q", c.kind, got, c.want)
		}
	}
}

// One character past the cap is what tells the scan the value was cut. Losing
// it would make truncation invisible, which is the failure this feature exists
// to avoid.
func TestTextCapAsksForOneCharacterPastTheCap(t *testing.T) {
	got, _ := mustGet(t, KindSQLite).BuildSelect(ObjectRef{Name: "docs"},
		ReadOptions{TextCap: 100}, longCols)
	if !strings.Contains(got, "substr(\"body\", 1, 101)") {
		t.Errorf("sentinel character missing: %q", got)
	}
}

// With nothing to cap the query must be byte-for-byte what it was before the
// cap existed — an explicit column list would quietly change what a SELECT *
// returns after an ALTER TABLE.
func TestNothingToCapKeepsSelectStar(t *testing.T) {
	d := mustGet(t, KindSQLite)
	ref := ObjectRef{Name: "docs"}
	cases := map[string]struct {
		opts ReadOptions
		cols []Column
	}{
		"cap disabled":       {ReadOptions{TextCap: 0}, longCols},
		"no column metadata": {ReadOptions{TextCap: 512}, nil},
		"no long columns": {ReadOptions{TextCap: 512}, []Column{
			{Name: "id", DataType: "integer"}, {Name: "name", DataType: "varchar(10)"},
		}},
	}
	for name, c := range cases {
		got, _ := d.BuildSelect(ref, c.opts, c.cols)
		if got != `SELECT * FROM "docs"` {
			t.Errorf("%s: got %q, want a plain SELECT *", name, got)
		}
	}
}

// The single-cell fetch projects one column and must not cap it — defeating the
// cap is its entire purpose. The column name is an identifier and is quoted.
func TestSelectOverrideProjectsOneUncappedColumn(t *testing.T) {
	got, _ := mustGet(t, KindPostgres).BuildSelect(
		ObjectRef{Schema: "public", Name: "docs"},
		ReadOptions{Select: []string{`we"ird`}, TextCap: 512, Limit: 1, Offset: 41},
		longCols)
	want := `SELECT "we""ird" FROM "public"."docs" LIMIT 1 OFFSET 41`
	if got != want {
		t.Errorf("\n got %q\nwant %q", got, want)
	}
}

// The cell fetch pages with LIMIT 1 / OFFSET n, so mssql still has to invent
// the same ORDER BY the page was read with or it addresses a different row.
func TestSelectOverrideStillOrdersForMSSQL(t *testing.T) {
	got, _ := mustGet(t, KindMSSQL).BuildSelect(
		ObjectRef{Database: "shop", Schema: "dbo", Name: "docs"},
		ReadOptions{Select: []string{"body"}, Limit: 1, Offset: 7}, longCols)
	want := "SELECT [body] FROM [shop].[dbo].[docs] ORDER BY [id] " +
		"OFFSET 7 ROWS FETCH NEXT 1 ROWS ONLY"
	if got != want {
		t.Errorf("\n got %q\nwant %q", got, want)
	}
}

// Capping rewrites the select list, which is the one place the filter and the
// projection meet. The filter must still be the only raw fragment.
func TestTextCapKeepsIdentifiersQuoted(t *testing.T) {
	got, _ := mustGet(t, KindMySQL).BuildSelect(ObjectRef{Database: "db", Name: "t"},
		ReadOptions{TextCap: 8, Filter: "1=1"},
		[]Column{{Name: "we`ird", DataType: "longtext"}})
	if !strings.Contains(got, "LEFT(`we``ird`, 9) AS `we``ird`") {
		t.Errorf("identifier not escaped in the capped select list: %q", got)
	}
}

func TestCapStringCutsOnRuneBoundaries(t *testing.T) {
	// Four characters, eight bytes.
	const s = "αβγδ"
	got, cut := capString(s, 2)
	if !cut || got != "αβ" {
		t.Errorf("capString(%q, 2) = (%q, %v), want (\"αβ\", true)", s, got, cut)
	}
	if got, cut := capString(s, 4); cut || got != s {
		t.Errorf("a string exactly at the cap must be left alone, got (%q, %v)", got, cut)
	}
	if got, cut := capString("abc", 10); cut || got != "abc" {
		t.Errorf("short string was touched: (%q, %v)", got, cut)
	}
}

func TestAllKindsRegistered(t *testing.T) {
	want := []Kind{KindMSSQL, KindMySQL, KindPostgres, KindSQLite}
	got := Kinds()
	if len(got) != len(want) {
		t.Fatalf("got %v, want %v", got, want)
	}
	for i := range want {
		if got[i] != want[i] {
			t.Errorf("Kinds()[%d] = %q, want %q", i, got[i], want[i])
		}
	}
	for _, k := range got {
		if caps := mustGet(t, k).Caps(); caps.DisplayName == "" {
			t.Errorf("%s has no display name", k)
		}
	}
}
