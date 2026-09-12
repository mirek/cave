import { test } from 'node:test'
import * as assert from 'node:assert/strict'
import { Claim, Entity } from '@cavelang/core'
import { Line, Token } from '@cavelang/parser'
import { emitClaim } from '@cavelang/canonical'

test('optimized entity object validation preserves parser classification and identity', () => {
  const objects = new Set(['', 'NOT', 'not', '_', '2026-01-01', '30ms', 'owner: platform', 'two words', '資料/項目', '"literal"', '`code`'])
  for (const prefix of ['a', 'NOT', '_', '3', '-', '@', '#', '+/-', '!']) {
    for (const suffix of ['', '-item', '/item', '.json', '42', ':value', ':', ' two', '\titem', '\n', ';comment', '"', '`', ' @ctx', ' #tag', ' !']) objects.add(prefix + suffix)
  }
  for (const verb of ['IS', 'HAS', 'CUSTOM']) for (const object of objects) {
    const body = `${verb} ${object}`
    const parsed = Line.parseBody(Token.tokenize(body))
    const accepted = !body.includes('\n') && Token.splitComment(`${body};`).head === body &&
      parsed.ok && parsed.problems.length === 0 && !parsed.value.negated &&
      parsed.value.payload.kind === 'relation' && parsed.value.payload.object.kind === 'entity' &&
      Entity.normalize(parsed.value.payload.object.text) === Entity.normalize(object)
    const claim = Claim.of({ subject: Claim.entity('subject'), verb, payload: Claim.relation(Claim.entity(object)) })
    if (accepted) assert.equal(emitClaim(claim), `subject ${body}`, `${verb}/${object}`)
    else assert.throws(() => emitClaim(claim), /relation|object|comment|delimiter|newline/, `${verb}/${object}`)
  }
})
