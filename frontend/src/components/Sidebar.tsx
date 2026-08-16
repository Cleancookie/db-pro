import { useMemo, useState } from 'react'
import { describeConnection, formatCount, OBJECT_ICON } from '../commands'
import { rank } from '../fuzzy'
import { useStore } from '../store'
import type { ObjectType, SchemaObject } from '../types'

const GROUP_ORDER: ObjectType[] = ['table', 'view', 'function', 'procedure']
const GROUP_LABEL: Record<ObjectType, string> = {
  table: 'Tables',
  view: 'Views',
  function: 'Functions',
  procedure: 'Procedures',
}

export function Sidebar() {
  const connections = useStore((s) => s.connections)
  const connectedIds = useStore((s) => s.connectedIds)
  const activeConnectionId = useStore((s) => s.activeConnectionId)
  const capabilities = useStore((s) => s.capabilities)
  const databases = useStore((s) => s.databases)
  const activeDatabase = useStore((s) => s.activeDatabase)
  const objects = useStore((s) => s.objects)
  const activeRef = useStore((s) => s.activeRef)
  const connect = useStore((s) => s.connect)
  const selectDatabase = useStore((s) => s.selectDatabase)
  const openObject = useStore((s) => s.openObject)
  const setDialog = useStore((s) => s.setDialog)

  const [treeQuery, setTreeQuery] = useState('')

  const grouped = useMemo(() => {
    const matched = treeQuery
      ? rank(treeQuery, objects, (o) => (o.schema ? `${o.schema}.${o.name}` : o.name)).map(
          (r) => r.item,
        )
      : objects
    const out = new Map<ObjectType, SchemaObject[]>()
    for (const o of matched) {
      const list = out.get(o.type)
      if (list) list.push(o)
      else out.set(o.type, [o])
    }
    return out
  }, [objects, treeQuery])

  return (
    <aside className="chrome flex w-64 shrink-0 flex-col border-r border-[var(--color-border)] bg-[var(--color-panel)]">
      <div className="flex items-center justify-between px-3 pt-3 pb-1">
        <span className="text-[10px] font-semibold tracking-wider text-[var(--color-faint)] uppercase">
          Connections
        </span>
        <button
          onClick={() => setDialog({ kind: 'connection', connection: null })}
          title="New connection"
          className="rounded px-1.5 text-[var(--color-muted)] hover:bg-[var(--color-elevated)] hover:text-[var(--color-text)]"
        >
          +
        </button>
      </div>

      <div className="max-h-44 overflow-y-auto px-1.5 pb-2">
        {connections.length === 0 && (
          <p className="px-1.5 py-2 text-[11px] leading-relaxed text-[var(--color-faint)]">
            No connections yet. Press{' '}
            <kbd className="rounded border border-[var(--color-border-strong)] px-1">Ctrl+K</kbd>{' '}
            and choose “New connection”.
          </p>
        )}
        {connections.map((c) => {
          const active = c.id === activeConnectionId
          return (
            <button
              key={c.id}
              onClick={() => connect(c.id)}
              onDoubleClick={() => setDialog({ kind: 'connection', connection: c })}
              className={`flex w-full items-center gap-2 rounded px-1.5 py-1 text-left ${
                active ? 'bg-[var(--color-accent-dim)]/45' : 'hover:bg-[var(--color-elevated)]'
              }`}
            >
              <span
                className="h-2 w-2 shrink-0 rounded-full"
                style={{
                  background: c.colour || (connectedIds.includes(c.id) ? '#5dd6a0' : '#4a525e'),
                }}
                title={connectedIds.includes(c.id) ? 'connected' : 'not connected'}
              />
              <span className="min-w-0 flex-1">
                <span className="block truncate">{c.name}</span>
                <span className="block truncate text-[10px] text-[var(--color-faint)]">
                  {describeConnection(c.kind, c.host, c.file)}
                </span>
              </span>
            </button>
          )
        })}
      </div>

      {activeConnectionId && capabilities?.serverHostsDatabases && (
        <div className="border-t border-[var(--color-border)] px-3 py-2">
          <label
            className="mb-1 block text-[10px] font-semibold tracking-wider text-[var(--color-faint)] uppercase"
            htmlFor="database-select"
          >
            Database
          </label>
          <select
            id="database-select"
            value={activeDatabase}
            onChange={(e) => selectDatabase(e.target.value)}
            className="w-full rounded border border-[var(--color-border-strong)] bg-[var(--color-elevated)] px-1.5 py-1 outline-none"
          >
            {databases.map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
          </select>
        </div>
      )}

      {activeConnectionId && (
        <>
          <div className="border-t border-[var(--color-border)] px-3 pt-2 pb-1.5">
            <input
              value={treeQuery}
              onChange={(e) => setTreeQuery(e.target.value)}
              placeholder="Filter objects…"
              spellCheck={false}
              aria-label="Filter objects"
              className="w-full rounded border border-[var(--color-border-strong)] bg-[var(--color-elevated)] px-1.5 py-1 outline-none placeholder:text-[var(--color-faint)]"
            />
          </div>

          <div className="flex-1 overflow-y-auto px-1.5 pb-3">
            {objects.length === 0 && (
              <p className="px-1.5 py-2 text-[11px] text-[var(--color-faint)]">No objects</p>
            )}
            {GROUP_ORDER.map((type) => {
              const list = grouped.get(type)
              if (!list || list.length === 0) return null
              return (
                <section key={type} className="mt-2">
                  <h3 className="px-1.5 pb-0.5 text-[10px] font-semibold tracking-wider text-[var(--color-faint)] uppercase">
                    {GROUP_LABEL[type]} <span className="opacity-60">{list.length}</span>
                  </h3>
                  {list.map((o) => {
                    const qualified = o.schema ? `${o.schema}.${o.name}` : o.name
                    const active = activeRef?.name === o.name && activeRef?.schema === o.schema
                    return (
                      <button
                        key={`${type}:${qualified}`}
                        onClick={() => openObject(o)}
                        title={qualified}
                        className={`flex w-full items-center gap-1.5 rounded px-1.5 py-[3px] text-left ${
                          active
                            ? 'bg-[var(--color-accent-dim)]/45'
                            : 'hover:bg-[var(--color-elevated)]'
                        }`}
                      >
                        <span className="shrink-0 text-[var(--color-faint)]">
                          {OBJECT_ICON[o.type]}
                        </span>
                        <span className="min-w-0 flex-1 truncate">{qualified}</span>
                        {o.rowEstimate != null && (
                          <span
                            className="shrink-0 text-[10px] text-[var(--color-faint)]"
                            title="estimated row count"
                          >
                            ~{formatCount(o.rowEstimate)}
                          </span>
                        )}
                      </button>
                    )
                  })}
                </section>
              )
            })}
          </div>
        </>
      )}
    </aside>
  )
}
