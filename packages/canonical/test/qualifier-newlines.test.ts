import { test } from 'node:test'
import * as assert from 'node:assert/strict'
import { Claim, Key } from '@cavelang/core'
import { emit, canonicalizeText } from '@cavelang/canonical'

test('abbreviated existence qualifiers reject field newlines and retain multiline comments', () => {
  const parent = Claim.of({ subject: Claim.entity('server'), verb: 'CAUSE', payload: Claim.relation(Claim.entity('crash')) })
  for (const role of ['WHEN', 'VIA', 'BECAUSE'] as const) for (const negated of [false, true]) {
    for (const field of ['subject', 'context'] as const) {
      const child = Claim.of({ subject: Claim.code(field === 'subject' ? 'first\nsecond' : 'condition'), verb: 'EXISTS', payload: Claim.none,
        negated, contexts: field === 'context' ? ['first\nsecond'] : [] })
      assert.throws(() => emit({ claims: [{ line: 1, claim: parent }, { line: 2, claim: child }], edges: [{ parent: 0, child: 1, role }] }), /newline/, `${role}/${negated}/${field}`)
    }
    const child = Claim.of({ subject: Claim.code('literal condition'), verb: 'EXISTS', payload: Claim.none, negated, comment: 'first comment\nsecond comment' })
    const source = emit({ claims: [{ line: 1, claim: parent }, { line: 2, claim: child }], edges: [{ parent: 0, child: 1, role }] })
    const parsed = canonicalizeText(source)
    assert.deepEqual(parsed.problems, [])
    assert.deepEqual(parsed.claims.map(entry => Key.of(entry.claim)), [Key.of(parent), Key.of(child)])
    assert.equal(parsed.claims[1]!.claim.comment, child.comment)
    assert.deepEqual(parsed.edges, [{ parent: 0, child: 1, role }])
  }
})
