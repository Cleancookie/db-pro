import { useVirtualizer } from '@tanstack/react-virtual'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useStore } from '../store'
import { ContextMenu, type MenuItem } from '../ui'
import type { Cell, Column, ResultSet, Sort } from '../types'

const WIDTH_SAMPLE_ROWS = 120

/**
 * Grid metrics derived from the root font size, so the Settings slider
 * rescales rows, gutters and column widths together. Hardcoded pixels here
 * would leave larger text clipped inside unchanged row heights.
 */
function metrics(rootPx: number) {
  const cellPx = rootPx * 0.75 // the grid renders at 0.75rem
  return {
    rowHeight: Math.round(rootPx * 1.625),
    headerHeight: Math.round(rootPx * 1.875),
    gutter: Math.round(rootPx * 3.5),
    // Slightly wider than the true advance of the mono faces we target.
    // Erring high costs a little horizontal space; erring low truncates
    // values, which is the one thing a data grid must not do casually.
    charPx: cellPx * 0.64,
    minCol: Math.round(rootPx * 5.25),
    maxCol: Math.round(rootPx * 28.75),
    padPx: Math.round(rootPx * 1.6),
  }
}

interface Props {
  result: ResultSet
  /** Introspected column metadata; absent when running ad-hoc SQL. */
  columns?: Column[]
  orderBy?: Sort[]
  onSort?: (column: string) => void
  /** Row offset of the first row, so numbering continues across pages. */
  rowOffset?: number
  /** Opens one cell in the viewer — Enter, or a double-click. */
  onOpenCell?: (rowIndex: number, colIndex: number) => void
  /**
   * Right-click actions for one cell. A builder rather than a list because the
   * menu wraps the whole row area — one Radix root, not one per cell — and is
   * asked for the items of whichever cell was clicked.
   */
  cellMenu?: (rowIndex: number, colIndex: number) => MenuItem[]
}

/**
 * Virtualised result grid. Only the visible rows are in the DOM, so a 100k-row
 * result with pagination off stays responsive.
 */
export function DataGrid({
  result,
  columns,
  orderBy,
  onSort,
  rowOffset = 0,
  onOpenCell,
  cellMenu,
}: Props) {
  const scrollRef = useRef<HTMLDivElement>(null)
  // The selected cell's own element, so the keyboard menu key can open the
  // context menu where the cell is rather than at the pointer's last position.
  const selectedRef = useRef<HTMLDivElement | null>(null)
  const [selected, setSelected] = useState<{ row: number; col: number } | null>(null)
  const rootPx = useStore((s) => s.settings.fontSizePx)
  const gm = useMemo(() => metrics(rootPx), [rootPx])

  const meta = useMemo(() => {
    const byName = new Map((columns ?? []).map((c) => [c.name, c]))
    return result.columns.map((rc) => ({
      ...rc,
      column: byName.get(rc.name),
      numeric: isNumericType(rc.dbType, byName.get(rc.name)?.dataType),
    }))
  }, [result.columns, columns])

  // A set keyed on "row:col" — the API sends only the cells that were cut, and
  // a lookup per rendered cell has to be O(1) or scrolling pays for it.
  const cutCells = useMemo(
    () => new Set((result.truncatedCells ?? []).map((c) => `${c.row}:${c.col}`)),
    [result.truncatedCells],
  )

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
      return Math.round(Math.min(gm.maxCol, Math.max(gm.minCol, longest * gm.charPx + gm.padPx)))
    })
  }, [meta, result.rows, gm])

  const totalWidth = widths.reduce((a, b) => a + b, 0) + gm.gutter

  const virtualizer = useVirtualizer({
    count: result.rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => gm.rowHeight,
    overscan: 12,
  })

  // Row height changes with the font size, so the virtualiser has to remeasure
  // or every row would keep its old height.
  useEffect(() => {
    virtualizer.measure()
  }, [gm.rowHeight, virtualizer])

  // A new result set should start at the top, not wherever the last one was.
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: 0 })
    setSelected(null)
  }, [result])

  // Ctrl+C copies the selected cell, Enter opens it. Copying what you are
  // looking at is the single most common thing done with a result grid; opening
  // it is how a capped value, or a JSON document, is read at all.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!selected) return
      // A cell stays selected while the user types in the filter box, where
      // Enter means "apply" and Ctrl+C means "copy what I selected in here".
      const target = e.target as HTMLElement | null
      if (
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target instanceof HTMLSelectElement
      ) {
        return
      }
      // While the cell menu or a dialog is open the keys belong to it: Enter
      // there means "activate the highlighted item", and handling it here as
      // well would run the menu's action and open the viewer on top of it.
      if (target?.closest('[role="menu"],[role="dialog"]')) return
      if (e.key === 'Enter' && !e.ctrlKey && !e.metaKey && onOpenCell) {
        e.preventDefault()
        onOpenCell(selected.row, selected.col)
        return
      }
      // The platform menu key, and its laptop-keyboard equivalent. Radix opens
      // the menu from a contextmenu event, so the cheapest way to honour the
      // key is to raise one at the selected cell — which also puts the menu
      // where the cell is rather than wherever the pointer was left.
      if ((e.key === 'ContextMenu' || (e.shiftKey && e.key === 'F10')) && cellMenu) {
        const el = selectedRef.current
        if (!el) return
        e.preventDefault()
        const box = el.getBoundingClientRect()
        el.dispatchEvent(
          new MouseEvent('contextmenu', {
            bubbles: true,
            clientX: Math.round(box.left + 8),
            clientY: Math.round(box.bottom),
          }),
        )
        return
      }
      if (!(e.ctrlKey || e.metaKey) || e.key !== 'c') return
      if (window.getSelection()?.toString()) return // let a text selection win
      const value = result.rows[selected.row]?.[selected.col]
      if (value === undefined) return
      e.preventDefault()
      void navigator.clipboard?.writeText(value === null ? '' : String(value))
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [selected, result, onOpenCell, cellMenu])

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

  // Built for the selected cell, which right-clicking has just set through
  // mousedown. Whether there is a menu at all is decided by the prop and never
  // by the selection: mounting the trigger conditionally would rebuild the row
  // area on the first right-click, taking the element the event came from with
  // it. The placeholder is all but unreachable for the same reason.
  const menuItems: MenuItem[] | null = !cellMenu
    ? null
    : selected
      ? cellMenu(selected.row, selected.col)
      : [{ label: 'No cell selected', onSelect: () => {}, disabled: true }]
  const menuHeading = selected ? meta[selected.col]?.name : undefined

  return (
    <div ref={scrollRef} className="h-full overflow-auto font-[var(--font-mono)] text-[0.75rem]">
      <div style={{ width: totalWidth, minWidth: '100%' }}>
        <div
          className="chrome sticky top-0 z-10 flex border-b border-[var(--color-border-strong)] bg-[var(--color-panel)]"
          style={{ height: gm.headerHeight }}
        >
          <div
            className="shrink-0 border-r border-[var(--color-border)]"
            style={{ width: gm.gutter }}
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
                    className="shrink-0 rounded-sm bg-[var(--color-warn)]/20 px-1 text-[0.5625rem] font-semibold text-[var(--color-warn)]"
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

        {/* The menu wraps the row area only: the header has its own meaning
            for a click, and a cell menu over it would act on a cell that is
            nowhere near the pointer. */}
        <CellContextMenu items={menuItems} heading={menuHeading}>
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
                    className="chrome flex shrink-0 items-center justify-end border-r border-[var(--color-border)] pr-2 text-[0.6875rem] text-[var(--color-faint)] select-none"
                    style={{ width: gm.gutter }}
                  >
                    {rowOffset + v.index + 1}
                  </div>
                  {meta.map((m, ci) => {
                    const isSelected = selected?.row === v.index && selected.col === ci
                    const value = row[ci]
                    const cut = cutCells.has(`${v.index}:${ci}`)
                    return (
                      <div
                        key={ci}
                        ref={isSelected ? selectedRef : undefined}
                        onMouseDown={() => setSelected({ row: v.index, col: ci })}
                        // mousedown already fires for the right button, but a
                        // ctrl-click on macOS arrives as a contextmenu without
                        // one. The menu must always act on the cell that was
                        // actually clicked, never on a stale selection.
                        onContextMenu={() => setSelected({ row: v.index, col: ci })}
                        onDoubleClick={() => onOpenCell?.(v.index, ci)}
                        className={`shrink-0 truncate border-r border-[var(--color-border)] px-2 ${
                          m.numeric ? 'text-right' : ''
                        } ${isSelected ? 'bg-[var(--color-accent-dim)]/60 ring-1 ring-[var(--color-accent)] ring-inset' : ''}`}
                        style={{ width: widths[ci], lineHeight: `${gm.rowHeight}px` }}
                        title={
                          value === null
                            ? 'NULL'
                            : cut
                              ? `${String(value)}\n\n(cut to ${result.textCap} characters — Enter for the whole value)`
                              : String(value)
                        }
                      >
                        {value === null ? (
                          // NULL and '' must never look the same — telling them
                          // apart is half of why people open a GUI at all.
                          <span className="text-[var(--color-faint)] italic">NULL</span>
                        ) : value === '' ? (
                          <span className="text-[var(--color-faint)] italic">empty</span>
                        ) : typeof value === 'boolean' ? (
                          <span className="text-[var(--color-warn)]">{String(value)}</span>
                        ) : cut ? (
                          // Truncation must be visible in the cell, not only in
                          // the tooltip: a value that was cut but looks whole is
                          // worse than no value at all. The badge is pinned to
                          // the right of the cell and the text truncates before
                          // it, or the marker would be the first thing scrolled
                          // out of sight — capped values always overflow.
                          <span className="flex min-w-0 items-center gap-1">
                            <span className="truncate">{String(value)}</span>
                            <span className="shrink-0 rounded-sm bg-[var(--color-warn)]/20 px-1 text-[0.5625rem] font-semibold text-[var(--color-warn)]">
                              CUT
                            </span>
                          </span>
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
        </CellContextMenu>
      </div>
    </div>
  )
}

/**
 * The row area's right-click menu, or the row area unchanged when the grid was
 * given no menu to show. Keeping the decision here means the trigger wraps
 * exactly the same element either way, so nothing about the grid's layout
 * depends on whether a menu was supplied.
 */
function CellContextMenu({
  items,
  heading,
  children,
}: {
  items: MenuItem[] | null
  heading?: string
  children: React.ReactNode
}) {
  if (!items) return children
  return (
    <ContextMenu items={items} heading={heading}>
      {children}
    </ContextMenu>
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
