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
