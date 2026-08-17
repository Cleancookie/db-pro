import { lazy, Suspense } from 'react'
import type { EditorProps } from './Editor'

/**
 * The editor, loaded on demand.
 *
 * CodeMirror is the largest thing in the bundle, and at launch neither surface
 * that uses it exists: the filter bar is only rendered once a table is open,
 * and the SQL editor only on the SQL view. Parsing it during startup was
 * therefore pure cost, paid by every launch including the ones that never
 * touch an editor.
 *
 * Vite splits this into its own chunk. The import resolves from the embedded
 * asset server — no network — so the fallback is on screen for a frame or two.
 * It reserves the same box as the editor so nothing jumps.
 */
const Impl = lazy(() => import('./Editor').then((m) => ({ default: m.Editor })))

export function Editor(props: EditorProps) {
  return (
    <Suspense fallback={<div className={props.className} aria-busy="true" />}>
      <Impl {...props} />
    </Suspense>
  )
}
