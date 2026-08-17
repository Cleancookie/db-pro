import { useEffect, useRef, useState } from 'react'
import { useStore } from '../store'

/** Drag limits. Mirrored in Settings.clamp() in Go, which rejects the rest. */
export const MIN_WIDTH = 180
export const MAX_WIDTH = 560
const KEY_STEP = 16
/** Matches Settings.SidebarWidthPx in DefaultSettings(). */
const DEFAULT_WIDTH = 256

/**
 * The sidebar's width, and the handle that changes it.
 *
 * The width is held in React state while dragging and written to settings only
 * on release: persisting per pointer event would be a disk write and an IPC
 * round trip per pixel of travel.
 */
export function useSidebarWidth() {
  const saved = useStore((s) => s.settings.sidebarWidthPx)
  const saveSettings = useStore((s) => s.saveSettings)
  const settings = useStore((s) => s.settings)

  const [dragging, setDragging] = useState(false)
  const [width, setWidth] = useState(saved)

  // Follows the saved value unless a drag is in progress, so loading settings
  // at startup — or changing them elsewhere — moves the edge, while a drag is
  // never yanked out from under the pointer.
  useEffect(() => {
    if (!dragging) setWidth(saved)
  }, [saved, dragging])

  const commit = (px: number) => {
    const next = clamp(px)
    setWidth(next)
    if (next !== saved) void saveSettings({ ...settings, sidebarWidthPx: next })
  }

  return { width: clamp(width), dragging, setDragging, setWidth, commit }
}

function clamp(px: number): number {
  return Math.round(Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, px)))
}

export interface SidebarResizerProps {
  width: number
  dragging: boolean
  setDragging: (on: boolean) => void
  setWidth: (px: number) => void
  commit: (px: number) => void
}

/**
 * The drag handle, overlaid on the sidebar's right edge.
 *
 * Absolutely positioned rather than a flex sibling: a divider in the layout
 * would mean wrapping the sidebar in a fragment and re-indenting all of it, and
 * an overlay cannot shift anything inside the panel.
 *
 * Pointer capture rather than window listeners: the pointer stays targeted at
 * this element even when it leaves it, so a fast drag over the grid does not
 * lose the gesture. It also means no listener survives an unmount.
 */
export function SidebarResizer({
  width,
  dragging,
  setDragging,
  setWidth,
  commit,
}: SidebarResizerProps) {
  const startX = useRef(0)
  const startWidth = useRef(width)

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize the sidebar"
      aria-valuenow={width}
      aria-valuemin={MIN_WIDTH}
      aria-valuemax={MAX_WIDTH}
      tabIndex={0}
      onPointerDown={(e) => {
        // Only the primary button; a right-click here should do nothing.
        if (e.button !== 0) return
        e.currentTarget.setPointerCapture(e.pointerId)
        startX.current = e.clientX
        startWidth.current = width
        setDragging(true)
      }}
      onPointerMove={(e) => {
        if (!dragging) return
        setWidth(startWidth.current + (e.clientX - startX.current))
      }}
      onPointerUp={(e) => {
        if (!dragging) return
        e.currentTarget.releasePointerCapture(e.pointerId)
        setDragging(false)
        commit(startWidth.current + (e.clientX - startX.current))
      }}
      // Cancel — a browser gesture takeover, or the window losing the pointer —
      // keeps the width reached rather than snapping back.
      onPointerCancel={() => {
        if (!dragging) return
        setDragging(false)
        commit(width)
      }}
      // The app is driven from the keyboard, so the divider is focusable and
      // the arrows move it. Home resets to the default.
      onKeyDown={(e) => {
        if (e.key === 'ArrowLeft') {
          e.preventDefault()
          commit(width - KEY_STEP)
        } else if (e.key === 'ArrowRight') {
          e.preventDefault()
          commit(width + KEY_STEP)
        } else if (e.key === 'Home') {
          e.preventDefault()
          commit(DEFAULT_WIDTH)
        }
      }}
      onDoubleClick={() => commit(DEFAULT_WIDTH)}
      title="Drag to resize · double-click to reset"
      // Sits on the sidebar's own right edge, outside the layout, so nothing
      // inside the sidebar shifts. Four pixels wide to be grabbable, but only
      // coloured on hover or focus — the sidebar's border is the visible line.
      className={`absolute inset-y-0 right-0 z-10 w-1 cursor-col-resize hover:bg-[var(--color-accent)] focus-visible:bg-[var(--color-accent)] focus-visible:outline-none ${
        dragging ? 'bg-[var(--color-accent)]' : ''
      }`}
    />
  )
}
