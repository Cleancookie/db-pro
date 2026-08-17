package activity

import (
	"context"
	"errors"
	"strings"
	"testing"
	"time"
)

func TestBeginListsThenFinishes(t *testing.T) {
	r := New()

	ctx, done := r.Begin(context.Background(), "c1", "shop", KindBrowse, "select 1")

	got := r.List()
	if len(got) != 1 {
		t.Fatalf("List() = %d entries, want 1", len(got))
	}
	if got[0].ConnectionID != "c1" || got[0].Kind != KindBrowse || got[0].SQL != "select 1" {
		t.Fatalf("unexpected entry: %+v", got[0])
	}
	if got[0].Phase != PhaseQueued {
		t.Fatalf("Phase = %q, want %q before anything reports in", got[0].Phase, PhaseQueued)
	}
	if err := ctx.Err(); err != nil {
		t.Fatalf("context cancelled before finish: %v", err)
	}

	done(nil)
	got = r.List()
	if len(got) != 1 || got[0].Phase != PhaseDone {
		t.Fatalf("List() = %+v, want one done entry", got)
	}
	// Always released, including on the success path, or the context leaks.
	if ctx.Err() == nil {
		t.Fatal("context still live after finish")
	}
}

func TestPhaseAndRowsComeFromTheContext(t *testing.T) {
	r := New()
	ctx, done := r.Begin(context.Background(), "c1", "", KindQuery, "select 1")

	SetPhase(ctx, PhaseExecuting)
	if p := r.List()[0].Phase; p != PhaseExecuting {
		t.Fatalf("Phase = %q, want %q", p, PhaseExecuting)
	}

	SetPhase(ctx, PhaseReading)
	AddRows(ctx, 512)
	AddRows(ctx, 8)
	got := r.List()[0]
	if got.Phase != PhaseReading || got.RowsRead != 520 {
		t.Fatalf("got phase %q rows %d, want %q 520", got.Phase, got.RowsRead, PhaseReading)
	}

	done(nil)
	if rows := r.List()[0].RowsRead; rows != 520 {
		t.Fatalf("RowsRead = %d after finish, want the final 520", rows)
	}
}

// Reporting through a context that carries no tracker has to be a no-op:
// "Test connection" and every test in this repo run queries that way.
func TestReportingWithoutATrackerIsANoOp(t *testing.T) {
	SetPhase(context.Background(), PhaseReading)
	AddRows(context.Background(), 5)
}

// The tray's timer counts forward from ElapsedMS while a query runs, and stops
// at the value recorded when it finished.
func TestElapsedIsMeasuredThenFrozen(t *testing.T) {
	r := New()
	_, done := r.Begin(context.Background(), "c1", "", KindQuery, "select 1")

	time.Sleep(15 * time.Millisecond)
	live := r.List()[0].ElapsedMS
	if live < 10 {
		t.Fatalf("ElapsedMS = %d while running, want at least 10", live)
	}

	done(nil)
	final := r.List()[0].ElapsedMS
	time.Sleep(15 * time.Millisecond)
	if again := r.List()[0].ElapsedMS; again != final {
		t.Fatalf("ElapsedMS moved after finish: %d then %d", final, again)
	}
}

func TestFailureIsRecordedWithItsMessage(t *testing.T) {
	r := New()
	_, done := r.Begin(context.Background(), "c1", "", KindQuery, "select boom")
	done(errors.New("near \"boom\": syntax error"))

	got := r.List()[0]
	if got.Phase != PhaseFailed || !strings.Contains(got.Error, "syntax error") {
		t.Fatalf("got %+v, want a failed entry carrying the message", got)
	}
}

func TestCancelMarksThenStops(t *testing.T) {
	r := New()
	ctx, done := r.Begin(context.Background(), "c1", "", KindQuery, "select sleep(30)")

	id := r.List()[0].ID
	r.Cancel(id)

	if ctx.Err() == nil {
		t.Fatal("cancelled query context is still live")
	}
	// It stays listed until it unwinds, flagged, so the row does not look stuck.
	if got := r.List(); len(got) != 1 || got[0].Phase != PhaseCancelling {
		t.Fatalf("List() = %+v, want one entry cancelling", got)
	}

	// The driver's own error is cancellation noise; the user's intent is what
	// the history should say.
	done(context.Canceled)
	if got := r.List(); got[0].Phase != PhaseCancelled {
		t.Fatalf("Phase = %q, want %q", got[0].Phase, PhaseCancelled)
	}

	// Cancelling something that has already gone is not an error: by the time a
	// click arrives the query may well be done.
	r.Cancel(id)
}

func TestCancelConnectionStopsOnlyThatConnection(t *testing.T) {
	r := New()
	mine, done1 := r.Begin(context.Background(), "c1", "", KindBrowse, "select 1")
	defer done1(nil)
	theirs, done2 := r.Begin(context.Background(), "c2", "", KindBrowse, "select 2")
	defer done2(nil)

	r.CancelConnection("c1")

	if mine.Err() == nil {
		t.Fatal("query on the disconnected connection is still live")
	}
	if theirs.Err() != nil {
		t.Fatalf("query on another connection was cancelled: %v", theirs.Err())
	}
}

func TestListPutsRunningAboveHistoryNewestFirst(t *testing.T) {
	r := New()
	for _, sql := range []string{"first", "second"} {
		_, done := r.Begin(context.Background(), "c1", "", KindQuery, sql)
		time.Sleep(2 * time.Millisecond)
		done(nil)
	}
	_, live := r.Begin(context.Background(), "c1", "", KindBrowse, "running")
	defer live(nil)

	got := r.List()
	want := []string{"running", "second", "first"}
	if len(got) != len(want) {
		t.Fatalf("List() = %d entries, want %d", len(got), len(want))
	}
	for i, sql := range want {
		if got[i].SQL != sql {
			t.Fatalf("entry %d = %q, want %q (order: running, then newest history)", i, got[i].SQL, sql)
		}
	}
}

func TestHistoryIsBoundedAndDropsTheOldest(t *testing.T) {
	r := New()
	for i := 0; i < historySize+20; i++ {
		_, done := r.Begin(context.Background(), "c1", "", KindQuery, "q")
		done(nil)
	}

	got := r.List()
	if len(got) != historySize {
		t.Fatalf("List() = %d entries, want the %d-entry bound", len(got), historySize)
	}
	// Newest first, and the first twenty ids are gone.
	if got[0].ID != "q220" || got[len(got)-1].ID != "q021" {
		t.Fatalf("ring holds %s…%s, want q220…q021", got[0].ID, got[len(got)-1].ID)
	}
}

// Catalogue reads happen on every table open; keeping them would push out the
// queries the user actually ran.
func TestIntrospectionIsNotRetained(t *testing.T) {
	r := New()
	_, done := r.Begin(context.Background(), "c1", "", KindIntrospect, "list objects")
	if len(r.List()) != 1 {
		t.Fatal("introspection should be visible while it runs")
	}
	done(nil)
	if got := r.List(); len(got) != 0 {
		t.Fatalf("List() = %+v, want introspection dropped once finished", got)
	}
}

func TestHistorySQLIsCapped(t *testing.T) {
	r := New()
	long := strings.Repeat("x", historySQLLimit*2)
	_, done := r.Begin(context.Background(), "c1", "", KindQuery, long)
	// Untouched while running: the tray shows one line of whatever is there.
	if got := r.List()[0].SQL; len(got) != len(long) {
		t.Fatalf("running SQL was truncated to %d bytes", len(got))
	}
	done(nil)
	if got := r.List()[0].SQL; len(got) > historySQLLimit+len("…") {
		t.Fatalf("retained SQL is %d bytes, want at most %d", len(got), historySQLLimit)
	}
}

func TestClearHistoryKeepsRunningQueries(t *testing.T) {
	r := New()
	_, done := r.Begin(context.Background(), "c1", "", KindQuery, "finished")
	done(nil)
	_, live := r.Begin(context.Background(), "c1", "", KindQuery, "running")
	defer live(nil)

	r.ClearHistory()

	got := r.List()
	if len(got) != 1 || got[0].SQL != "running" {
		t.Fatalf("List() = %+v, want only the running query", got)
	}
}

func TestTruncateCutsOnARuneBoundary(t *testing.T) {
	// Three-byte runes either side of the limit: a naive cut would leave half a
	// character and produce invalid UTF-8 in the JSON.
	got := truncate(strings.Repeat("あ", 10), 10)
	if !strings.HasSuffix(got, "…") || len(got) != 9+len("…") {
		t.Fatalf("truncate(…) = %q (%d bytes), want a clean 9-byte cut", got, len(got))
	}
}
