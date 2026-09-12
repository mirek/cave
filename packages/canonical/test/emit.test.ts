import { test } from 'node:test'
import * as assert from 'node:assert/strict'
import { Claim, Key, Value } from '@cavelang/core'
import { canonicalizeText, emit, emitClaim, standardRegistry } from '@cavelang/canonical'

const roundTrip = (text: string): { first: string, second: string } => {
  const result = canonicalizeText(text, standardRegistry)
  assert.deepEqual(result.problems, [], `problems for ${JSON.stringify(text)}`)
  const first = emit(result)
  const again = canonicalizeText(first, standardRegistry)
  assert.deepEqual(again.problems, [], `round-trip problems for ${JSON.stringify(first)}`)
  const second = emit(again)
  return { first, second }
}

test('bare carriage returns in text and code values preserve literal identity', () => {
  const base = canonicalizeText('claim HAS note: "ordinary"', standardRegistry).claims[0]!.claim
  assert.equal(base.payload.kind, 'attribute')
  if (base.payload.kind !== 'attribute') assert.fail('expected attribute fixture')
  for (const create of [Value.ofText, Value.ofCode]) {
    for (const content of ['a\rb', '\rleading', 'trailing\r', 'a\r\rb']) {
      const claim: Claim.t = { ...base, payload: { ...base.payload, value: create(content) } }
      const text = emitClaim(claim)
      const parsed = canonicalizeText(text, standardRegistry)
      assert.deepEqual(parsed.problems, [])
      assert.equal(parsed.claims.length, 1)
      assert.equal(Key.of(parsed.claims[0]!.claim), Key.of(claim))
      assert.deepEqual(parsed.claims[0]!.claim.payload, claim.payload)
      assert.equal(emitClaim(parsed.claims[0]!.claim), text)
    }
  }
})

test('emit supports broad sibling groups without spreading function arguments', () => {
  const count = 130_000
  const base = canonicalizeText('claim EXISTS', standardRegistry).claims[0]!
  const text = emit({ claims: Array.from({ length: count }, () => base), edges: [] })
  assert.equal(text, `claim\n${'  EXISTS\n'.repeat(count)}`)
  const parsed = canonicalizeText(text, standardRegistry)
  assert.deepEqual(parsed.problems, [])
  assert.equal(parsed.claims.length, count)
  assert.equal(parsed.edges.length, 0)
  assert.equal(emit(parsed), text)
})

test('emit preserves complete sibling prefixes with trailing metadata', () => {
  const count = 10_000
  const base = canonicalizeText('claim EXISTS @ 70%', standardRegistry).claims[0]!
  const text = emit({ claims: Array.from({ length: count }, () => base), edges: [] })
  assert.equal(text, `claim\n${'  EXISTS @ 70%\n'.repeat(count)}`)
  const mixed = canonicalizeText('first EXISTS @ 70%\nfirst EXISTS @ 80%\nsecond HAS a: A\nsecond HAS b: B', standardRegistry)
  const { first, second } = roundTrip(emit(mixed))
  assert.equal(first, second)
  assert.match(first, /second HAS/)
})

test('emit retains large multiline comments without spreading function arguments', () => {
  const count = 130_000
  const base = canonicalizeText('claim EXISTS', standardRegistry).claims[0]!
  const comment = Array.from({ length: count }, (_, index) => `line-${index}`).join('\n')
  const text = emit({ claims: [{ ...base, claim: { ...base.claim, comment } }], edges: [] })
  const lines = text.trimEnd().split('\n')
  assert.equal(lines.length, count)
  for (let index = 0; index < count - 1; index++) assert.equal(lines[index], `; line-${index}`)
  assert.equal(lines[count - 1], `claim EXISTS ; line-${count - 1}`)
  const parsed = canonicalizeText(text, standardRegistry)
  assert.deepEqual(parsed.problems, [])
  assert.equal(parsed.claims.length, 1)
  assert.equal(parsed.claims[0]!.claim.comment, comment)
  assert.equal(emit(parsed), text)
})

test('emit handles deep support chains and cycles without recursive stack growth', () => {
  const count = 3000
  const base = canonicalizeText('claim EXISTS', standardRegistry).claims[0]!
  const claims = Array.from({ length: count }, () => base)
  const edges = Array.from({ length: count - 1 }, (_, index) => ({ parent: index, child: index + 1, role: 'BECAUSE' as const }))
  edges.push({ parent: count - 1, child: 0, role: 'BECAUSE' })
  const visits: number[] = []
  const text = emit({ claims, edges }, { annotate: index => { visits.push(index); return undefined } })
  assert.deepEqual(visits, [...Array.from({ length: count }, (_, index) => index), 0])
  const lines = text.trimEnd().split('\n')
  assert.equal(lines.length, count + 1)
  assert.equal(lines[0], 'claim EXISTS')
  for (let index = 1; index <= count; index++) {
    assert.equal(lines[index], `${'  '.repeat(index)}BECAUSE claim`)
  }
  const parsed = canonicalizeText(text, standardRegistry)
  assert.deepEqual(parsed.problems, [])
  assert.equal(parsed.claims.length, count + 1)
  assert.equal(parsed.edges.length, count)
  assert.equal(emit(parsed), text)
})

test('emit rejects invalid edge roles and endpoints before annotations run', () => {
  const result = canonicalizeText('parent IS fact\nchild IS condition', standardRegistry)
  const valid = { parent: 0, child: 1, role: 'WHEN' as const }
  const before = JSON.stringify(result)
  let annotations = 0
  const options = { annotate: () => { annotations++; return '; annotation' } }
  for (const role of ['BOGUS', 'when', '', 'WHEN\ninjected IS fact', null, 1]) {
    assert.throws(() => emit({ ...result, edges: [valid, { ...valid, role: role as never }] }, options),
      { name: 'TypeError', message: /CAVE edge role/ })
  }
  for (const field of ['parent', 'child'] as const) {
    for (const index of [-1, 2, 0.5, NaN, Infinity, '0', null]) {
      assert.throws(() => emit({ ...result, edges: [valid, { ...valid, [field]: index } as never] }, options),
        { name: 'TypeError', message: new RegExp(`CAVE edge ${field}.*existing claim`) })
    }
  }
  assert.equal(annotations, 0)
  assert.equal(JSON.stringify(result), before)
  assert.match(emit({ ...result, edges: [valid] }), /WHEN child IS condition/)
  const reads = { parent: 0, child: 0, role: 0 }
  const captured = {
    get parent() { return ++reads.parent === 1 ? 0 : 99 },
    get child() { return ++reads.child === 1 ? 1 : 99 },
    get role() { return (++reads.role === 1 ? 'WHEN' : 'BOGUS') as 'WHEN' }
  }
  assert.match(emit({ ...result, edges: [captured] }), /WHEN child IS condition/)
  assert.deepEqual(reads, { parent: 1, child: 1, role: 1 })
})

test('emit rejects sparse claim arrays before annotations and accepts a corrected retry', () => {
  const result = canonicalizeText('parent IS fact\nchild IS condition', standardRegistry)
  const claims = new Array<(typeof result.claims)[number]>(3)
  claims[0] = result.claims[0]!
  claims[2] = result.claims[1]!
  let annotations = 0
  const options = { annotate: () => { annotations++; return undefined } }
  const before = JSON.stringify(claims)
  assert.throws(() => emit({ claims, edges: [] }, options), /claims must be a dense array/)
  assert.equal(annotations, 0)
  assert.equal(Object.hasOwn(claims, 1), false)
  assert.equal(JSON.stringify(claims), before)
  assert.equal(emit(result, options), emit(result))
  assert.equal(annotations, 2)
})

test('emit produces canonical primary direction (spec §5.5)', () => {
  const result = canonicalizeText('packages/api PART-OF monorepo', standardRegistry)
  assert.equal(emit(result), 'monorepo CONTAINS packages/api\n')
})

test('emitters MUST produce the colon attribute form (spec §3.4)', () => {
  const result = canonicalizeText('OpenAI HAS revenue 20B USD/yr', standardRegistry)
  assert.equal(emit(result), 'OpenAI HAS revenue: 20B USD/yr\n')
})

test('emit factors adjacent claims through recursive incomplete prefixes (spec §8.5)', () => {
  const result = canonicalizeText([
    'foo HAS a: A ; first',
    'foo HAS a: B',
    'foo HAS b: C',
    'bar HAS c: D'
  ].join('\n'), standardRegistry)
  assert.equal(
    emit(result),
    [
      'foo HAS',
      '  a:',
      '    A ; first',
      '    B',
      '  b: C',
      'bar HAS c: D',
      ''
    ].join('\n')
  )
  const again = canonicalizeText(emit(result), standardRegistry)
  assert.deepEqual(again.problems, [])
  assert.deepEqual(
    again.claims.map(entry => Key.of(entry.claim)),
    result.claims.map(entry => Key.of(entry.claim))
  )
})

test('emit factors qualifier siblings without changing their parent edges (spec §8.5)', () => {
  const result = canonicalizeText([
    'server CAUSE crash',
    '  WHEN high-load',
    '  WHEN cache-miss'
  ].join('\n'), standardRegistry)
  const text = emit(result)
  assert.equal(text, 'server CAUSE crash\n  WHEN\n    high-load\n    cache-miss\n')
  const again = canonicalizeText(text, standardRegistry)
  assert.deepEqual(again.problems, [])
  assert.deepEqual(again.edges, result.edges)
})

test('factoring stops before a prefix becomes a complete claim', () => {
  const result = canonicalizeText([
    'foo HAS revenue: 20B USD/yr @2025',
    'foo HAS revenue: 20B USD/mo @2026'
  ].join('\n'), standardRegistry)
  assert.equal(
    emit(result),
    'foo HAS revenue:\n  20B USD/yr @2025\n  20B USD/mo @2026\n'
  )
})

test('transaction annotations stay directly above factored claim leaves', () => {
  const result = canonicalizeText('foo HAS a: A\nfoo HAS b: B', standardRegistry)
  const text = emit(result, { annotate: index => `;@ tx-${index}` })
  assert.equal(
    text,
    'foo HAS\n  ;@ tx-0\n  a: A\n  ;@ tx-1\n  b: B\n'
  )
  const lines = text.trimEnd().split('\n')
  const again = canonicalizeText(text, standardRegistry)
  assert.deepEqual(again.problems, [])
  assert.deepEqual(
    again.claims.map(entry => lines[entry.line - 2]!.trim()),
    [';@ tx-0', ';@ tx-1']
  )
})

test('emit is stable — second pass equals first', () => {
  const { first, second } = roundTrip([
    'auth/middleware HAS bug: token-expiry #security #topic:auth-hardening',
    'server IS NOT compromised @ 90%',
    'OpenAI HAS revenue: ~20B USD/yr +/- 2B USD/yr (1σ) @2026-Q1 @ 90%',
    'auth/key HAS expiry: 3600s ! ; rotated quarterly',
    'memory-leak EXISTS @production',
    'feature EXISTS NOT @production',
    'latency IS 30ms',
    'step/1 IS "install dependencies"',
    'expiry-check USES `<`'
  ].join('\n'))
  assert.equal(second, first)
})

test('claim keys survive the round trip', () => {
  const text = [
    'server CAUSE crash @ 80%',
    '  WHEN load > ~1000 req/s',
    '  WHEN NOT cache/enabled',
    'monorepo CONTAINS packages/api',
    '  PART-OF org/monorepos'
  ].join('\n')
  const before = canonicalizeText(text, standardRegistry)
  const after = canonicalizeText(emit(before), standardRegistry)
  assert.deepEqual(
    after.claims.map(entry => Key.of(entry.claim)).sort(),
    before.claims.map(entry => Key.of(entry.claim)).sort()
  )
  assert.deepEqual(after.edges, before.edges)
})

test('UNLESS emits as WHEN NOT (spec §8.2 canonical preference)', () => {
  const result = canonicalizeText('server CAUSE crash\n  UNLESS cache/enabled', standardRegistry)
  assert.equal(emit(result), 'server CAUSE crash\n  WHEN NOT cache/enabled\n')
})

test('comparison condition emits as standard-verb claim', () => {
  const result = canonicalizeText('server CAUSE crash\n  WHEN load > ~1000 req/s', standardRegistry)
  assert.equal(emit(result), 'server CAUSE crash\n  WHEN load EXCEEDS ~1000 req/s\n')
})

test('all comparison conditions and isolated stored rows round-trip as valid CAVE', () => {
  const cases = [
    ['>', 'EXCEEDS'],
    ['<', 'IS-BELOW'],
    ['>=', 'IS-AT-LEAST'],
    ['<=', 'IS-AT-MOST'],
    ['=', 'EQUALS'],
    ['!=', 'DIFFERS-FROM']
  ] as const
  for (const [operator, verb] of cases) {
    const result = canonicalizeText(`server CAUSE crash\n  WHEN load ${operator} 100 req/s`, standardRegistry)
    const text = emit(result)
    assert.equal(text, `server CAUSE crash\n  WHEN load ${verb} 100 req/s\n`, operator)
    const again = canonicalizeText(text, standardRegistry)
    assert.deepEqual(again.problems, [], operator)
    assert.equal(Key.of(again.claims[1]!.claim), Key.of(result.claims[1]!.claim), operator)

    const isolated = `${emitClaim(result.claims[1]!.claim)}\n`
    const isolatedAgain = canonicalizeText(isolated, standardRegistry)
    assert.deepEqual(isolatedAgain.problems, [], `isolated ${operator}`)
    assert.equal(Key.of(isolatedAgain.claims[0]!.claim), Key.of(result.claims[1]!.claim), operator)
  }
})

test('grouped claims re-indent under their parent (spec §8.4)', () => {
  const result = canonicalizeText('deploy VIA github-actions\n  build PRECEDES deploy', standardRegistry)
  assert.equal(emit(result), 'deploy VIA github-actions\n  build PRECEDES deploy\n')
})

test('emitClaim renders every metadata item in §3.2 anatomy order', () => {
  const result = canonicalizeText(
    'OpenAI HAS projected-loss: 14B USD/yr +/- 3B USD/yr @2026 #finance @ 70% ! ; heavy capex',
    standardRegistry
  )
  assert.equal(
    emitClaim(result.claims[0]!.claim),
    'OpenAI HAS projected-loss: 14B USD/yr +/- 3B USD/yr @2026 #finance @ 70% ! ; heavy capex'
  )
})

test('empty result emits empty text', () => {
  assert.equal(emit({ claims: [], edges: [] }), '')
})

test('negated comparison conditions emit as WHEN NOT and round-trip keys (spec §8.2)', () => {
  const result = canonicalizeText('server CAUSE crash\n  UNLESS cpu >= 900', standardRegistry)
  const text = emit(result)
  assert.equal(text, 'server CAUSE crash\n  WHEN NOT cpu IS-AT-LEAST 900\n')
  const again = canonicalizeText(text, standardRegistry)
  assert.deepEqual(again.problems, [])
  assert.equal(Key.of(again.claims[1]!.claim), Key.of(result.claims[1]!.claim))
  assert.equal(again.claims[1]!.claim.negated, true)
  const exceeds = canonicalizeText('server CAUSE crash\n  WHEN NOT load > 1000 req/s', standardRegistry)
  const exceedsText = emit(exceeds)
  assert.equal(exceedsText, 'server CAUSE crash\n  WHEN NOT load EXCEEDS 1000 req/s\n')
  const exceedsAgain = canonicalizeText(exceedsText, standardRegistry)
  assert.equal(Key.of(exceedsAgain.claims[1]!.claim), Key.of(exceeds.claims[1]!.claim))
})

test('negated full-claim conditions round-trip (spec §8.2)', () => {
  const result = canonicalizeText('server CAUSE crash\n  WHEN NOT memory-leak EXISTS @production', standardRegistry)
  const text = emit(result)
  const again = canonicalizeText(text, standardRegistry)
  assert.deepEqual(again.problems, [])
  assert.equal(Key.of(again.claims[1]!.claim), Key.of(result.claims[1]!.claim))
})

test('a child cited by several parents is re-stated — children render once (spec §28.4)', () => {
  const base = canonicalizeText('a CAUSE b\nc CAUSE d\npremise EXISTS\n  WHEN deep EXISTS', standardRegistry)
  const result = {
    claims: base.claims,
    edges: [...base.edges, { parent: 0, role: 'BECAUSE', child: 2 }, { parent: 1, role: 'BECAUSE', child: 2 }] as const
  }
  assert.equal(
    emit(result),
    'a CAUSE b\n  BECAUSE premise\n    WHEN deep\nc CAUSE d\n  BECAUSE premise\n',
    "the re-statement is the line alone; the child's own children rode its first appearance"
  )
  const before = JSON.stringify(result)
  const failure = new Error('annotation failed')
  const visits: number[] = []
  assert.throws(() => emit(result, { annotate: index => {
    visits.push(index)
    if (index === 2) throw failure
    return undefined
  } }), error => error === failure)
  assert.deepEqual(visits, [0, 2])
  assert.equal(JSON.stringify(result), before)
  const retry: number[] = []
  assert.equal(emit(result, { annotate: index => { retry.push(index); return undefined } }), emit(result))
  assert.deepEqual(retry, [0, 2, 3, 1, 2])
  assert.equal(JSON.stringify(result), before)
})

test('a support cycle with no top-level member still emits every claim once (spec §24.5, §28.4)', () => {
  const base = canonicalizeText('a CAUSE b\nb CAUSE a', standardRegistry)
  const result = {
    claims: base.claims,
    edges: [{ parent: 0, role: 'BECAUSE', child: 1 }, { parent: 1, role: 'BECAUSE', child: 0 }] as const
  }
  assert.equal(
    emit(result),
    'a CAUSE b\n  BECAUSE b CAUSE a\n    BECAUSE a CAUSE b\n',
    'the cycle breaks at the re-statement instead of dropping rows'
  )
})

test('structured comment text round trips apply parser whitespace normalization', () => {
  for (const [comment, expected] of [
    ['first\n', 'first'], ['first\n\n', 'first'],
    ['\nfirst\n\nsecond\n', 'first\n\nsecond'],
    ['first\r\n\r\n  second  \r\n', 'first\n\n  second'],
    ['\n', undefined], ['\n\n', undefined]
  ]) {
    const source = canonicalizeText('api IS service')
    const result = { ...source, claims: source.claims.map(entry => ({
      ...entry, claim: { ...entry.claim, comment }
    })) }
    const text = emit(result)
    const parsed = canonicalizeText(text)
    assert.deepEqual(parsed.problems, [])
    assert.equal(parsed.claims.length, 1)
    assert.equal(parsed.claims[0]!.claim.comment, expected)
    assert.equal(result.claims[0]!.claim.comment, comment)
    assert.equal(Key.of(parsed.claims[0]!.claim), Key.of(result.claims[0]!.claim))
    const normalized = emit(parsed)
    assert.equal(emit(canonicalizeText(normalized)), normalized)
  }
})

test('multi-line comments open above the claim line, trailing last, and round-trip (spec §6.4)', () => {
  const source = [
    '; rotated quarterly',
    '; per security policy',
    'auth/key HAS expiry: 3600s ! ; confirmed by ops',
    'auth USES jwt',
    '  ; reviewed in june',
    '  BECAUSE security-review',
    'foo HAS a: A',
    '; second leaf',
    '; keeps its block',
    'foo HAS b: B'
  ].join('\n')
  const result = canonicalizeText(source, standardRegistry)
  assert.deepEqual(result.problems, [])
  assert.equal(result.claims[0]!.claim.comment, 'rotated quarterly\nper security policy\nconfirmed by ops')
  assert.equal(
    emitClaim(result.claims[0]!.claim),
    '; rotated quarterly\n; per security policy\nauth/key HAS expiry: 3600s ! ; confirmed by ops'
  )
  const text = emit(result, { annotate: index => `;@ tx-${index}` })
  assert.equal(text, [
    '; rotated quarterly',
    '; per security policy',
    ';@ tx-0',
    'auth/key HAS expiry: 3600s ! ; confirmed by ops',
    ';@ tx-1',
    'auth USES jwt',
    '  ;@ tx-2',
    '  BECAUSE security-review ; reviewed in june',
    'foo HAS',
    '  ;@ tx-3',
    '  a: A',
    '  ; second leaf',
    '  ;@ tx-4',
    '  b: B ; keeps its block',
    ''
  ].join('\n'))
  const again = canonicalizeText(text, standardRegistry)
  assert.deepEqual(again.problems, [])
  assert.deepEqual(again.claims.map(entry => entry.claim.comment), result.claims.map(entry => entry.claim.comment))
  assert.equal(emit(again), emit(result))
})

test('emission rejects malformed claim flags in standalone and qualifier positions', () => {
  const result = canonicalizeText('parent EXISTS\nchild EXISTS', standardRegistry)
  for (const flag of ['negated', 'importance'] as const) {
    for (const value of [undefined, null, 'true', 'false', 0, 1, {}, []]) {
      const claim = { ...result.claims[1]!.claim, [flag]: value } as Claim.t
      assert.throws(() => emitClaim(claim), new RegExp(`${flag} must be a boolean`))
      for (const role of ['WHEN', 'VIA', 'BECAUSE', 'QUALIFIES'] as const) {
        assert.throws(() => emit({ claims: [result.claims[0]!, { line: 2, claim }],
          edges: [{ parent: 0, child: 1, role }] }), new RegExp(`${flag} must be a boolean`))
      }
    }
  }
})

test('emission rejects unsupported term and payload kinds instead of changing their shape', () => {
  const result = canonicalizeText('parent EXISTS\nchild EXISTS', standardRegistry)
  const base = result.claims[1]!.claim
  for (const kind of [undefined, null, '', 'unknown', 0, {}]) {
    const malformed = [
      { ...base, subject: { kind, text: 'child' } },
      { ...base, payload: { kind } },
      { ...base, verb: 'USES', payload: { kind: 'relation', object: { kind, text: 'object' } } }
    ]
    for (const input of malformed) {
      const claim = input as Claim.t
      assert.throws(() => emitClaim(claim), { name: 'TypeError', message: /CAVE (term|payload) kind/ })
      for (const role of ['WHEN', 'VIA', 'BECAUSE', 'QUALIFIES'] as const) {
        assert.throws(() => emit({ claims: [result.claims[0]!, { line: 2, claim }],
          edges: [{ parent: 0, child: 1, role }] }), { name: 'TypeError', message: /CAVE (term|payload) kind/ })
      }
    }
  }
})

test('emission rejects non-string term and value text before coercion', () => {
  const result = canonicalizeText('parent EXISTS\nchild EXISTS', standardRegistry)
  const base = result.claims[1]!.claim
  for (const text of [undefined, null, 42, false, [], ['word'], new String('word')]) {
    for (const kind of ['entity', 'text', 'code'] as const) {
      const term = { kind, text } as Claim.Term
      const claims = [
        { ...base, subject: term },
        { ...base, verb: 'USES', payload: Claim.relation(term) }
      ]
      for (const claim of claims) {
        assert.throws(() => emitClaim(claim), TypeError)
        for (const role of ['WHEN', 'VIA', 'BECAUSE', 'QUALIFIES'] as const) {
          assert.throws(() => emit({ claims: [result.claims[0]!, { line: 2, claim }],
            edges: [{ parent: 0, child: 1, role }] }), TypeError)
        }
      }
    }
    for (const kind of ['text', 'code', 'atom'] as const) {
      const value = { kind, raw: text, approx: false } as Value.t
      assert.throws(() => emitClaim({ ...base, verb: 'HAS', payload: Claim.attribute('label', value) }), TypeError)
    }
  }
})

test('emission does not reinterpret non-array metadata collections', () => {
  const result = canonicalizeText('parent EXISTS\nchild EXISTS', standardRegistry)
  for (const field of ['contexts', 'tags'] as const) {
    for (const value of [undefined, null, '', 'manual', 0, {}, new Set(), { length: 0 }]) {
      const claim = { ...result.claims[1]!.claim, [field]: value } as Claim.t
      assert.throws(() => emitClaim(claim), new RegExp(`${field} must be an array`))
      assert.throws(() => emit({ claims: [result.claims[0]!, { line: 2, claim }],
        edges: [{ parent: 0, child: 1, role: 'WHEN' }] }), new RegExp(`${field} must be an array`))
    }
  }
})
