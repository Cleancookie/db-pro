import { describe, expect, it } from 'vitest'
import { parsePageSize } from './pageSize'

describe('parsePageSize', () => {
  // The reported request: "eg 5 if i just happen to know thats a
  // specifically gnarly table" — a plain small integer must just work.
  it('accepts a plain positive integer', () => {
    expect(parsePageSize('5', 100_000)).toBe(5)
  })

  it('rejects non-numeric input rather than coercing it', () => {
    expect(parsePageSize('abc', 100_000)).toBeNull()
    expect(parsePageSize('', 100_000)).toBeNull()
  })

  it('rejects zero and negative values', () => {
    expect(parsePageSize('0', 100_000)).toBeNull()
    expect(parsePageSize('-5', 100_000)).toBeNull()
  })

  it('truncates a fractional value rather than rejecting it', () => {
    expect(parsePageSize('12.9', 100_000)).toBe(12)
  })

  it('clamps to the row cap instead of sending an unbounded page size', () => {
    expect(parsePageSize('999999999', 100_000)).toBe(100_000)
  })

  it('leaves an in-range value untouched', () => {
    expect(parsePageSize('250', 100_000)).toBe(250)
  })
})
