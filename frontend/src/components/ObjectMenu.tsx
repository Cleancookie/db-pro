import { useStore } from '../store'
import { ContextMenu, type MenuItem } from '../ui'
import { qualifiedName } from '../commands'
import type { SchemaObject } from '../types'

/**
 * Wraps a sidebar table or view row in its right-click menu.
 *
 * Details is reachable from the action palette too; this is the direct route
 * for when you are already pointing at the object. Functions and procedures
 * have nothing to describe yet, so the sidebar only wraps tables and views.
 */
export function ObjectMenu({
  object,
  children,
}: {
  object: SchemaObject
  children: React.ReactNode
}) {
  const activeDatabase = useStore((s) => s.activeDatabase)
  const openObject = useStore((s) => s.openObject)
  const openDetails = useStore((s) => s.openDetails)

  const items: MenuItem[] = [
    { label: 'Open rows', onSelect: () => void openObject(object) },
    {
      label: 'Show details',
      onSelect: () =>
        void openDetails({
          database: activeDatabase,
          schema: object.schema,
          name: object.name,
        }),
    },
  ]

  return (
    <ContextMenu items={items} heading={qualifiedName(object)}>
      {children}
    </ContextMenu>
  )
}
