import type { Options } from './compile.ts'
import type * as Pattern from './pattern.ts'

const slot = (value: Pattern.Slot): Pattern.Slot => {
  switch (value.kind) {
    case 'wildcard': return { kind: 'wildcard' }
    case 'var': return { kind: 'var', name: value.name }
    case 'term': return { kind: 'term', text: value.text }
  }
}

const verb = (value: Pattern.VerbSlot): Pattern.VerbSlot => {
  switch (value.kind) {
    case 'wildcard': return { kind: 'wildcard' }
    case 'var': return { kind: 'var', name: value.name }
    case 'verb': return { kind: 'verb', name: value.name, transitive: value.transitive }
  }
}

const payload = (value: Pattern.PayloadPattern): Pattern.PayloadPattern => {
  switch (value.kind) {
    case 'any': return { kind: 'any' }
    case 'object': return { kind: 'object', object: slot(value.object) }
    case 'attribute': return { kind: 'attribute', attribute: value.attribute, value: slot(value.value) }
  }
}

const filter = (value: Pattern.Filter): Pattern.Filter => {
  switch (value.field) {
    case 'conf': return { field: 'conf', op: value.op, value: value.value }
    case 'tag': return { field: 'tag', op: value.op, key: value.key, value: value.value }
    case 'context': return { field: 'context', op: value.op, value: value.value }
    case 'value': return { field: 'value', op: value.op, value: value.value, unit: value.unit }
    case 'tx': return { field: 'tx', op: value.op, value: value.value }
  }
}

/** Capture caller-owned AST fields before numeric detection or SQL compilation. */
export const capturePattern = (value: Pattern.t): Pattern.t => ({
  subject: slot(value.subject),
  verb: verb(value.verb),
  payload: payload(value.payload),
  negated: value.negated,
  contexts: [...value.contexts],
  tags: value.tags.map(tag => ({ key: tag.key, value: tag.value })),
  filters: value.filters.map(filter),
})

/** Capture caller-owned query options before database callbacks can change them. */
export const captureOptions = (options: Options): Options => ({
  all: options.all,
  aliases: options.aliases,
  asOf: options.asOf,
  at: options.at,
  resolve: options.resolve,
  limit: options.limit,
  offset: options.offset,
  support: options.support,
})
