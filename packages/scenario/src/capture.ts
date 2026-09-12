import type { Definition } from './model.ts'

/** Capture own data once while leaving invalid scalar values for field diagnostics. */
export const captureDefinition = (supplied: Definition): Definition => {
  const copies = new Map<object, object>()
  type Frame = { target: object, entries: [string, unknown][], index: number }
  const pending: Frame[] = []
  const copy = (value: unknown): unknown => {
    if (value === null || typeof value !== 'object') return value
    const existing = copies.get(value)
    if (existing !== undefined) return existing
    const captured = Array.isArray(value) ? new Array(value.length) : Object.create(null) as object
    copies.set(value, captured)
    // Capture sibling getters before descending, matching Object.entries in
    // the recursive implementation. The explicit stack preserves depth-first
    // traversal without spending one JavaScript call frame per nested value.
    pending.push({ target: captured, entries: Object.entries(value), index: 0 })
    return captured
  }
  const captured = copy(supplied)
  while (pending.length > 0) {
    const frame = pending[pending.length - 1]!
    if (frame.index === frame.entries.length) {
      pending.pop()
      continue
    }
    const [key, child] = frame.entries[frame.index++]!
    Object.defineProperty(frame.target, key, {
      value: copy(child), enumerable: true, writable: true, configurable: true
    })
  }
  return captured as Definition
}
