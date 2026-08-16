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
