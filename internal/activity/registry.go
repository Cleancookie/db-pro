// Package activity tracks in-flight database work so the user can see what
// the app is doing and cancel anything that is taking too long.
//
// Every query the app issues is wrapped by Begin, which returns a derived
// context. Cancelling that context is what actually stops the query: Go's
// database/sql propagates cancellation to the driver, which sends the
// dialect's own kill/cancel signal to the server.
package activity

import (
	"context"
	"fmt"
	"sort"
	"sync"
	"sync/atomic"
	"time"
)

type Kind string

const (
	KindBrowse     Kind = "browse"     // paging through a table or view
	KindCount      Kind = "count"      // the background COUNT(*)
	KindQuery      Kind = "query"      // the SQL editor
	KindIntrospect Kind = "introspect" // catalogue reads for the tree
)

// Info is one running query, as shown on the activity page.
type Info struct {
	ID           string    `json:"id"`
	ConnectionID string    `json:"connectionId"`
	Database     string    `json:"database"`
	Kind         Kind      `json:"kind"`
	SQL          string    `json:"sql"`
	StartedAt    time.Time `json:"startedAt"`
	ElapsedMS    int64     `json:"elapsedMs"`
	// Cancelled marks a query the user has asked to stop but which has not
	// yet unwound. Without it the row would appear stuck and invite a second,
	// equally ineffective, click.
	Cancelled bool `json:"cancelled"`
}

type entry struct {
	info      Info
	cancel    context.CancelFunc
	cancelled bool
}

// Registry holds the currently running queries. Safe for concurrent use.
type Registry struct {
	mu      sync.Mutex
	seq     atomic.Uint64
	running map[string]*entry
}

func New() *Registry {
	return &Registry{running: map[string]*entry{}}
}

// Begin registers a query and returns a context to run it with, plus a
// function that must be deferred to unregister it.
func (r *Registry) Begin(parent context.Context, connID, database string, kind Kind, sql string) (context.Context, func()) {
	ctx, cancel := context.WithCancel(parent)
	id := fmt.Sprintf("q%d", r.seq.Add(1))

	r.mu.Lock()
	r.running[id] = &entry{
		info: Info{
			ID:           id,
			ConnectionID: connID,
			Database:     database,
			Kind:         kind,
			SQL:          sql,
			StartedAt:    time.Now().UTC(),
		},
		cancel: cancel,
	}
	r.mu.Unlock()

	return ctx, func() {
		r.mu.Lock()
		delete(r.running, id)
		r.mu.Unlock()
		// Always released, including on the success path, so the context does
		// not leak. Cancelling an already-finished query is a no-op.
		cancel()
	}
}

// List returns the running queries, newest first.
func (r *Registry) List() []Info {
	r.mu.Lock()
	defer r.mu.Unlock()

	now := time.Now().UTC()
	out := make([]Info, 0, len(r.running))
	for _, e := range r.running {
		info := e.info
		info.ElapsedMS = now.Sub(info.StartedAt).Milliseconds()
		info.Cancelled = e.cancelled
		out = append(out, info)
	}
	sort.Slice(out, func(i, j int) bool { return out[i].StartedAt.After(out[j].StartedAt) })
	return out
}

// Cancel stops a running query. It is not an error to cancel one that has
// already finished — by the time a click arrives the query may well be done,
// and reporting that as a failure would be noise.
func (r *Registry) Cancel(id string) {
	r.mu.Lock()
	e, ok := r.running[id]
	if ok {
		e.cancelled = true
	}
	r.mu.Unlock()

	if ok {
		e.cancel()
	}
}

// CancelConnection stops everything running against one saved connection,
// which is what disconnecting has to do before closing the pool.
func (r *Registry) CancelConnection(connID string) {
	r.mu.Lock()
	var cancels []context.CancelFunc
	for _, e := range r.running {
		if e.info.ConnectionID == connID {
			e.cancelled = true
			cancels = append(cancels, e.cancel)
		}
	}
	r.mu.Unlock()

	for _, c := range cancels {
		c()
	}
}
