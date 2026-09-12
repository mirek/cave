import type { Explain } from '@cavelang/solver'

const object = (value: unknown, path: string): Record<string, unknown> => {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${path} must be an object`)
  return value as Record<string, unknown>
}

const text = (value: unknown, path: string): void => {
  if (typeof value !== 'string') throw new TypeError(`${path} must be a string`)
}

const strings = (value: unknown, path: string): void => {
  if (!Array.isArray(value)) throw new TypeError(`${path} must be an array of strings`)
  for (let index = 0; index < value.length; index++) text(value[index], `${path}[${index}]`)
}

const choice = (value: unknown, choices: readonly string[], path: string): void => {
  if (typeof value !== 'string' || !choices.includes(value)) throw new TypeError(`${path} must be one of ${choices.join(', ')}`)
}

const element = (value: unknown, path: string): Record<string, unknown> => {
  const entry = object(value, path)
  text(entry.id, `${path}.id`)
  strings(entry.evidenceRowIds, `${path}.evidenceRowIds`)
  strings(entry.scenarioInputIds, `${path}.scenarioInputIds`)
  if (entry.description !== undefined) text(entry.description, `${path}.description`)
  if (entry.declaration !== undefined) {
    const declaration = object(entry.declaration, `${path}.declaration`)
    text(declaration.uri, `${path}.declaration.uri`)
    for (const field of ['line', 'column']) {
      const position = declaration[field]
      if (position !== undefined && (typeof position !== 'number' || !Number.isSafeInteger(position) || position <= 0)) {
        throw new TypeError(`${path}.declaration.${field} must be a positive safe integer`)
      }
    }
  }
  return entry
}

const declared = (entry: Record<string, unknown>, path: string): void => {
  if (typeof entry.declared !== 'boolean') throw new TypeError(`${path}.declared must be a boolean`)
}

/** Called after collection validation, over captured or decoded JSON only. */
export const validateExplanationEntries = (report: Explain.Report): void => {
  report.run.inputs.forEach((value, index) => {
    const path = `solver explanation inputs[${index}]`
    const entry = object(value, path)
    text(entry.id, `${path}.id`)
    strings(entry.evidenceRowIds, `${path}.evidenceRowIds`)
    strings(entry.scenarioClaimIds, `${path}.scenarioClaimIds`)
    if (entry.query !== undefined) text(entry.query, `${path}.query`)
  })
  const outcome = report.outcome
  if (outcome.status === 'satisfied' || outcome.status === 'optimal') {
    outcome.assignments.forEach((value, index) => {
      const path = `solver explanation assignments[${index}]`
      declared(element(value, path), path)
      // Backend values are intentionally retained, including malformed shapes.
    })
    for (const field of ['hardConstraints', 'softConstraints'] as const) {
      outcome[field].forEach((value, index) => {
        const path = `solver explanation ${field}[${index}]`
        const entry = element(value, path)
        choice(entry.evaluation, field === 'hardConstraints' ? ['satisfied', 'violated', 'indeterminate'] : ['accepted', 'violated', 'indeterminate'], `${path}.evaluation`)
        if (entry.evaluationReason !== undefined) text(entry.evaluationReason, `${path}.evaluationReason`)
        if (field === 'softConstraints') {
          const weight = object(entry.weight, `${path}.weight`)
          text(weight.numerator, `${path}.weight.numerator`)
          text(weight.denominator, `${path}.weight.denominator`)
        }
      })
    }
  }
  if (outcome.status === 'optimal') outcome.objectives.forEach((value, index) => {
    const path = `solver explanation objectives[${index}]`
    const entry = element(value, path)
    declared(entry, path)
    choice(entry.direction, ['minimize', 'maximize', 'unknown'], `${path}.direction`)
  })
  if (outcome.status === 'unsatisfied') outcome.core?.forEach((value, index) => {
    const path = `solver explanation core[${index}]`
    declared(element(value, path), path)
  })
}
