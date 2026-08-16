# src/ui — the component adapter layer

**This directory is the only place in the app allowed to import a component
library.** Everything else imports from `@/ui` (or `../ui`) and sees our own
API, never the vendor's.

The point is that swapping libraries — or dropping back to hand-rolled — means
rewriting the files in this folder and touching nothing else. If a Radix type,
prop name or `asChild` idiom leaks into a component outside this directory,
that guarantee is gone.

## What is here

| File | Wraps | Why not hand-rolled |
| --- | --- | --- |
| `Dialog.tsx` | `@radix-ui/react-dialog` | Focus trap, focus restore on close, scroll lock, `aria-modal` wiring, Escape and outside-click handling |
| `Menu.tsx` | `@radix-ui/react-context-menu` | Arrow-key navigation, typeahead, collision-aware positioning, focus return to the trigger |

## What is deliberately NOT here

- **The command palette.** Its ranking (`src/fuzzy.ts`) is the core of the app
  and is tuned against a real failure case. `cmdk` would replace it with its own
  matcher.
- **The data grid.** Virtualised and performance-critical.
- **`<select>` and `<input type="checkbox">`.** Native elements are already
  keyboard-accessible and correct. Replacing them buys styling control we do
  not currently need, at the cost of a lot of JavaScript.

## Adding to this layer

Expose the smallest API the app actually needs, not the library's full surface.
`Dialog` takes `title`, `footer` and children — not a dozen Radix subcomponents —
because a narrow API is what makes the next swap cheap.
