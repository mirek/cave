import { captureResult } from './result.ts'
import { validateContext } from './context.ts'
import { clone } from './clone.ts'
import type { Options, Result, SolverAdapter } from './adapter.ts'
import * as Capability from './capability.ts'
import * as Canonical from './canonical.ts'
import * as Explain from './explain.ts'
import type { Model } from './model.ts'
import * as Validate from './validate.ts'
import { validateOptions } from './options.ts'

const freeze = <T>(value: T): T => {
  const pending: unknown[] = [value]
  const seen = new Set<object>()
  while (pending.length > 0) {
    const next = pending.pop()
    if (next === null || typeof next !== 'object' || seen.has(next)) continue
    seen.add(next)
    for (const child of Object.values(next)) pending.push(child)
    Object.freeze(next)
  }
  return value
}

const prepared = (adapter: SolverAdapter, model: Model, options: Options): {
  readonly limits: ReturnType<typeof Validate.mergeLimits>
  readonly model: Model
  readonly run: () => Promise<Result>
} => {
  options = validateOptions(options)
  const limits = Object.freeze(Validate.mergeLimits(options.limits))
  model = clone(model)
  Validate.model(model, limits)
  model = freeze(model)
  const unsatCore = options.unsatCore ?? false
  const missing = Capability.missing(adapter, model, unsatCore)
  if (missing.length > 0) throw new Capability.UnsupportedModelError(adapter.backend.name, missing)
  return { model, limits, run: async () => captureResult(await adapter.solve(model, { limits, unsatCore })) }
}

/** Validates and negotiates a model before crossing the adapter boundary. */
export const run = async (adapter: SolverAdapter, model: Model, options: Options = {}): Promise<Result> => {
  return prepared(adapter, model, options).run()
}

/** Solve and return a traceable JSON explanation envelope. */
export const runWithExplanation = async (
  adapter: SolverAdapter,
  model: Model,
  options: Options = {},
  context: Explain.Context = {}
): Promise<Explain.Report> => {
  const solve = prepared(adapter, model, options)
  validateContext(context)
  const snapshot = clone(context)
  validateContext(snapshot)
  if (snapshot.modelDigest !== undefined) {
    const digest = Canonical.digest(solve.model, solve.limits)
    if (snapshot.modelDigest !== digest) {
      throw new TypeError(`scenario model digest ${snapshot.modelDigest} does not match ${digest}`)
    }
  }
  return Explain.report(solve.model, await solve.run(), solve.limits, snapshot)
}
