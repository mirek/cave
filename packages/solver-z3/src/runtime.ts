import { performance } from 'node:perf_hooks'
import { Adapter, Exact, Model } from '@cavelang/solver'
import type {
  AnyExpr,
  Arith,
  Bool,
  Context,
  Model as Z3Model,
  Optimize,
  Solver
} from 'z3-solver'

type Z3 = Awaited<ReturnType<typeof import('z3-solver')['init']>>
type Name = 'cave'
type Expression = AnyExpr<Name>

type Compiled = {
  readonly variables: ReadonlyMap<string, Expression>
  readonly enums: ReadonlyMap<string, readonly string[]>
  readonly bounds: readonly Bool<Name>[]
  readonly constraints: ReadonlyMap<string, Bool<Name>>
  readonly softConstraints: readonly {
    readonly expression: Bool<Name>
    readonly weight: string
  }[]
  readonly objectives: readonly {
    readonly id: string
    readonly direction: 'minimize' | 'maximize'
    readonly expression: Arith<Name>
  }[]
}

export type Runtime = Adapter.t & {
  /** Time spent loading and initializing the Z3 Wasm module. */
  readonly initializationMs: number
  /** Wait for queued checks and terminate Z3's Emscripten workers. Idempotent. */
  readonly close: () => Promise<void>
}

const backendError = (
  backend: Adapter.Backend,
  started: number,
  error: unknown
): Adapter.Result => ({
  status: 'unknown',
  reason: {
    kind: 'backend-error',
    message: error instanceof Error ? error.message : String(error)
  },
  backend,
  diagnostics: [],
  elapsedMs: Math.round(performance.now() - started)
})

const exact = (value: Model.Rational): { readonly numerator: bigint, readonly denominator: bigint } => {
  const normalized = Exact.rational(value)
  return {
    numerator: BigInt(normalized.numerator),
    denominator: BigInt(normalized.denominator)
  }
}

const rationalText = (value: Model.Rational): string => {
  const normalized = Exact.rational(value)
  return `${normalized.numerator}/${normalized.denominator}`
}

const asBool = (value: Expression): Bool<Name> => value as Bool<Name>
const asArith = (value: Expression): Arith<Name> => value as Arith<Name>

const compiler = (
  context: Context<Name>,
  model: Model.t
): Compiled => {
  const compareText = (left: string, right: string): number => left < right ? -1 : left > right ? 1 : 0
  const enums = new Map((model.enums ?? []).map(domain => [
    domain.id,
    [...domain.values].sort(compareText)
  ] as const))
  const variables = new Map<string, Expression>()
  const bounds: Bool<Name>[] = []

  for (const variable of model.variables) {
    switch (variable.sort) {
      case 'bool':
        variables.set(variable.id, context.Bool.const(variable.id))
        break
      case 'int': {
        const expression = context.Int.const(variable.id)
        variables.set(variable.id, expression)
        bounds.push(expression.ge(Exact.integer(variable.min)), expression.le(Exact.integer(variable.max)))
        break
      }
      case 'real': {
        const expression = context.Real.const(variable.id)
        variables.set(variable.id, expression)
        if (variable.min !== undefined) bounds.push(expression.ge(exact(variable.min)))
        if (variable.max !== undefined) bounds.push(expression.le(exact(variable.max)))
        break
      }
      case 'enum': {
        // A finite enum is encoded as a bounded integer. The mapping is stable
        // across semantically irrelevant declaration reordering.
        const values = enums.get(variable.domain)!
        const expression = context.Int.const(variable.id)
        variables.set(variable.id, expression)
        bounds.push(expression.ge(0), expression.lt(values.length))
        break
      }
    }
  }

  const compile = (expression: Model.Expression): Expression => {
    switch (expression.kind) {
      case 'literal':
        switch (expression.sort) {
          case 'bool': return context.Bool.val(expression.value)
          case 'int': return context.Int.val(Exact.integer(expression.value))
          case 'real': return context.Real.val(exact(expression.value))
          case 'enum': return context.Int.val(enums.get(expression.domain)!.indexOf(expression.value))
        }
      case 'variable': return variables.get(expression.id)!
      case 'not': return asBool(compile(expression.value)).not()
      case 'and': return context.And(...expression.operands.map(value => asBool(compile(value))))
      case 'or': return context.Or(...expression.operands.map(value => asBool(compile(value))))
      case 'implies': return context.Implies(asBool(compile(expression.left)), asBool(compile(expression.right)))
      case 'eq': return compile(expression.left).eq(compile(expression.right))
      case 'neq': return compile(expression.left).neq(compile(expression.right))
      case 'lt': return asArith(compile(expression.left)).lt(asArith(compile(expression.right)))
      case 'lte': return asArith(compile(expression.left)).le(asArith(compile(expression.right)))
      case 'gt': return asArith(compile(expression.left)).gt(asArith(compile(expression.right)))
      case 'gte': return asArith(compile(expression.left)).ge(asArith(compile(expression.right)))
      case 'add': {
        const [first, ...rest] = expression.operands.map(value => asArith(compile(value)))
        return rest.reduce((left, right) => left.add(right), first!)
      }
      case 'multiply': {
        const [first, ...rest] = expression.operands.map(value => asArith(compile(value)))
        return rest.reduce((left, right) => left.mul(right), first!)
      }
      case 'subtract': return asArith(compile(expression.left)).sub(asArith(compile(expression.right)))
      case 'divide': {
        const left = asArith(compile(expression.left))
        const right = asArith(compile(expression.right))
        // Portable division is exact-real division even when both operands are
        // integers; Z3's native Int / Int operation would truncate instead.
        const real = (value: Arith<Name>): Arith<Name> => context.isInt(value) ? context.ToReal(value) : value
        return real(left).div(real(right))
      }
      case 'negate': return asArith(compile(expression.value)).neg()
      case 'if': return context.If(
        asBool(compile(expression.condition)),
        compile(expression.then),
        compile(expression.else)
      ) as Expression
    }
  }

  return {
    variables,
    enums,
    bounds,
    constraints: new Map(model.constraints.map(constraint => [constraint.id, asBool(compile(constraint.expression))])),
    softConstraints: (model.softConstraints ?? []).map(constraint => ({
      expression: asBool(compile(constraint.expression)),
      weight: rationalText(constraint.weight)
    })),
    objectives: (model.objectives ?? []).map(objective => ({
      id: objective.id,
      direction: objective.direction,
      expression: asArith(compile(objective.expression))
    }))
  }
}

const assignment = (
  context: Context<Name>,
  compiled: Compiled,
  model: Model.t,
  z3Model: Z3Model<Name>
): Model.Assignment => Object.fromEntries(
  [...model.variables]
    .sort((left, right) => left.id < right.id ? -1 : left.id > right.id ? 1 : 0)
    .map(variable => {
      const value = z3Model.eval(compiled.variables.get(variable.id)!, true)
      switch (variable.sort) {
        case 'bool':
          if (context.isTrue(value)) return [variable.id, { sort: 'bool', value: true }]
          if (context.isFalse(value)) return [variable.id, { sort: 'bool', value: false }]
          throw new TypeError(`Z3 returned a non-Boolean value for ${JSON.stringify(variable.id)}`)
        case 'int':
          if (!context.isIntVal(value)) throw new TypeError(`Z3 returned a non-integer value for ${JSON.stringify(variable.id)}`)
          return [variable.id, { sort: 'int', value: value.value().toString() }]
        case 'real':
          if (!context.isRealVal(value)) throw new TypeError(`Z3 returned a non-rational value for ${JSON.stringify(variable.id)}`)
          return [variable.id, {
            sort: 'real',
            numerator: value.value().numerator.toString(),
            denominator: value.value().denominator.toString()
          }]
        case 'enum': {
          if (!context.isIntVal(value)) throw new TypeError(`Z3 returned a non-enum value for ${JSON.stringify(variable.id)}`)
          const index = Number(value.value())
          const member = compiled.enums.get(variable.domain)?.[index]
          if (member === undefined) throw new TypeError(`Z3 returned an out-of-domain enum value for ${JSON.stringify(variable.id)}`)
          return [variable.id, { sort: 'enum', domain: variable.domain, value: member }]
        }
      }
    })
) as Model.Assignment

const numericValue = (context: Context<Name>, value: Arith<Name>): Model.Value => {
  if (context.isIntVal(value)) return { sort: 'int', value: value.value().toString() }
  if (context.isRealVal(value)) return {
    sort: 'real',
    numerator: value.value().numerator.toString(),
    denominator: value.value().denominator.toString()
  }
  throw new TypeError(`Z3 returned a non-rational objective value: ${value.sexpr()}`)
}

const withDeadline = async (
  context: Context<Name>,
  timeoutMs: number,
  check: () => Promise<'sat' | 'unsat' | 'unknown'>
): Promise<{ readonly status: 'sat' | 'unsat' | 'unknown', readonly interrupted: boolean }> => {
  let interrupted = false
  const timer = setTimeout(() => {
    interrupted = true
    context.interrupt()
  }, timeoutMs)
  timer.unref()
  try {
    return { status: await check(), interrupted }
  } finally {
    clearTimeout(timer)
  }
}

const unknown = (
  backend: Adapter.Backend,
  started: number,
  reason: string,
  interrupted: boolean
): Adapter.Result => {
  const timeout = interrupted || /timeout|canceled|cancelled/i.test(reason)
  const memory = /memory|memout/i.test(reason)
  return {
    status: 'unknown',
    reason: timeout
      ? { kind: 'timeout', message: reason || 'Z3 deadline reached', limit: 'timeoutMs' }
      : memory
        ? { kind: 'resource-limit', message: reason, limit: 'maxMemoryBytes' }
        : { kind: 'indeterminate', message: reason || 'Z3 returned unknown' },
    backend,
    diagnostics: [],
    elapsedMs: Math.round(performance.now() - started)
  }
}

const addHard = (
  solver: Solver<Name> | Optimize<Name>,
  compiled: Compiled,
  track: boolean
): ReadonlyMap<number, string> => {
  solver.add(...compiled.bounds)
  const trackers = new Map<number, string>()
  for (const [id, expression] of compiled.constraints) {
    if (track) {
      const symbol = `cave.constraint.${id}`
      const tracker = solver.ctx.Bool.const(symbol)
      solver.addAndTrack(expression, tracker)
      trackers.set(tracker.id(), id)
    } else {
      solver.add(expression)
    }
  }
  return trackers
}

const coreFor = async (
  context: Context<Name>,
  compiled: Compiled,
  limits: Adapter.Limits
): Promise<readonly string[] | undefined> => {
  const solver = new context.Solver()
  try {
    solver.set('timeout', limits.timeoutMs)
    const trackers = addHard(solver, compiled, true)
    if ((await withDeadline(context, limits.timeoutMs, () => solver.check())).status !== 'unsat') return undefined
    return [...solver.unsatCore()]
      .map(value => trackers.get(value.id()))
      .filter((value): value is string => value !== undefined)
      .sort()
  } finally {
    solver.release()
  }
}

const limitOutput = (
  result: Adapter.Result,
  limits: Adapter.Limits
): Adapter.Result => Buffer.byteLength(JSON.stringify(result)) <= limits.maxOutputBytes
  ? result
  : {
      status: 'unknown',
      reason: {
        kind: 'resource-limit',
        message: 'solver result exceeds maxOutputBytes',
        limit: 'maxOutputBytes'
      },
      backend: result.backend,
      diagnostics: result.diagnostics,
      elapsedMs: result.elapsedMs
    }

const solveModel = async (
  api: Z3,
  context: Context<Name>,
  backend: Adapter.Backend,
  model: Model.t,
  request: Adapter.Request
): Promise<Adapter.Result> => {
  const started = performance.now()
  try {
    api.setParam('memory_max_size', Math.max(1, Math.floor(request.limits.maxMemoryBytes / 1024 / 1024)))
    const compiled = compiler(context, model)
    const optimize = compiled.objectives.length > 0 || compiled.softConstraints.length > 0

    if (!optimize) {
      const solver = new context.Solver()
      try {
        solver.set('timeout', request.limits.timeoutMs)
        const trackers = addHard(solver, compiled, request.unsatCore)
        const checked = await withDeadline(context, request.limits.timeoutMs, () => solver.check())
        if (checked.status === 'unknown') {
          return unknown(backend, started, solver.reasonUnknown(), checked.interrupted)
        }
        if (checked.status === 'unsat') {
          const core = request.unsatCore
            ? [...solver.unsatCore()]
                .map(value => trackers.get(value.id()))
                .filter((value): value is string => value !== undefined)
                .sort()
            : undefined
          return limitOutput({
            status: 'unsatisfied',
            ...(core === undefined ? {} : { core }),
            infeasibilityProved: true,
            backend,
            diagnostics: [],
            elapsedMs: Math.round(performance.now() - started)
          }, request.limits)
        }
        return limitOutput({
          status: 'satisfied',
          assignment: assignment(context, compiled, model, solver.model()),
          backend,
          diagnostics: [],
          elapsedMs: Math.round(performance.now() - started)
        }, request.limits)
      } finally {
        solver.release()
      }
    }

    const optimizer = new context.Optimize()
    try {
      optimizer.set('timeout', request.limits.timeoutMs)
      optimizer.set('priority', 'lex')
      addHard(optimizer, compiled, false)
      for (const objective of compiled.objectives) {
        if (objective.direction === 'minimize') optimizer.minimize(objective.expression)
        else optimizer.maximize(objective.expression)
      }
      // Soft preferences are deliberately the lowest-priority objective. Their
      // weights are explicit model data and never derived from CAVE confidence.
      for (const constraint of compiled.softConstraints) {
        optimizer.addSoft(constraint.expression, constraint.weight)
      }
      const checked = await withDeadline(context, request.limits.timeoutMs, () => optimizer.check())
      if (checked.status === 'unknown') {
        const reason = api.Z3.optimize_get_reason_unknown(context.ptr, optimizer.ptr)
        return unknown(backend, started, reason, checked.interrupted)
      }
      if (checked.status === 'unsat') {
        return limitOutput({
          status: 'unsatisfied',
          ...(request.unsatCore ? { core: await coreFor(context, compiled, request.limits) } : {}),
          infeasibilityProved: true,
          backend,
          diagnostics: [],
          elapsedMs: Math.round(performance.now() - started)
        }, request.limits)
      }
      const z3Model = optimizer.model()
      return limitOutput({
        status: 'optimal',
        assignment: assignment(context, compiled, model, z3Model),
        objectives: compiled.objectives.map(objective => ({
          objectiveId: objective.id,
          value: numericValue(context, z3Model.eval(objective.expression, true))
        })),
        optimalityProved: true,
        backend,
        diagnostics: [],
        elapsedMs: Math.round(performance.now() - started)
      }, request.limits)
    } finally {
      optimizer.release()
    }
  } catch (error) {
    if (api.Z3.get_estimated_alloc_size() > BigInt(request.limits.maxMemoryBytes)) {
      return {
        status: 'unknown',
        reason: {
          kind: 'resource-limit',
          message: 'Z3 exceeded maxMemoryBytes',
          limit: 'maxMemoryBytes'
        },
        backend,
        diagnostics: [],
        elapsedMs: Math.round(performance.now() - started)
      }
    }
    return backendError(backend, started, error)
  }
}

let singleton: Promise<Runtime> | undefined

const initialize = async (): Promise<Runtime> => {
  const started = performance.now()
  // Keep this as the only runtime import: importing @cavelang/solver-z3 itself
  // must not load the 34 MB Wasm artifact or start worker threads.
  const api = await import('z3-solver').then(module => module.init())
  const context = api.Context('cave')
  const backend = Object.freeze({ name: 'z3-wasm', version: api.Z3.get_full_version() })
  let tail: Promise<void> = Promise.resolve()
  let closing = false
  let closed = false

  const enqueue = <T>(work: () => Promise<T>): Promise<T> => {
    const result = tail.then(work, work)
    tail = result.then(() => undefined, () => undefined)
    return result
  }

  const runtime: Runtime = {
    backend,
    capabilities: new Set(Adapter.capabilities),
    initializationMs: Math.round(performance.now() - started),
    solve: (model, request) => {
      if (closing) return Promise.resolve(backendError(backend, performance.now(), new Error('Z3 runtime is closed')))
      return enqueue(() => solveModel(api, context, backend, model, request))
    },
    close: async () => {
      if (closed) return
      closing = true
      await enqueue(async () => {
        if (closed) return
        // Let the completed pthread post its cleanup message before forcibly
        // terminating the pool. Without this turn, Emscripten can report a
        // late `cleanupThread` command from a worker we just terminated.
        await new Promise<void>(resolve => setTimeout(resolve, 0))
        api.em?.PThread?.terminateAllThreads?.()
        closed = true
        singleton = undefined
      })
    }
  }
  return runtime
}

/** Lazily initialize and reuse one process-wide Z3 runtime. */
export const create = (): Promise<Runtime> => singleton ??= initialize().catch(error => {
  singleton = undefined
  throw error
})
