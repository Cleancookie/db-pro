/**
 * Parses the free-text "Custom…" page size box in `Paginator.tsx`. Anything
 * that is not a positive integer is rejected outright rather than coerced, so
 * a stray keystroke cannot silently become page size 0 or NaN rows. A valid
 * number above `max` (the configured row cap) is clamped rather than
 * rejected — the user's intent ("as many as will fit") is still honoured.
 */
export function parsePageSize(raw: string, max: number): number | null {
  const n = Number.parseInt(raw, 10)
  if (!Number.isFinite(n) || n < 1) return null
  return Math.min(n, max)
}
