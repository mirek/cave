import { test } from 'node:test'
import * as assert from 'node:assert/strict'
import { Claim } from '@cavelang/core'
import { canonicalizeText, emit } from '@cavelang/canonical'

// Raw spelling and source lines deliberately change during canonical emission.
const semantic = ({ raw: _raw, ...claim }: Claim.t): Omit<Claim.t, 'raw'> => claim

test('accepted subject, payload and metadata combinations preserve semantic fields through emission', () => {
  const subjects = ['item', 'NOT', 'EXISTS', 'a:b', '123', 'é', '_', 'a/b']
  const verbs = ['IS', 'HAS', 'USES', 'EXISTS', 'NOT']
  const objects = ['word', 'NOT', 'EXISTS', 'a:b', '123', 'é', '_', 'a/b',
    '"a\rb"', '`a\rb`', '""', '"a;b"', '`a"b`', '"a`b"',
    'a b', '~2', '1 -> 2', '2026-01-01']
  const tails = ['', ' @source', ' #key:value', ' +/- 2', ' (2σ)', ' @ 70%', ' !', ' ; note']
  let accepted = 0
  for (const subject of subjects) for (const verb of verbs) {
    for (const object of objects) for (const tail of tails) {
      const source = `${subject} ${verb} ${object}${tail}`
      const parsed = canonicalizeText(source)
      if (parsed.problems.length > 0 || parsed.claims.length === 0) continue
      accepted++
      const text = emit(parsed)
      const again = canonicalizeText(text)
      assert.deepEqual(again.problems, [], source)
      assert.deepEqual(again.claims.map(entry => semantic(entry.claim)),
        parsed.claims.map(entry => semantic(entry.claim)), source)
      assert.deepEqual(again.edges, parsed.edges, source)
      assert.equal(emit(again), text, source)
    }
  }
  // Prevent a parser regression from silently reducing the accepted corpus.
  assert.equal(accepted, 4928)
})
