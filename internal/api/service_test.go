package api

import (
	"context"
	"fmt"
	"path/filepath"
	"testing"

	"github.com/alexlaw/db-pro/internal/activity"
	"github.com/alexlaw/db-pro/internal/config"
	"github.com/alexlaw/db-pro/internal/driver"
	"github.com/alexlaw/db-pro/internal/engine"
)

// newService builds a Service over a real store, settings file, engine and
// activity registry rooted at dir.
func newService(t *testing.T, dir string) *Service {
	t.Helper()
	store, err := config.Open(dir)
	if err != nil {
		t.Fatalf("opening store: %v", err)
	}
	settings, err := config.OpenSettings(filepath.Join(dir, "settings.json"))
	if err != nil {
		t.Fatalf("opening settings: %v", err)
	}
	svc := New(store, settings, engine.New(), activity.New())
	t.Cleanup(svc.Shutdown)
	return svc
}

// newTestService wires the real store, engine and service against a throwaway
// SQLite file, so these tests exercise the whole stack rather than a mock.
func newTestService(t *testing.T) (*Service, string) {
	t.Helper()
	dir := t.TempDir()
	svc := newService(t, dir)

	conn, err := svc.SaveConnection(SaveConnectionRequest{
		Connection: config.Connection{
			Name: "test",
			Kind: driver.KindSQLite,
			File: filepath.Join(dir, "test.db"),
		},
	})
	if err != nil {
		t.Fatalf("saving connection: %v", err)
	}
	return svc, conn.ID
}

func mustRun(t *testing.T, svc *Service, id, sql string) {
	t.Helper()
	if _, err := svc.RunSQL(context.Background(), RunSQLRequest{ConnectionID: id, SQL: sql}); err != nil {
		t.Fatalf("running %q: %v", sql, err)
	}
}

func seed(t *testing.T, svc *Service, id string, rows int) {
	t.Helper()
	mustRun(t, svc, id, `CREATE TABLE orders (
		id INTEGER PRIMARY KEY,
		customer TEXT NOT NULL,
		total REAL,
		note TEXT
	)`)
	mustRun(t, svc, id, `CREATE VIEW big_orders AS SELECT * FROM orders WHERE total > 100`)
	for i := 1; i <= rows; i++ {
		mustRun(t, svc, id, fmt.Sprintf(
			`INSERT INTO orders (id, customer, total, note) VALUES (%d, 'cust-%d', %d.5, NULL)`,
			i, i%3, i*10))
	}
}

func TestConnectListsTheSQLiteFileAsOneDatabase(t *testing.T) {
	svc, id := newTestService(t)
	res, err := svc.Connect(context.Background(), id)
	if err != nil {
		t.Fatalf("connect: %v", err)
	}
	if res.Capabilities.ServerHostsDatabases {
		t.Error("SQLite should not advertise a server-hosted database list")
	}
	if len(res.Databases) != 1 || res.Databases[0].Name != "main" {
		t.Errorf("got %v, want exactly [main]", res.Databases)
	}
}

func TestListObjectsSeparatesTablesFromViews(t *testing.T) {
	svc, id := newTestService(t)
	seed(t, svc, id, 3)

	objs, err := svc.ListObjects(context.Background(), id, "main")
	if err != nil {
		t.Fatalf("list objects: %v", err)
	}
	kinds := map[string]driver.ObjectType{}
	for _, o := range objs {
		kinds[o.Name] = o.Type
	}
	if kinds["orders"] != driver.ObjectTable {
		t.Errorf("orders typed as %q, want table", kinds["orders"])
	}
	if kinds["big_orders"] != driver.ObjectView {
		t.Errorf("big_orders typed as %q, want view", kinds["big_orders"])
	}
}

func TestListColumnsReportsKeysAndNullability(t *testing.T) {
	svc, id := newTestService(t)
	seed(t, svc, id, 1)

	cols, err := svc.ListColumns(context.Background(), id,
		driver.ObjectRef{Database: "main", Name: "orders"})
	if err != nil {
		t.Fatalf("list columns: %v", err)
	}
	if len(cols) != 4 {
		t.Fatalf("got %d columns, want 4", len(cols))
	}
	if !cols[0].PrimaryKey {
		t.Error("id was not reported as the primary key")
	}
	if cols[1].Nullable {
		t.Error("customer is NOT NULL but was reported nullable")
	}
	if !cols[3].Nullable {
		t.Error("note is nullable but was reported otherwise")
	}
}

// Paging must not overlap or skip. Walking every page and collecting ids is
// the only check that actually catches an off-by-one in the offset maths.
func TestPaginationWalksEveryRowExactlyOnce(t *testing.T) {
	svc, id := newTestService(t)
	const total = 25
	seed(t, svc, id, total)

	seen := map[any]bool{}
	page := 1
	for {
		res, err := svc.ReadRows(context.Background(), ReadRowsRequest{
			ConnectionID: id,
			Ref:          driver.ObjectRef{Database: "main", Name: "orders"},
			OrderBy:      []driver.Sort{{Column: "id"}},
			Pagination:   Pagination{Enabled: true, Page: page, PageSize: 10},
		})
		if err != nil {
			t.Fatalf("page %d: %v", page, err)
		}
		for _, row := range res.Result.Rows {
			if seen[row[0]] {
				t.Errorf("row %v appeared on more than one page", row[0])
			}
			seen[row[0]] = true
		}
		if !res.HasMore {
			break
		}
		page++
		if page > 10 {
			t.Fatal("HasMore never went false — pagination is not terminating")
		}
	}
	if len(seen) != total {
		t.Errorf("saw %d distinct rows across %d pages, want %d", len(seen), page, total)
	}
}

// HasMore is derived from an extra fetched row, so the boundary where the last
// page is exactly full is the case most likely to be wrong.
func TestHasMoreIsFalseOnAnExactlyFullFinalPage(t *testing.T) {
	svc, id := newTestService(t)
	seed(t, svc, id, 20)

	res, err := svc.ReadRows(context.Background(), ReadRowsRequest{
		ConnectionID: id,
		Ref:          driver.ObjectRef{Database: "main", Name: "orders"},
		OrderBy:      []driver.Sort{{Column: "id"}},
		Pagination:   Pagination{Enabled: true, Page: 2, PageSize: 10},
	})
	if err != nil {
		t.Fatal(err)
	}
	if len(res.Result.Rows) != 10 {
		t.Errorf("got %d rows, want a full page of 10", len(res.Result.Rows))
	}
	if res.HasMore {
		t.Error("HasMore is true on the final page")
	}
}

// The extra row fetched to compute HasMore must never reach the caller.
func TestPageNeverReturnsMoreRowsThanRequested(t *testing.T) {
	svc, id := newTestService(t)
	seed(t, svc, id, 50)

	res, err := svc.ReadRows(context.Background(), ReadRowsRequest{
		ConnectionID: id,
		Ref:          driver.ObjectRef{Database: "main", Name: "orders"},
		Pagination:   Pagination{Enabled: true, Page: 1, PageSize: 7},
	})
	if err != nil {
		t.Fatal(err)
	}
	if len(res.Result.Rows) != 7 {
		t.Errorf("got %d rows, want exactly the requested 7", len(res.Result.Rows))
	}
	if !res.HasMore {
		t.Error("HasMore should be true with 50 rows and a page size of 7")
	}
}

func TestPaginationOffReturnsEverything(t *testing.T) {
	svc, id := newTestService(t)
	seed(t, svc, id, 40)

	res, err := svc.ReadRows(context.Background(), ReadRowsRequest{
		ConnectionID: id,
		Ref:          driver.ObjectRef{Database: "main", Name: "orders"},
		Pagination:   Pagination{Enabled: false},
	})
	if err != nil {
		t.Fatal(err)
	}
	if len(res.Result.Rows) != 40 {
		t.Errorf("got %d rows, want all 40", len(res.Result.Rows))
	}
	if res.HasMore {
		t.Error("HasMore is meaningless with pagination off and should be false")
	}
}

func TestFilterIsAppliedAndCounted(t *testing.T) {
	svc, id := newTestService(t)
	seed(t, svc, id, 30)
	ref := driver.ObjectRef{Database: "main", Name: "orders"}

	// total is i*10+0.5 for i in 1..30, so this matches i = 20..30: 11 rows.
	const filter = "total > 200"
	const want = 11

	res, err := svc.ReadRows(context.Background(), ReadRowsRequest{
		ConnectionID: id, Ref: ref, Filter: filter,
		Pagination: Pagination{Enabled: false},
	})
	if err != nil {
		t.Fatal(err)
	}
	if len(res.Result.Rows) != want {
		t.Errorf("filter returned %d rows, want %d", len(res.Result.Rows), want)
	}

	n, err := svc.CountRows(context.Background(), CountRowsRequest{
		ConnectionID: id, Ref: ref, Filter: filter,
	})
	if err != nil {
		t.Fatal(err)
	}
	if n != want {
		t.Errorf("count returned %d, want %d — count and read disagree", n, want)
	}
}

// A bad filter is normal usage, not an app error: the database message has to
// reach the user intact so they can fix their expression.
func TestBadFilterSurfacesTheDatabaseError(t *testing.T) {
	svc, id := newTestService(t)
	seed(t, svc, id, 2)

	_, err := svc.ReadRows(context.Background(), ReadRowsRequest{
		ConnectionID: id,
		Ref:          driver.ObjectRef{Database: "main", Name: "orders"},
		Filter:       "total >>> 100",
	})
	if err == nil {
		t.Fatal("expected a syntax error")
	}
	if len(err.Error()) == 0 {
		t.Error("error message is empty; the user has nothing to act on")
	}
}

func TestBrowsingAViewWorks(t *testing.T) {
	svc, id := newTestService(t)
	seed(t, svc, id, 30)

	res, err := svc.ReadRows(context.Background(), ReadRowsRequest{
		ConnectionID: id,
		Ref:          driver.ObjectRef{Database: "main", Name: "big_orders"},
		Pagination:   Pagination{Enabled: true, Page: 1, PageSize: 100},
	})
	if err != nil {
		t.Fatalf("reading a view: %v", err)
	}
	// The view is total > 100, and total is i*10+0.5, so i = 10..30: 21 rows.
	if len(res.Result.Rows) != 21 {
		t.Errorf("got %d rows from the view, want 21", len(res.Result.Rows))
	}
}

func TestNullsAreDistinctFromEmptyStrings(t *testing.T) {
	svc, id := newTestService(t)
	seed(t, svc, id, 1)
	mustRun(t, svc, id, `INSERT INTO orders (id, customer, total, note) VALUES (99, 'x', 1, '')`)

	res, err := svc.ReadRows(context.Background(), ReadRowsRequest{
		ConnectionID: id,
		Ref:          driver.ObjectRef{Database: "main", Name: "orders"},
		OrderBy:      []driver.Sort{{Column: "id"}},
		Pagination:   Pagination{Enabled: false},
	})
	if err != nil {
		t.Fatal(err)
	}
	if got := res.Result.Rows[0][3]; got != nil {
		t.Errorf("NULL note came back as %#v, want nil", got)
	}
	if got := res.Result.Rows[1][3]; got != "" {
		t.Errorf("empty-string note came back as %#v, want an empty string", got)
	}
}

func TestRunSQLDistinguishesQueriesFromStatements(t *testing.T) {
	svc, id := newTestService(t)
	seed(t, svc, id, 5)

	q, err := svc.RunSQL(context.Background(), RunSQLRequest{
		ConnectionID: id, SQL: "SELECT id, customer FROM orders ORDER BY id",
	})
	if err != nil {
		t.Fatal(err)
	}
	if len(q.Rows) != 5 || len(q.Columns) != 2 {
		t.Errorf("got %d rows / %d cols, want 5/2", len(q.Rows), len(q.Columns))
	}
	if q.RowsAffected != nil {
		t.Error("a SELECT should not report rows affected")
	}

	e, err := svc.RunSQL(context.Background(), RunSQLRequest{
		ConnectionID: id, SQL: "UPDATE orders SET note = 'seen'",
	})
	if err != nil {
		t.Fatal(err)
	}
	if e.RowsAffected == nil || *e.RowsAffected != 5 {
		t.Errorf("got %v rows affected, want 5", e.RowsAffected)
	}
}

func TestReturnsRowsClassifier(t *testing.T) {
	queries := []string{
		"SELECT 1", "select 1", "  \n SELECT 1", "WITH x AS (SELECT 1) SELECT * FROM x",
		"-- a comment\nSELECT 1", "PRAGMA table_info(t)", "EXPLAIN SELECT 1", "(SELECT 1)",
	}
	for _, q := range queries {
		if !returnsRows(q) {
			t.Errorf("%q was not classified as a query", q)
		}
	}
	statements := []string{
		"INSERT INTO t VALUES (1)", "UPDATE t SET a = 1", "DELETE FROM t",
		"CREATE TABLE t (a int)", "DROP TABLE t", "-- only a comment",
	}
	for _, s := range statements {
		if returnsRows(s) {
			t.Errorf("%q was misclassified as a query", s)
		}
	}
}

// Deleting a connection must take its stored password with it.
func TestDeletingAConnectionRemovesItsPassword(t *testing.T) {
	dir := t.TempDir()
	svc := newService(t, dir)
	store := svc.store

	pw := "hunter2"
	conn, err := svc.SaveConnection(SaveConnectionRequest{
		Connection: config.Connection{
			Name: "pg", Kind: driver.KindPostgres, Host: "localhost",
		},
		Password: &pw,
	})
	if err != nil {
		t.Fatal(err)
	}
	if got, _ := store.Password(conn.ID); got != pw {
		t.Fatalf("password not stored, got %q", got)
	}
	if err := svc.DeleteConnection(conn.ID); err != nil {
		t.Fatal(err)
	}
	if got, _ := store.Password(conn.ID); got != "" {
		t.Errorf("password %q survived deletion of the connection", got)
	}
}

// Editing a connection without retyping the password must not blank it.
func TestUpdateWithoutPasswordKeepsTheStoredOne(t *testing.T) {
	dir := t.TempDir()
	svc := newService(t, dir)
	store := svc.store

	pw := "hunter2"
	conn, err := svc.SaveConnection(SaveConnectionRequest{
		Connection: config.Connection{Name: "pg", Kind: driver.KindPostgres, Host: "localhost"},
		Password:   &pw,
	})
	if err != nil {
		t.Fatal(err)
	}

	conn.Name = "pg renamed"
	if _, err := svc.SaveConnection(SaveConnectionRequest{Connection: conn}); err != nil {
		t.Fatal(err)
	}
	if got, _ := store.Password(conn.ID); got != pw {
		t.Errorf("password is now %q; an edit erased it", got)
	}
}

// Connections must survive a restart — the store is reopened from disk here.
func TestConnectionsPersistAcrossRestart(t *testing.T) {
	dir := t.TempDir()
	svc := newService(t, dir)
	pw := "s3cret"
	if _, err := svc.SaveConnection(SaveConnectionRequest{
		Connection: config.Connection{Name: "keeper", Kind: driver.KindMySQL, Host: "db.internal"},
		Password:   &pw,
	}); err != nil {
		t.Fatal(err)
	}
	svc.Shutdown()

	reopened, err := config.Open(dir)
	if err != nil {
		t.Fatal(err)
	}
	conns := reopened.List()
	if len(conns) != 1 || conns[0].Name != "keeper" {
		t.Fatalf("got %v after restart, want the saved connection", conns)
	}
	if got, _ := reopened.Password(conns[0].ID); got != pw {
		t.Errorf("password did not survive restart, got %q", got)
	}
}

// --- activity ----------------------------------------------------------------------

// The phases the tray shows are instrumented, not inferred, so they are worth
// asserting through the whole stack: api -> driver -> registry.
func TestActivityRecordsFinishedQueriesWithTheirPhase(t *testing.T) {
	svc, id := newTestService(t)
	seed(t, svc, id, 3)

	if _, err := svc.RunSQL(context.Background(), RunSQLRequest{
		ConnectionID: id,
		SQL:          "SELECT * FROM orders",
	}); err != nil {
		t.Fatalf("select: %v", err)
	}

	got := svc.Activity().Queries
	if len(got) == 0 {
		t.Fatal("Activity() reported no queries; the history is empty")
	}
	// Newest first, and nothing is still running by the time RunSQL returns.
	latest := got[0]
	if latest.Phase != activity.PhaseDone {
		t.Fatalf("Phase = %q, want %q", latest.Phase, activity.PhaseDone)
	}
	if latest.SQL != "SELECT * FROM orders" {
		t.Fatalf("SQL = %q, want the statement that ran", latest.SQL)
	}
	// The row counter is what makes "reading rows" informative.
	if latest.RowsRead != 3 {
		t.Errorf("RowsRead = %d, want 3", latest.RowsRead)
	}
}

func TestActivityRecordsFailuresWithTheDatabaseMessage(t *testing.T) {
	svc, id := newTestService(t)
	seed(t, svc, id, 1)

	if _, err := svc.RunSQL(context.Background(), RunSQLRequest{
		ConnectionID: id,
		SQL:          "SELECT nope FROM orders",
	}); err == nil {
		t.Fatal("expected the bad column to error")
	}

	latest := svc.Activity().Queries[0]
	if latest.Phase != activity.PhaseFailed || latest.Error == "" {
		t.Fatalf("got %+v, want a failed entry carrying the database's message", latest)
	}
}

// Catalogue reads are visible while they run but must not fill the log.
func TestActivityDropsIntrospectionFromTheHistory(t *testing.T) {
	svc, id := newTestService(t)
	seed(t, svc, id, 1)
	svc.ClearQueryHistory()

	if _, err := svc.ListObjects(context.Background(), id, ""); err != nil {
		t.Fatalf("list objects: %v", err)
	}
	if got := svc.Activity().Queries; len(got) != 0 {
		t.Fatalf("Activity() = %+v, want introspection left out of the log", got)
	}
}

func TestClearQueryHistoryEmptiesTheLog(t *testing.T) {
	svc, id := newTestService(t)
	seed(t, svc, id, 1)
	if len(svc.Activity().Queries) == 0 {
		t.Fatal("seeding should have left history behind")
	}

	svc.ClearQueryHistory()
	if got := svc.Activity().Queries; len(got) != 0 {
		t.Fatalf("Activity() = %+v after clearing, want empty", got)
	}
}
