import { useEffect, useState } from 'react'
import { api, errorMessage } from '../api'
import { useStore } from '../store'
import type { Connection, Kind } from '../types'

const KIND_ORDER: Kind[] = ['postgres', 'mysql', 'mssql', 'sqlite']

const BLANK: Connection = {
  id: '',
  name: '',
  kind: 'postgres',
  host: 'localhost',
  port: 5432,
  user: '',
  database: '',
  file: '',
}

type TestState = { state: 'idle' } | { state: 'testing' } | { state: 'ok' } | { state: 'failed'; message: string }

export function ConnectionDialog({ existing }: { existing: Connection | null }) {
  const drivers = useStore((s) => s.drivers)
  const setDialog = useStore((s) => s.setDialog)
  const saveConnection = useStore((s) => s.saveConnection)
  const deleteConnection = useStore((s) => s.deleteConnection)

  const [conn, setConn] = useState<Connection>(existing ?? BLANK)
  // null means "not touched" — saving then leaves the stored password alone.
  const [password, setPassword] = useState<string | null>(existing ? null : '')
  const [test, setTest] = useState<TestState>({ state: 'idle' })

  const caps = drivers?.[conn.kind]
  const isFileBased = !caps?.serverHostsDatabases

  // Changing dialect should move the port to that dialect's default, but must
  // not clobber a port the user deliberately typed.
  useEffect(() => {
    if (!caps || isFileBased) return
    setConn((c) => {
      const previousDefault = drivers
        ? Object.values(drivers).some((d) => d.defaultPort === c.port)
        : false
      return !c.port || previousDefault ? { ...c, port: caps.defaultPort } : c
    })
  }, [conn.kind, caps, drivers, isFileBased])

  const patch = (p: Partial<Connection>) => {
    setConn((c) => ({ ...c, ...p }))
    setTest({ state: 'idle' })
  }

  const runTest = async () => {
    setTest({ state: 'testing' })
    try {
      await api.testConnection({ connection: conn, password })
      setTest({ state: 'ok' })
    } catch (e) {
      setTest({ state: 'failed', message: errorMessage(e) })
    }
  }

  const canSave = conn.name.trim() !== '' && (isFileBased ? !!conn.file : !!conn.host)

  return (
    <div
      className="chrome fixed inset-0 z-40 flex items-center justify-center bg-black/50"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) setDialog({ kind: 'none' })
      }}
    >
      <form
        onSubmit={(e) => {
          e.preventDefault()
          if (canSave) void saveConnection(conn, password)
        }}
        onKeyDown={(e) => {
          if (e.key === 'Escape') setDialog({ kind: 'none' })
        }}
        className="w-[min(520px,92vw)] rounded-lg border border-[var(--color-border-strong)] bg-[var(--color-elevated)] shadow-2xl"
      >
        <h2 className="border-b border-[var(--color-border)] px-4 py-3 font-semibold">
          {existing ? `Edit ${existing.name}` : 'New connection'}
        </h2>

        <div className="grid grid-cols-2 gap-3 p-4">
          <Field label="Name" className="col-span-2">
            <input
              autoFocus
              value={conn.name}
              onChange={(e) => patch({ name: e.target.value })}
              placeholder="Production replica"
              className={inputClass}
            />
          </Field>

          <Field label="Type" className="col-span-2">
            <div className="flex gap-1.5">
              {KIND_ORDER.map((k) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => patch({ kind: k })}
                  className={`flex-1 rounded border px-2 py-1.5 ${
                    conn.kind === k
                      ? 'border-[var(--color-accent)] bg-[var(--color-accent-dim)]/40'
                      : 'border-[var(--color-border-strong)] hover:border-[var(--color-border-strong)] hover:bg-white/5'
                  }`}
                >
                  {drivers?.[k]?.displayName ?? k}
                </button>
              ))}
            </div>
          </Field>

          {isFileBased ? (
            <Field label="Database file" className="col-span-2">
              <input
                value={conn.file ?? ''}
                onChange={(e) => patch({ file: e.target.value })}
                placeholder="C:\data\app.sqlite"
                spellCheck={false}
                className={`${inputClass} font-[var(--font-mono)]`}
              />
            </Field>
          ) : (
            <>
              <Field label="Host">
                <input
                  value={conn.host ?? ''}
                  onChange={(e) => patch({ host: e.target.value })}
                  spellCheck={false}
                  className={inputClass}
                />
              </Field>
              <Field label="Port">
                <input
                  type="number"
                  value={conn.port ?? ''}
                  onChange={(e) => patch({ port: Number(e.target.value) })}
                  className={inputClass}
                />
              </Field>
              <Field label="User">
                <input
                  value={conn.user ?? ''}
                  onChange={(e) => patch({ user: e.target.value })}
                  spellCheck={false}
                  autoComplete="off"
                  className={inputClass}
                />
              </Field>
              <Field label="Password">
                <input
                  type="password"
                  value={password ?? ''}
                  onChange={(e) => {
                    setPassword(e.target.value)
                    setTest({ state: 'idle' })
                  }}
                  placeholder={password === null ? '••••••• unchanged' : ''}
                  autoComplete="off"
                  className={inputClass}
                />
              </Field>
              <Field label="Database" className="col-span-2">
                <input
                  value={conn.database ?? ''}
                  onChange={(e) => patch({ database: e.target.value })}
                  placeholder={conn.kind === 'postgres' ? 'postgres' : 'optional'}
                  spellCheck={false}
                  className={inputClass}
                />
              </Field>
            </>
          )}
        </div>

        {test.state === 'failed' && (
          <p className="mx-4 mb-3 rounded border border-[var(--color-danger)]/50 bg-[var(--color-danger)]/10 px-3 py-2 font-[var(--font-mono)] text-[0.6875rem] break-words text-[var(--color-danger)]">
            {test.message}
          </p>
        )}
        {test.state === 'ok' && (
          <p className="mx-4 mb-3 text-[0.6875rem] text-[var(--color-success)]">Connected successfully</p>
        )}

        <div className="flex items-center gap-2 border-t border-[var(--color-border)] px-4 py-3">
          <button
            type="button"
            onClick={() => void runTest()}
            disabled={test.state === 'testing' || !canSave}
            className="rounded border border-[var(--color-border-strong)] px-3 py-1.5 disabled:opacity-40 enabled:hover:border-[var(--color-accent)]"
          >
            {test.state === 'testing' ? 'Testing…' : 'Test'}
          </button>

          {existing && (
            <button
              type="button"
              onClick={() => {
                void deleteConnection(existing.id)
                setDialog({ kind: 'none' })
              }}
              className="rounded border border-[var(--color-border-strong)] px-3 py-1.5 text-[var(--color-danger)] hover:border-[var(--color-danger)]"
            >
              Delete
            </button>
          )}

          <button
            type="button"
            onClick={() => setDialog({ kind: 'none' })}
            className="ml-auto rounded px-3 py-1.5 text-[var(--color-muted)] hover:text-[var(--color-text)]"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={!canSave}
            className="rounded bg-[var(--color-accent-dim)] px-3 py-1.5 font-medium disabled:opacity-40 enabled:hover:bg-[var(--color-accent)]"
          >
            Save
          </button>
        </div>
      </form>
    </div>
  )
}

const inputClass =
  'w-full rounded border border-[var(--color-border-strong)] bg-[var(--color-bg)] px-2 py-1.5 outline-none placeholder:text-[var(--color-faint)]'

function Field({
  label,
  className = '',
  children,
}: {
  label: string
  className?: string
  children: React.ReactNode
}) {
  return (
    <label className={`block ${className}`}>
      <span className="mb-1 block text-[0.625rem] font-semibold tracking-wider text-[var(--color-faint)] uppercase">
        {label}
      </span>
      {children}
    </label>
  )
}
