import type { Claim, Value } from '@cavelang/core'

const term = ({ kind, text }: Claim.Term): Claim.Term => ({ kind, text })
const value = ({ raw, kind, approx, num, unit, from, to }: Value.t): Value.t =>
  ({ raw, kind, approx, num, unit, from, to })

const payload = (input: Claim.Payload): Claim.Payload => {
  switch (input.kind) {
    case 'none': return { kind: 'none' }
    case 'relation': return { kind: 'relation', object: term(input.object) }
    case 'attribute': return { kind: 'attribute', attribute: input.attribute, value: value(input.value) }
    case 'metric': return { kind: 'metric', value: value(input.value) }
  }
}

/** Own declared fields before columns, emitted text and identity are derived. */
export const captureClaim = (input: Claim.t): Claim.t => {
  const { subject, verb, negated, payload: body, contexts, tags, conf, importance,
    delta, sigmaLevel, comment, raw } = input
  for (const [name, collection] of [['contexts', contexts], ['tags', tags]] as const) {
    if (!Array.isArray(collection)) throw new TypeError(`claim ${name} must be an array`)
  }
  return {
    subject: term(subject), verb, negated, payload: payload(body),
    contexts: Array.from(contexts),
    tags: Array.from(tags, ({ key, value }) => ({ key, value })),
    conf, importance, delta: delta === undefined ? undefined : value(delta),
    sigmaLevel, comment, raw,
  }
}
