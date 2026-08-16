import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useStore } from '../store'

interface Item {
  label: string
  onClick: () => void
  danger?: boolean
  disabled?: boolean
}

/** Right-click menu for a saved connection. */
export function ContextMenu() {
  const menu = useStore((s) => s.contextMenu)
  const close = useStore((s) => s.closeContextMenu)
  const connectedIds = useStore((s) => s.connectedIds)
  const connect = useStore((s) => s.connect)
  const disconnect = useStore((s) => s.disconnect)
  const deleteConnection = useStore((s) => s.deleteConnection)
  const setDialog = useStore((s) => s.setDialog)
  const confirmDestructive = useStore((s) => s.settings.confirmDestructive)

  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState({ x: 0, y: 0 })

  // Measure after mount and nudge back inside the viewport, so a right-click
  // near the bottom or right edge does not open a menu that runs off-screen.
  useLayoutEffect(() => {
    if (!menu) return
    const el = ref.current
    if (!el) return
    const { width, height } = el.getBoundingClientRect()
    setPos({
      x: Math.min(menu.x, window.innerWidth - width - 8),
      y: Math.min(menu.y, window.innerHeight - height - 8),
    })
  }, [menu])

  useEffect(() => {
    if (!menu) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close()
    }
    // Capture phase: the menu must close before the click lands on whatever
    // is underneath it.
    window.addEventListener('keydown', onKey)
    window.addEventListener('resize', close)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('resize', close)
    }
  }, [menu, close])

  if (!menu) return null

  const c = menu.connection
  const isConnected = connectedIds.includes(c.id)

  const items: Item[] = [
    {
      label: isConnected ? 'Switch to this connection' : 'Connect',
      onClick: () => void connect(c.id),
    },
    {
      label: 'Disconnect',
      onClick: () => void disconnect(c.id),
      disabled: !isConnected,
    },
    {
      label: 'Edit…',
      onClick: () => setDialog({ kind: 'connection', connection: c }),
    },
    {
      label: 'Remove',
      danger: true,
      onClick: () => {
        if (confirmDestructive) setDialog({ kind: 'confirmDelete', connection: c })
        else void deleteConnection(c.id)
      },
    },
  ]

  return (
    <div className="fixed inset-0 z-50" onMouseDown={close} onContextMenu={(e) => e.preventDefault()}>
      <div
        ref={ref}
        role="menu"
        aria-label={`Actions for ${c.name}`}
        style={{ left: pos.x, top: pos.y }}
        onMouseDown={(e) => e.stopPropagation()}
        className="chrome absolute min-w-48 overflow-hidden rounded-md border border-[var(--color-border-strong)] bg-[var(--color-elevated)] py-1 shadow-2xl"
      >
        <div className="truncate border-b border-[var(--color-border)] px-3 pt-1 pb-1.5 text-xs text-[var(--color-faint)]">
          {c.name}
        </div>
        {items.map((item) => (
          <button
            key={item.label}
            role="menuitem"
            disabled={item.disabled}
            onClick={() => {
              close()
              item.onClick()
            }}
            className={`block w-full px-3 py-1.5 text-left disabled:opacity-35 ${
              item.danger ? 'text-[var(--color-danger)]' : ''
            } enabled:hover:bg-[var(--color-accent-dim)]/45`}
          >
            {item.label}
          </button>
        ))}
      </div>
    </div>
  )
}

/** Confirmation for removing a connection. */
export function ConfirmDeleteDialog({ name, id }: { name: string; id: string }) {
  const setDialog = useStore((s) => s.setDialog)
  const deleteConnection = useStore((s) => s.deleteConnection)

  return (
    <div
      className="chrome fixed inset-0 z-40 flex items-center justify-center bg-black/50"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) setDialog({ kind: 'none' })
      }}
    >
      <div className="w-[min(26rem,92vw)] rounded-lg border border-[var(--color-border-strong)] bg-[var(--color-elevated)] shadow-2xl">
        <h2 className="border-b border-[var(--color-border)] px-4 py-3 font-semibold">
          Remove “{name}”?
        </h2>
        <p className="px-4 py-4 leading-relaxed text-[var(--color-muted)]">
          The saved connection and its stored password will be deleted. The database itself is
          not touched.
        </p>
        <div className="flex justify-end gap-2 border-t border-[var(--color-border)] px-4 py-3">
          <button
            onClick={() => setDialog({ kind: 'none' })}
            className="rounded px-3 py-1.5 text-[var(--color-muted)] hover:text-[var(--color-text)]"
          >
            Cancel
          </button>
          <button
            autoFocus
            onClick={() => void deleteConnection(id)}
            className="rounded bg-[var(--color-danger)]/20 px-3 py-1.5 font-medium text-[var(--color-danger)] hover:bg-[var(--color-danger)]/30"
          >
            Remove
          </button>
        </div>
      </div>
    </div>
  )
}
