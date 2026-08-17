import { useEffect, useRef, useState } from 'react'
import { elapsedFor, trayStatus } from '../activity'
import { formatDuration } from '../commands'
import { useStore } from '../store'
import type { QueryKind, RunningQuery } from '../types'

/** How often Go is asked what is running — only while something is. */
const POLL_MS = 700
/** How often the on-screen timers advance. Local arithmetic, no request. */
const TICK_MS = 100

const KIND_LABEL: Record<QueryKind, string> = {
  browse: 'browse',
  count: 'count',
  query: 'editor',
  introspect: 'catalogue',
}

/**
 * The bottom tray: always present, collapsed to one strip, expandable to the
 * list of in-flight queries with a cancel on each.
 *
 * It is the app's only activity poller. The tray is mounted for the whole
 * session, so putting the polling here means one interval rather than one per
 * interested component — and the activity page below simply reads the store.
 *
 * The strip's height never changes with what is running. A query starting
 * must not resize the grid underneath it, so the expanded list is an overlay
 * rather than another row in the layout.
 */
export function ActivityTray() {
  const queries = useStore((s) => s.activity.queries)
  const polledAt = useStore((s) => s.activityPolledAt)
  const inFlight = useStore((s) => s.inFlight)
  const open = useStore((s) => s.trayOpen)
  const view = useStore((s) => s.view)
  const setTrayOpen = useStore((s) => s.setTrayOpen)
  const refresh = useStore((s) => s.refreshActivity)

  // Three reasons to be watching: the app is waiting on the server, the user
  // has the list open, or the activity page is on screen reading the same
  // snapshot. Otherwise there is nothing to see and nothing is asked for.
  const watching = inFlight > 0 || open || view === 'activity'
  usePolling(watching, refresh)
  const now = useTicker(watching && queries.length > 0)

  const status = trayStatus(queries, polledAt, now)
  const label =
    status.running === 0
      ? 'Nothing running'
      : `${status.running} running · ${formatDuration(status.longestMs)}` +
        (status.cancelling > 0 ? ` · ${status.cancelling} cancelling` : '')

  return (
    <div className="chrome relative shrink-0 border-t border-[var(--color-border)] bg-[var(--color-panel)]">
      {open && (
        <div className="absolute inset-x-0 bottom-full max-h-[40vh] overflow-y-auto border-t border-[var(--color-border)] bg-[var(--color-panel)] shadow-[0_-8px_24px_rgba(0,0,0,0.45)]">
          {queries.length === 0 ? (
            <p className="px-3 py-4 text-center text-xs text-[var(--color-faint)]">
              No queries running
            </p>
          ) : (
            <ul className="flex flex-col">
              {queries.map((q) => (
                <QueryRow key={q.id} query={q} polledAt={polledAt} now={now} />
              ))}
            </ul>
          )}
        </div>
      )}

      {/* The strip is one button so the whole width is a hit target. */}
      <button
        onClick={() => setTrayOpen(!open)}
        aria-expanded={open}
        title="Query activity (Ctrl+J)"
        className="flex h-6 w-full items-center gap-2 px-3 text-[0.6875rem] hover:bg-[var(--color-elevated)]"
      >
        <span className="text-[var(--color-faint)]">{open ? '▾' : '▸'}</span>
        <span className="font-semibold tracking-wider text-[var(--color-faint)] uppercase">
          Activity
        </span>
        <span className={status.running > 0 ? 'text-[var(--color-text)]' : 'text-[var(--color-faint)]'}>
          {label}
        </span>
        {status.running > 0 && <IndeterminateBar className="ml-1 h-[3px] w-24 rounded-full" />}
        <span className="ml-auto font-[var(--font-mono)] text-[var(--color-faint)]">Ctrl+J</span>
      </button>
    </div>
  )
}

function QueryRow({
  query,
  polledAt,
  now,
}: {
  query: RunningQuery
  polledAt: number
  now: number
}) {
  const cancelQuery = useStore((s) => s.cancelQuery)
  const connections = useStore((s) => s.connections)
  const name = connections.find((c) => c.id === query.connectionId)?.name ?? query.connectionId
  const elapsed = elapsedFor(query, polledAt, now)

  return (
    <li className="flex items-center gap-2 border-b border-[var(--color-border)] px-3 py-1.5 text-xs last:border-b-0">
      <span className="shrink-0 rounded bg-[var(--color-accent-dim)]/40 px-1.5 py-0.5">
        {KIND_LABEL[query.kind] ?? query.kind}
      </span>
      <span className="shrink-0 text-[var(--color-muted)]">{name}</span>
      {query.database && (
        <span className="shrink-0 text-[var(--color-faint)]">/ {query.database}</span>
      )}
      {/* The SQL is one line here: the tray is a glance, and the full text is
          on the query itself if it needs reading. */}
      <span
        title={query.sql}
        className="min-w-0 flex-1 truncate font-[var(--font-mono)] text-[var(--color-muted)]"
      >
        {query.sql}
      </span>
      <IndeterminateBar className="h-[3px] w-20 shrink-0 rounded-full" warn={query.cancelled} />
      <span
        className={`w-14 shrink-0 text-right font-[var(--font-mono)] ${
          elapsed > 5000 ? 'text-[var(--color-warn)]' : 'text-[var(--color-faint)]'
        }`}
      >
        {formatDuration(elapsed)}
      </span>
      <button
        onClick={() => void cancelQuery(query.id)}
        disabled={query.cancelled}
        className="shrink-0 rounded border border-[var(--color-border-strong)] px-2 py-0.5 text-[var(--color-danger)] disabled:opacity-40 enabled:hover:border-[var(--color-danger)]"
      >
        {query.cancelled ? 'cancelling…' : 'Cancel'}
      </button>
    </li>
  )
}

/**
 * Indeterminate on purpose: a query's duration is not knowable up front, and a
 * percentage that is really a guess is worse than none. The bar shows motion,
 * the timer next to it shows the fact.
 */
function IndeterminateBar({ className = '', warn = false }: { className?: string; warn?: boolean }) {
  return (
    <span
      role="progressbar"
      aria-label="Running"
      className={`indeterminate ${warn ? 'indeterminate-warn' : ''} ${className}`}
    />
  )
}

/** Polls while `on`, and once more on the way down so a finished query leaves. */
function usePolling(on: boolean, refresh: () => Promise<void>) {
  // Starts settled: a cold, idle app must not issue a request just to be told
  // that nothing is running.
  const settled = useRef(true)

  useEffect(() => {
    if (on || !settled.current) void refresh()
    settled.current = !on
    if (!on) return
    const t = setInterval(() => void refresh(), POLL_MS)
    return () => clearInterval(t)
  }, [on, refresh])
}

/** A clock that only runs while something needs timing. */
function useTicker(on: boolean): number {
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    if (!on) return
    setNow(Date.now())
    const t = setInterval(() => setNow(Date.now()), TICK_MS)
    return () => clearInterval(t)
  }, [on])

  // While off, the value is stale but unused — nothing is running to time.
  return now
}
