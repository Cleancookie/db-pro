# Wishlist

Wanted, not yet built. Each item keeps the original request close to verbatim
so whoever implements it can make their own call against the codebase as it
stands then, rather than following a design decided in advance.

---

## 1. Real server-side query state

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

---

## Built since

- **Manual page size** — a free-text page size beside the presets, as a one-off
  override for the table currently open. `Paginator.tsx`, `pageSize.ts`.
- **Cap long values on read**, and **JSON viewer** — the two items that had to
  be designed together, because a capped value needs a "fetch the whole thing"
  path before there is anything for a viewer to show. Includes the cell context
  menu. See `ARCHITECTURE.md` ("Long values").
- **Autocomplete** — CodeMirror 6 behind `ui/Editor.tsx`, driving both the
  filter box and the SQL editor. Candidates in `src/completion.ts`. Monaco was
  costed and rejected; see `frontend/src/ui/README.md`.
- **The activity tray** — always-visible bottom drawer, query ids, instrumented
  lifecycle status, ticking timers, cancel-with-confirmation, and a bounded
  query log. See `ARCHITECTURE.md` ("The activity tray").

All five are recorded in full, request verbatim and decisions taken, in
`REQUIREMENTS.md` under 2026-08-17.
