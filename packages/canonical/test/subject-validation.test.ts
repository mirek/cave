import { test } from 'node:test'
import * as assert from 'node:assert/strict'
import { Claim } from '@cavelang/core'
import { Line, Token } from '@cavelang/parser'
import { emitClaim } from '@cavelang/canonical'

test('optimized subject validation preserves parser token and comment boundaries', () => {
  const characters = [...Array.from({ length: 128 }, (_, index) => String.fromCharCode(index)), '資料', 'é', '😀', '\u2028', '\u2029', '\u00a0']
  const subjects = ['', 'scope/item-1', '_internal', 'code:literal', ...characters.flatMap(char => [char + 'item', 'it' + char + 'em', 'item' + char])]
  for (const subject of subjects) {
    const head = Token.splitComment(subject).head
    const tokens = Token.tokenize(head), token = tokens[0]
    const comment = Token.splitComment(`${subject} IS retained ; boundary marker`).comment
    const accepted = comment === 'boundary marker' && !subject.includes('\n') && head === subject && tokens.length === 1 && token?.kind === 'word' && token.text === subject && !Line.isMetaStart(token)
    const claim = Claim.of({ subject: Claim.entity(subject), verb: 'IS', payload: Claim.relation(Claim.entity('retained')) })
    if (accepted) assert.equal(emitClaim(claim), `${subject} IS retained`, JSON.stringify(subject))
    else assert.throws(() => emitClaim(claim), /atom|newline|comment|delimiter/, JSON.stringify(subject))
  }
})
