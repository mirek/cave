import type { Options, Result, SolverAdapter } from './adapter.ts'
import * as Capability from './capability.ts'
import * as Explain from './explain.ts'
import type { Model } from './model.ts'
import * as Validate from './validate.ts'

const prepared = (adapter: SolverAdapter, model: Model, options: Options): {
  readonly limits: ReturnType<typeof Validate.mergeLimits>
  readonly run: () => Promise<Result>
} => {
  const limits = Validate.mergeLimits(options.limits)
  Validate.model(model, limits)
  const unsatCore = options.unsatCore ?? false
  const missing = Capability.missing(adapter, model, unsatCore)
  if (missing.length > 0) throw new Capability.UnsupportedModelError(adapter.backend.name, missing)
  return { limits, run: () => adapter.solve(model, { limits, unsatCore }) }
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
  return Explain.report(model, await solve.run(), solve.limits, context)
}
