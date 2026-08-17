import { useMemo } from 'react'
import { editorCandidates, tokenAt } from '../completion'
import { useActiveKind, useHasSchemas, useStore } from '../store'
import { Editor } from '../ui'
import { useCellMenu } from './CellMenu'
import { DataGrid } from './DataGrid'

/**
 * SQL editor.
 *
 * Now a real editor rather than a textarea: highlighting and completion over
 * the objects in the open database, with Ctrl+Enter still running the
 * statement and Tab still indenting. See ui/Editor.tsx for why CodeMirror and
 * not Monaco.
 */
export function SqlEditor() {
  const sqlText = useStore((s) => s.sqlText)
  const setSqlText = useStore((s) => s.setSqlText)
  const runSql = useStore((s) => s.runSql)
  const sqlResult = useStore((s) => s.sqlResult)
  const busy = useStore((s) => s.busy)
  const setView = useStore((s) => s.setView)
  const openCell = useStore((s) => s.openCell)
  const objects = useStore((s) => s.objects)
  const columns = useStore((s) => s.columns)
  const activeRef = useStore((s) => s.activeRef)
  const activeDatabase = useStore((s) => s.activeDatabase)
  const kind = useActiveKind()
  const hasSchemas = useHasSchemas()
  const cellMenu = useCellMenu('sql')

  const completion = useMemo(
    () => ({
      options: editorCandidates({ columns, objects, kind, hasSchemas }, activeRef?.name),
      tokenAt,
    }),
    [columns, objects, kind, hasSchemas, activeRef],
  )

  return (
    <div className="flex h-full flex-col">
      <div className="chrome flex items-center gap-2 border-b border-[var(--color-border)] bg-[var(--color-panel)] px-3 py-1.5">
        <span className="font-semibold tracking-wider text-[var(--color-faint)] uppercase">
          SQL
        </span>
        {/* Which database the statement will run against. The connection is
            already scoped to it, so `use` is never needed — but that is only
            reassuring if it is on screen. */}
        {activeDatabase && (
          <span
            title="Statements run against this database — chosen in the sidebar"
            className="max-w-[12rem] truncate rounded bg-[var(--color-elevated)] px-1.5 py-0.5 font-[var(--font-mono)] text-[var(--color-muted)]"
          >
            {activeDatabase}
          </span>
        )}
        <button
          onClick={() => void runSql()}
          disabled={busy || !sqlText.trim()}
          className="rounded border border-[var(--color-border-strong)] bg-[var(--color-elevated)] px-2 py-0.5 disabled:opacity-40 enabled:hover:border-[var(--color-accent)]"
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

      {/* Fixed height with its own scrolling, as the textarea had. The editor
          grows its own content area, so the height belongs on the wrapper. */}
      <div className="h-40 shrink-0 overflow-auto border-b border-[var(--color-border)] bg-[var(--color-bg)]">
        <Editor
          autoFocus
          value={sqlText}
          onChange={setSqlText}
          onSubmit={() => void runSql()}
          dialect={kind}
          completion={completion}
          placeholder="select * from …"
          ariaLabel="SQL editor"
          className="p-3 leading-relaxed"
        />
      </div>

      <div className="min-h-0 flex-1">
        {sqlResult ? (
          <DataGrid
            result={sqlResult}
            onOpenCell={(r, c) => openCell('sql', r, c)}
            cellMenu={cellMenu}
          />
        ) : (
          <div className="flex h-full items-center justify-center text-[var(--color-faint)]">
            Results appear here
          </div>
        )}
      </div>
    </div>
  )
}
