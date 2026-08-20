import { refLabel, useStore } from '../store'
import { ContextMenu, Dialog, dialogButton, type MenuItem } from '../ui'
import { qualifiedName } from '../commands'
import type { ObjectRef, ObjectType, SchemaObject } from '../types'

/**
 * Wraps a sidebar table or view row in its right-click menu.
 *
 * Every item here is a store action that the command palette also exposes —
 * this menu is a second route to them, not a second implementation. Whether a
 * destructive item confirms first, and what gets refreshed afterwards, lives in
 * the action; see the `truncateTable` / `dropObject` block in store.ts.
 *
 * Functions and procedures have nothing here that applies, so the sidebar only
 * wraps tables and views.
 */
export function ObjectMenu({
  object,
  children,
}: {
  object: SchemaObject
  children: React.ReactNode
}) {
  const activeDatabase = useStore((s) => s.activeDatabase)
  const truncateIsDelete = useStore((s) => s.capabilities?.truncateIsDelete ?? false)
  const openObject = useStore((s) => s.openObject)
  const openDetails = useStore((s) => s.openDetails)
  const truncateTable = useStore((s) => s.truncateTable)
  const dropObject = useStore((s) => s.dropObject)
  const newTable = useStore((s) => s.newTable)

  const ref = { database: activeDatabase, schema: object.schema, name: object.name }

  const items: MenuItem[] = [
    { label: 'Open rows', onSelect: () => void openObject(object) },
    { label: 'Show details', onSelect: () => void openDetails(ref) },
    {
      label: 'New table…',
      separatorBefore: true,
      // Defaulted to this object's schema, which is nearly always where a table
      // being added alongside it belongs.
      onSelect: () => newTable(object.schema),
    },
  ]

  if (object.type === 'table') {
    items.push({
      label: truncateIsDelete ? 'Empty table (DELETE)' : 'Empty table (TRUNCATE)',
      separatorBefore: true,
      danger: true,
      onSelect: () => void truncateTable(ref),
    })
  }
  items.push({
    label: object.type === 'view' ? 'Drop view…' : 'Drop table…',
    separatorBefore: object.type !== 'table',
    danger: true,
    onSelect: () => void dropObject(ref, object.type),
  })

  return (
    <ContextMenu items={items} heading={qualifiedName(object)}>
      {children}
    </ContextMenu>
  )
}

/**
 * Confirmation for emptying a table.
 *
 * The wording names the statement rather than describing it, because the two are
 * not interchangeable: TRUNCATE does not fire row triggers and on most engines
 * cannot be rolled back, while the DELETE that SQLite gets instead does both.
 */
export function ConfirmTruncateDialog({ target }: { target: ObjectRef }) {
  const setDialog = useStore((s) => s.setDialog)
  const runTruncate = useStore((s) => s.runTruncate)
  const isDelete = useStore((s) => s.capabilities?.truncateIsDelete ?? false)
  const close = () => setDialog({ kind: 'none' })

  return (
    <Dialog
      open
      onClose={close}
      title={`Empty ${refLabel(target)}?`}
      widthClass="w-[min(28rem,92vw)]"
      footer={
        <>
          <button onClick={close} className={`ml-auto ${dialogButton.ghost}`}>
            Cancel
          </button>
          <button onClick={() => void runTruncate(target)} className={dialogButton.dangerFilled}>
            Empty it
          </button>
        </>
      }
    >
      <p className="px-4 py-4 leading-relaxed text-[var(--color-muted)]">
        {isDelete ? (
          <>
            Every row is deleted. SQLite has no <code>TRUNCATE</code>, so this runs{' '}
            <code>DELETE FROM</code> — triggers fire, and it is undone by rolling back the
            transaction it runs in. This one is not in a transaction.
          </>
        ) : (
          <>
            Every row is deleted by <code>TRUNCATE TABLE</code>. The table and its columns stay.
            There is no undo.
          </>
        )}
      </p>
    </Dialog>
  )
}

/** Confirmation for dropping a table or view. */
export function ConfirmDropDialog({ target, type }: { target: ObjectRef; type: ObjectType }) {
  const setDialog = useStore((s) => s.setDialog)
  const runDrop = useStore((s) => s.runDrop)
  const close = () => setDialog({ kind: 'none' })

  return (
    <Dialog
      open
      onClose={close}
      title={`Drop ${type} ${refLabel(target)}?`}
      widthClass="w-[min(28rem,92vw)]"
      footer={
        <>
          <button onClick={close} className={`ml-auto ${dialogButton.ghost}`}>
            Cancel
          </button>
          <button onClick={() => void runDrop(target, type)} className={dialogButton.dangerFilled}>
            Drop it
          </button>
        </>
      }
    >
      <p className="px-4 py-4 leading-relaxed text-[var(--color-muted)]">
        {type === 'view'
          ? 'The view definition is removed. The tables it reads from are not touched.'
          : 'The table, its rows, its indexes and its triggers are all removed. There is no undo.'}
      </p>
    </Dialog>
  )
}
