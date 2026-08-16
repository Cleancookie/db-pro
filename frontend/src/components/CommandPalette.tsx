import { useEffect, useMemo, useRef, useState } from 'react'
import { buildCommands, commandText, type Command } from '../commands'
import { rank } from '../fuzzy'
import { useStore } from '../store'

/**
 * The command palette. Rebuilt from live state each time it opens, so the
 * offered commands always reflect what is actually possible right now.
 */
export function CommandPalette() {
  const open = useStore((s) => s.paletteOpen)
  const setOpen = useStore((s) => s.setPaletteOpen)
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState(0)
  const listRef = useRef<HTMLDivElement>(null)

  // Snapshotting on open avoids rebuilding the (potentially large) command
  // list on every keystroke, and stops the list shifting under the cursor if
  // a background refresh lands mid-typing.
  const commands = useMemo(() => (open ? buildCommands(useStore.getState()) : []), [open])

  const results = useMemo(() => {
    const scored = rank(query, commands, commandText)
    return scored.slice(0, 200)
  }, [query, commands])

  useEffect(() => {
    if (open) {
      setQuery('')
      setSelected(0)
    }
  }, [open])

  useEffect(() => {
    setSelected(0)
  }, [query])

  // Keep the highlighted row in view when navigating with the keyboard.
  useEffect(() => {
    const el = listRef.current?.querySelector(`[data-index="${selected}"]`)
    el?.scrollIntoView({ block: 'nearest' })
  }, [selected])

  if (!open) return null

  const run = (cmd: Command | undefined) => {
    if (!cmd) return
    setOpen(false)
    void cmd.run()
  }

  const onKeyDown = (e: React.KeyboardEvent) => {
    switch (e.key) {
      case 'Escape':
        e.preventDefault()
        setOpen(false)
        break
      case 'ArrowDown':
        e.preventDefault()
        setSelected((i) => Math.min(i + 1, results.length - 1))
        break
      case 'ArrowUp':
        e.preventDefault()
        setSelected((i) => Math.max(i - 1, 0))
        break
      case 'Home':
        e.preventDefault()
        setSelected(0)
        break
      case 'End':
        e.preventDefault()
        setSelected(results.length - 1)
        break
      case 'Enter':
        e.preventDefault()
        run(results[selected]?.item)
        break
      // Ctrl+N / Ctrl+P for people who never leave the home row.
      case 'n':
        if (e.ctrlKey) {
          e.preventDefault()
          setSelected((i) => Math.min(i + 1, results.length - 1))
        }
        break
      case 'p':
        if (e.ctrlKey) {
          e.preventDefault()
          setSelected((i) => Math.max(i - 1, 0))
        }
        break
    }
  }

  return (
    <div
      className="chrome fixed inset-0 z-50 flex items-start justify-center bg-black/50 pt-[12vh]"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) setOpen(false)
      }}
    >
      <div
        className="w-[min(680px,92vw)] overflow-hidden rounded-lg border border-[var(--color-border-strong)] bg-[var(--color-elevated)] shadow-2xl"
        role="dialog"
        aria-label="Command palette"
      >
        <input
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder="Type a table name or a command…"
          spellCheck={false}
          aria-label="Command"
          className="w-full border-b border-[var(--color-border)] bg-transparent px-4 py-3.5 text-[15px] outline-none placeholder:text-[var(--color-faint)]"
        />

        <div ref={listRef} className="max-h-[52vh] overflow-y-auto py-1">
          {results.length === 0 && (
            <div className="px-4 py-6 text-center text-[var(--color-faint)]">
              No matching commands
            </div>
          )}
          {results.map(({ item, match }, i) => {
            const prevGroup = i > 0 ? results[i - 1].item.group : null
            return (
              <div key={item.id}>
                {item.group !== prevGroup && (
                  <div className="px-4 pt-2.5 pb-1 text-[10px] font-semibold tracking-wider text-[var(--color-faint)] uppercase">
                    {item.group}
                  </div>
                )}
                <button
                  data-index={i}
                  onMouseMove={() => setSelected(i)}
                  onClick={() => run(item)}
                  className={`flex w-full items-center gap-3 px-4 py-2 text-left ${
                    i === selected ? 'bg-[var(--color-accent-dim)]/45' : ''
                  }`}
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate">
                      <Highlighted text={item.title} positions={match.positions} />
                    </span>
                    {item.subtitle && (
                      <span className="block truncate text-[11px] text-[var(--color-muted)]">
                        {item.subtitle}
                      </span>
                    )}
                  </span>
                  {item.shortcut && (
                    <kbd className="shrink-0 rounded border border-[var(--color-border-strong)] px-1.5 py-0.5 font-[var(--font-mono)] text-[10px] text-[var(--color-muted)]">
                      {item.shortcut}
                    </kbd>
                  )}
                </button>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

/**
 * Highlights the matched characters. Positions index the full search text
 * (title + subtitle + keywords), so any that fall past the title are ignored.
 */
function Highlighted({ text, positions }: { text: string; positions: number[] }) {
  if (positions.length === 0) return <>{text}</>
  const set = new Set(positions)
  const out: React.ReactNode[] = []
  let run = ''
  let runMatched = set.has(0)

  const flush = (key: number) => {
    if (!run) return
    out.push(
      runMatched ? (
        <span key={key} className="font-semibold text-[var(--color-accent)]">
          {run}
        </span>
      ) : (
        <span key={key}>{run}</span>
      ),
    )
    run = ''
  }

  for (let i = 0; i < text.length; i++) {
    const matched = set.has(i)
    if (matched !== runMatched) {
      flush(i)
      runMatched = matched
    }
    run += text[i]
  }
  flush(text.length)
  return <>{out}</>
}
