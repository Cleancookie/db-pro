package activity

import (
	"context"
	"testing"
	"time"
)

func TestBeginListsThenReleases(t *testing.T) {
	r := New()

	ctx, done := r.Begin(context.Background(), "c1", "shop", KindBrowse, "select 1")

	got := r.List()
	if len(got) != 1 {
		t.Fatalf("List() = %d entries, want 1", len(got))
	}
	if got[0].ConnectionID != "c1" || got[0].Kind != KindBrowse || got[0].SQL != "select 1" {
		t.Fatalf("unexpected entry: %+v", got[0])
	}
	if err := ctx.Err(); err != nil {
		t.Fatalf("context cancelled before release: %v", err)
	}

	done()
	if len(r.List()) != 0 {
		t.Fatalf("List() = %v after release, want empty", r.List())
	}
	// Releasing must cancel even on the success path, or the context leaks.
	if ctx.Err() == nil {
		t.Fatal("context still live after release")
	}
}

// The tray's timer counts forward from ElapsedMS, so List has to measure it
// rather than leaving it at whatever Begin stored.
func TestListMeasuresElapsed(t *testing.T) {
	r := New()
	_, done := r.Begin(context.Background(), "c1", "", KindQuery, "select 1")
	defer done()

	time.Sleep(15 * time.Millisecond)
	if ms := r.List()[0].ElapsedMS; ms < 10 {
		t.Fatalf("ElapsedMS = %d, want at least 10", ms)
	}
}

func TestCancelMarksAndStops(t *testing.T) {
	r := New()
	ctx, done := r.Begin(context.Background(), "c1", "", KindQuery, "select sleep(30)")
	defer done()

	id := r.List()[0].ID
	r.Cancel(id)

	if ctx.Err() == nil {
		t.Fatal("cancelled query context is still live")
	}
	// It stays listed until it unwinds, flagged, so the row does not look stuck.
	got := r.List()
	if len(got) != 1 || !got[0].Cancelled {
		t.Fatalf("List() = %+v, want one entry flagged cancelled", got)
	}

	// Cancelling something that has already gone is not an error: by the time a
	// click arrives the query may well be done.
	done()
	r.Cancel(id)
}

func TestCancelConnectionStopsOnlyThatConnection(t *testing.T) {
	r := New()
	mine, done1 := r.Begin(context.Background(), "c1", "", KindBrowse, "select 1")
	defer done1()
	theirs, done2 := r.Begin(context.Background(), "c2", "", KindBrowse, "select 2")
	defer done2()

	r.CancelConnection("c1")

	if mine.Err() == nil {
		t.Fatal("query on the disconnected connection is still live")
	}
	if theirs.Err() != nil {
		t.Fatalf("query on another connection was cancelled: %v", theirs.Err())
	}
}

func TestListIsNewestFirst(t *testing.T) {
	r := New()
	_, done1 := r.Begin(context.Background(), "c1", "", KindBrowse, "first")
	defer done1()
	time.Sleep(2 * time.Millisecond)
	_, done2 := r.Begin(context.Background(), "c1", "", KindBrowse, "second")
	defer done2()

	got := r.List()
	if len(got) != 2 || got[0].SQL != "second" {
		t.Fatalf("List() = %+v, want newest first", got)
	}
}
