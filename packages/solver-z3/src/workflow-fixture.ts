/** Named CLI fixture for the solver workflow API. No raw model input is accepted. */

import { Adapter, Model, Workflow } from '@cavelang/solver'
import { create } from './runtime.ts'

export type Output = { readonly code: number, readonly out: string, readonly err: string }

const usage = `Usage: cave-solver-workflow architecture <operation> [options]

Operations:
  feasibility     Find a deterministic feasible architecture.
  optimization    Minimize the declared architecture cost model.
  counterexample  Test the declared small-team-monolith invariant.
  sensitivity     Vary deployment frequency and report architecture changes.

Options:
  --team-size <2..20>                 Default: 10
  --deployment-frequency <1..12>      Default: 6
  --from <1..12>                      Sensitivity start; default: 1
  --to <1..12>                        Sensitivity end; default: 12
  --timeout-ms <positive integer>     Per solver run; default: 10000

The fixture is the only selectable model. Inputs are bounded and typed before
the optional Z3 adapter runs; arbitrary expressions and SMT-LIB are rejected.
`

const fail = (message: string, code = 2): Output => ({ code, out: '', err: `${message}\n\n${usage}` })
const ok = (value: unknown): Output => ({ code: 0, out: `${JSON.stringify(value, null, 2)}\n`, err: '' })

const integer = (value: number): Model.Expression => ({ kind: 'literal', sort: 'int', value })
const ref = (id: string): Model.Expression => ({ kind: 'variable', id })
const architecture = (value: string): Model.Expression => ({
  kind: 'literal', sort: 'enum', domain: 'architecture', value
})
const equal = (id: string, value: Model.Expression): Model.Expression => ({ kind: 'eq', left: ref(id), right: value })
const add = (...operands: readonly Model.Expression[]): Model.Expression => ({ kind: 'add', operands })
const multiply = (left: Model.Expression, right: Model.Expression): Model.Expression => ({
  kind: 'multiply', operands: [left, right]
})

export type ArchitectureInputs = {
  readonly teamSize?: number
  readonly deploymentFrequency?: number
}

/**
 * Small but non-trivial architecture decision model used by the CLI fixture.
 * The invariant is intentionally stronger than the feasibility constraint so
 * the counterexample workflow has a concrete bounded witness.
 */
export const architectureModel = (inputs: ArchitectureInputs = {}): Model.t => {
  const constraints: Model.HardConstraint[] = [
    {
      id: 'microservices-team-capacity',
      description: 'Microservices need at least six people in this fixture.',
      declaration: { uri: 'packages/solver-z3/src/workflow-fixture.ts' },
      expression: {
        kind: 'implies',
        left: equal('architecture', architecture('microservices')),
        right: { kind: 'gte', left: ref('team-size'), right: integer(6) }
      }
    },
    {
      id: 'small-team-monolith',
      description: 'Teams below eight people should choose a monolith.',
      declaration: { uri: 'packages/solver-z3/src/workflow-fixture.ts' },
      expression: {
        kind: 'implies',
        left: { kind: 'lt', left: ref('team-size'), right: integer(8) },
        right: equal('architecture', architecture('monolith'))
      }
    }
  ]
  if (inputs.teamSize !== undefined) {
    constraints.push({
      id: 'input/team-size',
      expression: equal('team-size', integer(inputs.teamSize)),
      scenarioInputIds: ['team-size']
    })
  }
  if (inputs.deploymentFrequency !== undefined) {
    constraints.push({
      id: 'input/deployment-frequency',
      expression: equal('deployment-frequency', integer(inputs.deploymentFrequency)),
      scenarioInputIds: ['deployment-frequency']
    })
  }
  const monolithCost = add(integer(20), ref('team-size'), multiply(integer(3), ref('deployment-frequency')))
  const microservicesCost = add(
    integer(45),
    multiply(integer(2), ref('team-size')),
    { kind: 'negate', value: multiply(integer(4), ref('deployment-frequency')) }
  )
  return {
    schema: Model.schema,
    enums: [{ id: 'architecture', values: ['monolith', 'microservices'] }],
    variables: [
      { id: 'architecture', sort: 'enum', domain: 'architecture' },
      { id: 'deployment-frequency', sort: 'int', min: 1, max: 12, scenarioInputIds: ['deployment-frequency'] },
      { id: 'team-size', sort: 'int', min: 2, max: 20, scenarioInputIds: ['team-size'] }
    ],
    constraints,
    objectives: [{
      id: 'operational-cost',
      direction: 'minimize',
      description: 'Illustrative relative operating cost, not epistemic confidence.',
      expression: {
        kind: 'if',
        condition: equal('architecture', architecture('monolith')),
        then: monolithCost,
        else: microservicesCost
      }
    }]
  }
}

type Parsed = {
  readonly operation: 'feasibility' | 'optimization' | 'counterexample' | 'sensitivity'
  readonly teamSize: number
  readonly deploymentFrequency: number
  readonly from: number
  readonly to: number
  readonly timeoutMs: number
}

const parseInteger = (name: string, value: string | undefined, min: number, max?: number): number => {
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed) || parsed < min || (max !== undefined && parsed > max)) {
    throw new TypeError(`${name} must be an integer from ${min}${max === undefined ? '' : ` to ${max}`}`)
  }
  return parsed
}

const parse = (argv: readonly string[]): Parsed | Output => {
  if (argv.includes('--help') || argv.includes('-h')) return { code: 0, out: usage, err: '' }
  if (argv[0] !== 'architecture') return fail(`unknown workflow model ${JSON.stringify(argv[0] ?? '')}`)
  const operation = argv[1]
  if (operation !== 'feasibility' && operation !== 'optimization' &&
      operation !== 'counterexample' && operation !== 'sensitivity') {
    return fail(`unknown workflow operation ${JSON.stringify(operation ?? '')}`)
  }
  const values = new Map<string, string>()
  for (let index = 2; index < argv.length; index += 2) {
    const flag = argv[index]
    const value = argv[index + 1]
    if (flag === undefined || !['--team-size', '--deployment-frequency', '--from', '--to', '--timeout-ms'].includes(flag)) {
      return fail(`unknown workflow option ${JSON.stringify(flag ?? '')}`)
    }
    if (value === undefined || value.startsWith('--')) return fail(`${flag} needs a value`)
    if (values.has(flag)) return fail(`${flag} was provided more than once`)
    values.set(flag, value)
  }
  try {
    const from = parseInteger('--from', values.get('--from') ?? '1', 1, 12)
    const to = parseInteger('--to', values.get('--to') ?? '12', 1, 12)
    if (from > to) return fail('--from must be less than or equal to --to')
    return {
      operation,
      teamSize: parseInteger('--team-size', values.get('--team-size') ?? '10', 2, 20),
      deploymentFrequency: parseInteger(
        '--deployment-frequency', values.get('--deployment-frequency') ?? '6', 1, 12
      ),
      from,
      to,
      timeoutMs: parseInteger('--timeout-ms', values.get('--timeout-ms') ?? '10000', 1)
    }
  } catch (error) {
    return fail(error instanceof Error ? error.message : String(error))
  }
}

/** Runs the allowlisted fixture. Supplying an adapter is intended for tests. */
export const runWorkflowFixture = async (
  argv: readonly string[],
  supplied?: Adapter.t
): Promise<Output> => {
  const parsed = parse(argv)
  if ('code' in parsed) return parsed
  const runtime = supplied === undefined ? await create() : undefined
  const adapter = supplied ?? runtime!
  const options: Adapter.Options = { limits: { timeoutMs: parsed.timeoutMs } }
  const context = { snapshot: { transactionTime: null } } as const
  try {
    switch (parsed.operation) {
      case 'feasibility':
        return ok(await Workflow.feasibility(
          adapter,
          architectureModel({ teamSize: parsed.teamSize, deploymentFrequency: parsed.deploymentFrequency }),
          options,
          context
        ))
      case 'optimization':
        return ok(await Workflow.optimization(
          adapter,
          architectureModel({ teamSize: parsed.teamSize, deploymentFrequency: parsed.deploymentFrequency }),
          options,
          context
        ))
      case 'counterexample':
        return ok(await Workflow.counterexample(
          adapter,
          architectureModel(),
          'small-team-monolith',
          options,
          context
        ))
      case 'sensitivity': {
        const samples = Array.from(
          { length: parsed.to - parsed.from + 1 },
          (_, index): Model.Value => ({ sort: 'int', value: String(parsed.from + index) })
        )
        return ok(await Workflow.sensitivity(adapter, architectureModel(), {
          variableId: 'deployment-frequency',
          samples,
          fixed: [{ variableId: 'team-size', value: { sort: 'int', value: String(parsed.teamSize) } }],
          observe: ['architecture'],
          operation: 'optimization',
          maxRuns: 12
        }, options, context))
      }
    }
  } catch (error) {
    return { code: 1, out: '', err: `${error instanceof Error ? error.message : String(error)}\n` }
  } finally {
    await runtime?.close()
  }
}
