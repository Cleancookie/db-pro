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
