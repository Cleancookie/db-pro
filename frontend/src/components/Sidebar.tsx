import { useMemo, useState } from 'react'
import { describeConnection, formatCount, objectCandidate, OBJECT_ICON, qualifiedName } from '../commands'
import { rankCandidates } from '../fuzzy'
import { useStore, type SectionKey } from '../store'
import { ConnectionMenu } from './ConnectionMenu'
import { SidebarResizer, useSidebarWidth } from './SidebarResizer'
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
  const collapsed = useStore((s) => s.collapsed)
  const connect = useStore((s) => s.connect)
  const selectDatabase = useStore((s) => s.selectDatabase)
  const openObject = useStore((s) => s.openObject)
  const setDialog = useStore((s) => s.setDialog)

  const [objectQuery, setObjectQuery] = useState('')
  const [dbQuery, setDbQuery] = useState('')

  const grouped = useMemo(() => {
    const matched = objectQuery
      ? rankCandidates(objectQuery, objects, objectCandidate).map((r) => r.item)
      : objects
    const out = new Map<ObjectType, SchemaObject[]>()
    for (const o of matched) {
      const list = out.get(o.type)
      if (list) list.push(o)
      else out.set(o.type, [o])
    }
    return out
  }, [objects, objectQuery])

  const visibleDatabases = useMemo(
    () =>
      dbQuery ? rankCandidates(dbQuery, databases, (d) => ({ name: d })).map((r) => r.item) : databases,
    [databases, dbQuery],
  )

  const resize = useSidebarWidth()

  return (
    // The width is inline because it is dragged; `relative` anchors the resize
    // handle to this element's right edge, which keeps it out of the layout and
    // out of the indentation of everything below.
    <aside
      style={{ width: resize.width }}
      className={`chrome relative flex shrink-0 flex-col overflow-hidden border-r border-[var(--color-border)] bg-[var(--color-panel)] ${
        resize.dragging ? '' : 'transition-[width] duration-75'
      }`}
    >
      <SidebarResizer {...resize} />
      <Section
        id="connections"
        label="Connections"
        count={connections.length}
        collapsed={collapsed.connections}
        action={{
          label: '+',
          title: 'New connection',
          onClick: () => setDialog({ kind: 'connection', connection: null }),
        }}
      >
        <div className="max-h-52 overflow-y-auto px-1.5 pb-1.5">
          {connections.length === 0 && (
            <p className="px-1.5 py-2 text-xs leading-relaxed text-[var(--color-faint)]">
              No connections yet. Press{' '}
              <kbd className="rounded border border-[var(--color-border-strong)] px-1">Ctrl+K</kbd>{' '}
              and choose “New connection”.
            </p>
          )}
          {connections.map((c) => {
            const active = c.id === activeConnectionId
            return (
              <ConnectionMenu key={c.id} connection={c}>
                <button
                  onClick={() => connect(c.id)}
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
                    <span className="block truncate text-[0.6875rem] text-[var(--color-faint)]">
                      {describeConnection(c.kind, c.host, c.file)}
                    </span>
                  </span>
                </button>
              </ConnectionMenu>
            )
          })}
        </div>
      </Section>

      {activeConnectionId && capabilities?.serverHostsDatabases && (
        <Section
          id="databases"
          label="Databases"
          count={databases.length}
          collapsed={collapsed.databases}
        >
          <div className="px-2 pb-1">
            {databases.length > 8 && (
              <input
                value={dbQuery}
                onChange={(e) => setDbQuery(e.target.value)}
                placeholder="Filter databases…"
                spellCheck={false}
                aria-label="Filter databases"
                className="mb-1 w-full rounded border border-[var(--color-border-strong)] bg-[var(--color-elevated)] px-1.5 py-1 text-xs outline-none placeholder:text-[var(--color-faint)]"
              />
            )}
          </div>
          <div className="max-h-44 overflow-y-auto px-1.5 pb-1.5">
            {visibleDatabases.map((d) => (
              <button
                key={d}
                onClick={() => selectDatabase(d)}
                title={d}
                className={`flex w-full items-center gap-1.5 rounded px-1.5 py-[0.15rem] text-left ${
                  d === activeDatabase
                    ? 'bg-[var(--color-accent-dim)]/45'
                    : 'hover:bg-[var(--color-elevated)]'
                }`}
              >
                <span className="shrink-0 text-[var(--color-faint)]">▪</span>
                <span className="min-w-0 flex-1 truncate">{d}</span>
              </button>
            ))}
          </div>
        </Section>
      )}

      {activeConnectionId && (
        <Section
          id="objects"
          label="Tables"
          count={objects.length}
          collapsed={collapsed.objects}
          grow
        >
          <div className="px-2 pb-1">
            <input
              value={objectQuery}
              onChange={(e) => setObjectQuery(e.target.value)}
              placeholder="Filter objects…"
              spellCheck={false}
              aria-label="Filter objects"
              className="w-full rounded border border-[var(--color-border-strong)] bg-[var(--color-elevated)] px-1.5 py-1 text-xs outline-none placeholder:text-[var(--color-faint)]"
            />
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto px-1.5 pb-3">
            {objects.length === 0 && (
              <p className="px-1.5 py-2 text-xs text-[var(--color-faint)]">No objects</p>
            )}
            {GROUP_ORDER.map((type) => {
              const list = grouped.get(type)
              if (!list || list.length === 0) return null
              return (
                <section key={type} className="mt-2">
                  <h3 className="px-1.5 pb-0.5 text-[0.625rem] font-semibold tracking-wider text-[var(--color-faint)] uppercase">
                    {GROUP_LABEL[type]} <span className="opacity-60">{list.length}</span>
                  </h3>
                  {list.map((o) => {
                    const qualified = qualifiedName(o)
                    const active = activeRef?.name === o.name && activeRef?.schema === o.schema
                    return (
                      <button
                        key={`${type}:${qualified}`}
                        onClick={() => openObject(o)}
                        title={qualified}
                        className={`flex w-full items-center gap-1.5 rounded px-1.5 py-[0.15rem] text-left ${
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
                            className="shrink-0 text-[0.625rem] text-[var(--color-faint)]"
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
        </Section>
      )}
    </aside>
  )
}

/**
 * A collapsible sidebar section. `grow` marks the one section allowed to take
 * the remaining height — without it, collapsing the others leaves a gap
 * rather than giving the space to the object list.
 */
function Section({
  id,
  label,
  count,
  collapsed,
  grow = false,
  action,
  children,
}: {
  id: SectionKey
  label: string
  count?: number
  collapsed: boolean
  grow?: boolean
  action?: { label: string; title: string; onClick: () => void }
  children: React.ReactNode
}) {
  const toggleSection = useStore((s) => s.toggleSection)

  return (
    <div
      className={`flex min-h-0 flex-col border-b border-[var(--color-border)] ${
        grow && !collapsed ? 'flex-1' : 'shrink-0'
      }`}
    >
      <div className="flex items-center">
        <button
          onClick={() => toggleSection(id)}
          aria-expanded={!collapsed}
          className="flex flex-1 items-center gap-1 px-2 py-1.5 text-left text-[0.625rem] font-semibold tracking-wider text-[var(--color-faint)] uppercase hover:text-[var(--color-text)]"
        >
          <span className="inline-block w-3 shrink-0 text-[0.75rem]">{collapsed ? '▸' : '▾'}</span>
          {label}
          {count != null && <span className="opacity-60">{count}</span>}
        </button>
        {action && (
          <button
            onClick={action.onClick}
            title={action.title}
            className="mr-1 rounded px-1.5 text-[var(--color-muted)] hover:bg-[var(--color-elevated)] hover:text-[var(--color-text)]"
          >
            {action.label}
          </button>
        )}
      </div>
      {!collapsed && <div className="flex min-h-0 flex-1 flex-col">{children}</div>}
    </div>
  )
}
