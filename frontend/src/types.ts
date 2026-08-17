// Mirrors the Go DTOs in internal/driver, internal/config and internal/api.
// Kept hand-written rather than generated so the browser transport does not
// depend on `wails generate` having been run.

export type Kind = 'mysql' | 'postgres' | 'mssql' | 'sqlite'

export interface Capabilities {
  serverHostsDatabases: boolean
  hasSchemas: boolean
  databasePerConnection: boolean
  supportsFunctions: boolean
  defaultPort: number
  displayName: string
}

export interface Connection {
  id: string
  name: string
  kind: Kind
  host?: string
  port?: number
  user?: string
  database?: string
  file?: string
  sslMode?: string
  params?: Record<string, string>
  colour?: string
  createdAt?: string
  updatedAt?: string
}

export type ObjectType = 'table' | 'view' | 'function' | 'procedure'

export interface SchemaObject {
  schema: string
  name: string
  type: ObjectType
  rowEstimate?: number
}

export interface Column {
  name: string
  dataType: string
  nullable: boolean
  primaryKey: boolean
  default?: string
  ordinal: number
}

export interface ObjectRef {
  database: string
  schema: string
  name: string
}

export interface Sort {
  column: string
  desc: boolean
}

export interface ResultColumn {
  name: string
  dbType: string
}

/** Cell values are limited to these by internal/driver/scan.go. */
export type Cell = string | number | boolean | null

/** One cell's position in a ResultSet. */
export interface CellRef {
  row: number
  col: number
}

export interface ResultSet {
  columns: ResultColumn[]
  rows: Cell[][]
  truncated: boolean
  /** Character cap applied to long values; 0 means none was. */
  textCap: number
  /** The cells the cap shortened — the grid marks these rather than lying. */
  truncatedCells: CellRef[]
  elapsedMs: number
  rowsAffected?: number
  query: string
}

/** One value fetched on its own, in full — see api.readCell. */
export interface CellValue {
  /** null for NULL, which is not the same as an empty string. */
  value: string | null
  /** Size in the database, before any trimming. */
  bytes: number
  /** True when even the full fetch had to stop (8 MiB). */
  truncated: boolean
  query: string
}

export interface Pagination {
  enabled: boolean
  page: number
  pageSize: number
}

export interface ReadRowsResult {
  result: ResultSet
  columns: Column[]
  page: number
  hasMore: boolean
}

export interface ConnectResult {
  capabilities: Capabilities
  databases: { name: string }[]
  defaultDatabase: string
}

export interface SaveConnectionRequest {
  connection: Connection
  /** null leaves the stored password untouched. */
  password: string | null
}

export interface Settings {
  /** Root font size in px. The UI is sized in rem, so this scales all of it. */
  fontSizePx: number
  defaultPageSize: number
  paginationEnabled: boolean
  rowCap: number
  /** Characters kept from long text/JSON columns; 0 disables the cap. */
  textCapChars: number
  showSystemObjects: boolean
  autoCount: boolean
  confirmDestructive: boolean
  sidebarWidthPx: number
}

export type QueryKind = 'browse' | 'count' | 'query' | 'introspect'

/**
 * The app's own lifecycle states, instrumented in internal/activity,
 * internal/driver and internal/api — not the server's view of the query. The
 * last three are terminal: an entry carrying one of them is history.
 */
export type QueryPhase =
  | 'queued'
  | 'executing'
  | 'reading rows'
  | 'cancelling'
  | 'done'
  | 'failed'
  | 'cancelled'

/** One query, running or finished. Mirrors internal/activity.Info. */
export interface QueryInfo {
  id: string
  connectionId: string
  database: string
  kind: QueryKind
  sql: string
  startedAt: string
  /** Frozen once the phase is terminal. */
  elapsedMs: number
  phase: QueryPhase
  rowsRead: number
  error?: string
}

export interface SessionInfo {
  connectionId: string
  database: string
  openConns: number
  inUse: number
  idle: number
}

export interface ActivityResult {
  /** Running queries newest-first, then the bounded history newest-first. */
  queries: QueryInfo[]
  sessions: SessionInfo[]
}
