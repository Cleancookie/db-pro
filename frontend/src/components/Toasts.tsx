import { useStore } from '../store'

/**
 * Errors here are usually the database's own message about a filter or query,
 * so they are shown in full, in a monospace face, and stay until dismissed.
 */
export function Toasts() {
  const toasts = useStore((s) => s.toasts)
  const dismiss = useStore((s) => s.dismissToast)

  if (toasts.length === 0) return null

  return (
    <div className="pointer-events-none fixed right-4 bottom-4 z-50 flex w-[min(460px,90vw)] flex-col gap-2">
      {toasts.map((t) => (
        <div
          key={t.id}
          role={t.kind === 'error' ? 'alert' : 'status'}
          className={`pointer-events-auto flex items-start gap-2 rounded border px-3 py-2 shadow-lg ${
            t.kind === 'error'
              ? 'border-[var(--color-danger)]/50 bg-[#2a1b1b]'
              : 'border-[var(--color-border-strong)] bg-[var(--color-elevated)]'
          }`}
        >
          <span
            className={`flex-1 font-[var(--font-mono)] text-[11px] leading-relaxed break-words ${
              t.kind === 'error' ? 'text-[var(--color-danger)]' : 'text-[var(--color-text)]'
            }`}
          >
            {t.message}
          </span>
          <button
            onClick={() => dismiss(t.id)}
            aria-label="Dismiss"
            className="shrink-0 rounded px-1 text-[var(--color-muted)] hover:text-[var(--color-text)]"
          >
            ✕
          </button>
        </div>
      ))}
    </div>
  )
}
