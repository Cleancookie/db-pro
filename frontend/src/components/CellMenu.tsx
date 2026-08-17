import { rectOf, rectSize } from '../selection'
import { useStore, type ResultSource } from '../store'
import type { MenuItem } from '../ui'

/**
 * The right-click actions for a grid cell.
 *
 * A hook returning a builder rather than a component: the grid wraps its whole
 * row area in one menu — a Radix root per rendered cell would be hundreds of
 * them in a virtualised grid — and asks for the items of whichever cell was
 * clicked. See DataGrid.
 *
 * Every action here is something the app can already do. Nothing on this menu
 * reaches for a call that did not exist before it.
 */
export function useCellMenu(source: ResultSource): (rowIndex: number, colIndex: number) => MenuItem[] {
  const cellTarget = useStore((s) => s.cellTarget)
  const openCell = useStore((s) => s.openCell)
  const copyCell = useStore((s) => s.copyCell)
  const copyText = useStore((s) => s.copyText)
  const copySelection = useStore((s) => s.copySelection)
  const selection = useStore((s) => (s.selection?.source === source ? s.selection : null))

  return (rowIndex, colIndex) => {
    const cell = cellTarget(source, rowIndex, colIndex)
    if (!cell) return []

    // Only offered once the selection is more than the cell that was clicked,
    // where "copy value" already says it better.
    const range = selection ? rectSize(rectOf(selection)) : null
    const rangeItem: MenuItem[] =
      range && range.cells > 1
        ? [
            {
              label:
                range.cols === 1
                  ? `Copy ${range.rows} values as an IN list`
                  : `Copy ${range.cells} cells as CSV`,
              separatorBefore: true,
              onSelect: () => void copySelection(),
            },
          ]
        : []

    // Worth fetching only when the grid is holding a shortened value and there
    // is a table to re-read it from; an ad-hoc SQL result has neither.
    const canFetchFull = cell.truncated && cell.rowOffset !== null

    return [
      {
        label: 'Open in cell viewer',
        onSelect: () => openCell(source, rowIndex, colIndex),
      },
      {
        label: cell.truncated ? 'Copy value (as shown, cut)' : 'Copy value',
        separatorBefore: true,
        onSelect: () => void copyCell(source, rowIndex, colIndex),
      },
      {
        label: 'Copy full value',
        // Left visible but disabled when the shown value already is the whole
        // one: hiding it would make the menu change shape between cells.
        disabled: !canFetchFull,
        onSelect: () => void copyCell(source, rowIndex, colIndex, true),
      },
      ...rangeItem,
      {
        label: 'Copy column name',
        separatorBefore: true,
        onSelect: () => void copyText(cell.column),
      },
    ]
  }
}
