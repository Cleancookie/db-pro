import { describe, expect, it } from 'vitest'
import { elapsedFor, trayStatus } from './activity'
import type { RunningQuery } from './types'

function query(over: Partial<RunningQuery> = {}): RunningQuery {
  return {
    id: 'q1',
    connectionId: 'c1',
    database: 'shop',
    kind: 'browse',
    sql: 'select * from orders',
    // Deliberately far from the browser's clock: nothing may read it.
    startedAt: '1999-01-01T00:00:00Z',
    elapsedMs: 250,
    cancelled: false,
    ...over,
  }
}

describe('elapsedFor', () => {
  it('adds the time since the poll to the number Go measured', () => {
    expect(elapsedFor(query(), 1000, 1400)).toBe(650)
  })

  it('ignores the server wall clock entirely', () => {
    // Same inputs, a startedAt from a decade away: same answer.
    const skewed = query({ startedAt: '2040-06-01T12:00:00Z' })
    expect(elapsedFor(skewed, 1000, 1400)).toBe(650)
  })

  it('never counts backwards when the clock jumps back', () => {
    expect(elapsedFor(query(), 5000, 4000)).toBe(250)
  })
})

describe('trayStatus', () => {
  it('is empty when nothing is running', () => {
    expect(trayStatus([], 1000, 2000)).toEqual({ running: 0, cancelling: 0, longestMs: 0 })
  })

  it('reports the oldest query, not the newest', () => {
    const s = trayStatus(
      [query({ id: 'q2', elapsedMs: 40 }), query({ id: 'q1', elapsedMs: 9000 })],
      1000,
      1100,
    )
    expect(s.running).toBe(2)
    expect(s.longestMs).toBe(9100)
  })

  it('counts queries that are cancelling', () => {
    const s = trayStatus([query({ cancelled: true }), query({ id: 'q2' })], 0, 0)
    expect(s).toEqual({ running: 2, cancelling: 1, longestMs: 250 })
  })
})
