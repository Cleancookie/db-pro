// Cell coordinates and cell text.
//
// Kept out of the store so the two things that are easy to get wrong — where a
// grid row sits in the whole result, and whether the cap shortened this
// particular cell — are testable without a store or a browser.

import type { Cell, ResultSet } from './types'

/**
 * Where a grid row sits in the *whole* filtered result, which is the
 * coordinate `ReadCell` addresses rows by.
 *
 * With pagination off the grid is showing the result from the top, so the row
 * index is already absolute.
 */
export function absoluteRowOffset(
  rowIndex: number,
  pagination: { enabled: boolean; page: number; pageSize: number },
): number {
  if (!pagination.enabled) return rowIndex
  return (pagination.page - 1) * pagination.pageSize + rowIndex
}

/** Whether the long-value cap shortened this cell. */
export function isCellTruncated(result: ResultSet, rowIndex: number, colIndex: number): boolean {
  return (result.truncatedCells ?? []).some((c) => c.row === rowIndex && c.col === colIndex)
}

/**
 * A cell as text, for the clipboard.
 *
 * NULL copies as an empty string: there is no text that means NULL, and
 * pasting the word "NULL" into a query or a spreadsheet would be wrong in a
 * way that is hard to notice.
 */
export function cellText(value: Cell): string {
  return value === null ? '' : String(value)
}
