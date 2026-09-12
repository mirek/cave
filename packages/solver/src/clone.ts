import { types } from 'node:util'

/** Inspect descriptors without evaluating accessors or touching proxy traps. */
const portable = (input: unknown): boolean => {
  const pending: unknown[] = [input]
  const seen = new WeakSet<object>()
  while (pending.length > 0) {
    const value = pending.pop()
    if (typeof value === 'function' || typeof value === 'symbol') return false
    if (value === null || typeof value !== 'object' || seen.has(value)) continue
    if (types.isProxy(value)) return false
    seen.add(value)
    const prototype = Object.getPrototypeOf(value)
    if (!Array.isArray(value) && prototype !== Object.prototype && prototype !== null) return false
    for (const key of Object.keys(value)) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key)!
      if (!Object.hasOwn(descriptor, 'value')) return false
      pending.push(descriptor.value)
    }
  }
  return true
}

/** Copy portable records/arrays without native structured-clone recursion. */
export const clone = <T>(input: T): T => {
  if (!portable(input)) return structuredClone(input)
  const copies = new WeakMap<object, object>()
  const pending: { source: object, target: object }[] = []
  const allocate = (value: unknown): unknown => {
    if (value === null || typeof value !== 'object') return value
    const previous = copies.get(value)
    if (previous !== undefined) return previous
    const target: object = Array.isArray(value) ? new Array(value.length) : {}
    copies.set(value, target)
    pending.push({ source: value, target })
    return target
  }
  const result = allocate(input)
  while (pending.length > 0) {
    const { source, target } = pending.pop()!
    for (const key of Object.keys(source)) {
      const copied = allocate((source as Record<string, unknown>)[key])
      Object.defineProperty(target, key, { value: copied, enumerable: true, writable: true, configurable: true })
    }
  }
  return result as T
}
