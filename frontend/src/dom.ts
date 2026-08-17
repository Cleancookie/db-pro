/**
 * Whether a key event came from somewhere the user is typing.
 *
 * Window-level hotkeys need this: a cell stays selected while a filter is being
 * typed, so without it Enter would both apply the filter *and* open the cell
 * viewer, and Ctrl+C would copy the grid instead of the selection in the box.
 *
 * `contentEditable` is the case that matters and the one that was missed. The
 * filter box used to be an `<input>`, so an `instanceof HTMLInputElement` check
 * covered it; it is now a CodeMirror editor, whose editable surface is a
 * contenteditable div. Any check that enumerates element *types* will keep
 * going stale as surfaces change, so this asks the question the callers
 * actually mean: is focus somewhere that consumes typing?
 */
export function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  if (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement
  ) {
    return true
  }
  // isContentEditable is true on descendants of a contenteditable host too, so
  // this covers a nested span inside the editor as well as its content element.
  return target.isContentEditable
}
