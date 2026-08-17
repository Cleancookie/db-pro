/**
 * Startup timing.
 *
 * Launch feel is the one performance question that cannot be answered from a
 * test: it depends on the webview booting, the bundle parsing and the config
 * reads, on a real machine. This records the few marks that separate those,
 * cheaply enough to leave in the shipped build.
 *
 * Deliberately readable from inside the app (a palette command reports it)
 * rather than only from devtools, because the Windows build is launched from
 * Explorer where there is no console to read.
 */

/** Marks in the order they happen. `at` is ms since the document started. */
const marks: { name: string; at: number }[] = []

export function mark(name: string) {
  marks.push({ name, at: Math.round(performance.now()) })
}

/**
 * Elapsed per phase, plus the total.
 *
 * `performance.now()` is relative to the start of the document, so the first
 * mark is itself a measurement — everything before the bundle ran: webview
 * boot, asset serving, and parsing the JavaScript.
 */
export function report(): { phase: string; ms: number }[] {
  if (marks.length === 0) return []
  const out = [{ phase: `webview + bundle (to ${marks[0].name})`, ms: marks[0].at }]
  for (let i = 1; i < marks.length; i++) {
    out.push({ phase: marks[i].name, ms: marks[i].at - marks[i - 1].at })
  }
  out.push({ phase: 'total', ms: marks[marks.length - 1].at })
  return out
}

export function reportText(): string {
  const rows = report()
  if (rows.length === 0) return 'no startup marks recorded'
  return rows.map((r) => `${r.phase}: ${r.ms}ms`).join(' · ')
}
