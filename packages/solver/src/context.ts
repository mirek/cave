import type { Context } from './explain.ts'
import { clone } from './clone.ts'

const validateJson = (root: unknown, path: string): void => {
  const active = new WeakSet<object>()
  const completed = new WeakSet<object>()
  const stack: { value: unknown, path: string, leave?: boolean }[] = [{ value: root, path }]
  while (stack.length > 0) {
    const frame = stack.pop()!
    const value = frame.value
    if (value === null || typeof value === 'string' || typeof value === 'boolean') continue
    if (typeof value === 'number' && Number.isFinite(value)) continue
    if (typeof value !== 'object' || value === null) throw new TypeError(`${frame.path} must be a finite JSON value`)
    if (frame.leave) { active.delete(value); completed.add(value); continue }
    if (active.has(value)) throw new TypeError(`${frame.path} contains a JSON cycle`)
    if (completed.has(value)) continue
    if (!Array.isArray(value) && Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) throw new TypeError(`${frame.path} must be a plain JSON object or array`)
    if (typeof (value as { toJSON?: unknown }).toJSON === 'function') throw new TypeError(`${frame.path} must not use a custom JSON serializer`)
    active.add(value)
    stack.push({ ...frame, leave: true })
    if (Array.isArray(value)) {
      for (let index = value.length - 1; index >= 0; index--) {
        if (!Object.hasOwn(value, index)) throw new TypeError(`${frame.path}[${index}] must not be a sparse JSON array entry`)
        stack.push({ value: value[index], path: `${frame.path}[${index}]` })
      }
    } else {
      for (const [key, child] of Object.entries(value)) {
        if (child !== undefined) stack.push({ value: child, path: `${frame.path}.${key}` })
      }
    }
  }
}

/** Serialize validated input values without depending on the engine's stack limit. */
export const stringifyInput = (value: unknown): string => {
  validateJson(value, 'explanation input value')
  value = clone(value)
  validateJson(value, 'explanation input value')
  const output: string[] = []
  const stack: ({ value: unknown } | { text: string })[] = [{ value }]
  while (stack.length > 0) {
    const frame = stack.pop()!
    if ('text' in frame) { output.push(frame.text); continue }
    const current = frame.value
    if (current === null || typeof current !== 'object') {
      output.push(JSON.stringify(current))
      continue
    }
    if (Array.isArray(current)) {
      output.push('[')
      stack.push({ text: ']' })
      for (let index = current.length - 1; index >= 0; index--) {
        stack.push({ value: current[index] })
        if (index > 0) stack.push({ text: ',' })
      }
    } else {
      const entries = Object.entries(current).filter(([, child]) => child !== undefined)
      output.push('{')
      stack.push({ text: '}' })
      for (let index = entries.length - 1; index >= 0; index--) {
        const [key, child] = entries[index]!
        stack.push({ value: child }, { text: `${JSON.stringify(key)}:` })
        if (index > 0) stack.push({ text: ',' })
      }
    }
  }
  return output.join('')
}

/** Validate explanation metadata and bindings without resolving external IDs. */
export const validateContext = (context: Context): void => {
  if (context === null || typeof context !== 'object' || Array.isArray(context)) throw new TypeError('explanation context must be an object')
  const nonempty = (value: unknown, path: string): void => {
    if (typeof value !== 'string' || value.length === 0) throw new TypeError(`${path} must be a nonempty string`)
  }
  if (context.modelDigest !== undefined) nonempty(context.modelDigest, 'explanation modelDigest')
  if (context.scenario !== undefined) {
    const scenario = context.scenario
    if (scenario === null || typeof scenario !== 'object' || Array.isArray(scenario)) throw new TypeError('explanation scenario must be an object')
    for (const key of ['id', 'inputDigest', 'overlayDigest'] as const) nonempty(scenario[key], `explanation scenario.${key}`)
  }
  if (context.snapshot !== undefined) {
    const snapshot = context.snapshot
    if (snapshot === null || typeof snapshot !== 'object' || Array.isArray(snapshot)) throw new TypeError('explanation snapshot must be an object')
    if (snapshot.transactionTime !== null) nonempty(snapshot.transactionTime, 'explanation snapshot.transactionTime')
    if (snapshot.validTime !== undefined) nonempty(snapshot.validTime, 'explanation snapshot.validTime')
    if (snapshot.aliases !== undefined && snapshot.aliases !== 'exact' && snapshot.aliases !== 'closure') throw new TypeError('explanation snapshot.aliases must be exact or closure')
    if (snapshot.resolution !== undefined && snapshot.resolution !== 'coexisting' && snapshot.resolution !== 'winner') throw new TypeError('explanation snapshot.resolution must be coexisting or winner')
    const confidence = snapshot.minimumConfidence
    if (confidence !== undefined && (typeof confidence !== 'number' || !Number.isFinite(confidence) || confidence < 0 || confidence > 1)) throw new TypeError('explanation snapshot.minimumConfidence must be a finite number from 0 to 1')
  }
  if (context.inputs === undefined) return
  if (!Array.isArray(context.inputs)) throw new TypeError('explanation inputs must be an array')
  const ids = new Set<string>()
  for (let index = 0; index < context.inputs.length; index++) {
    const input = context.inputs[index]
    const path = `explanation inputs[${index}]`
    if (!Object.hasOwn(context.inputs, index) || input === null || typeof input !== 'object' || Array.isArray(input)) throw new TypeError(`${path} must be an input object`)
    if (typeof input.id !== 'string' || input.id.length === 0) throw new TypeError(`${path}.id must be a nonempty string`)
    if (ids.has(input.id)) throw new TypeError(`${path}.id duplicates ${JSON.stringify(input.id)}`)
    ids.add(input.id)
    for (const key of ['value', 'authoredValue'] as const) {
      if (input[key] !== undefined) validateJson(input[key], `${path}.${key}`)
    }
    if (input.query !== undefined && typeof input.query !== 'string') throw new TypeError(`${path}.query must be a string`)
    for (const key of ['evidenceRowIds', 'scenarioClaimIds'] as const) {
      const values = input[key]
      if (!Array.isArray(values)) throw new TypeError(`${path}.${key} must be an array`)
      for (let item = 0; item < values.length; item++) {
        if (!Object.hasOwn(values, item) || typeof values[item] !== 'string' || values[item].length === 0) throw new TypeError(`${path}.${key}[${item}] must be a nonempty string`)
      }
    }
  }
}
