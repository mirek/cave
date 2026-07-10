import { test } from 'node:test'
import * as assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  heuristicPolicy, llmPolicy, memoryStoreOfText, parseSelection, reconstruct, reconstructAsync,
  selectPrompt, shellComplete
} from '@cavelang/loop'
import type { AsyncPolicy, Cue, Policy, State } from '@cavelang/loop'
import { knowledge } from '../src/demo.ts'

const asyncOf = (policy: Policy): AsyncPolicy => ({
  select: async state => policy.select(state),
  score: async (edge, from) => policy.score(edge, from),
  done: async state => policy.done(state)
})

const cue = (entity: string, score = 1): Cue =>
  ({ entity, score, depth: 0 })

const stateOf = (frontier: readonly Cue[]): State =>
  ({ frontier, visited: new Set(), collected: [], steps: 0 })

/** Scripted `Complete`: consumes replies in order, recording prompts. */
const scripted = (replies: readonly string[]) => {
  const prompts: string[] = []
  const complete = async (prompt: string): Promise<string> => {
    prompts.push(prompt)
    const reply = replies[prompts.length - 1]
    assert.ok(reply !== undefined, `unexpected completion #${prompts.length}`)
    return reply
  }
  return { complete, prompts }
}

test('reconstructAsync mirrors the sync loop under the same policy', async () => {
  const store = memoryStoreOfText(knowledge)
  const sync = reconstruct(store, heuristicPolicy({ maxSteps: 12 }), ['reject-valid-tokens'])
  const async_ = await reconstructAsync(store, asyncOf(heuristicPolicy({ maxSteps: 12 })), ['reject-valid-tokens'])
  assert.deepEqual(async_.claims.map(claim => claim.raw), sync.claims.map(claim => claim.raw))
  assert.deepEqual(async_.trace.map(step => step.cue.entity), sync.trace.map(step => step.cue.entity))
})

test('selectPrompt renders the query, collected claims and the strongest cues', () => {
  const store = memoryStoreOfText(knowledge)
  const seeded = reconstruct(store, heuristicPolicy({ maxSteps: 1 }), ['reject-valid-tokens'])
  const prompt = selectPrompt(seeded.state, { query: 'why are valid tokens rejected?', maxCues: 1 })
  assert.match(prompt, /Query: why are valid tokens rejected\?/)
  assert.match(prompt, /token-expiry CAUSE reject-valid-tokens/, 'collected claims render as canonical CAVE')
  assert.match(prompt, /token-expiry @ 0\./, 'the strongest frontier cue is offered')
  assert.match(prompt, /or STOP when/)
  const empty = selectPrompt(stateOf([cue('a')]))
  assert.match(empty, /\(none yet\)/)
  assert.doesNotMatch(empty, /Query:/)
})

test('selectPrompt caps the offered cues at maxCues, strongest first', () => {
  const frontier = [cue('weak', 0.1), cue('strong', 0.9), cue('mid', 0.5)]
  const prompt = selectPrompt(stateOf(frontier), { maxCues: 2 })
  assert.match(prompt, /strong @ 0\.90/)
  assert.match(prompt, /mid @ 0\.50/)
  assert.doesNotMatch(prompt, /weak/)
})

test('parseSelection: exact replies, wrapped replies and last lines', () => {
  const frontier = [cue('token-expiry', 0.8), cue('auth/middleware', 0.5), cue('`<=`', 0.3)]
  assert.equal(parseSelection('token-expiry', frontier)?.entity, 'token-expiry')
  assert.equal(parseSelection('  auth/middleware\n', frontier)?.entity, 'auth/middleware')
  assert.equal(parseSelection('Thinking about it…\n\ntoken-expiry', frontier)?.entity, 'token-expiry')
  assert.equal(parseSelection('- `token-expiry`', frontier)?.entity, 'token-expiry')
  assert.equal(parseSelection('token-expiry.', frontier)?.entity, 'token-expiry')
  assert.equal(parseSelection('`<=`', frontier)?.entity, '`<=`', 'literal entities keep their delimiters')
})

test('parseSelection: STOP ends the loop; mentions beat trailing stop talk', () => {
  const frontier = [cue('token-expiry', 0.8), cue('auth/middleware', 0.5)]
  assert.equal(parseSelection('STOP', frontier), undefined)
  assert.equal(parseSelection('stop.', frontier), undefined)
  assert.equal(parseSelection('STOP — the query is answered.', frontier), undefined)
  assert.equal(parseSelection('The claims answer the query, so I will stop here.', frontier), undefined)
  assert.equal(
    parseSelection('Expand token-expiry next, then we can STOP.', frontier)?.entity,
    'token-expiry',
    'a mentioned cue wins over a trailing stop word'
  )
})

test('parseSelection: mention scanning is word-bounded, earliest-first, longest on ties', () => {
  const frontier = [cue('auth', 0.9), cue('auth/middleware', 0.5), cue('expiry-check', 0.4)]
  assert.equal(
    parseSelection('I would expand auth/middleware first.', frontier)?.entity,
    'auth/middleware',
    'the longer name wins at the same position'
  )
  assert.equal(
    parseSelection('expiry-check looks better than auth/middleware.', frontier)?.entity,
    'expiry-check',
    'the earliest mention wins'
  )
  assert.equal(
    parseSelection('The authors disagree.', frontier)?.entity,
    'auth',
    'no word-bounded mention degrades to the strongest cue'
  )
})

test('parseSelection: unparseable replies degrade to the strongest cue; empty frontier stops', () => {
  const frontier = [cue('b', 0.4), cue('a', 0.9)]
  assert.equal(parseSelection('no idea what to do', frontier)?.entity, 'a')
  assert.equal(parseSelection('anything', []), undefined)
})

test('llmPolicy drives the multi-hop recovery with one completion per step', async () => {
  const store = memoryStoreOfText(knowledge)
  const { complete, prompts } = scripted([
    'reject-valid-tokens',
    'token-expiry',
    'topic/auth-hardening',
    'STOP'
  ])
  const policy = llmPolicy(complete, { query: 'why are valid tokens rejected?' })
  const { claims, trace } = await reconstructAsync(store, policy, ['reject-valid-tokens'])
  assert.equal(prompts.length, 4, 'one completion per step, plus the STOP')
  assert.deepEqual(trace.map(step => step.cue.entity), ['reject-valid-tokens', 'token-expiry', 'topic/auth-hardening'])
  const raws = claims.map(claim => claim.raw)
  assert.ok(raws.some(raw => raw.includes('token-expiry CAUSE reject-valid-tokens')))
  assert.ok(raws.some(raw => raw.includes('topic/auth-hardening CONTAINS auth/middleware')))
  assert.ok(!raws.some(raw => raw.includes('unrelated/service')))
  assert.match(prompts[1]!, /token-expiry CAUSE reject-valid-tokens/, 'later prompts carry what was collected')
})

test('llmPolicy budgets stop without spending a completion', async () => {
  const store = memoryStoreOfText(knowledge)
  const { complete, prompts } = scripted(['reject-valid-tokens'])
  const { trace } = await reconstructAsync(store, llmPolicy(complete, { maxSteps: 1 }), ['reject-valid-tokens'])
  assert.equal(trace.length, 1)
  assert.equal(prompts.length, 1, 'the budget check costs nothing')
})

test('llmPolicy propagates agent failures instead of treating them as stop', async () => {
  const store = memoryStoreOfText(knowledge)
  const failing = llmPolicy(async () => {
    throw new Error('rate limited')
  })
  await assert.rejects(
    reconstructAsync(store, failing, ['reject-valid-tokens']),
    /rate limited/
  )
})

test('shellComplete pipes the prompt to stdin and returns stdout', async () => {
  const complete = shellComplete(
    `node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>process.stdout.write('len:'+d.length))"`
  )
  assert.equal(await complete('hello'), 'len:5')
})

test('shellComplete substitutes {prompt-file}', async () => {
  const complete = shellComplete(
    `node -e "process.stdout.write(require('fs').readFileSync(process.argv[1],'utf8'))" {prompt-file}`
  )
  assert.equal(await complete('from the file'), 'from the file')
})

test('shellComplete shell-quotes {prompt-file} — a temp dir with spaces still works', async () => {
  // The prompt file lands under os.tmpdir(); with TMPDIR containing a
  // space the unquoted substitution would split into two arguments.
  const base = mkdtempSync(join(tmpdir(), 'cave loop '))
  const saved = process.env.TMPDIR
  process.env.TMPDIR = base
  try {
    const complete = shellComplete(
      `node -e "process.stdout.write(require('fs').readFileSync(process.argv[1],'utf8'))" {prompt-file}`
    )
    assert.equal(await complete('from the file'), 'from the file')
  } finally {
    if (saved === undefined) {
      delete process.env.TMPDIR
    } else {
      process.env.TMPDIR = saved
    }
    rmSync(base, { recursive: true, force: true })
  }
})

test('shellComplete rejects on non-zero exit and on timeout', async () => {
  await assert.rejects(shellComplete('node -e "process.exit(3)"')('x'), /exited with 3/)
  await assert.rejects(
    shellComplete('node -e "setTimeout(()=>{},60000)"', { timeoutSeconds: 0.5 })('x'),
    /killed by SIG/
  )
})

test('llmPolicy over shellComplete: a subprocess agent drives the loop end to end', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'cave-loop-agent-'))
  try {
    // The agent picks the strongest offered cue — the prompt lists them
    // strongest first — so it reconstructs exactly what the heuristic does.
    const script = join(dir, 'agent.js')
    writeFileSync(script, [
      `let d = ''`,
      `process.stdin.on('data', c => d += c).on('end', () => {`,
      `  const lines = d.split('\\n')`,
      `  const at = lines.findIndex(line => line.startsWith('Frontier cues'))`,
      `  const first = (lines[at + 1] ?? '').split(' @ ')[0]`,
      `  process.stdout.write(first === '' ? 'STOP' : first)`,
      `})`
    ].join('\n'))
    const store = memoryStoreOfText(knowledge)
    const policy = llmPolicy(shellComplete(`node ${script}`), { maxSteps: 4 })
    const { claims, trace } = await reconstructAsync(store, policy, ['reject-valid-tokens'])
    const baseline = reconstruct(store, heuristicPolicy({ maxSteps: 4 }), ['reject-valid-tokens'])
    assert.deepEqual(trace.map(step => step.cue.entity), baseline.trace.map(step => step.cue.entity))
    assert.deepEqual(claims.map(claim => claim.raw), baseline.claims.map(claim => claim.raw))
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
