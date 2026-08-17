import { Fragment } from 'react'
import * as RadixContextMenu from '@radix-ui/react-context-menu'

/**
 * A right-click menu.
 *
 * Radix contributes arrow-key navigation, typeahead, collision-aware
 * positioning that flips near a viewport edge, and focus returning to the
 * trigger on close — all of which the hand-rolled version lacked or faked.
 *
 * The trigger wraps its children rather than taking coordinates, which means
 * callers no longer track mouse position or menu state at all.
 */
export interface MenuItem {
  label: string
  onSelect: () => void
  disabled?: boolean
  danger?: boolean
  /** Draws a divider above this item, for grouping unrelated actions. */
  separatorBefore?: boolean
}

export interface ContextMenuProps {
  items: MenuItem[]
  /** Optional heading, for naming what the menu acts on. */
  heading?: string
  children: React.ReactNode
  /** Applied to the trigger wrapper. */
  className?: string
}

export function ContextMenu({ items, heading, children, className }: ContextMenuProps) {
  return (
    <RadixContextMenu.Root>
      <RadixContextMenu.Trigger className={className} asChild>
        {children}
      </RadixContextMenu.Trigger>

      <RadixContextMenu.Portal>
        <RadixContextMenu.Content
          className="chrome z-50 min-w-48 overflow-hidden rounded-md border border-[var(--color-border-strong)] bg-[var(--color-elevated)] py-1 shadow-2xl"
          collisionPadding={8}
        >
          {heading && (
            <RadixContextMenu.Label className="truncate border-b border-[var(--color-border)] px-3 pt-1 pb-1.5 text-[var(--color-faint)]">
              {heading}
            </RadixContextMenu.Label>
          )}
          {items.map((item) => (
            <Fragment key={item.label}>
              {item.separatorBefore && (
                <RadixContextMenu.Separator className="my-1 h-px bg-[var(--color-border)]" />
              )}
              <RadixContextMenu.Item
                disabled={item.disabled}
                onSelect={item.onSelect}
                className={`block cursor-default px-3 py-1.5 outline-none select-none data-[disabled]:opacity-35 data-[highlighted]:bg-[var(--color-accent-dim)]/45 ${
                  item.danger ? 'text-[var(--color-danger)]' : ''
                }`}
              >
                {item.label}
              </RadixContextMenu.Item>
            </Fragment>
          ))}
        </RadixContextMenu.Content>
      </RadixContextMenu.Portal>
    </RadixContextMenu.Root>
  )
}
