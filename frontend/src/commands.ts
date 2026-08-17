/**
 * The command registry.
 *
 * Everything the app can do is a Command, and the palette is the primary way
 * to reach any of it. The list is rebuilt from state on every open, so it is
 * context-aware: tables only appear once a database is selected, "Disconnect"
 * only when connected.
 */

import { schemaBias, type Candidate } from './fuzzy'
import { reportText } from './startup'
import { PAGE_SIZES, type useStore } from './store'
import type { ObjectType, SchemaObject } from './types'

type Store = ReturnType<typeof useStore.getState>

export interface Command {
  id: string
  title: string
  subtitle?: string
  group: string
  shortcut?: string
  /** How this entry is matched and ranked. */
  candidate: Candidate
  run: () => void | Promise<void>
}

export const OBJECT_ICON: Record<ObjectType, string> = {
  table: '▤',
  view: '◫',
  function: 'ƒ',
  procedure: '⚙',
}

/**
 * Tables are what people navigate to; routines are usually noise in a name
 * search. Values are on fuzzysort's 0–1 scale, so these are nudges — a
 * function that matches strongly still beats a table that barely matches.
 */
function typeBias(t: ObjectType): number {
  switch (t) {
    case 'table':
      return 0
    case 'view':
      return -0.02
    default:
      return -0.08
  }
}

export function objectCandidate(o: SchemaObject): Candidate {
  return {
    name: o.name,
    qualifier: o.schema || undefined,
    keywords: o.type,
    bias: schemaBias(o.schema) + typeBias(o.type),
  }
}

export function qualifiedName(o: { schema: string; name: string }): string {
  return o.schema ? `${o.schema}.${o.name}` : o.name
}

/**
 * The navigation palette (Ctrl+P): places to go.
 *
 * Tables, views, databases and connections — the things a person means when
 * they know *what* they want to look at. Nothing here changes settings or
 * app state beyond moving somewhere.
 */
export function buildNavigationCommands(s: Store): Command[] {
  const cmds: Command[] = []

  // Objects first: navigating to a table is by far the most common reason to
  // open this palette, so those entries lead when nothing has been typed.
  if (s.activeConnectionId) {
    for (const o of s.objects) {
      cmds.push({
        id: `object:${qualifiedName(o)}:${o.type}`,
        title: qualifiedName(o),
        subtitle: o.type + (o.rowEstimate != null ? ` · ~${formatCount(o.rowEstimate)} rows` : ''),
        group: 'Open',
        candidate: objectCandidate(o),
        run: () => s.openObject(o),
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
        candidate: { name: db, keywords: 'use database switch catalog', bias: -0.05 },
        run: () => s.selectDatabase(db),
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
      candidate: {
        name: c.name,
        keywords: `connect connection ${c.kind} ${c.host ?? ''} ${c.file ?? ''}`,
      },
      run: () => s.connect(c.id),
    })
  }

  return cmds
}

/**
 * The action palette (Ctrl+Shift+P): things to do.
 *
 * Settings, the activity tray, pagination, managing connections. This is where
 * everything that used to live in the top bar went — the app is
 * palette-first, so a permanent strip of buttons for three actions was mostly
 * ornament.
 */
export function buildActionCommands(s: Store): Command[] {
  const cmds: Command[] = []

  cmds.push({
    id: 'connection:new',
    title: 'New connection…',
    group: 'Connections',
    candidate: {
      // Matches the title exactly so highlighting lines up — see alignToTitle.
      name: 'New connection…',
      keywords: 'add create database server mysql postgres mssql sqlite',
    },
    run: () => s.setDialog({ kind: 'connection', connection: null }),
  })

  if (s.activeConnectionId) {
    const active = s.connections.find((c) => c.id === s.activeConnectionId)
    if (active) {
      cmds.push({
        id: 'connection:edit',
        title: `Edit connection “${active.name}”`,
        group: 'Connections',
        candidate: { name: `Edit ${active.name}`, keywords: 'connection settings modify' },
        run: () => s.setDialog({ kind: 'connection', connection: active }),
      })
      cmds.push({
        id: 'connection:disconnect',
        title: `Disconnect from ${active.name}`,
        group: 'Connections',
        candidate: { name: `Disconnect ${active.name}`, keywords: 'close drop' },
        run: () => s.disconnect(active.id),
      })
    }
  }

  cmds.push({
    id: 'sql:toggle',
    title: s.view === 'sql' ? 'Close SQL editor' : 'Open SQL editor',
    group: 'Query',
    shortcut: 'Ctrl+E',
    candidate: { name: 'SQL editor', keywords: 'query write execute run' },
    run: () => s.setView(s.view === 'sql' ? 'data' : 'sql'),
  })

  cmds.push({
    id: 'tray:toggle',
    title: s.trayOpen ? 'Hide the activity tray' : 'Show running queries',
    subtitle: 'In-flight queries, with elapsed time and cancel',
    group: 'Query',
    shortcut: 'Ctrl+J',
    candidate: {
      name: 'Running queries',
      keywords: 'activity tray monitor cancel kill progress loading elapsed',
    },
    run: () => s.setTrayOpen(!s.trayOpen),
  })

  cmds.push({
    id: 'app:startup-timing',
    title: 'Show startup timing',
    subtitle: 'Where launch time went, this run',
    group: 'App',
    candidate: { name: 'Startup timing', keywords: 'slow launch boot performance profile' },
    // A toast rather than a console log: the Windows build is launched from
    // Explorer, where there is no console to read. Also logged, for when
    // devtools *is* open and the toast has already timed out.
    run: () => {
      console.info('startup:', reportText())
      s.pushToast('info', reportText())
    },
  })

  cmds.push({
    id: 'tray:clear',
    title: 'Clear the query log',
    subtitle: 'Drops finished queries from the tray; anything running stays',
    group: 'Query',
    candidate: { name: 'Clear query log', keywords: 'activity history tray reset empty' },
    run: () => s.clearQueryHistory(),
  })

  cmds.push({
    id: 'view:activity',
    title: 'Show open connections',
    subtitle: 'Connection pools per database, with disconnect',
    group: 'Query',
    shortcut: 'Ctrl+Shift+A',
    candidate: { name: 'Open connections', keywords: 'activity sessions processes pool disconnect' },
    run: () => s.setView('activity'),
  })

  if (s.activeRef) {
    cmds.push({
      id: 'data:refresh',
      title: 'Refresh rows',
      group: 'Query',
      shortcut: 'Ctrl+R',
      candidate: { name: 'Refresh rows', keywords: 'reload requery' },
      run: () => s.reload(),
    })
    cmds.push({
      id: 'data:focus-filter',
      title: 'Filter rows (SQL after WHERE)',
      group: 'Query',
      shortcut: 'Ctrl+F',
      candidate: { name: 'Filter rows', keywords: 'where search find condition' },
      run: () => focusFilter(),
    })
    if (s.filter) {
      cmds.push({
        id: 'data:clear-filter',
        title: 'Clear filter',
        group: 'Query',
        candidate: { name: 'Clear filter', keywords: 'reset where' },
        run: () => s.applyFilter(''),
      })
    }
    if (s.orderBy.length > 0) {
      cmds.push({
        id: 'data:clear-sort',
        title: 'Clear sort',
        group: 'Query',
        candidate: { name: 'Clear sort', keywords: 'reset order by' },
        run: () => s.clearSort(),
      })
    }

    cmds.push({
      id: 'page:toggle',
      title: s.paginationEnabled ? 'Turn pagination off' : 'Turn pagination on',
      subtitle: s.paginationEnabled
        ? 'Load every matching row, up to the safety cap'
        : `Back to pages of ${s.pageSize}`,
      group: 'Pagination',
      candidate: { name: 'Pagination', keywords: 'paging limit all rows off on' },
      run: () => s.setPaginationEnabled(!s.paginationEnabled),
    })
    if (s.paginationEnabled) {
      for (const n of PAGE_SIZES) {
        if (n === s.pageSize) continue
        cmds.push({
          id: `page:size:${n}`,
          title: `Page size: ${n}`,
          group: 'Pagination',
          candidate: { name: `Page size ${n}`, keywords: 'rows per page limit', bias: -0.1 },
          run: () => s.setPageSize(n),
        })
      }
      if (s.page > 1) {
        cmds.push({
          id: 'page:prev',
          title: 'Previous page',
          group: 'Pagination',
          shortcut: 'Ctrl+←',
          candidate: { name: 'Previous page', keywords: 'back' },
          run: () => s.setPage(s.page - 1),
        })
        cmds.push({
          id: 'page:first',
          title: 'First page',
          group: 'Pagination',
          candidate: { name: 'First page', keywords: 'start beginning' },
          run: () => s.setPage(1),
        })
      }
      if (s.hasMore) {
        cmds.push({
          id: 'page:next',
          title: 'Next page',
          group: 'Pagination',
          shortcut: 'Ctrl+→',
          candidate: { name: 'Next page', keywords: 'forward' },
          run: () => s.setPage(s.page + 1),
        })
      }
    }
  }

  cmds.push({
    id: 'app:settings',
    title: 'Settings',
    group: 'App',
    shortcut: 'Ctrl+,',
    candidate: {
      name: 'Settings',
      // The cog in the top bar is gone, so this is the way in: worth matching
      // the names of the things inside the dialog too.
      keywords: 'preferences options config font size page cap confirm system',
    },
    run: () => s.setDialog({ kind: 'settings' }),
  })

  cmds.push({
    id: 'help:shortcuts',
    title: 'Keyboard shortcuts',
    group: 'App',
    candidate: { name: 'Keyboard shortcuts', keywords: 'keys bindings help' },
    run: () => s.setDialog({ kind: 'shortcuts' }),
  })

  return cmds
}

/** The filter editor owns this id, for `aria` wiring and for tests. */
export const FILTER_INPUT_ID = 'row-filter-input'

/**
 * Focusing the filter goes through a registered callback rather than the DOM.
 *
 * The filter is a CodeMirror editor, not an `<input>`, so `el.focus()` on the
 * container would land on a div and `el.select()` does not exist. The editor
 * registers its own handle here on mount, and the hotkey and the palette both
 * call through it.
 */
let filterFocus: (() => void) | null = null

export function registerFilterFocus(fn: (() => void) | null) {
  filterFocus = fn
}

export function focusFilter() {
  filterFocus?.()
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

export function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`
  const mins = Math.floor(ms / 60_000)
  return `${mins}m ${Math.round((ms % 60_000) / 1000)}s`
}
