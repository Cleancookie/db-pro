/**
 * The grid's cell range, and what copying one puts on the clipboard.
 *
 * The shape of the selection decides the format, and nothing else does — there
 * is no setting. One cell is the value as it stands, one column is an `IN` list,
 * anything wider is CSV. That is enough to cover pasting into a WHERE clause,
 * into a spreadsheet, and into a chat window, without asking the user which of
 * nine formats they meant.
 *
 * Values are taken verbatim: duplicates and NULLs are kept. A list that quietly
 * differs from what was selected is worse than one with a useless NULL in it,
 * which the user can see and delete.
 */

import type { Cell } from './types'

export interface CellPos {
  row: number
  col: number
}

/** A rectangle of cells, anchored where the selection started. */
export interface Selection {
  anchor: CellPos
  focus: CellPos
}

export interface Rect {
  top: number
  left: number
  bottom: number
  right: number
}

/** The selection as an ordered rectangle, whichever way it was dragged. */
export function rectOf(sel: Selection): Rect {
  return {
    top: Math.min(sel.anchor.row, sel.focus.row),
    bottom: Math.max(sel.anchor.row, sel.focus.row),
    left: Math.min(sel.anchor.col, sel.focus.col),
    right: Math.max(sel.anchor.col, sel.focus.col),
  }
}

export function inRect(r: Rect, row: number, col: number): boolean {
  return row >= r.top && row <= r.bottom && col >= r.left && col <= r.right
}

export function rectSize(r: Rect): { rows: number; cols: number; cells: number } {
  const rows = r.bottom - r.top + 1
  const cols = r.right - r.left + 1
  return { rows, cols, cells: rows * cols }
}

/**
 * A value as a SQL literal. Text is single-quoted with '' escaping, numbers and
 * booleans are bare, NULL is the keyword.
 *
 * A numeric-looking string stays quoted, because the grid cannot know whether
 * the column is text: every engine this app targets accepts `id in ('1')` for
 * an integer column, while `name in (1)` is an error on some.
 */
export function sqlLiteral(v: Cell): string {
  if (v === null) return 'NULL'
  if (typeof v === 'number') return String(v)
  if (typeof v === 'boolean') return String(v)
  return `'${v.replace(/'/g, "''")}'`
}

/** One column of values, ready to paste between the brackets of an `IN (…)`. */
export function inList(values: Cell[]): string {
  return values.map(sqlLiteral).join(', ')
}

/**
 * One CSV field. Quoted only where it has to be, so a plain list of ids stays
 * readable.
 *
 * NULL is an empty field and an empty string is a quoted empty field, which is
 * the only way CSV can tell them apart at all — and telling them apart is half
 * of why the grid marks them differently in the first place.
 */
export function csvField(v: Cell): string {
  if (v === null) return ''
  if (typeof v !== 'string') return String(v)
  if (v === '') return '""'
  if (/["\n\r,]/.test(v)) return `"${v.replace(/"/g, '""')}"`
  return v
}

/**
 * CSV with a header row of column names.
 *
 * The header is always included: the point of copying a block out of a grid is
 * to paste it somewhere that has lost the grid, and unlabelled columns are the
 * first thing anyone asks about.
 */
export function csv(columns: string[], rows: Cell[][]): string {
  return [columns.map(csvField).join(','), ...rows.map((r) => r.map(csvField).join(','))].join('\n')
}

/**
 * What copying the selection produces.
 *
 * `columns` and `rows` are already narrowed to the selected rectangle.
 */
export function selectionText(columns: string[], rows: Cell[][]): string {
  if (rows.length === 1 && columns.length === 1) {
    const v = rows[0][0]
    // A single cell is its own value, unquoted: this is the "copy what I am
    // looking at" case, and quoting it would break pasting it into anything.
    return v === null ? '' : String(v)
  }
  if (columns.length === 1) return inList(rows.map((r) => r[0]))
  return csv(columns, rows)
}

/** How the copy describes itself in a toast. */
export function describeCopy(columns: string[], rows: Cell[][]): string {
  const cells = rows.length * columns.length
  if (cells === 1) return 'Copied the cell'
  if (columns.length === 1) return `Copied ${rows.length} values as an IN list`
  return `Copied ${cells} cells as CSV (${rows.length} rows × ${columns.length} columns)`
}
