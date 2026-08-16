import { useEffect, useState } from 'react'
import { formatCount } from '../commands'
import { PAGE_SIZES, useStore } from '../store'

/**
 * Pagination controls: page size, page number, or switched off entirely.
 *
 * With pagination off the app fetches every matching row up to the 100k cap in
 * internal/driver/scan.go, and the grid virtualises them.
 */
export function Paginator() {
  const enabled = useStore((s) => s.paginationEnabled)
  const page = useStore((s) => s.page)
  const pageSize = useStore((s) => s.pageSize)
  const hasMore = useStore((s) => s.hasMore)
  const totalCount = useStore((s) => s.totalCount)
  const result = useStore((s) => s.result)
  const busy = useStore((s) => s.busy)
  const setPage = useStore((s) => s.setPage)
  const setPageSize = useStore((s) => s.setPageSize)
  const setPaginationEnabled = useStore((s) => s.setPaginationEnabled)

  const [pageDraft, setPageDraft] = useState(String(page))
  useEffect(() => setPageDraft(String(page)), [page])

  const rowCount = result?.rows.length ?? 0
  const firstRow = enabled ? (page - 1) * pageSize + 1 : 1
  const lastRow = enabled ? firstRow + rowCount - 1 : rowCount
  const lastPage = totalCount != null && enabled ? Math.max(1, Math.ceil(totalCount / pageSize)) : null

  const commitPage = () => {
    const n = Number.parseInt(pageDraft, 10)
    if (Number.isFinite(n) && n >= 1) void setPage(n)
    else setPageDraft(String(page))
  }

  return (
    <div className="chrome flex items-center gap-3 border-t border-[var(--color-border)] bg-[var(--color-panel)] px-3 py-1.5 text-[11px]">
      <label className="flex items-center gap-1.5 text-[var(--color-muted)]">
        <input
          type="checkbox"
          checked={enabled}
          onChange={(e) => void setPaginationEnabled(e.target.checked)}
        />
        Paginate
      </label>

      {enabled ? (
        <>
          <label className="flex items-center gap-1.5 text-[var(--color-muted)]">
            Per page
            <select
              value={pageSize}
              onChange={(e) => void setPageSize(Number(e.target.value))}
              className="rounded border border-[var(--color-border-strong)] bg-[var(--color-elevated)] px-1 py-0.5 outline-none"
            >
              {PAGE_SIZES.map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </label>

          <div className="flex items-center gap-1">
            <button
              onClick={() => void setPage(1)}
              disabled={page <= 1 || busy}
              title="First page"
              className="rounded px-1.5 py-0.5 disabled:opacity-30 enabled:hover:bg-[var(--color-elevated)]"
            >
              «
            </button>
            <button
              onClick={() => void setPage(page - 1)}
              disabled={page <= 1 || busy}
              title="Previous page (Ctrl+←)"
              className="rounded px-1.5 py-0.5 disabled:opacity-30 enabled:hover:bg-[var(--color-elevated)]"
            >
              ‹
            </button>
            <input
              value={pageDraft}
              onChange={(e) => setPageDraft(e.target.value)}
              onBlur={commitPage}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  commitPage()
                  e.currentTarget.blur()
                }
              }}
              aria-label="Page number"
              className="w-12 rounded border border-[var(--color-border-strong)] bg-[var(--color-elevated)] px-1 py-0.5 text-center outline-none"
            />
            {lastPage != null && <span className="text-[var(--color-faint)]">of {lastPage}</span>}
            <button
              onClick={() => void setPage(page + 1)}
              disabled={!hasMore || busy}
              title="Next page (Ctrl+→)"
              className="rounded px-1.5 py-0.5 disabled:opacity-30 enabled:hover:bg-[var(--color-elevated)]"
            >
              ›
            </button>
          </div>
        </>
      ) : (
        <span className="text-[var(--color-warn)]">
          Pagination off — loading every matching row
        </span>
      )}

      <div className="ml-auto flex items-center gap-3 text-[var(--color-faint)]">
        {rowCount > 0 && (
          <span>
            {enabled ? `${formatCount(firstRow)}–${formatCount(lastRow)}` : formatCount(rowCount)}
            {totalCount != null && ` of ${formatCount(totalCount)}`}
          </span>
        )}
        {result?.truncated && (
          <span className="text-[var(--color-warn)]" title="The 100k row safety cap was reached">
            capped at 100k
          </span>
        )}
        {result && <span>{result.elapsedMs}ms</span>}
      </div>
    </div>
  )
}
