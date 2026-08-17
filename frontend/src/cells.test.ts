import { describe, expect, it } from 'vitest'
import { absoluteRowOffset, cellText, isCellTruncated } from './cells'
import type { ResultSet } from './types'

const result = (truncatedCells: { row: number; col: number }[]): ResultSet => ({
  columns: [{ name: 'body', dbType: 'TEXT' }],
  rows: [['x'], ['y']],
  truncated: false,
  textCap: 1024,
  truncatedCells,
  elapsedMs: 1,
  query: 'select body from t',
})

describe('absoluteRowOffset', () => {
  // The fetch of a full value addresses rows by position, so an off-by-one
  // here hands the user a different row's data — the failure this exists to
  // make testable.
  it('adds the page offset when paginated', () => {
    const paged = { enabled: true, page: 3, pageSize: 50 }
    expect(absoluteRowOffset(0, paged)).toBe(100)
    expect(absoluteRowOffset(7, paged)).toBe(107)
  })

  it('treats the first page as no offset', () => {
    expect(absoluteRowOffset(4, { enabled: true, page: 1, pageSize: 50 })).toBe(4)
  })

  it('uses the row index directly with pagination off', () => {
    expect(absoluteRowOffset(4, { enabled: false, page: 3, pageSize: 50 })).toBe(4)
  })
})

describe('isCellTruncated', () => {
  it('matches on both coordinates, not either', () => {
    const rs = result([{ row: 1, col: 0 }])
    expect(isCellTruncated(rs, 1, 0)).toBe(true)
    expect(isCellTruncated(rs, 0, 0)).toBe(false)
    expect(isCellTruncated(rs, 1, 1)).toBe(false)
  })

  it('copes with a result that predates the field', () => {
    const rs = { ...result([]), truncatedCells: undefined as unknown as [] }
    expect(isCellTruncated(rs, 0, 0)).toBe(false)
  })
})

describe('cellText', () => {
  it('copies NULL as nothing, and keeps everything else verbatim', () => {
    expect(cellText(null)).toBe('')
    expect(cellText('')).toBe('')
    expect(cellText(0)).toBe('0')
    expect(cellText(false)).toBe('false')
    expect(cellText('text')).toBe('text')
  })
})
