import { useState } from 'react'
import { jsonEntries, jsonKind, summarise, type JsonKind } from '../json'

/**
 * A collapsible JSON tree.
 *
 * Hand-rolled rather than pulled in: the whole component is the eighty lines
 * below, where a viewer library is tens of kilobytes with its own theming to
 * fight. It also stays outside `src/ui/` on purpose — that layer exists to
 * quarantine *vendor* APIs, and there is no vendor here.
 */

/** Nodes below this depth start collapsed, so a deep document opens readable. */
const AUTO_OPEN_DEPTH = 2

/** A container with more children than this starts collapsed regardless. */
const AUTO_OPEN_MAX_CHILDREN = 100

export function JsonView({ value }: { value: unknown }) {
  return (
    // Matches the cell dialog's text tab rather than the grid: both are for
    // reading one value, not for scanning many.
    <div className="p-3 font-[var(--font-mono)] leading-relaxed">
      <Node name={null} value={value} depth={0} />
    </div>
  )
}

function Node({ name, value, depth }: { name: string | null; value: unknown; depth: number }) {
  const kind = jsonKind(value)
  const container = kind === 'object' || kind === 'array'
  const entries = container ? jsonEntries(value) : []
  const [open, setOpen] = useState(
    depth < AUTO_OPEN_DEPTH && entries.length <= AUTO_OPEN_MAX_CHILDREN,
  )

  if (!container) {
    return (
      <div className="flex gap-2">
        <Key name={name} />
        <Scalar kind={kind} value={value} />
      </div>
    )
  }

  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        // The whole row toggles: a 10px triangle is a poor click target when
        // you are working down a nested document.
        className="flex w-full items-baseline gap-2 rounded px-1 text-left hover:bg-[var(--color-elevated)]"
        aria-expanded={open}
      >
        <span className="w-3 shrink-0 text-[var(--color-faint)]">{open ? '▾' : '▸'}</span>
        <Key name={name} />
        <span className="text-[var(--color-faint)]">{summarise(value)}</span>
      </button>
      {open && (
        // The rule down the left edge is what makes the nesting level readable
        // once a document is more than two deep.
        <div className="ml-3 border-l border-[var(--color-border)] pl-3">
          {entries.map(([k, v]) => (
            <Node key={k} name={k} value={v} depth={depth + 1} />
          ))}
          {entries.length === 0 && <span className="text-[var(--color-faint)]">empty</span>}
        </div>
      )}
    </div>
  )
}

/** The root has no key; every other node is labelled with its key or index. */
function Key({ name }: { name: string | null }) {
  if (name === null) return null
  return <span className="shrink-0 text-[var(--color-accent)]">{name}:</span>
}

function Scalar({ kind, value }: { kind: JsonKind; value: unknown }) {
  if (kind === 'null') {
    // Same treatment as a NULL cell in the grid, for the same reason: it must
    // never be mistaken for the string "null".
    return <span className="text-[var(--color-faint)] italic">null</span>
  }
  if (kind === 'string') {
    return (
      <span className="break-all whitespace-pre-wrap text-[var(--color-success)]">
        {value as string}
      </span>
    )
  }
  return <span className="text-[var(--color-warn)]">{String(value)}</span>
}
