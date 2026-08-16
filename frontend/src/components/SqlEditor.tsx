import { useRef } from 'react'
import { useStore } from '../store'
import { DataGrid } from './DataGrid'

/**
 * SQL editor.
 *
 * A plain textarea for now, deliberately: it is keyboard-complete, has no
 * bundle cost and no focus quirks to fight. Monaco slots in behind the same
 * props when it earns its place — see the note in README.
 */
export function SqlEditor() {
  const sqlText = useStore((s) => s.sqlText)
  const setSqlText = useStore((s) => s.setSqlText)
  const runSql = useStore((s) => s.runSql)
  const sqlResult = useStore((s) => s.sqlResult)
  const busy = useStore((s) => s.busy)
  const setView = useStore((s) => s.setView)
  const ref = useRef<HTMLTextAreaElement>(null)

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault()
      void runSql()
      return
    }
    // Tab indents rather than escaping the field — in an editor, leaving on
    // Tab is never what you meant.
    if (e.key === 'Tab') {
      e.preventDefault()
      const el = e.currentTarget
      const { selectionStart: start, selectionEnd: end } = el
      const next = `${sqlText.slice(0, start)}  ${sqlText.slice(end)}`
      setSqlText(next)
      requestAnimationFrame(() => el.setSelectionRange(start + 2, start + 2))
    }
  }

  return (
    <div className="flex h-full flex-col">
      <div className="chrome flex items-center gap-2 border-b border-[var(--color-border)] bg-[var(--color-panel)] px-3 py-1.5">
        <span className="text-[0.625rem] font-semibold tracking-wider text-[var(--color-faint)] uppercase">
          SQL
        </span>
        <button
          onClick={() => void runSql()}
          disabled={busy || !sqlText.trim()}
          className="rounded border border-[var(--color-border-strong)] bg-[var(--color-elevated)] px-2 py-0.5 text-[0.6875rem] disabled:opacity-40 enabled:hover:border-[var(--color-accent)]"
        >
          Run <span className="text-[var(--color-faint)]">Ctrl+Enter</span>
        </button>
        <button
          onClick={() => setView('data')}
          className="ml-auto rounded px-1.5 text-[var(--color-muted)] hover:bg-[var(--color-elevated)] hover:text-[var(--color-text)]"
          title="Close editor (Ctrl+E)"
        >
          ✕
        </button>
      </div>

      <textarea
        ref={ref}
        autoFocus
        value={sqlText}
        onChange={(e) => setSqlText(e.target.value)}
        onKeyDown={onKeyDown}
        spellCheck={false}
        placeholder="select * from …"
        aria-label="SQL editor"
        className="h-40 w-full shrink-0 resize-y border-b border-[var(--color-border)] bg-[var(--color-bg)] p-3 font-[var(--font-mono)] text-[0.78rem] leading-relaxed outline-none placeholder:text-[var(--color-faint)]"
      />

      <div className="min-h-0 flex-1">
        {sqlResult ? (
          <DataGrid result={sqlResult} />
        ) : (
          <div className="flex h-full items-center justify-center text-[var(--color-faint)]">
            Results appear here
          </div>
        )}
      </div>
    </div>
  )
}
