/**
 * The command registry.
 *
 * Everything the app can do is a Command, and the palette is the primary way
 * to reach any of it. The list is rebuilt from state on every open, so it is
 * context-aware: tables only appear once a database is selected, "Disconnect"
 * only when connected.
 */

import { PAGE_SIZES, type useStore } from './store'
import type { ObjectType } from './types'

type Store = ReturnType<typeof useStore.getState>

export interface Command {
  id: string
  title: string
  subtitle?: string
  group: string
  /** Extra text folded into the fuzzy search but not displayed. */
  keywords?: string
  shortcut?: string
  run: () => void | Promise<void>
}

export const OBJECT_ICON: Record<ObjectType, string> = {
  table: '▤',
  view: '◫',
  function: 'ƒ',
  procedure: '⚙',
}

export function buildCommands(s: Store): Command[] {
  const cmds: Command[] = []

  // Objects first: navigating to a table is by far the most common reason to
  // open the palette, so those entries should win ties against everything else.
  if (s.activeConnectionId) {
    for (const o of s.objects) {
      const qualified = o.schema ? `${o.schema}.${o.name}` : o.name
      cmds.push({
        id: `object:${qualified}:${o.type}`,
        title: qualified,
        subtitle: o.type + (o.rowEstimate != null ? ` · ~${formatCount(o.rowEstimate)} rows` : ''),
        group: 'Open',
        keywords: `${o.type} ${o.name}`,
        run: () => s.openObject(o),
      })
    }
  }

  for (const c of s.connections) {
    const connected = s.connectedIds.includes(c.id)
    cmds.push({
      id: `connect:${c.id}`,
      title: connected ? `Switch to ${c.name}` : `Connect to ${c.name}`,
      subtitle: describeConnection(c.kind, c.host, c.file),
      group: 'Connections',
      keywords: `connection ${c.kind} ${c.host ?? ''} ${c.file ?? ''}`,
      run: () => s.connect(c.id),
    })
  }

  cmds.push({
    id: 'connection:new',
    title: 'New connection…',
    group: 'Connections',
    keywords: 'add create database server mysql postgres mssql sqlite',
    run: () => s.setDialog({ kind: 'connection', connection: null }),
  })

  if (s.activeConnectionId) {
    const active = s.connections.find((c) => c.id === s.activeConnectionId)
    if (active) {
      cmds.push({
        id: 'connection:edit',
        title: `Edit connection “${active.name}”`,
        group: 'Connections',
        run: () => s.setDialog({ kind: 'connection', connection: active }),
      })
      cmds.push({
        id: 'connection:disconnect',
        title: `Disconnect from ${active.name}`,
        group: 'Connections',
        run: () => s.disconnect(active.id),
      })
    }
  }

  if (s.capabilities?.serverHostsDatabases) {
    for (const db of s.databases) {
      if (db === s.activeDatabase) continue
      cmds.push({
        id: `database:${db}`,
        title: `Use database ${db}`,
        group: 'Databases',
        keywords: 'switch schema catalog',
        run: () => s.selectDatabase(db),
      })
    }
  }

  cmds.push({
    id: 'sql:toggle',
    title: s.sqlOpen ? 'Close SQL editor' : 'Open SQL editor',
    group: 'Query',
    shortcut: 'Ctrl+E',
    keywords: 'query editor write execute',
    run: () => s.setSqlOpen(!s.sqlOpen),
  })

  if (s.activeRef) {
    cmds.push({
      id: 'data:refresh',
      title: 'Refresh rows',
      group: 'Query',
      shortcut: 'Ctrl+R',
      keywords: 'reload requery',
      run: () => s.reload(),
    })
    cmds.push({
      id: 'data:focus-filter',
      title: 'Filter rows (SQL after WHERE)',
      group: 'Query',
      shortcut: 'Ctrl+F',
      keywords: 'where search find condition',
      run: () => focusFilter(),
    })
    if (s.filter) {
      cmds.push({
        id: 'data:clear-filter',
        title: 'Clear filter',
        group: 'Query',
        run: () => s.applyFilter(''),
      })
    }
    if (s.orderBy.length > 0) {
      cmds.push({
        id: 'data:clear-sort',
        title: 'Clear sort',
        group: 'Query',
        run: () => s.clearSort(),
      })
    }

    // Pagination
    cmds.push({
      id: 'page:toggle',
      title: s.paginationEnabled ? 'Turn pagination off' : 'Turn pagination on',
      subtitle: s.paginationEnabled
        ? 'Load every matching row, up to the 100k safety cap'
        : `Back to pages of ${s.pageSize}`,
      group: 'Pagination',
      keywords: 'paging limit all rows',
      run: () => s.setPaginationEnabled(!s.paginationEnabled),
    })
    if (s.paginationEnabled) {
      for (const n of PAGE_SIZES) {
        if (n === s.pageSize) continue
        cmds.push({
          id: `page:size:${n}`,
          title: `Page size: ${n}`,
          group: 'Pagination',
          keywords: 'rows per page limit',
          run: () => s.setPageSize(n),
        })
      }
      if (s.page > 1) {
        cmds.push({
          id: 'page:prev',
          title: 'Previous page',
          group: 'Pagination',
          shortcut: 'Ctrl+←',
          run: () => s.setPage(s.page - 1),
        })
        cmds.push({
          id: 'page:first',
          title: 'First page',
          group: 'Pagination',
          run: () => s.setPage(1),
        })
      }
      if (s.hasMore) {
        cmds.push({
          id: 'page:next',
          title: 'Next page',
          group: 'Pagination',
          shortcut: 'Ctrl+→',
          run: () => s.setPage(s.page + 1),
        })
      }
    }
  }

  cmds.push({
    id: 'help:shortcuts',
    title: 'Keyboard shortcuts',
    group: 'Help',
    keywords: 'keys bindings help',
    run: () => s.setDialog({ kind: 'shortcuts' }),
  })

  return cmds
}

/** The filter input owns this id so commands and hotkeys can both reach it. */
export const FILTER_INPUT_ID = 'row-filter-input'

export function focusFilter() {
  const el = document.getElementById(FILTER_INPUT_ID)
  if (el instanceof HTMLInputElement) {
    el.focus()
    el.select()
  }
}

export function describeConnection(kind: string, host?: string, file?: string): string {
  if (kind === 'sqlite') return file ? shortenPath(file) : 'sqlite'
  return `${kind} · ${host || 'localhost'}`
}

function shortenPath(p: string): string {
  const parts = p.split(/[\\/]/)
  return parts.length <= 2 ? p : `…/${parts.slice(-2).join('/')}`
}

export function formatCount(n: number): string {
  if (n < 1000) return String(n)
  if (n < 1_000_000) return `${(n / 1000).toFixed(n < 10_000 ? 1 : 0)}k`
  return `${(n / 1_000_000).toFixed(1)}m`
}

/** Searchable text for a command: what is shown, plus hidden keywords. */
export function commandText(c: Command): string {
  return `${c.title} ${c.subtitle ?? ''} ${c.keywords ?? ''}`
}
