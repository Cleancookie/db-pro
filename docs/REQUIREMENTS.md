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

## 2026-08-17 — long values and the JSON viewer

Wishlist items 2 and 3, taken together because the second needs the first.

### Requested

> dbeaver does a smart thing where long data types such as text, json,
> longtext, etc, are capped at a length so to now cause the UI to lag and also
> the sql request doesn't bog down if there is a table with massive json in it.
> lets also do that for our project.

> another nice feature would be a nice json viewer

### Decided

| Question | Choice |
| --- | --- |
| Where the cap is applied | In the emitted SQL, per dialect (`LEFT`, `left(…::text, n)`, `SUBSTRING(CAST(…))`, `substr`). Trimming after the fetch would save the rendering and none of the bandwidth, which was the bigger of the two wins asked for |
| How a dialect supplies its substring | An unexported `textCapper` interface, not a new `Driver` method — the interface stays introspection-shaped |
| Which columns are capped | Decided from the introspected type name *and the cap*: an unbounded or `(max)` type always, a declared length only when it exceeds the cap. An unrecognised type is left alone rather than risking `substr()` on a number |
| How truncation is made visible | `ResultSet.TruncatedCells`, from asking the server for `cap + 1` characters and noticing the extra one. Grid marks those cells `CUT` |
| How the full value is fetched | `ReadCell`: one column of one row, addressed by absolute offset in the same filtered, sorted result. Works on views and keyless tables, unlike a primary-key lookup. Bounded at 8 MiB |
| Configurability | `textCapChars` in Settings, 1024 by default (the ~1 kB DBeaver uses, which is the number that was asked for), 0 to disable. Saving a new cap re-reads the open table |
| JSON viewer | Hand-rolled collapsible tree (`JsonView.tsx`), no new dependency. Opens on Enter or double-click, on JSON/JSONB columns and on text columns that happen to hold JSON |

Verified against real MySQL, PostgreSQL and SQL Server containers as well as the
SQLite-backed unit tests, because a wrong substring is a syntax error only the
server can report.

### Follow-up, same day

The request restated, with two specifics: *"in dbeaver it limits it to just 1kb
of data I think"*, and *"maybe we could add a right click context when we right
click on a cell to open in the cell viewer"*.

- Default cap moved 512 → **1024**. Defaults only: a settings file that already
  names a cap keeps it, and one written before the feature existed picks up the
  new default.
- **Right-click menu on a grid cell** — open in cell viewer, copy value, copy
  full value (uncapped, disabled when the shown value already is whole), copy
  column name. Behind `ui/Menu.tsx`'s existing Radix wrapper, which gained only
  an optional separator.
- One menu wraps the row area rather than one per cell: a Radix root per
  rendered cell would be hundreds in a virtualised grid. Right-click selects the
  cell first, so the menu always acts on what was clicked. `Enter`, double-click
  and the platform menu key all reach the same viewer.

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
| The long-value cap is applied by the database, not after the fetch, and only to columns that can exceed it | `internal/driver/driver_test.go`, `internal/api/service_test.go` |
| A capped cell is reported as capped — truncation is never silent | `service_test.go` |
| The full value of one cell is always reachable, on views and keyless tables too | `service_test.go` |

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
| The UI is sized in `rem` from a single root font size | The Settings slider must scale spacing and controls, not just text |
| `frontend/dist/.gitkeep` stays tracked, and builds must not delete it | `main.go` embeds `frontend/dist`; without it a fresh clone will not compile |

### Known gaps, accepted for now

- **Passwords are plaintext on disk.** `docs/adr/0003`. Must not ship to anyone else's machine as-is.
- **The filter is a SQL injection sink by construction.** Safe only while the input comes from the keyboard of whoever already holds the credentials.
- **No read-only mode.** A user can type a destructive statement into the filter or the editor and mean it. Enforcing otherwise belongs at the session level, not in string parsing.
- **Wails v2 cannot cross-compile to macOS or Linux.** Windows works only because every driver is pure Go. Keep it that way — a cgo driver would end Windows cross-compilation from WSL.
