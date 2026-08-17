import { useStore } from '../store'

/**
 * The server-side view: which connections are open, to which databases, and
 * what each pool is doing. Stable, tabular, and worth reading a column at a
 * time — which is why it is a page and the in-flight queries are a tray.
 *
 * The tray is the only activity poller; this page reads the same snapshot from
 * the store. See ActivityTray.tsx.
 */
export function ActivityPage() {
  const activity = useStore((s) => s.activity)
  const connections = useStore((s) => s.connections)
  const setView = useStore((s) => s.setView)
  const setTrayOpen = useStore((s) => s.setTrayOpen)
  const disconnect = useStore((s) => s.disconnect)

  const nameOf = (id: string) => connections.find((c) => c.id === id)?.name ?? id

  return (
    <div className="flex h-full flex-col">
      <div className="chrome flex items-center gap-2 border-b border-[var(--color-border)] bg-[var(--color-panel)] px-3 py-1.5">
        <span className="text-[0.625rem] font-semibold tracking-wider text-[var(--color-faint)] uppercase">
          Connections
        </span>
        <span className="text-xs text-[var(--color-faint)]">
          {activity.sessions.length} open connection
          {activity.sessions.length === 1 ? '' : 's'}
        </span>
        <button
          onClick={() => setTrayOpen(true)}
          className="text-xs text-[var(--color-accent)] hover:underline"
        >
          {activity.queries.length} running — show in the tray
        </button>
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
