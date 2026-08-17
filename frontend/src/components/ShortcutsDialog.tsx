import { useStore } from '../store'
import { Dialog, dialogButton } from '../ui'

const SHORTCUTS: [string, string][] = [
  ['Ctrl+K', 'Command palette'],
  ['Ctrl+,', 'Settings'],
  ['Ctrl+F  /  /', 'Focus the WHERE filter'],
  ['Enter', 'Apply the filter'],
  ['Ctrl+E', 'Toggle the SQL editor'],
  ['Ctrl+Enter', 'Run the query (in the editor)'],
  ['Ctrl+R', 'Refresh the current rows'],
  ['Ctrl+←  /  Ctrl+→', 'Previous / next page'],
  ['Ctrl+Shift+A', 'Running queries and connections'],
  ['Right-click', 'Connection actions in the sidebar'],
  ['Ctrl+C', 'Copy the selected cell'],
  ['Enter  /  double-click', 'Open the selected cell (JSON viewer, full value)'],
  ['↑ ↓  /  Ctrl+P  Ctrl+N', 'Move through the palette'],
  ['Esc', 'Close, or revert an unapplied filter'],
]

export function ShortcutsDialog() {
  const setDialog = useStore((s) => s.setDialog)
  const close = () => setDialog({ kind: 'none' })

  return (
    <Dialog
      open
      onClose={close}
      title="Keyboard shortcuts"
      widthClass="w-[min(28rem,92vw)]"
      footer={
        <button onClick={close} className={`ml-auto ${dialogButton.secondary}`}>
          Close
        </button>
      }
    >
      <dl className="p-4">
        {SHORTCUTS.map(([key, what]) => (
          <div key={key} className="flex items-baseline gap-4 py-1">
            <dt className="w-44 shrink-0 font-[var(--font-mono)] text-[0.6875rem] text-[var(--color-accent)]">
              {key}
            </dt>
            <dd className="text-[var(--color-muted)]">{what}</dd>
          </div>
        ))}
      </dl>
    </Dialog>
  )
}
