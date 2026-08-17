/**
 * Arithmetic behind the activity tray.
 *
 * `elapsedMs` on a RunningQuery is a measurement Go took while answering the
 * poll, not something the browser can recompute: `startedAt` is the server's
 * wall clock and drifting clocks would make a fresh query read as ten seconds
 * old. So the tray takes the server's number and adds the time since that
 * answer arrived, which lets the timers tick between polls without polling
 * faster.
 */

import type { RunningQuery } from './types'

/** Elapsed time to show for one query, extrapolated to `now`. */
export function elapsedFor(q: RunningQuery, polledAt: number, now: number): number {
  // Clamp: a clock that jumps backwards must not make a timer count down.
  return q.elapsedMs + Math.max(0, now - polledAt)
}

/** What the collapsed strip has to say without expanding anything. */
export interface TrayStatus {
  running: number
  /** Asked to stop but not yet unwound — shown separately so the strip does
   *  not look stuck while a cancel propagates to the driver. */
  cancelling: number
  /** Age of the oldest running query, which is the number people watch. */
  longestMs: number
}

export function trayStatus(
  queries: RunningQuery[],
  polledAt: number,
  now: number,
): TrayStatus {
  let cancelling = 0
  let longestMs = 0
  for (const q of queries) {
    if (q.cancelled) cancelling++
    longestMs = Math.max(longestMs, elapsedFor(q, polledAt, now))
  }
  return { running: queries.length, cancelling, longestMs }
}
