# Wishlist

Wanted, not yet built. Each item keeps the original request close to verbatim
so whoever implements it can make their own call against the codebase as it
stands then, rather than following a design decided in advance.

---

## 1. Manual page size

> the paginate per page i would also like an option for me to set it manually,
> eg 5 if i just happen to know thats a specifically gnarly table.

Today the page size is a fixed dropdown (`PAGE_SIZES` in `frontend/src/store.ts`:
50/100/200/500/1000). It needs a free-text option alongside those presets.

Note the two places a page size lives: the per-table control in `Paginator.tsx`,
and the `defaultPageSize` in Settings. This request is about the former — a
one-off override for the table currently open.

---

## 2. Cap long values on read

> dbeaver does a smart thing where long data types such as text, json,
> longtext, etc, are capped at a length so to now cause the UI to lag and also
> the sql request doesn't bog down if there is a table with massive json in it.
> lets also do that for our project.

Two distinct wins in that sentence, and the second is the bigger one:

- the UI does not choke rendering huge cells
- **the query itself does not haul megabytes over the wire** — this wants doing
  in SQL (per-dialect substring on long columns), not by trimming after the
  fetch

`internal/driver/scan.go` already caps binary columns to a hex preview with a
byte count; text-shaped types are the gap. The cap should be configurable, the
grid should make truncation visible rather than silent, and there needs to be a
way to pull the full value for one cell on demand.

---

## 3. JSON viewer

> another nice feature would be a nice json viewer

For JSON and JSONB columns, and for text columns that happen to hold JSON.
Formatted, collapsible, readable — rather than one long line in a grid cell.

Overlaps with item 2: a truncated JSON value needs a "fetch the whole thing"
path before it can be viewed, so these two are worth designing together even if
they ship separately.

---

## 4. Real server-side query state

The activity tray shows a **status** column — `QUEUED`, `EXECUTING`,
`READING ROWS`, `CANCELLING`, `DONE`, `FAILED`, `CANCELLED`. Those are the
app's own lifecycle, instrumented in `internal/activity`, `internal/driver` and
`internal/api`. They answer "are we waiting on the server or reading rows",
which was the point of asking for the column:

> a column to say the current status of the query like WRITING TO NET etc

What they are *not* is the server's own opinion — MySQL's literal
`writing to net`, `Sending data`, `Locked`; Postgres's `pg_stat_activity.state`
and `wait_event`; SQL Server's `dm_exec_requests.status` plus its blocking
session id. That is strictly better information: it can say *why* a query is
slow, including that it is blocked on someone else's lock.

The cost is a change to how queries are run, which is why it was deferred:

- Each tracked query has to be pinned to its own `*sql.Conn` for its whole
  lifetime, so its connection id can be captured — `CONNECTION_ID()`,
  `pg_backend_pid()`, `@@SPID`. Today queries take any connection from the
  pool, and `database/sql` gives no way to ask which one it used.
- Reading the state then needs a *second* connection, since the first is busy
  running the query being asked about. That is a monitoring connection, and
  it needs its own lifecycle, error handling and permissions story —
  `PROCESSLIST` beyond your own rows needs `PROCESS`, `pg_stat_activity` shows
  other users' queries only to a superuser or `pg_read_all_stats`, and
  `dm_exec_requests` wants `VIEW SERVER STATE`.
- The pinned connection also unlocks a better cancel: `KILL QUERY <id>` /
  `pg_cancel_backend(pid)` reaches queries that context cancellation cannot,
  and reports whether it worked.
- **SQLite has no equivalent at all.** There is no server, no session view. The
  column would have to fall back to the instrumented phases per dialect, which
  means the tray must keep both sources and label which one it is showing.

Worth doing when the tray is being lived in and "why is this slow" becomes the
question. It should not be done by widening the existing pool or by holding a
monitoring connection open for connections nobody is querying.
