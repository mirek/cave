import { test } from 'node:test'
import * as assert from 'node:assert/strict'
import { Claim, Tag, Value } from '@cavelang/core'
import * as Canonical from '@cavelang/canonical'
import { open } from '@cavelang/store'

for (const delimiter of ['"', '`']) test(`structured fields cannot hide comments with ${delimiter}`, () => {
  const store = open()
  try {
    store.ingest('original IS retained')
    const before = store.exportText({ tx: true })
    for (const field of ['subject', 'object', 'value', 'context', 'tag', 'comment-marker'] as const) {
      const content = field === 'comment-marker' ? 'prefix;suffix' : `prefix${delimiter}suffix`
      const claim = Claim.of({ subject: Claim.entity(field === 'subject' ? content : 'subject'), verb: 'IS', raw: 'provided', comment: 'must remain a comment',
        payload: field === 'value' ? Claim.metric(Value.parse(content)) : Claim.relation(Claim.entity(field === 'object' || field === 'comment-marker' ? content : 'object')),
        contexts: field === 'context' ? [content] : [], tags: field === 'tag' ? [Tag.of(content)] : [] })
      const result = { claims: [{ line: 1, claim }], edges: [], problems: [], registry: store.registry() }
      assert.throws(() => Canonical.emitClaim(claim), /comment|delimiter/, field)
      assert.throws(() => Canonical.emit(result), /comment|delimiter/, field)
      assert.throws(() => store.insertResult(result), /comment|delimiter/, field)
      assert.equal(store.exportText({ tx: true }), before)
    }
    const parent = Claim.of({ subject: Claim.entity('parent'), verb: 'IS', payload: Claim.relation(Claim.entity('ready')) })
    const child = Claim.of({ subject: Claim.entity('condition'), verb: 'EXISTS', payload: Claim.none, contexts: [`prefix${delimiter}suffix`] })
    assert.throws(() => Canonical.emit({ claims: [{ line: 1, claim: parent }, { line: 2, claim: child }], edges: [{ parent: 0, child: 1, role: 'WHEN' }] }), /comment|delimiter/)
    const valid = Claim.of({ subject: Claim.text('subject;literal'), verb: 'IS', payload: Claim.relation(Claim.code('x"y;z')), comment: 'literal "quote ; marker' })
    const parsed = Canonical.canonicalizeText(Canonical.emitClaim(valid))
    assert.deepEqual(parsed.problems, [])
    assert.deepEqual(parsed.claims[0]!.claim.subject, valid.subject)
    assert.deepEqual(parsed.claims[0]!.claim.payload, valid.payload)
    assert.equal(parsed.claims[0]!.claim.comment, valid.comment)
  } finally { store.close() }
})

for (const delimiter of ['"', '`']) test(`authored unmatched ${delimiter} produces diagnostics before storage`, () => {
  const input = [
    'retained IS valid',
    `broken IS prefix${delimiter}suffix`,
    '  WHEN orphan',
    `parent IS ready`,
    `  WHEN condition @prefix${delimiter}suffix`,
    `  IS prefix${delimiter}suffix`,
    `CUSTOM IS verb @prefix${delimiter}suffix`,
    'last IS valid'
  ].join('\n')
  const result = Canonical.canonicalizeText(input)
  assert.deepEqual(result.problems.map(problem => problem.line), [2, 3, 5, 6, 7])
  assert.deepEqual(result.claims.map(entry => entry.line), [1, 4, 8])
  assert.deepEqual(result.edges, [])
  assert.equal(result.registry.declared.has('CUSTOM'), false)
  assert.deepEqual(Canonical.canonicalizeText(Canonical.emit(result)).problems, [])
  for (const strict of [false, true]) {
    const store = open()
    try {
      store.ingest('original IS retained')
      const before = store.exportText({ tx: true })
      if (strict) {
        assert.throws(() => store.ingest(input, { strict }), /line 2/)
        assert.equal(store.exportText({ tx: true }), before)
      } else {
        const ingested = store.ingest(input, { strict })
        assert.equal(ingested.ids.length, 3)
        assert.deepEqual(ingested.problems, result.problems)
        assert.deepEqual(Canonical.canonicalizeText(store.exportText()).problems, [])
      }
      assert.equal(store.registry().declared.has('CUSTOM'), false)
    } finally { store.close() }
  }
})
