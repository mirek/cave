import { test } from 'node:test'
import * as assert from 'node:assert/strict'
import { memoryStoreOfText, reconstruct, heuristicPolicy } from '@cavelang/loop'
import { knowledge, run } from '../src/demo.ts'

test('multi-hop recovery: symptom → cause → topic → fix (spec §11.3, §18)', () => {
  const store = memoryStoreOfText(knowledge)
  const { claims, trace } = reconstruct(store, heuristicPolicy({ maxSteps: 12 }), ['reject-valid-tokens'])
  const raws = claims.map(claim => claim.raw)
  assert.ok(raws.some(raw => raw.includes('token-expiry CAUSE reject-valid-tokens')), 'recovered the cause via inverse CAUSE')
  assert.ok(raws.some(raw => raw.includes('FIX token-expiry')), 'recovered the fix')
  assert.ok(raws.some(raw => raw.includes('HAS bug: token-expiry')), 'recovered the bug claim via topic membership')
  assert.ok(!raws.some(raw => raw.includes('unrelated/service')), 'did not wander into unrelated knowledge')
  assert.ok(trace.length <= 12)
  assert.equal(trace[0]!.cue.entity, 'reject-valid-tokens')
})

test('reconstruction is deterministic', () => {
  const store = memoryStoreOfText(knowledge)
  const policy = () => heuristicPolicy({ maxSteps: 12 })
  const first = reconstruct(store, policy(), ['reject-valid-tokens'])
  const second = reconstruct(store, policy(), ['reject-valid-tokens'])
  assert.deepEqual(
    first.claims.map(claim => claim.raw),
    second.claims.map(claim => claim.raw)
  )
  assert.deepEqual(
    first.trace.map(step => step.cue.entity),
    second.trace.map(step => step.cue.entity)
  )
})

test('maxSteps budget stops the loop', () => {
  const store = memoryStoreOfText(knowledge)
  const { trace } = reconstruct(store, heuristicPolicy({ maxSteps: 1 }), ['reject-valid-tokens'])
  assert.equal(trace.length, 1)
})

test('maxClaims budget stops the loop', () => {
  const store = memoryStoreOfText(knowledge)
  const { claims } = reconstruct(store, heuristicPolicy({ maxClaims: 2 }), ['reject-valid-tokens'])
  assert.ok(claims.length >= 2)
  const unbounded = reconstruct(store, heuristicPolicy({ maxSteps: 12 }), ['reject-valid-tokens'])
  assert.ok(unbounded.claims.length > claims.length)
})

test('minScore prunes low-confidence frontiers', () => {
  const store = memoryStoreOfText([
    'a CAUSE b @ 10%',
    'b CAUSE c @ 10%'
  ].join('\n'))
  const { trace } = reconstruct(store, heuristicPolicy({ minScore: 0.5 }), ['a'])
  assert.equal(trace.length, 1, 'weak edges never make the cut')
})

test('empty seeds and unknown entities terminate cleanly', () => {
  const store = memoryStoreOfText(knowledge)
  assert.deepEqual(reconstruct(store, heuristicPolicy(), []).claims, [])
  const unknown = reconstruct(store, heuristicPolicy(), ['never-heard-of-it'])
  assert.deepEqual(unknown.claims, [])
  assert.equal(unknown.trace.length, 1)
})

test('demo runs and narrates the recovery', () => {
  const { lines } = run()
  const text = lines.join('\n')
  assert.match(text, /trace:/)
  assert.match(text, /PART-OF/)
  assert.match(text, /`<=` FIX token-expiry @auth\.ts:42/)
})

test('a weaker path discovered later never downgrades a pending cue', () => {
  const withWeakEdge = [
    'seed USES mid',
    'seed USES endpoint @ 70%',
    'mid CAUSE endpoint @ 5%',
    'endpoint YIELDS treasure'
  ].join('\n')
  const withoutWeakEdge = [
    'seed USES mid',
    'seed USES endpoint @ 70%',
    'endpoint YIELDS treasure'
  ].join('\n')
  for (const text of [withWeakEdge, withoutWeakEdge]) {
    const { claims } = reconstruct(memoryStoreOfText(text), heuristicPolicy(), ['seed'])
    assert.ok(
      claims.some(claim => claim.raw.includes('treasure')),
      `treasure reachable (adding an edge must never remove claims): ${text.split('\n').length} lines`
    )
  }
})
