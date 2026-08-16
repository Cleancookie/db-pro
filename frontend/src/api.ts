// Typed client for the Go API.
//
// Two transports, one interface. Inside the Wails webview the generated
// bindings hang off window.go; in a browser we POST to the dev server. Nothing
// above this file knows which is in play.
// See docs/adr/0001-go-core-with-two-transports.md.

import type {
  ActivityResult,
  Capabilities,
  Column,
  Connection,
  ConnectResult,
  Kind,
  ObjectRef,
  Pagination,
  ReadRowsResult,
  ResultSet,
  SaveConnectionRequest,
  SchemaObject,
  Settings,
  Sort,
} from './types'

type Bindings = Record<string, (...args: unknown[]) => Promise<unknown>>

declare global {
  interface Window {
    go?: { main?: { App?: Bindings } }
  }
}

function wailsBindings(): Bindings | null {
  return window.go?.main?.App ?? null
}

export const transportName = wailsBindings() ? 'wails' : 'http'

/**
 * Errors from the Go side are almost always database errors, which are the
 * user's primary feedback channel. They are surfaced verbatim rather than
 * being wrapped in something friendlier and less useful.
 */
export class ApiError extends Error {
  constructor(public method: string, message: string) {
    super(message)
    this.name = 'ApiError'
  }
}

/**
 * `args` is the ordered argument list for the Wails binding. The HTTP
 * transport needs a single JSON body instead, so `httpBody` maps those
 * arguments into the shape cmd/devserver expects.
 */
async function call<T>(method: string, args: unknown[], httpBody: unknown): Promise<T> {
  const bindings = wailsBindings()
  if (bindings) {
    const fn = bindings[method]
    if (!fn) throw new ApiError(method, `binding ${method} is missing`)
    try {
      return (await fn(...args)) as T
    } catch (e) {
      throw new ApiError(method, e instanceof Error ? e.message : String(e))
    }
  }

  const res = await fetch(`/api/${method}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(httpBody ?? {}),
  })
  const text = await res.text()
  if (!res.ok) {
    let message = text
    try {
      message = (JSON.parse(text) as { error?: string }).error ?? text
    } catch {
      // A non-JSON body means the dev server is not running or something
      // upstream failed; the raw text is the most useful thing to show.
    }
    throw new ApiError(method, message || `${method} failed with ${res.status}`)
  }
  return (text ? JSON.parse(text) : null) as T
}

export const api = {
  drivers: () => call<Record<Kind, Capabilities>>('Drivers', [], {}),

  listConnections: () => call<Connection[]>('ListConnections', [], {}),

  saveConnection: (req: SaveConnectionRequest) =>
    call<Connection>('SaveConnection', [req], req),

  deleteConnection: (id: string) => call<void>('DeleteConnection', [id], { id }),

  testConnection: (req: SaveConnectionRequest) => call<void>('TestConnection', [req], req),

  connect: (id: string) => call<ConnectResult>('Connect', [id], { id }),

  disconnect: (id: string) => call<void>('Disconnect', [id], { id }),

  connectedIds: () => call<string[] | null>('ConnectedIDs', [], {}),

  listObjects: (id: string, database: string) =>
    call<SchemaObject[]>('ListObjects', [id, database], { id, database }),

  listColumns: (id: string, ref: ObjectRef) =>
    call<Column[]>('ListColumns', [id, ref], { id, ref }),

  readRows: (req: {
    connectionId: string
    ref: ObjectRef
    filter: string
    orderBy: Sort[]
    pagination: Pagination
  }) => call<ReadRowsResult>('ReadRows', [req], req),

  countRows: (req: { connectionId: string; ref: ObjectRef; filter: string }) =>
    call<number>('CountRows', [req], req),

  runSql: (req: { connectionId: string; database: string; sql: string; maxRows: number }) =>
    call<ResultSet>('RunSQL', [req], req),

  getSettings: () => call<Settings>('GetSettings', [], {}),

  saveSettings: (s: Settings) => call<Settings>('SaveSettings', [s], s),

  activity: () => call<ActivityResult>('Activity', [], {}),

  cancelQuery: (id: string) => call<void>('CancelQuery', [id], { id }),
}

export function errorMessage(e: unknown): string {
  if (e instanceof Error) return e.message
  return String(e)
}
