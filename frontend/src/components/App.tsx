import { useEffect } from 'react'
import { focusFilter } from '../commands'
import { isTypingTarget } from '../dom'
import { useStore } from '../store'
import { ActivityPage } from './ActivityPage'
import { ActivityTray, ConfirmCancelDialog } from './ActivityTray'
import { CellDialog } from './CellDialog'
import { useCellMenu } from './CellMenu'
import { CommandPalette } from './CommandPalette'
import { ConfirmDeleteDialog } from './ConnectionMenu'
import { ConnectionDialog } from './ConnectionDialog'
import { DataGrid } from './DataGrid'
import { FilterBar } from './FilterBar'
import { Paginator } from './Paginator'
import { SettingsDialog } from './SettingsDialog'
import { ShortcutsDialog } from './ShortcutsDialog'
import { Sidebar } from './Sidebar'
import { SqlEditor } from './SqlEditor'
import { Toasts } from './Toasts'

export function App() {
  const init = useStore((s) => s.init)
  const dialog = useStore((s) => s.dialog)
  const view = useStore((s) => s.view)
  const activeRef = useStore((s) => s.activeRef)
  const result = useStore((s) => s.result)
  const columns = useStore((s) => s.columns)
  const orderBy = useStore((s) => s.orderBy)
  const busy = useStore((s) => s.busy)
  const page = useStore((s) => s.page)
  const pageSize = useStore((s) => s.pageSize)
  const paginationEnabled = useStore((s) => s.paginationEnabled)
  const toggleSort = useStore((s) => s.toggleSort)
  const openCell = useStore((s) => s.openCell)
  const cellMenu = useCellMenu('browse')

  useEffect(() => {
    void init()
  }, [init])

  useGlobalHotkeys()

  return (
    <div className="flex h-full flex-col">

      <div className="flex min-h-0 flex-1">
        <Sidebar />

        <main className="flex min-w-0 flex-1 flex-col">
          {view === 'activity' ? (
            <ActivityPage />
          ) : view === 'sql' ? (
            <SqlEditor />
          ) : activeRef ? (
            <>
              <FilterBar />
              <div className="min-h-0 flex-1">
                {result ? (
                  <DataGrid
                    result={result}
                    columns={columns}
                    orderBy={orderBy}
                    onSort={(c) => void toggleSort(c)}
                    rowOffset={paginationEnabled ? (page - 1) * pageSize : 0}
                    onOpenCell={(r, c) => openCell('browse', r, c)}
                    cellMenu={cellMenu}
                  />
                ) : (
                  <Placeholder text={busy ? 'Loading…' : 'No rows'} />
                )}
              </div>
              <Paginator />
            </>
          ) : (
            <EmptyState />
          )}
        </main>
      </div>

      {/* Below every view, including the activity page: what is running is
          worth knowing wherever the user happens to be. */}
      <ActivityTray />

      <CommandPalette />
      {dialog.kind === 'connection' && <ConnectionDialog existing={dialog.connection} />}
      {dialog.kind === 'shortcuts' && <ShortcutsDialog />}
      {dialog.kind === 'settings' && <SettingsDialog />}
      {dialog.kind === 'cell' && <CellDialog cell={dialog.cell} />}
      {dialog.kind === 'confirmDelete' && (
        <ConfirmDeleteDialog name={dialog.connection.name} id={dialog.connection.id} />
      )}
      {dialog.kind === 'confirmCancel' && (
        <ConfirmCancelDialog queryId={dialog.queryId} sql={dialog.sql} />
      )}
      <Toasts />
    </div>
  )
}

function Placeholder({ text }: { text: string }) {
  return (
    <div className="flex h-full items-center justify-center text-[var(--color-faint)]">{text}</div>
  )
}

function Key({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="rounded border border-[var(--color-border-strong)] px-1.5 py-0.5 font-[var(--font-mono)] text-xs">
      {children}
    </kbd>
  )
}

function EmptyState() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 text-[var(--color-faint)]">
      <p className="text-lg">Nothing open</p>
      {/* With no top bar, this is where the two palettes are advertised. It is
          the first screen of a palette-first app, so it had better say how. */}
      <p className="flex items-center gap-2">
        <Key>Ctrl+P</Key> to open a connection, database or table
      </p>
      <p className="flex items-center gap-2">
        <Key>Ctrl+Shift+P</Key> for settings and everything else
      </p>
    </div>
  )
}

/**
 * Global keyboard shortcuts.
 *
 * Handlers check whether focus is in a text field before claiming a key, so
 * typing a filter never triggers navigation. The palette keys are the
 * exception — they open from anywhere, including the filter box and the SQL
 * editor, which is the point of a palette-first app with no menu bar.
 */
function useGlobalHotkeys() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const s = useStore.getState()
      const mod = e.ctrlKey || e.metaKey
      const target = e.target as HTMLElement | null
      const typing = isTypingTarget(target)

      // The two palettes. Ctrl+P goes somewhere, Ctrl+Shift+P does something —
      // the same split as an editor's quick-open versus command palette.
      // preventDefault matters on Ctrl+P: the webview would otherwise print.
      //
      // Handled before the typing guard so a palette is reachable from the
      // filter box and the SQL editor, which is most of where the caret is.
      // Ctrl+P *inside* an open palette belongs to it (move-up), so the switch
      // only fires when none is open.
      if (mod && e.shiftKey && e.key.toLowerCase() === 'p') {
        e.preventDefault()
        s.setPalette(s.palette === 'do' ? null : 'do')
        return
      }
      if (mod && !e.shiftKey && e.key.toLowerCase() === 'p' && s.palette === null) {
        e.preventDefault()
        s.setPalette('go')
        return
      }

      // Ctrl+K keeps working, and opens the one people reach for most. It was
      // the only palette key before the split, so it stays as muscle memory.
      if (mod && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        s.setPalette(s.palette === null ? 'go' : null)
        return
      }

      // Ctrl+, is conventional for preferences and is worth honouring even
      // from inside a dialog, so it is handled before the modal guard.
      if (mod && e.key === ',') {
        e.preventDefault()
        s.setDialog({ kind: 'settings' })
        return
      }

      // Escape here only closes the palette, which is hand-rolled. Dialogs and
      // menus dismiss themselves through the ui layer — unmounting them from
      // out here would pre-empt the close sequence that restores focus to
      // whatever opened them.
      if (e.key === 'Escape') {
        if (s.palette !== null) s.setPalette(null)
        return
      }

      // Everything below would otherwise steal keys from the palette or a
      // dialog while the user is typing in it.
      if (s.palette !== null || s.dialog.kind !== 'none') return

      if (mod && e.shiftKey && e.key.toLowerCase() === 'a') {
        e.preventDefault()
        s.setView(s.view === 'activity' ? 'data' : 'activity')
        return
      }

      // Ctrl+J for the bottom tray, as in every editor with a bottom panel.
      if (mod && e.key.toLowerCase() === 'j') {
        e.preventDefault()
        s.setTrayOpen(!s.trayOpen)
        return
      }

      if (mod && e.key.toLowerCase() === 'f') {
        e.preventDefault()
        if (s.view !== 'data') s.setView('data')
        // The bar only exists once a table is open; focusing after the render
        // that mounts it is what makes Ctrl+F work on the first press.
        requestAnimationFrame(focusFilter)
        return
      }

      if (mod && e.key.toLowerCase() === 'e') {
        e.preventDefault()
        s.setView(s.view === 'sql' ? 'data' : 'sql')
        return
      }

      if (mod && e.key.toLowerCase() === 'r') {
        e.preventDefault()
        void s.reload()
        return
      }

      if (mod && e.key === 'ArrowLeft' && s.paginationEnabled && s.page > 1) {
        e.preventDefault()
        void s.setPage(s.page - 1)
        return
      }

      if (mod && e.key === 'ArrowRight' && s.paginationEnabled && s.hasMore) {
        e.preventDefault()
        void s.setPage(s.page + 1)
        return
      }

      // Bare "/" jumps to the filter, as in vim and every pager.
      if (!typing && !mod && e.key === '/') {
        e.preventDefault()
        focusFilter()
      }
    }

    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
}
