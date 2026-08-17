# Architecture

## Layers

```
                 ┌──────────────────────────────────┐
   Wails binding │  app.go        (desktop)         │
   HTTP binding  │  cmd/devserver (browser / dev)   │
                 └───────────────┬──────────────────┘
                                 │  both call the same methods
                 ┌───────────────▼──────────────────┐
                 │  internal/api.Service            │  request/response DTOs
                 └───────┬──────────────────┬───────┘
                         │                  │
          ┌──────────────▼─────┐   ┌────────▼─────────────┐
          │ internal/config    │   │ internal/engine      │
          │ saved connections  │   │ live *sql.DB pool    │
          └────────────────────┘   └────────┬─────────────┘
                                            │
                                   ┌────────▼─────────────┐
                                   │ internal/driver      │
                                   │ Driver interface     │
                                   │ mysql/pg/mssql/sqlite│
                                   └──────────────────────┘
```

### Why two transports

`internal/api.Service` contains all behaviour and knows nothing about Wails. `app.go`
and `cmd/devserver` are both ~100 lines of pass-through. That buys three things:

1. Development on Linux/WSL, where no native webview is installed.
2. The frontend can be exercised in a normal browser with normal devtools.
3. If Wails is ever the wrong choice, only the binding layer is thrown away.

The frontend picks its transport at runtime (`frontend/src/api.ts`): if
`window.go` exists it uses Wails bindings, otherwise it POSTs to `/api/:method`. The
call signatures are identical, so no component knows or cares which is in play.

## The frontend component layer

`frontend/src/ui/` is the only place allowed to import a component library.
Everything else imports from `../ui` and sees our own narrow API — `Dialog`
takes `title`, `footer` and children, not a dozen vendor subcomponents.

Radix Primitives sits behind it, chosen for behaviour rather than styling:
focus trapping and restoration, scroll locking, `aria-hidden` on the
background, and keyboard navigation with typeahead in menus. All of that was
either missing or faked in the hand-rolled versions, and all of it matters in
an app driven from the keyboard. The styling stays ours — Radix ships none.

Deliberately *not* behind the layer: the command palette (its ranking in
`fuzzy.ts` is the point of it), the data grid (virtualised), and native
`<select>`/`<checkbox>` (already correct and accessible).

One mismatch the layer absorbs: this app mounts a dialog already-open and
unmounts it to close, so Radix's own open→closed transition never runs and its
focus restore never fires. `ui/Dialog.tsx` captures the opener during first
render and restores focus on unmount. That is the kind of vendor-shaped detail
the boundary exists to keep out of the rest of the app.

## Command palette matching

Scoring is delegated to `fuzzysort` (`frontend/src/fuzzy.ts`) — the same class
of matcher behind VS Code's file finder. What stays local to this app:

- **Where to match.** A bare query is scored against the object *name*; the
  schema and hidden keywords are only consulted at a discount, so "user" finds
  `auth.user` rather than everything in a schema whose name contains those
  letters.
- **Bias.** Framework schemas (Supabase's `extensions`, `graphql`, …) and
  routines are demoted so a real table wins a close contest.
- **A relative cutoff.** This is what makes the list feel filtered. Fuzzy
  matching is inherently permissive — "user" legitimately matches `customers`
  via c-U-S-t-om-E-R-s — so results below half the best score are dropped. With
  a strong hit on screen the junk disappears; with only weak hits, they are all
  still offered rather than showing nothing.

Two rendering details that are easy to get wrong and were both bugs:

- Ranking interleaves groups, but the list draws a heading whenever the group
  changes — which produced a dozen headings for seventeen results. Results are
  regrouped after ranking, each group ordered by its best member.
- Match positions index the candidate *name*, while the row renders the longer
  *title* ("auth.user", "Connect to prod"). They must be shifted onto the title
  or the highlight lands on the wrong characters.

## The driver interface

Every dialect implements `driver.Driver` (see `internal/driver/driver.go`). The
interface is deliberately introspection-shaped rather than SQL-shaped — it returns
`[]Database`, `[]SchemaObject`, `[]Column`, not raw rows — because the four dialects
disagree profoundly about how you ask those questions.

The main asymmetries the interface has to absorb:

| | MySQL/MariaDB | PostgreSQL | SQL Server | SQLite |
| --- | --- | --- | --- | --- |
| Server hosts many DBs | yes | yes, but one per connection | yes | no, one file |
| Schemas within a DB | no (db *is* the schema) | yes | yes | no |
| Switching database | `USE db` on same conn | new connection required | `USE db` on same conn | n/a |
| Identifier quoting | `` `x` `` | `"x"` | `[x]` | `"x"` |
| Placeholder | `?` | `$1` | `@p1` | `?` |
| Pagination | `LIMIT n OFFSET m` | `LIMIT n OFFSET m` | `OFFSET m ROWS FETCH NEXT n ROWS ONLY` | `LIMIT n OFFSET m` |

Postgres needing a fresh connection per database is the reason `engine` keys its pool
on `(connectionID, database)` rather than just `connectionID`.

SQL Server's `OFFSET/FETCH` requires an `ORDER BY`. When the user has not chosen a
sort, the mssql driver falls back to ordering by the primary key, then by the first
column, so pagination stays stable.

## Row browsing and the filter box

`Ctrl+F` is a raw SQL fragment appended after `WHERE`. It is **not** escaped or
parsed — that is the point, it is an expert tool, the same as TablePlus. The query is
assembled as:

```sql
SELECT * FROM <quoted ref> [WHERE <user fragment>] [ORDER BY <sort>] [LIMIT/OFFSET]
```

The user fragment is interpolated, so a malformed fragment produces a database syntax
error that is shown verbatim in the UI. This is intentional and is documented in
`docs/adr/0002-raw-sql-filter.md`. It is safe because the fragment is authored by the
person who already holds the credentials — but it means the filter box must never be
fed anything that did not come from a keystroke.

Everything *around* the fragment — table names, schema names, sort columns, limits and
offsets — is quoted or parameterised by the driver. Only the fragment is raw.

## Pagination

Three modes, chosen in the UI and carried on every `ReadRows` request:

- **Paged** (default): `limit = pageSize`, `offset = (page-1) * pageSize`.
- **Off**: no `LIMIT` clause is emitted. A `HardRowCap` of 100k rows still applies in
  `engine` so a mistake cannot exhaust memory; the UI reports when the cap trims a
  result.
- **Count**: exact row counts are a separate, optional call (`CountRows`), because
  `SELECT count(*)` on a large table is slow and should not be on the hot path of
  every page turn. The UI fetches a page first, then the count in the background.

## Type handling

`sql.Rows` gives back `[]byte` for most driver types. `internal/driver/scan.go`
normalises everything to a small JSON-safe set — string, number, bool, null — and
records the database's own type name per column separately, so the grid can render a
`NULL` distinctly from an empty string. Binary columns are reported as `\x…` hex with
a byte count rather than shipped to the frontend in full.

## Long values

Text-shaped columns — `text`, `longtext`, `json`, `jsonb`, `nvarchar(max)`, … — are
capped to `textCapChars` (Settings, 1024 by default — roughly the 1 kB DBeaver uses;
0 turns it off). Two layers, and
the first is the one that matters:

1. **In the emitted SQL.** `BuildSelect` replaces `SELECT *` with an explicit column
   list in which long columns are wrapped in the dialect's substring — `LEFT()` in
   MySQL, `left(…::text, n)` in postgres, `SUBSTRING(CAST(… AS nvarchar(max)), 1, n)`
   in SQL Server, `substr()` in SQLite. The server does the cutting, so the megabytes
   never cross the wire. The substring is the one SQL fragment a dialect has to hand
   back, and it goes through the unexported `textCapper` interface rather than
   `Driver`, which stays introspection-shaped.

   Which columns qualify is decided by `isLongTextType` from the introspected type
   name *and the cap in force*: a `varchar(64)` cannot exceed a cap of 1024, so it is
   left alone and the list collapses back to `SELECT *` when nothing qualifies.
   Without column metadata — a view that cannot be introspected — there is nothing to
   rewrite and only layer 2 applies.

2. **While scanning** (`RunQuery`, `QueryOptions.TextCap`). The query asks for
   `cap + 1` characters; that extra character is what tells the scan the value was
   cut, with no second query and no `length()` column per row. The scan trims it and
   records the position in `ResultSet.TruncatedCells`, which the grid marks with a
   `CUT` badge. This layer also covers ad-hoc SQL from the editor, whose statement
   must not be rewritten.

`ReadCell` is the escape hatch: one column of one row, uncapped, bounded by
`MaxCellBytes` (8 MiB). The row is addressed by its absolute offset in the same
filtered, sorted result the grid is showing rather than by primary key, so it works
on a view and on a table with no key — at the cost that on a table being written to
concurrently the offset may have moved. The cell viewer
(`frontend/src/components/CellDialog.tsx`) fetches it on open and renders JSON —
whether the column is `json`/`jsonb` or merely a text column holding some — as a
collapsible tree (`JsonView.tsx`, hand-rolled; see `frontend/src/ui/README.md`).
