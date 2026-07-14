import type { Options, Result, SolverAdapter } from './adapter.ts'
import * as Capability from './capability.ts'
import type { Model } from './model.ts'
import * as Validate from './validate.ts'

/** Validates and negotiates a model before crossing the adapter boundary. */
export const run = async (adapter: SolverAdapter, model: Model, options: Options = {}): Promise<Result> => {
  const limits = Validate.mergeLimits(options.limits)
  Validate.model(model, limits)
  const missing = Capability.missing(adapter, model, options.unsatCore ?? false)
  if (missing.length > 0) throw new Capability.UnsupportedModelError(adapter.backend.name, missing)
  return adapter.solve(model, { limits, unsatCore: options.unsatCore ?? false })
}
