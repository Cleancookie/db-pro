import { describe, expect, it } from 'vitest'
import { measuredSpan, offsetToShow, uniformSpan, worthAnimating } from './scroll'

/**
 * The rule these pin down: the focused cell ends up whole and *below* the
 * sticky chrome, never tucked a pixel under it. That was the bug — the
 * virtualiser counted the covered strip as visible, so a cell nudged into view
 * was the header's to draw over.
 */
describe('offsetToShow', () => {
  const v = { offset: 0, length: 100, sticky: 20 }

  it('leaves a span already clear of the chrome alone', () => {
    expect(offsetToShow(v, { start: 30, size: 10 })).toBe(0)
  })

  it('scrolls back until a span under the sticky chrome clears it', () => {
    // Visible in the browser's terms, hidden in the user's: 15..25 sits behind
    // a 20px header. It has to land at 20, so the offset goes negative-ward.
    expect(offsetToShow({ ...v, offset: 0 }, { start: 15, size: 10 })).toBe(0)
    expect(offsetToShow({ ...v, offset: 30 }, { start: 40, size: 10 })).toBe(20)
  })

  it('scrolls forward until the far edge is inside', () => {
    expect(offsetToShow(v, { start: 90, size: 30 })).toBe(20)
  })

  it('shows the start of a span too big to fit', () => {
    // 200px of cell in 80px of uncovered viewport: the far-edge rule would show
    // its end, which is the wrong half of a value.
    expect(offsetToShow(v, { start: 300, size: 200 })).toBe(280)
  })

  it('never returns a negative offset', () => {
    expect(offsetToShow({ offset: 0, length: 100, sticky: 20 }, { start: 0, size: 10 })).toBe(0)
  })
})

describe('spans', () => {
  it('places uniform items after the leading chrome', () => {
    expect(uniformSpan(3, 26, 30)).toEqual({ start: 108, size: 26 })
  })

  it('sums measured sizes up to the index', () => {
    expect(measuredSpan(2, [10, 20, 40, 80], 5)).toEqual({ start: 35, size: 40 })
  })

  it('treats an index past the end as empty', () => {
    expect(measuredSpan(9, [10, 20])).toEqual({ start: 30, size: 0 })
  })
})

describe('worthAnimating', () => {
  it('animates a correction of a cell or two', () => {
    expect(worthAnimating(26, 400)).toBe(true)
    expect(worthAnimating(-26, 400)).toBe(true)
  })

  it('jumps a scroll of thousands of rows', () => {
    expect(worthAnimating(90_000, 400)).toBe(false)
  })
})
