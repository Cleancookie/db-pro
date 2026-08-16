import { useStore } from '../store'

const SHORTCUTS: [string, string][] = [
  ['Ctrl+K', 'Command palette'],
  ['Ctrl+F  /  /', 'Focus the WHERE filter'],
  ['Enter', 'Apply the filter'],
  ['Ctrl+E', 'Toggle the SQL editor'],
  ['Ctrl+Enter', 'Run the query (in the editor)'],
  ['Ctrl+R', 'Refresh the current rows'],
  ['Ctrl+←  /  Ctrl+→', 'Previous / next page'],
  ['Ctrl+C', 'Copy the selected cell'],
  ['↑ ↓  /  Ctrl+P  Ctrl+N', 'Move through the palette'],
  ['Esc', 'Close, or revert an unapplied filter'],
]

export function ShortcutsDialog() {
  const setDialog = useStore((s) => s.setDialog)
  return (
    <div
      className="chrome fixed inset-0 z-40 flex items-center justify-center bg-black/50"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) setDialog({ kind: 'none' })
      }}
    >
      <div className="w-[min(440px,92vw)] rounded-lg border border-[var(--color-border-strong)] bg-[var(--color-elevated)] shadow-2xl">
        <h2 className="border-b border-[var(--color-border)] px-4 py-3 font-semibold">
          Keyboard shortcuts
        </h2>
        <dl className="p-4">
          {SHORTCUTS.map(([key, what]) => (
            <div key={key} className="flex items-baseline gap-4 py-1">
              <dt className="w-44 shrink-0 font-[var(--font-mono)] text-[11px] text-[var(--color-accent)]">
                {key}
              </dt>
              <dd className="text-[var(--color-muted)]">{what}</dd>
            </div>
          ))}
        </dl>
        <div className="border-t border-[var(--color-border)] px-4 py-3 text-right">
          <button
            autoFocus
            onClick={() => setDialog({ kind: 'none' })}
            className="rounded border border-[var(--color-border-strong)] px-3 py-1.5 hover:border-[var(--color-accent)]"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  )
}
