import { useEffect } from 'react'
import { formatDuration } from '../commands'
import { useStore } from '../store'
import type { QueryKind } from '../types'

/** How often the page re-polls while it is open. */
const POLL_MS = 700

const KIND_LABEL: Record<QueryKind, string> = {
  browse: 'browse',
  count: 'count',
  query: 'editor',
  introspect: 'catalogue',
}

/**
 * Shows what the app currently has open and what it is running, and lets the
 * user cancel anything that is taking too long.
 *
 * Cancelling closes the query's context, which database/sql propagates to the
 * driver — so this really does stop work on the server, not just in the UI.
 */
export function ActivityPage() {
  const activity = useStore((s) => s.activity)
  const refresh = useStore((s) => s.refreshActivity)
  const cancelQuery = useStore((s) => s.cancelQuery)
  const connections = useStore((s) => s.connections)
  const setView = useStore((s) => s.setView)
  const disconnect = useStore((s) => s.disconnect)

  // Polling only runs while this page is mounted, so a background tab is not
  // issuing requests forever.
  useEffect(() => {
    void refresh()
    const t = setInterval(() => void refresh(), POLL_MS)
    return () => clearInterval(t)
  }, [refresh])

  const nameOf = (id: string) => connections.find((c) => c.id === id)?.name ?? id

  return (
    <div className="flex h-full flex-col">
      <div className="chrome flex items-center gap-2 border-b border-[var(--color-border)] bg-[var(--color-panel)] px-3 py-1.5">
        <span className="text-[0.625rem] font-semibold tracking-wider text-[var(--color-faint)] uppercase">
          Activity
        </span>
        <span className="text-xs text-[var(--color-faint)]">
          {activity.queries.length} running · {activity.sessions.length} open connection
          {activity.sessions.length === 1 ? '' : 's'}
        </span>
        <button
          onClick={() => setView('data')}
          className="ml-auto rounded px-1.5 text-[var(--color-muted)] hover:bg-[var(--color-elevated)] hover:text-[var(--color-text)]"
          title="Close"
        >
          ✕
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        <h3 className="mb-2 text-[0.625rem] font-semibold tracking-wider text-[var(--color-faint)] uppercase">
          Running queries
        </h3>
        {activity.queries.length === 0 ? (
          <p className="mb-6 rounded border border-[var(--color-border)] px-3 py-4 text-center text-[var(--color-faint)]">
            Nothing running
          </p>
        ) : (
          <ul className="mb-6 flex flex-col gap-2">
            {activity.queries.map((q) => (
              <li
                key={q.id}
                className="rounded border border-[var(--color-border-strong)] bg-[var(--color-panel)] p-3"
              >
                <div className="mb-1.5 flex flex-wrap items-center gap-2 text-xs">
                  <span className="rounded bg-[var(--color-accent-dim)]/40 px-1.5 py-0.5">
                    {KIND_LABEL[q.kind] ?? q.kind}
                  </span>
                  <span className="text-[var(--color-muted)]">{nameOf(q.connectionId)}</span>
                  {q.database && <span className="text-[var(--color-faint)]">/ {q.database}</span>}
                  <span
                    className={
                      q.elapsedMs > 5000 ? 'text-[var(--color-warn)]' : 'text-[var(--color-faint)]'
                    }
                  >
                    {formatDuration(q.elapsedMs)}
                  </span>
                  {q.cancelled && (
                    <span className="text-[var(--color-warn)]">cancelling…</span>
                  )}
                  <button
                    onClick={() => void cancelQuery(q.id)}
                    disabled={q.cancelled}
                    className="ml-auto rounded border border-[var(--color-border-strong)] px-2 py-0.5 text-[var(--color-danger)] disabled:opacity-40 enabled:hover:border-[var(--color-danger)]"
                  >
                    Cancel
                  </button>
                </div>
                <pre className="max-h-24 overflow-auto rounded bg-[var(--color-bg)] p-2 font-[var(--font-mono)] text-xs whitespace-pre-wrap text-[var(--color-muted)]">
                  {q.sql}
                </pre>
              </li>
            ))}
          </ul>
        )}

        <h3 className="mb-2 text-[0.625rem] font-semibold tracking-wider text-[var(--color-faint)] uppercase">
          Open connections
        </h3>
        {activity.sessions.length === 0 ? (
          <p className="rounded border border-[var(--color-border)] px-3 py-4 text-center text-[var(--color-faint)]">
            No open connections
          </p>
        ) : (
          <table className="w-full border-collapse text-left">
            <thead>
              <tr className="text-xs text-[var(--color-faint)]">
                <th className="border-b border-[var(--color-border)] py-1.5 pr-3 font-normal">
                  Connection
                </th>
                <th className="border-b border-[var(--color-border)] py-1.5 pr-3 font-normal">
                  Database
                </th>
                <th className="border-b border-[var(--color-border)] py-1.5 pr-3 text-right font-normal">
                  Open
                </th>
                <th className="border-b border-[var(--color-border)] py-1.5 pr-3 text-right font-normal">
                  In use
                </th>
                <th className="border-b border-[var(--color-border)] py-1.5 pr-3 text-right font-normal">
                  Idle
                </th>
                <th className="border-b border-[var(--color-border)] py-1.5" />
              </tr>
            </thead>
            <tbody>
              {activity.sessions.map((s) => (
                <tr key={`${s.connectionId}:${s.database}`}>
                  <td className="border-b border-[var(--color-border)] py-1.5 pr-3">
                    {nameOf(s.connectionId)}
                  </td>
                  <td className="border-b border-[var(--color-border)] py-1.5 pr-3 text-[var(--color-muted)]">
                    {s.database || '—'}
                  </td>
                  <td className="border-b border-[var(--color-border)] py-1.5 pr-3 text-right font-[var(--font-mono)]">
                    {s.openConns}
                  </td>
                  <td className="border-b border-[var(--color-border)] py-1.5 pr-3 text-right font-[var(--font-mono)]">
                    {s.inUse}
                  </td>
                  <td className="border-b border-[var(--color-border)] py-1.5 pr-3 text-right font-[var(--font-mono)]">
                    {s.idle}
                  </td>
                  <td className="border-b border-[var(--color-border)] py-1.5 text-right">
                    <button
                      onClick={() => void disconnect(s.connectionId)}
                      className="rounded border border-[var(--color-border-strong)] px-2 py-0.5 text-xs hover:border-[var(--color-danger)] hover:text-[var(--color-danger)]"
                    >
                      Disconnect
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
