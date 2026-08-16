import { useVirtualizer } from '@tanstack/react-virtual'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { Cell, Column, ResultSet, Sort } from '../types'

const ROW_HEIGHT = 26
const HEADER_HEIGHT = 30
// Slightly wider than the true advance of the mono faces we target. Erring
// high costs a little horizontal space; erring low truncates values, which is
// the one thing a data grid must not do casually.
const CHAR_PX = 7.6
const MIN_COL = 84
const MAX_COL = 460
const WIDTH_SAMPLE_ROWS = 120

interface Props {
  result: ResultSet
  /** Introspected column metadata; absent when running ad-hoc SQL. */
  columns?: Column[]
  orderBy?: Sort[]
  onSort?: (column: string) => void
  /** Row offset of the first row, so numbering continues across pages. */
  rowOffset?: number
}

/**
 * Virtualised result grid. Only the visible rows are in the DOM, so a 100k-row
 * result with pagination off stays responsive.
 */
export function DataGrid({ result, columns, orderBy, onSort, rowOffset = 0 }: Props) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const [selected, setSelected] = useState<{ row: number; col: number } | null>(null)

  const meta = useMemo(() => {
    const byName = new Map((columns ?? []).map((c) => [c.name, c]))
    return result.columns.map((rc) => ({
      ...rc,
      column: byName.get(rc.name),
      numeric: isNumericType(rc.dbType, byName.get(rc.name)?.dataType),
    }))
  }, [result.columns, columns])

  // Widths are measured from a sample rather than the whole result: scanning
  // 100k rows to size columns would cost more than rendering them.
  const widths = useMemo(() => {
    const sample = result.rows.slice(0, WIDTH_SAMPLE_ROWS)
    return meta.map((m, i) => {
      let longest = m.name.length + (m.column?.primaryKey ? 2 : 0)
      for (const row of sample) {
        const len = displayValue(row[i]).length
        if (len > longest) longest = len
      }
      return Math.round(Math.min(MAX_COL, Math.max(MIN_COL, longest * CHAR_PX + 26)))
    })
  }, [meta, result.rows])

  const totalWidth = widths.reduce((a, b) => a + b, 0) + 56

  const virtualizer = useVirtualizer({
    count: result.rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 12,
  })

  // A new result set should start at the top, not wherever the last one was.
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: 0 })
    setSelected(null)
  }, [result])

  // Ctrl+C copies the selected cell. Copying what you are looking at is the
  // single most common thing done with a result grid.
  useEffect(() => {
    const onCopy = (e: KeyboardEvent) => {
      if (!selected || !(e.ctrlKey || e.metaKey) || e.key !== 'c') return
      if (window.getSelection()?.toString()) return // let a text selection win
      const value = result.rows[selected.row]?.[selected.col]
      if (value === undefined) return
      e.preventDefault()
      void navigator.clipboard?.writeText(value === null ? '' : String(value))
    }
    window.addEventListener('keydown', onCopy)
    return () => window.removeEventListener('keydown', onCopy)
  }, [selected, result])

  if (result.columns.length === 0) {
    return (
      <div className="flex h-full items-center justify-center text-[var(--color-faint)]">
        {result.rowsAffected != null
          ? `${result.rowsAffected} row(s) affected`
          : 'Statement completed with no result set'}
      </div>
    )
  }

  const sort = orderBy?.[0]

  return (
    <div ref={scrollRef} className="h-full overflow-auto font-[var(--font-mono)] text-[12px]">
      <div style={{ width: totalWidth, minWidth: '100%' }}>
        <div
          className="chrome sticky top-0 z-10 flex border-b border-[var(--color-border-strong)] bg-[var(--color-panel)]"
          style={{ height: HEADER_HEIGHT }}
        >
          <div
            className="shrink-0 border-r border-[var(--color-border)]"
            style={{ width: 56 }}
            aria-hidden
          />
          {meta.map((m, i) => {
            const active = sort?.column === m.name
            return (
              <button
                key={`${m.name}-${i}`}
                onClick={() => onSort?.(m.name)}
                disabled={!onSort}
                title={`${m.name}${m.column ? ` · ${m.column.dataType}` : ''}${
                  m.column?.primaryKey ? ' · primary key' : ''
                }`}
                className={`flex shrink-0 items-center gap-1 border-r border-[var(--color-border)] px-2 text-left ${
                  onSort ? 'hover:bg-[var(--color-elevated)]' : 'cursor-default'
                }`}
                style={{ width: widths[i] }}
              >
                {m.column?.primaryKey && (
                  // A text badge rather than a key glyph: symbol fonts vary
                  // wildly across the platforms this ships to, and a tofu box
                  // next to a column name reads as corruption.
                  <span
                    className="shrink-0 rounded-sm bg-[var(--color-warn)]/20 px-1 text-[9px] font-semibold text-[var(--color-warn)]"
                    title="primary key"
                  >
                    PK
                  </span>
                )}
                <span
                  className={`truncate ${active ? 'text-[var(--color-accent)]' : 'text-[var(--color-text)]'}`}
                >
                  {m.name}
                </span>
                {active && (
                  <span className="ml-auto shrink-0 text-[var(--color-accent)]">
                    {sort.desc ? '▾' : '▴'}
                  </span>
                )}
              </button>
            )
          })}
        </div>

        <div style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
          {virtualizer.getVirtualItems().map((v) => {
            const row = result.rows[v.index]
            return (
              <div
                key={v.key}
                className={`absolute flex ${
                  v.index % 2 === 1 ? 'bg-white/[0.015]' : ''
                } hover:bg-[var(--color-accent-dim)]/15`}
                style={{
                  top: v.start,
                  height: v.size,
                  left: 0,
                  right: 0,
                  minWidth: totalWidth,
                }}
              >
                <div
                  className="chrome flex shrink-0 items-center justify-end border-r border-[var(--color-border)] pr-2 text-[11px] text-[var(--color-faint)] select-none"
                  style={{ width: 56 }}
                >
                  {rowOffset + v.index + 1}
                </div>
                {meta.map((m, ci) => {
                  const isSelected = selected?.row === v.index && selected.col === ci
                  const value = row[ci]
                  return (
                    <div
                      key={ci}
                      onMouseDown={() => setSelected({ row: v.index, col: ci })}
                      className={`shrink-0 truncate border-r border-[var(--color-border)] px-2 leading-[26px] ${
                        m.numeric ? 'text-right' : ''
                      } ${isSelected ? 'bg-[var(--color-accent-dim)]/60 ring-1 ring-[var(--color-accent)] ring-inset' : ''}`}
                      style={{ width: widths[ci] }}
                      title={value === null ? 'NULL' : String(value)}
                    >
                      {value === null ? (
                        // NULL and '' must never look the same — telling them
                        // apart is half of why people open a GUI at all.
                        <span className="text-[var(--color-faint)] italic">NULL</span>
                      ) : value === '' ? (
                        <span className="text-[var(--color-faint)] italic">empty</span>
                      ) : typeof value === 'boolean' ? (
                        <span className="text-[var(--color-warn)]">{String(value)}</span>
                      ) : (
                        String(value)
                      )}
                    </div>
                  )
                })}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

function displayValue(v: Cell): string {
  if (v === null) return 'NULL'
  return String(v)
}

/** Right-aligning numbers makes magnitude comparable down a column. */
function isNumericType(dbType: string, dataType?: string): boolean {
  const t = `${dbType} ${dataType ?? ''}`.toUpperCase()
  return /INT|DECIMAL|NUMERIC|FLOAT|DOUBLE|REAL|MONEY|SERIAL/.test(t) && !/INTERVAL|POINT/.test(t)
}
