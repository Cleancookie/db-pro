import { useEffect, useState } from 'react'
import { FILTER_INPUT_ID } from '../commands'
import { useStore } from '../store'

/**
 * The Ctrl+F filter: a raw SQL fragment appended after WHERE.
 *
 * It applies on Enter rather than on every keystroke — a half-typed expression
 * is usually a syntax error, and firing a query per character would flood the
 * server with failures. See docs/adr/0002-raw-sql-filter.md.
 */
export function FilterBar() {
  const filter = useStore((s) => s.filter)
  const applyFilter = useStore((s) => s.applyFilter)
  const activeRef = useStore((s) => s.activeRef)

  const [draft, setDraft] = useState(filter)

  // Opening a different table clears the filter in the store; the input has to
  // follow, or it would show a condition that is no longer applied.
  useEffect(() => {
    setDraft(filter)
  }, [filter, activeRef])

  const dirty = draft !== filter

  return (
    <div className="chrome flex items-center gap-2 border-b border-[var(--color-border)] bg-[var(--color-panel)] px-3 py-1.5">
      <span className="shrink-0 font-[var(--font-mono)] text-[11px] text-[var(--color-faint)]">
        WHERE
      </span>
      <input
        id={FILTER_INPUT_ID}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault()
            void applyFilter(draft)
          } else if (e.key === 'Escape') {
            e.preventDefault()
            // First Escape reverts an unapplied edit; a second gives up focus.
            if (dirty) setDraft(filter)
            else e.currentTarget.blur()
          }
        }}
        placeholder="status = 'active' and created_at > now() - interval '7 days'"
        spellCheck={false}
        autoComplete="off"
        aria-label="Row filter, raw SQL after WHERE"
        className={`min-w-0 flex-1 rounded border bg-[var(--color-elevated)] px-2 py-1 font-[var(--font-mono)] text-[12px] outline-none placeholder:text-[var(--color-faint)] ${
          dirty ? 'border-[var(--color-warn)]' : 'border-[var(--color-border-strong)]'
        }`}
      />
      {dirty && (
        <span className="shrink-0 text-[10px] text-[var(--color-warn)]">
          Enter to apply
        </span>
      )}
      {filter && !dirty && (
        <button
          onClick={() => void applyFilter('')}
          title="Clear filter"
          className="shrink-0 rounded px-1.5 text-[var(--color-muted)] hover:bg-[var(--color-elevated)] hover:text-[var(--color-text)]"
        >
          ✕
        </button>
      )}
    </div>
  )
}
