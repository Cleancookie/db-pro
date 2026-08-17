/**
 * Arithmetic behind the activity tray.
 *
 * `elapsedMs` on a QueryInfo is a measurement Go took while answering the
 * poll, not something the browser can recompute: `startedAt` is the server's
 * wall clock and drifting clocks would make a fresh query read as ten seconds
 * old. So the tray takes the server's number and adds the time since that
 * answer arrived, which lets the timers tick between polls without polling
 * faster.
 */

import type { QueryInfo, QueryPhase } from './types'

/** Phases that mean the query has stopped. Mirrors Phase.Terminal in Go. */
const TERMINAL: readonly QueryPhase[] = ['done', 'failed', 'cancelled']

export function isRunning(q: QueryInfo): boolean {
  return !TERMINAL.includes(q.phase)
}

/**
 * Elapsed time to show for one query, extrapolated to `now` while it runs.
 * A finished query keeps the duration it finished with — history must not
 * appear to still be counting.
 */
export function elapsedFor(q: QueryInfo, polledAt: number, now: number): number {
  if (!isRunning(q)) return q.elapsedMs
  // Clamp: a clock that jumps backwards must not make a timer count down.
  return q.elapsedMs + Math.max(0, now - polledAt)
}

/**
 * The log the tray shows.
 *
 * Go retains every kind, catalogue reads included — a describe that vanishes
 * the moment it finishes is what made the log untrustworthy. But those fire on
 * every table open and tree expansion, so by default they are filtered out of
 * the *view*: the data is there and one toggle away, rather than discarded.
 *
 * Anything still running is always shown, whatever its kind. A slow
 * `information_schema` query is exactly the thing worth seeing.
 */
export function visibleQueries(queries: QueryInfo[], showCatalogue: boolean): QueryInfo[] {
  if (showCatalogue) return queries
  return queries.filter((q) => q.kind !== 'introspect' || isRunning(q))
}

/** How many catalogue rows the filter is currently hiding. */
export function hiddenCatalogueCount(queries: QueryInfo[]): number {
  return queries.length - visibleQueries(queries, false).length
}

/** What the collapsed strip has to say without expanding anything. */
export interface TrayStatus {
  running: number
  /** Asked to stop but not yet unwound — shown separately so the strip does
   *  not look stuck while a cancel propagates to the driver. */
  cancelling: number
  /** Age of the oldest running query, which is the number people watch. */
  longestMs: number
  /** Finished queries retained in the log. */
  finished: number
}

export function trayStatus(queries: QueryInfo[], polledAt: number, now: number): TrayStatus {
  let running = 0
  let cancelling = 0
  let longestMs = 0
  let finished = 0
  for (const q of queries) {
    if (!isRunning(q)) {
      finished++
      continue
    }
    running++
    if (q.phase === 'cancelling') cancelling++
    longestMs = Math.max(longestMs, elapsedFor(q, polledAt, now))
  }
  return { running, cancelling, longestMs, finished }
}
