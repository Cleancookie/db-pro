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

## Built since

- **Cap long values on read**, and **JSON viewer** — the two items that had to
  be designed together, because a capped value needs a "fetch the whole thing"
  path before there is anything for a viewer to show. See `ARCHITECTURE.md`
  ("Long values") and the 2026-08-17 entry in `REQUIREMENTS.md`.
