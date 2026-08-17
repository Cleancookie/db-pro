import { create } from 'zustand'
import { api, errorMessage } from './api'
import { absoluteRowOffset, cellText, isCellTruncated } from './cells'
import type {
  ActivityResult,
  Capabilities,
  Cell,
  Column,
  Connection,
  Kind,
  ObjectRef,
  ResultSet,
  SchemaObject,
  Settings,
  Sort,
} from './types'

export const PAGE_SIZES = [50, 100, 200, 500, 1000] as const

export interface Toast {
  id: number
  kind: 'error' | 'info'
  message: string
}

/** One cell, as the viewer needs to see it. */
export interface CellTarget {
  column: string
  dbType: string
  value: Cell
  /** The text cap shortened this value; the whole thing is a fetch away. */
  truncated: boolean
  /**
   * The row's absolute offset in the filtered, sorted result, which is how the
   * full value is fetched. null when there is nothing to fetch from — an
   * ad-hoc SQL result has no table to go back to.
   */
  rowOffset: number | null
}

export type DialogState =
  | { kind: 'none' }
  | { kind: 'connection'; connection: Connection | null }
  | { kind: 'shortcuts' }
  | { kind: 'settings' }
  | { kind: 'confirmDelete'; connection: Connection }
  | { kind: 'cell'; cell: CellTarget }

/** Which grid a cell came from, since only the browse grid can re-read it. */
export type ResultSource = 'browse' | 'sql'

/** Which pane fills the main area. */
export type View = 'data' | 'sql' | 'activity'

/** Collapsible sidebar sections. */
export type SectionKey = 'connections' | 'databases' | 'objects'

export const DEFAULT_SETTINGS: Settings = {
  fontSizePx: 16,
  defaultPageSize: 100,
  paginationEnabled: true,
  rowCap: 100_000,
  textCapChars: 1024,
  showSystemObjects: false,
  autoCount: true,
  confirmDestructive: true,
}

interface State {
  // catalogue
  drivers: Record<Kind, Capabilities> | null
  connections: Connection[]
  connectedIds: string[]

  // active connection
  activeConnectionId: string | null
  capabilities: Capabilities | null
  databases: string[]
  activeDatabase: string
  objects: SchemaObject[]

  // active object
  activeRef: ObjectRef | null
  columns: Column[]
  result: ResultSet | null
  orderBy: Sort[]

  // filter (Ctrl+F) — raw SQL after WHERE
  filter: string

  // pagination
  paginationEnabled: boolean
  page: number
  pageSize: number
  hasMore: boolean
  totalCount: number | null

  // sql editor
  sqlText: string
  sqlResult: ResultSet | null

  // ui
  view: View
  collapsed: Record<SectionKey, boolean>
  settings: Settings
  activity: ActivityResult
  paletteOpen: boolean
  dialog: DialogState
  busy: boolean
  toasts: Toast[]

  // actions
  init: () => Promise<void>
  refreshConnections: () => Promise<void>
  connect: (id: string) => Promise<void>
  disconnect: (id: string) => Promise<void>
  selectDatabase: (name: string) => Promise<void>
  openObject: (o: SchemaObject) => Promise<void>
  reload: () => Promise<void>
  setFilter: (f: string) => void
  applyFilter: (f: string) => Promise<void>
  setPage: (p: number) => Promise<void>
  setPageSize: (n: number) => Promise<void>
  setPaginationEnabled: (on: boolean) => Promise<void>
  toggleSort: (column: string) => Promise<void>
  clearSort: () => Promise<void>
  setView: (v: View) => void
  toggleSection: (k: SectionKey) => void
  loadSettings: () => Promise<void>
  saveSettings: (s: Settings) => Promise<void>
  refreshActivity: () => Promise<void>
  cancelQuery: (id: string) => Promise<void>
  setSqlText: (t: string) => void
  runSql: () => Promise<void>
  saveConnection: (c: Connection, password: string | null) => Promise<void>
  deleteConnection: (id: string) => Promise<void>
  setPaletteOpen: (open: boolean) => void
  setDialog: (d: DialogState) => void
  /** Resolves a grid coordinate to a cell, or null if there is nothing there. */
  cellTarget: (source: ResultSource, rowIndex: number, colIndex: number) => CellTarget | null
  openCell: (source: ResultSource, rowIndex: number, colIndex: number) => void
  /** Copies a cell; `full` re-reads it uncapped first. */
  copyCell: (
    source: ResultSource,
    rowIndex: number,
    colIndex: number,
    full?: boolean,
  ) => Promise<void>
  copyText: (text: string) => Promise<void>
  pushToast: (kind: Toast['kind'], message: string) => void
  dismissToast: (id: number) => void
}

/**
 * Responses are matched against this counter before being applied. Paging
 * quickly, or retyping a filter, can leave an earlier request in flight;
 * without the guard a slow first response would overwrite a newer one and the
 * grid would show rows that do not match what the controls say.
 */
let requestSeq = 0
let toastSeq = 0

export const useStore = create<State>((set, get) => {
  /** Fetches the current page and, separately, the total count. */
  async function fetchRows() {
    const s = get()
    if (!s.activeConnectionId || !s.activeRef) return

    const seq = ++requestSeq
    const { activeConnectionId, activeRef, filter, orderBy } = s
    set({ busy: true })

    try {
      const res = await api.readRows({
        connectionId: activeConnectionId,
        ref: activeRef,
        filter,
        orderBy,
        pagination: {
          enabled: s.paginationEnabled,
          page: s.page,
          pageSize: s.pageSize,
        },
      })
      if (seq !== requestSeq) return
      set({
        result: res.result,
        columns: res.columns,
        hasMore: res.hasMore,
        busy: false,
      })
    } catch (e) {
      if (seq !== requestSeq) return
      set({ busy: false })
      get().pushToast('error', errorMessage(e))
      return
    }

    // The count is deliberately not awaited above: COUNT(*) on a large table
    // is slow and must not delay the rows the user asked for.
    if (!get().settings.autoCount) {
      set({ totalCount: null })
      return
    }
    void (async () => {
      set({ totalCount: null })
      try {
        const n = await api.countRows({
          connectionId: activeConnectionId,
          ref: activeRef,
          filter,
        })
        if (seq === requestSeq) set({ totalCount: n })
      } catch {
        // A failed count is not worth interrupting the user over — the grid
        // simply shows no total.
      }
    })()
  }

  return {
    drivers: null,
    connections: [],
    connectedIds: [],
    activeConnectionId: null,
    capabilities: null,
    databases: [],
    activeDatabase: '',
    objects: [],
    activeRef: null,
    columns: [],
    result: null,
    orderBy: [],
    filter: '',
    paginationEnabled: true,
    page: 1,
    pageSize: 100,
    hasMore: false,
    totalCount: null,
    sqlText: '',
    sqlResult: null,
    view: 'data',
    collapsed: { connections: false, databases: false, objects: false },
    settings: DEFAULT_SETTINGS,
    activity: { queries: [], sessions: [] },
    paletteOpen: false,
    dialog: { kind: 'none' },
    busy: false,
    toasts: [],

    async init() {
      try {
        const [drivers, connections, connectedIds, settings] = await Promise.all([
          api.drivers(),
          api.listConnections(),
          api.connectedIds(),
          api.getSettings(),
        ])
        set({
          drivers,
          connections,
          connectedIds: connectedIds ?? [],
          settings,
          // Seed the browse controls from the saved preferences.
          pageSize: settings.defaultPageSize,
          paginationEnabled: settings.paginationEnabled,
        })
        applyFontSize(settings.fontSizePx)
      } catch (e) {
        get().pushToast('error', errorMessage(e))
      }
    },

    async refreshConnections() {
      try {
        set({ connections: await api.listConnections() })
      } catch (e) {
        get().pushToast('error', errorMessage(e))
      }
    },

    async connect(id) {
      set({ busy: true })
      try {
        const res = await api.connect(id)
        const databases = res.databases.map((d) => d.name)
        const active = res.defaultDatabase || databases[0] || ''
        set({
          activeConnectionId: id,
          capabilities: res.capabilities,
          databases,
          activeDatabase: active,
          connectedIds: Array.from(new Set([...get().connectedIds, id])),
          objects: [],
          activeRef: null,
          result: null,
          columns: [],
          filter: '',
          page: 1,
          totalCount: null,
          busy: false,
        })
        if (active) await get().selectDatabase(active)
      } catch (e) {
        set({ busy: false })
        get().pushToast('error', errorMessage(e))
      }
    },

    async disconnect(id) {
      try {
        await api.disconnect(id)
      } catch (e) {
        get().pushToast('error', errorMessage(e))
      }
      const stillActive = get().activeConnectionId === id
      set({
        connectedIds: get().connectedIds.filter((c) => c !== id),
        ...(stillActive
          ? {
              activeConnectionId: null,
              capabilities: null,
              databases: [],
              activeDatabase: '',
              objects: [],
              activeRef: null,
              result: null,
              columns: [],
              totalCount: null,
            }
          : {}),
      })
    },

    async selectDatabase(name) {
      const id = get().activeConnectionId
      if (!id) return
      set({ activeDatabase: name, busy: true, objects: [] })
      try {
        const objects = await api.listObjects(id, name)
        set({ objects, busy: false })
      } catch (e) {
        set({ busy: false })
        get().pushToast('error', errorMessage(e))
      }
    },

    async openObject(o) {
      const s = get()
      if (!s.activeConnectionId) return
      // Functions and procedures have no rows to browse. Selecting one in the
      // palette should not blank the grid.
      if (o.type === 'function' || o.type === 'procedure') {
        s.pushToast('info', `${o.name} is a ${o.type} — open the SQL editor to call it`)
        return
      }
      set({
        activeRef: { database: s.activeDatabase, schema: o.schema, name: o.name },
        // A new table starts clean: carrying a filter written for the previous
        // table over would almost always be a syntax error.
        filter: '',
        orderBy: [],
        page: 1,
        totalCount: null,
        result: null,
        view: 'data',
      })
      await fetchRows()
    },

    async reload() {
      await fetchRows()
    },

    setFilter(filter) {
      set({ filter })
    },

    async applyFilter(filter) {
      set({ filter, page: 1, totalCount: null })
      await fetchRows()
    },

    async setPage(p) {
      const page = Math.max(1, p)
      if (page === get().page) return
      set({ page })
      await fetchRows()
    },

    async setPageSize(pageSize) {
      // Jumping to page 1 avoids landing past the end of a smaller result.
      set({ pageSize, page: 1 })
      await fetchRows()
    },

    async setPaginationEnabled(on) {
      set({ paginationEnabled: on, page: 1 })
      await fetchRows()
    },

    async toggleSort(column) {
      const current = get().orderBy[0]
      let orderBy: Sort[]
      if (!current || current.column !== column) orderBy = [{ column, desc: false }]
      else if (!current.desc) orderBy = [{ column, desc: true }]
      else orderBy = [] // third click clears the sort
      set({ orderBy, page: 1 })
      await fetchRows()
    },

    async clearSort() {
      if (get().orderBy.length === 0) return
      set({ orderBy: [], page: 1 })
      await fetchRows()
    },

    setView(view) {
      set({ view })
      // Entering the activity page should show current data immediately
      // rather than after the first poll tick.
      if (view === 'activity') void get().refreshActivity()
    },

    toggleSection(k) {
      set({ collapsed: { ...get().collapsed, [k]: !get().collapsed[k] } })
    },

    async loadSettings() {
      try {
        const settings = await api.getSettings()
        set({ settings })
        applyFontSize(settings.fontSizePx)
      } catch (e) {
        get().pushToast('error', errorMessage(e))
      }
    },

    async saveSettings(next) {
      const before = get().settings
      try {
        const saved = await api.saveSettings(next)
        set({ settings: saved })
        applyFontSize(saved.fontSizePx)
        // The cap is applied by the query, so a changed cap only reaches the
        // grid on the next read. Doing it here saves the user wondering why
        // the setting appeared to do nothing.
        if (saved.textCapChars !== before.textCapChars && get().activeRef) {
          await fetchRows()
        }
      } catch (e) {
        get().pushToast('error', errorMessage(e))
      }
    },

    async refreshActivity() {
      try {
        set({ activity: await api.activity() })
      } catch {
        // The activity page polls; a transient failure would otherwise
        // produce a stream of toasts the user cannot act on.
      }
    },

    async cancelQuery(id) {
      try {
        await api.cancelQuery(id)
        await get().refreshActivity()
      } catch (e) {
        get().pushToast('error', errorMessage(e))
      }
    },

    setSqlText(sqlText) {
      set({ sqlText })
    },

    async runSql() {
      const s = get()
      if (!s.activeConnectionId) {
        s.pushToast('error', 'Connect to a database first')
        return
      }
      if (!s.sqlText.trim()) return
      set({ busy: true })
      try {
        const res = await api.runSql({
          connectionId: s.activeConnectionId,
          database: s.activeDatabase,
          sql: s.sqlText,
          maxRows: 0,
        })
        set({ sqlResult: res, busy: false })
        if (res.rowsAffected != null) {
          s.pushToast('info', `${res.rowsAffected} row(s) affected in ${res.elapsedMs}ms`)
        }
      } catch (e) {
        set({ busy: false })
        get().pushToast('error', errorMessage(e))
      }
    },

    async saveConnection(connection, password) {
      try {
        await api.saveConnection({ connection, password })
        await get().refreshConnections()
        set({ dialog: { kind: 'none' } })
      } catch (e) {
        get().pushToast('error', errorMessage(e))
      }
    },

    async deleteConnection(id) {
      try {
        await api.deleteConnection(id)
        if (get().activeConnectionId === id) await get().disconnect(id)
        await get().refreshConnections()
        set({ dialog: { kind: 'none' } })
      } catch (e) {
        get().pushToast('error', errorMessage(e))
      }
    },

    setPaletteOpen(paletteOpen) {
      set({ paletteOpen })
    },

    setDialog(dialog) {
      set({ dialog })
    },

    cellTarget(source, rowIndex, colIndex) {
      const s = get()
      const rs = source === 'sql' ? s.sqlResult : s.result
      if (!rs) return null
      const column = rs.columns[colIndex]
      const value = rs.rows[rowIndex]?.[colIndex]
      if (!column || value === undefined) return null
      return {
        column: column.name,
        dbType: column.dbType,
        value,
        truncated: isCellTruncated(rs, rowIndex, colIndex),
        // The same absolute coordinate the row gutter is showing, which is what
        // ReadCell addresses rows by.
        rowOffset:
          source === 'browse' && s.activeRef
            ? absoluteRowOffset(rowIndex, {
                enabled: s.paginationEnabled,
                page: s.page,
                pageSize: s.pageSize,
              })
            : null,
      }
    },

    openCell(source, rowIndex, colIndex) {
      const cell = get().cellTarget(source, rowIndex, colIndex)
      if (cell) set({ dialog: { kind: 'cell', cell } })
    },

    async copyCell(source, rowIndex, colIndex, full = false) {
      const s = get()
      const cell = s.cellTarget(source, rowIndex, colIndex)
      if (!cell) return
      let text = cellText(cell.value)

      // Only worth a round trip when there is more to get: an untruncated cell
      // is already whole in the grid.
      if (full && cell.truncated && cell.rowOffset !== null && s.activeConnectionId && s.activeRef) {
        try {
          const res = await api.readCell({
            connectionId: s.activeConnectionId,
            ref: s.activeRef,
            column: cell.column,
            filter: s.filter,
            orderBy: s.orderBy,
            rowOffset: cell.rowOffset,
          })
          text = res.value ?? ''
        } catch (e) {
          s.pushToast('error', errorMessage(e))
          return
        }
      }

      await s.copyText(text)
    },

    async copyText(text) {
      try {
        await navigator.clipboard.writeText(text)
      } catch {
        // Clipboard access can be refused. Silence would look exactly like a
        // menu item that does nothing.
        get().pushToast('error', 'Could not write to the clipboard')
      }
    },

    pushToast(kind, message) {
      const id = ++toastSeq
      set({ toasts: [...get().toasts, { id, kind, message }] })
      // Errors stay until dismissed; they often contain the SQL detail the
      // user needs to read carefully.
      if (kind === 'info') {
        setTimeout(() => get().dismissToast(id), 4000)
      }
    },

    dismissToast(id) {
      set({ toasts: get().toasts.filter((t) => t.id !== id) })
    },
  }
})

/**
 * The whole UI is sized in rem, so setting the root font size rescales
 * spacing and controls together rather than leaving big text in small boxes.
 */
function applyFontSize(px: number) {
  document.documentElement.style.fontSize = `${px}px`
}
