# Requirements log

What was asked for, when, and what was decided. Kept so later work does not
quietly undo earlier work, and so a contradiction between an old requirement
and a new one is noticed rather than silently resolved.

Newest session last. If a new requirement conflicts with something in
**Invariants**, that is a decision to raise, not to make in passing.

---

## 2026-08-16 — initial build

### Brief

> I usually use TablePlus but have since stopped paying for it. Please plan out
> and create a database gui that can achieve similar. I want it to be powered
> by Golang + some kind of Web View UI. I want a command pallete first
> approach. It should support at least: mysql / mariadb, postgres, mssql,
> sqlite

### Decisions taken at the outset

| Question | Choice |
| --- | --- |
| App shell | Wails v2 (WebView2). Windows first, macOS and Linux kept in mind |
| Frontend | React + TypeScript + Vite + Tailwind |
| Scope | Walking skeleton with all four drivers wired |

### MVP features requested

- Connection management, storing multiple connections
- Browse databases on a server
- Browse tables / views / functions / etc. on a database
- Browse rows on a table / view
- `Ctrl+F` filter: a text input that is **raw SQL going after `WHERE`**
- Automatic pagination, with options to turn it off, set per-page, set page number
- SQL editor — plain textarea for MVP, Monaco later, ideally "use your own editor" one day

All delivered. See `ARCHITECTURE.md` for how, and the ADRs for why.

### Test rig

Docker Compose added on request ("could you make a docker compose file for
testing so i have a mysql db"), covering MySQL, MariaDB, PostgreSQL and SQL
Server, seeded with a fixture designed to exercise the failure-prone cases:
bigints past 2^53, decimals, NULL beside empty string, binary columns, a
composite primary key, a table with no primary key at all, and identifiers
needing quoting.

---

## 2026-08-16 — second batch

Requested:

- Settings page on `Ctrl+,`
- Copy-to-clipboard button on error popups
- Right-click menu on connections: connect, disconnect, edit, remove
- Collapsible sidebar sections
- A page showing running queries and open connections, with the ability to cancel
- Databases promoted from a dropdown to its own sidebar section
- Command palette fixed: *"if I search for 'user' expecting to find 'auth.user' … it just shows all the extensions first"*
- Base text size raised — 1rem as the default

All delivered.

### Component library

Asked whether one could help, with the constraint: *"if we do want to use one
lets architect our code we can easily swap it out"*.

Chose **Radix Primitives behind `frontend/src/ui/`** — taken for behaviour, not
styling, because the hand-rolled dialogs had no focus trap or focus restore and
the context menu had no keyboard navigation. Migrated the four dialogs and the
connection menu only. Deliberately left alone: the command palette, the data
grid, and native `<select>`/`<checkbox>`.

### Palette matching

The ranking complaint was fixed twice. First with hand-written match tiers;
then, when it still did not narrow the list enough, by moving scoring to
`fuzzysort` and adding a relative cutoff. Two separate causes were found:
permissive matching, **and** a grouping bug that drew twelve headings for
seventeen results, which by itself read as "nothing was filtered".

### Tooling

`Makefile` added — `make windows` is the headline target. `make check` runs
fmt, vet, typecheck and both test suites.

Pushed to `git@github.com:Cleancookie/db-pro.git`.

---

## 2026-08-17 — always-visible query activity

### Brief

> also can you add an item such that it is a loading bar so I know it's doing
> something? or maybe we should make the currently running queries visible
> somewhere maybe a folding bottom tray like on tableplus with a loading bar /
> timer on each query

Delivered as `frontend/src/components/ActivityTray.tsx`: a strip along the
bottom on every view, collapsed by default, `Ctrl+J` to expand. The strip says
how many queries are running and how long the oldest has been going; expanded,
each query gets a ticking timer, an indeterminate bar and a Cancel.

### Decisions

| Question | Choice |
| --- | --- |
| Tray or page? | **Both, split by shape.** The tray owns in-flight queries; the activity page keeps the server-side pools, renamed "Open connections" |
| Progress semantics | Indeterminate only. A query's duration is not knowable up front and a fabricated percentage would be a lie |
| Cost when idle | The store counts in-flight API calls; the tray polls only while that is non-zero, the tray is open, or the connections page is on screen. An untouched app issues nothing |
| Timer smoothness | Poll at 700ms, tick locally at 100ms from the last snapshot. Never recompute from `startedAt` — that is the server's clock |
| Layout | The expanded list is an overlay, so starting a query never resizes the grid |

The header's old "N running" button went away: the strip says the same thing
permanently, and two indicators for one fact drift apart.

### Second pass, same session

> I was thinking a one line preview of the query, maybe a query ID, and then a
> column to say the current status of the query like WRITING TO NET etc, and
> also how long it has been running for and maybe a cancel button (that
> requires confirmation) once the query is done it will auto hide maybe, or
> maybe this query should stay in this pane always so there is a history of
> queries and then we show the pane when there is a running query?

Answers given by the user when asked:

| Question | Choice |
| --- | --- |
| Real server state (`writing to net`) or the app's own phases? | The app's own, instrumented. Real engine state deferred — wishlist item 4 |
| Auto-hide, or keep a history? | Keep a history, with the final duration and a terminal status |
| Auto-open the pane when a query starts? | **No.** The strip's bar is signal enough |

Delivered: a query id column (`q001`, zero-padded so the column does not
change width), a status column from real instrumentation, a bounded history
ring of 200 entries, `Clear log`, and a confirmation on Cancel that honours the
existing "confirm destructive actions" setting.

Catalogue reads are shown while they run but are not retained in the history:
they fire on every table open and would push the user's own queries out of the
ring within a minute.

---

## Invariants

Things that are true on purpose. Breaking one should be a decision, not an
accident. Where a test enforces it, changing the behaviour means changing a
test — which is the intended speed bump.

### Data correctness

| Invariant | Enforced by |
| --- | --- |
| Integers beyond 2^53 are sent as strings — a JSON number silently rounds a bigint id | `internal/driver/scan_test.go` |
| Decimals stay strings; never float64 | `scan_test.go` |
| `NULL` and `''` are distinguishable, in the API and in the grid | `internal/api/service_test.go` |
| Paging visits every row exactly once — no skips, no repeats | `service_test.go` |
| Pagination off emits **no** `LIMIT`; the row cap is applied while scanning instead | `internal/driver/driver_test.go` |
| SQL Server invents an `ORDER BY` when paging unsorted (PK → first column → constant), or `OFFSET/FETCH` silently reorders between pages | `driver_test.go` |
| Every identifier is quoted per dialect; only the user's filter fragment is raw | `driver_test.go` |
| Non-finite floats are stringified — they cannot be JSON-encoded | `scan_test.go` |

### Design decisions

| Invariant | Why |
| --- | --- |
| The `Ctrl+F` filter is raw, uninterpreted SQL | The whole point of it. `docs/adr/0002`. It must never be fed anything that did not come from a keystroke |
| `internal/api.Service` knows nothing about Wails; both transports are pure pass-through | `docs/adr/0001`. Logic in a binding is a bug — the other binding would not have it |
| Passwords never live on the `Connection` struct; they go through `SecretStore` | `docs/adr/0003`. That seam is what makes the keyring migration cheap |
| `cmd/devserver` binds to loopback only and refuses anything else | It serves stored credentials |
| Nothing outside `frontend/src/ui/` imports a component library | The swap-out guarantee. A leak silently voids it |
| The palette matches the object *name* first; schema and keywords only at a discount | Otherwise "user" returns everything in a schema containing those letters |
| Palette results are cut relative to the best score | Fuzzy matching is permissive by nature; ordering alone does not narrow a list |
| Activity polling is driven by the store's in-flight count, never by a bare timer | An idle app must issue no requests. A poller that runs regardless is a background load on every connected database |
| The query history is a fixed ring with capped retained SQL | It grows for the whole session otherwise, and holds statement text |
| Query timers extrapolate from the last snapshot, never from `startedAt` | `startedAt` is the server's wall clock; clock skew would show a fresh query as minutes old |
| The UI is sized in `rem` from a single root font size | The Settings slider must scale spacing and controls, not just text |
| `frontend/dist/.gitkeep` stays tracked, and builds must not delete it | `main.go` embeds `frontend/dist`; without it a fresh clone will not compile |

### Known gaps, accepted for now

- **Passwords are plaintext on disk.** `docs/adr/0003`. Must not ship to anyone else's machine as-is.
- **The filter is a SQL injection sink by construction.** Safe only while the input comes from the keyboard of whoever already holds the credentials.
- **No read-only mode.** A user can type a destructive statement into the filter or the editor and mean it. Enforcing otherwise belongs at the session level, not in string parsing.
- **Wails v2 cannot cross-compile to macOS or Linux.** Windows works only because every driver is pure Go. Keep it that way — a cgo driver would end Windows cross-compilation from WSL.
