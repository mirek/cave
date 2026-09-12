import { test } from 'node:test'
import * as assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  ProcessFailure, heuristicPolicy, llmPolicy, memoryStoreOfText, parseSelection, reconstruct, reconstructAsync,
  selectPrompt, shellComplete
} from '@cavelang/loop'
import type { AsyncPolicy, Cue, Policy, State } from '@cavelang/loop'
import { knowledge } from '../src/demo.ts'

const asyncOf = (policy: Policy): AsyncPolicy => ({
  select: async state => policy.select(state),
  score: async (edge, from) => policy.score(edge, from),
  done: async state => policy.done(state)
})

test('retained policy states preserve the claims collected at their step', async () => {
  for (const asynchronous of [false, true]) {
    const states: State[] = []
    const base = heuristicPolicy()
    const policy: Policy = { ...base, done(state) { states.push(state); return base.done(state) } }
    const store = memoryStoreOfText('a CAUSE b\nb CAUSE c')
    const result = asynchronous ? await reconstructAsync(store, asyncOf(policy), ['a']) :
      reconstruct(store, policy, ['a'])
    assert.equal(result.claims.length, 2)
    assert.deepEqual(states.map(state => [state.steps, state.collected.length]), [[0, 0], [1, 1], [2, 2], [3, 2]])
    assert.deepEqual(states[1]!.collected.map(claim => claim.raw), ['a CAUSE b'])
    assert.deepEqual(result.state.collected, result.claims)
  }
})

test('built-in policies reject nonfinite or negative scoring settings', () => {
  for (const decay of [NaN, Infinity, -Infinity, -0.1]) {
    assert.throws(() => heuristicPolicy({ decay }), /decay must be a finite nonnegative number/)
    assert.throws(() => llmPolicy(async () => assert.fail('must not call model'), { decay }),
      /decay must be a finite nonnegative number/)
  }
  for (const minScore of [NaN, Infinity, -Infinity, -0.1]) {
    assert.throws(() => heuristicPolicy({ minScore }), /minScore must be a finite nonnegative number/)
  }
  const store = memoryStoreOfText('a CAUSE b')
  assert.equal(reconstruct(store, heuristicPolicy({ decay: 0 }), ['a']).trace.length, 1)
  assert.equal(reconstruct(store, heuristicPolicy({ minScore: 2 }), ['a']).trace.length, 0)
  assert.equal(reconstruct(store, heuristicPolicy({ decay: 2 }), ['a']).trace[1]!.cue.score, 2)
})

test('built-in policies reject invalid budgets before reconstruction', async () => {
  let calls = 0
  const complete = async () => { calls++; return 'STOP' }
  for (const create of [heuristicPolicy, (options: Parameters<typeof heuristicPolicy>[0]) => llmPolicy(complete, options)]) {
    for (const field of ['maxSteps', 'maxClaims']) {
      for (const value of [NaN, -Infinity, -1, 0.5, Number.MAX_SAFE_INTEGER + 1]) {
        assert.throws(() => create({ [field]: value }), new RegExp(`${field} must be`))
      }
    }
    assert.throws(() => create({ maxSteps: Infinity }), /maxSteps must be/)
  }
  const store = memoryStoreOfText('api IS service')
  for (const options of [{ maxSteps: 0 }, { maxClaims: 0 }]) {
    assert.equal(reconstruct(store, heuristicPolicy(options), ['api']).trace.length, 0)
    assert.equal((await reconstructAsync(store, llmPolicy(complete, options), ['api'])).trace.length, 0)
  }
  assert.equal(calls, 0)
  assert.equal(reconstruct(store, heuristicPolicy({ maxClaims: Infinity }), ['api']).trace.length, 2)
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

test('reconstruction deduplicates seeds before policies see the frontier', async () => {
  const seeds = ['a', 'a', 'b', 'a', 'b']
  const store = memoryStoreOfText('a CAUSE b')
  const initial = reconstruct(store, heuristicPolicy({ maxSteps: 0 }), seeds)
  assert.deepEqual(initial.state.frontier.map(cue => cue.entity), ['a', 'b'])
  const prompts: string[] = []
  await reconstructAsync(store, llmPolicy(async prompt => {
    prompts.push(prompt)
    return 'STOP'
  }, { maxCues: 2 }), seeds)
  assert.equal(prompts.length, 1)
  assert.equal(prompts[0]!.split('a @ 1.00').length - 1, 1)
  assert.match(prompts[0]!, /b @ 1\.00/)
  assert.deepEqual(seeds, ['a', 'a', 'b', 'a', 'b'])
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

test('prompt cue limits reject invalid values before model work', () => {
  for (const maxCues of [0, -1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(() => selectPrompt(stateOf([]), { maxCues }), /maxCues must be a positive safe integer/)
    assert.throws(() => llmPolicy(async () => assert.fail('must not call model'), { maxCues }),
      /maxCues must be a positive safe integer/)
  }
  assert.match(selectPrompt(stateOf([cue('available')]), { maxCues: Number.MAX_SAFE_INTEGER }), /available @ 1\.00/)
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

test('parseSelection: Unicode word continuations do not create entity mentions', () => {
  const frontier = [cue('api', 0.1), cue('fallback', 1)]
  for (const adjacent of ['é', '界', '𐐀', '١', '\u0301']) {
    for (const reply of [`Choose ${adjacent}api next`, `Choose api${adjacent} next`]) {
      assert.equal(parseSelection(reply, frontier)?.entity, 'fallback', reply)
    }
  }
  assert.equal(parseSelection('Choose (api) next', frontier)?.entity, 'api')
  assert.equal(parseSelection('Choose 😀api😀 next', frontier)?.entity, 'api')
  assert.equal(parseSelection('Choose 服务 next', [cue('服务', 0.1), cue('fallback', 1)])?.entity, '服务')
})

test('parseSelection: STOP inside a Unicode word or entity path does not stop', () => {
  const frontier = [cue('fallback')]
  for (const adjacent of ['é', '界', '𐐀', '١', '\u0301', '/', '-']) {
    for (const reply of [`STOP${adjacent}`, `${adjacent}STOP`, `Choose ${adjacent}STOP${adjacent} next`]) {
      assert.equal(parseSelection(reply, frontier)?.entity, 'fallback', reply)
    }
  }
  assert.equal(parseSelection('STOP — enough evidence', frontier), undefined)
  assert.equal(parseSelection('We should stop.', frontier), undefined)
})

test('parseSelection: dots and colons within names are not mention boundaries', () => {
  const frontier = [cue('api', 0.1), cue('target', 1)]
  for (const separator of ['.', ':', '::', '..']) {
    for (const name of [`api${separator}child`, `parent${separator}api`]) {
      assert.equal(parseSelection(`${name} is unrelated; target is next`, frontier)?.entity, 'target', name)
    }
    for (const name of [`STOP${separator}child`, `parent${separator}stop`]) {
      assert.equal(parseSelection(`${name} is unrelated; target is next`, frontier)?.entity, 'target', name)
      assert.equal(parseSelection(`Ignore ${name} here`, frontier)?.entity, 'target', name)
    }
  }
  for (const reply of ['Choose api. It is next.', 'Choose api: it is next.']) {
    assert.equal(parseSelection(reply, frontier)?.entity, 'api', reply)
  }
  for (const reply of ['STOP.', 'stop: enough evidence', 'We can STOP.']) {
    assert.equal(parseSelection(reply, frontier), undefined, reply)
  }
  const dotted = [cue('api', 1), cue('api.example', 0.1)]
  assert.equal(parseSelection('Choose api.example next', dotted)?.entity, 'api.example')
  assert.equal(parseSelection('STOP.example', [cue('STOP.example')])?.entity, 'STOP.example')
})

test('parseSelection: empty cue names cannot stall mention scanning', () => {
  const script = `
    import assert from 'node:assert/strict'
    import { parseSelection } from ${JSON.stringify(new URL('../src/index.ts', import.meta.url).href)}
    const empty = { entity: '', score: 0.1, depth: 0 }
    const strongest = { entity: 'api', score: 1, depth: 0 }
    const frontier = [empty, strongest]
    assert.equal(parseSelection('unknown', frontier), strongest)
    assert.equal(parseSelection('unknown  answer', frontier), strongest)
    assert.equal(parseSelection('', frontier), empty)
    assert.equal(parseSelection('STOP', frontier), undefined)
  `
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', script], {
    encoding: 'utf8', timeout: 5000
  })
  assert.equal(result.error, undefined, 'selection must finish within the subprocess deadline')
  assert.equal(result.status, 0, result.stderr)
})

test('parseSelection: unparseable replies degrade to the strongest cue; empty frontier stops', () => {
  const frontier = [cue('b', 0.4), cue('a', 0.9)]
  assert.equal(parseSelection('no idea what to do', frontier)?.entity, 'a')
  assert.equal(parseSelection('anything', []), undefined)
})

test('llmPolicy retains prompt settings across awaited completions', async () => {
  const store = memoryStoreOfText('a CAUSE b\na CAUSE c')
  const options = { query: 'original question', instructions: 'original guidance', maxCues: 1 }
  const prompts: string[] = []
  const policy = llmPolicy(async prompt => {
    prompts.push(prompt)
    await Promise.resolve()
    options.query = 'replacement question'
    options.instructions = 'replacement guidance'
    options.maxCues = 2
    return prompts.length === 1 ? 'a' : 'STOP'
  }, options)
  await reconstructAsync(store, policy, ['a'])
  assert.equal(prompts.length, 2)
  for (const prompt of prompts) {
    assert.match(prompt, /Query: original question/)
    assert.match(prompt, /original guidance/)
    assert.doesNotMatch(prompt, /replacement/)
  }
  assert.match(prompts[1]!, /b @ 0\.80/)
  assert.doesNotMatch(prompts[1]!, /c @ 0\.80/)
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

test('shellComplete rejects malformed stdout before structured consumers see it', async () => {
  await assert.rejects(
    shellComplete('node -e "process.stdout.write(Buffer.from([91,49,93,10,255]))"')('select a claim'),
    error => error instanceof ProcessFailure && error.kind === 'stdout-encoding'
  )
  const reply = '�café 😀'
  const complete = shellComplete(`node -e "process.stdout.write(Buffer.from([${[...Buffer.from(reply)].join(',')}]))"`)
  assert.equal(await complete('retry'), reply)
})

test('shellComplete rejects malformed prompt Unicode instead of changing agent input', async () => {
  for (const suffix of ['', ' {prompt-file}']) {
    const complete = shellComplete('node -e "process.stdin.pipe(process.stdout)"' + suffix)
    for (const surrogate of ['\ud800', '\udc00']) {
      await assert.rejects(complete('claim ' + surrogate), /agent prompt must contain well-formed Unicode/)
    }
    assert.equal(await complete('�café 😀'), '�café 😀')
  }
})

test('shellComplete accepts fractional seconds that resolve to whole milliseconds', async () => {
  const complete = shellComplete('node -e "process.stdout.write(\'ok\')"', { timeoutSeconds: 1.001 })
  assert.equal(await complete('prompt'), 'ok')
})

test('shellComplete validates its timeout before returning an adapter', () => {
  for (const timeoutSeconds of [NaN, Infinity, -Infinity, -1, 0.0001, 1.0001, 2147483.648]) {
    assert.throws(() => shellComplete('node {prompt-file}', { timeoutSeconds }), /timeoutSeconds must resolve to whole milliseconds/)
  }
  for (const timeoutSeconds of [0, 0.001, 1.001, 2147483.647]) {
    assert.equal(typeof shellComplete('node {prompt-file}', { timeoutSeconds }), 'function')
  }
})

test('shellComplete retains captured output limits across calls', async () => {
  let reads = 0
  const complete = shellComplete('node -e "process.stdout.write(\'abc\')"', {
    get maxStdoutBytes() { return ++reads === 1 ? 1 : 1024 }
  })
  for (let attempt = 0; attempt < 2; attempt++) {
    await assert.rejects(complete('prompt'), error => error instanceof ProcessFailure && error.kind === 'stdout-limit')
  }
  assert.equal(reads, 1)
  assert.equal(await shellComplete('node -e "process.stdout.write(\'abc\')"', { maxStdoutBytes: 1024 })('prompt'), 'abc')
})

test('shellComplete retains its cancellation signal when caller settings change', async () => {
  const controller = new AbortController()
  const options: { signal?: AbortSignal } = { signal: controller.signal }
  const complete = shellComplete('node -e "process.stdout.write(\'must not run\')"', options)
  options.signal = undefined
  const reason = new Error('cancel captured completion')
  controller.abort(reason)
  await assert.rejects(complete('prompt'), error => error === reason)
})

test('shellComplete pipes the prompt to stdin and returns stdout', async () => {
  const complete = shellComplete(
    `node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>process.stdout.write('len:'+d.length))"`
  )
  assert.equal(await complete('hello'), 'len:5')
})

test('shellComplete skips cancelled prompt writes and cleans failed writes', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cave-loop-write-failure-'))
  try {
    const script = `
      import fs from 'node:fs'
      import { syncBuiltinESMExports } from 'node:module'
      import assert from 'node:assert/strict'
      const original = fs.writeFileSync
      const failure = new Error('controlled prompt write failure')
      fs.writeFileSync = () => { throw failure }
      syncBuiltinESMExports()
      const { shellComplete } = await import(${JSON.stringify(new URL('../src/index.ts', import.meta.url).href)})
      const reason = new Error('cancel before writing prompt')
      await assert.rejects(shellComplete('node {prompt-file}', { signal: AbortSignal.abort(reason) })('prompt'), error => error === reason)
      await assert.rejects(shellComplete('node {prompt-file}')('prompt'), error => error === failure)
      fs.writeFileSync = original
      syncBuiltinESMExports()
      const complete = shellComplete(${JSON.stringify(`node -e "process.stdout.write(require('fs').readFileSync(process.argv[1],'utf8'))" {prompt-file}`)})
      assert.equal(await complete('recovered'), 'recovered')
    `
    const result = spawnSync(process.execPath, ['--disable-warning=ExperimentalWarning', '--input-type=module', '-e', script], {
      encoding: 'utf8', timeout: 5000, env: { ...process.env, TMPDIR: dir, TMP: dir, TEMP: dir }
    })
    assert.equal(result.status, 0, result.stderr)
    assert.deepEqual(readdirSync(dir), [])
  } finally { rmSync(dir, { recursive: true, force: true }) }
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
    (error: unknown) => error instanceof ProcessFailure && error.kind === 'timeout'
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

test('llmPolicy selects from the frontier captured before an awaited completion', async () => {
  for (const reply of ['original', 'unparseable answer']) {
    const frontier = [{ entity: 'original', score: 1, depth: 0 }, { entity: 'other', score: 0.5, depth: 1 }]
    const policy = llmPolicy(async prompt => {
      assert.match(prompt, /original @ 1\.00/)
      await Promise.resolve()
      frontier[0]!.entity = 'replacement'
      frontier[0]!.score = 0.1
      frontier[0]!.depth = 9
      frontier.splice(0, frontier.length, { entity: 'injected', score: 10, depth: 8 })
      return reply
    })
    assert.deepEqual(await policy.select(stateOf(frontier)), { entity: 'original', score: 1, depth: 0 })
  }
})

test('built-in reconstruction policies reject score overflow and allow a later bounded run', async () => {
  const store = memoryStoreOfText('a REL b\nb REL c')
  const options = { decay: Number.MAX_VALUE, minScore: 0, maxSteps: 4 }
  assert.throws(() => reconstruct(store, heuristicPolicy(options), ['a']), /reconstruction score must be finite/)
  await assert.rejects(reconstructAsync(store, llmPolicy(async () => '', options), ['a']), /reconstruction score must be finite/)
  const result = reconstruct(store, heuristicPolicy({ decay: 0.5, minScore: 0, maxSteps: 4 }), ['a'])
  assert.ok(result.trace.length > 1)
  assert.ok(result.trace.every(step => Number.isFinite(step.cue.score)))
})

test('claim thresholds preserve a complete expansion and stop before another completion', async () => {
  const store = memoryStoreOfText('root IS service\nroot HAS owner: team\nroot REL next\nnext IS evidence')
  const expected = store.claimsAbout('root')
  assert.equal(expected.length, 3)
  const options = { maxClaims: 1, maxSteps: 10, minScore: 0 }
  let completions = 0
  const sync = reconstruct(store, heuristicPolicy(options), ['root'])
  const asyncResult = await reconstructAsync(store, llmPolicy(async () => { completions++; return 'root' }, options), ['root'])
  for (const result of [sync, asyncResult]) {
    assert.deepEqual(result.claims, expected)
    assert.equal(result.trace.length, 1)
    assert.equal(result.trace[0]!.collected, 3)
    assert.deepEqual([...result.state.visited], ['root'])
    assert.ok(result.state.frontier.some(cue => cue.entity === 'next'))
  }
  assert.equal(completions, 1)
})

test('selection prompts preserve small and distinct scores without false zeroes or ties', () => {
  const frontier = [cue('zero', 0), cue('tiny', Number.MIN_VALUE), cue('lower', 0.003),
    cue('low', 0.004), cue('almost', 0.99999), cue('unit', 1), cue('ordinary', 0.8)]
  const prompt = selectPrompt(stateOf(frontier))
  const expected = ['unit @ 1.00', 'almost @ 0.99999', 'ordinary @ 0.80',
    'low @ 0.004', 'lower @ 0.003', 'tiny @ 5e-324', 'zero @ 0.00']
  const lines = prompt.split('\n').filter(line => frontier.some(item => line.startsWith(item.entity + ' @ ')))
  assert.deepEqual(lines, expected)
})

for (const field of ['query', 'instructions'] as const) {
  for (const later of ['replacement', undefined]) {
    test(`direct selection prompts capture ${field} once before rendering (${later})`, () => {
      const state = stateOf([cue('root')])
      const initial = { query: 'original question', instructions: 'original guidance', maxCues: 1 }
      let reads = 0
      const options = { ...initial, get [field]() { return ++reads === 1 ? initial[field] : later } }
      assert.equal(selectPrompt(state, options), selectPrompt(state, initial))
      assert.equal(reads, 1)
      assert.equal(selectPrompt(state, options), selectPrompt(state, { ...initial, [field]: later }))
      assert.equal(reads, 2)
    })
  }
}

test('selection reply cleanup preserves numeric and punctuation prefixes in cue names', () => {
  for (const name of ['123api', '-api', '.api', '1.api']) {
    const frontier = [cue('api', 1), cue(name, 0.1)]
    assert.equal(parseSelection(name + '.', frontier)?.entity, name)
    assert.equal(parseSelection('1. ' + name, frontier)?.entity, name)
    assert.equal(parseSelection('- ' + name, frontier)?.entity, name)
  }
})

test('selection replies preserve literal cue suffixes before removing sentence punctuation', () => {
  for (const name of ['api.', 'api:', 'api!', 'api;']) {
    const frontier = [cue('api', 1), cue(name, 0.1)]
    for (const reply of ['- ' + name, '1. ' + name, '- "' + name + '"', '- ' + name + '.']) {
      assert.equal(parseSelection(reply, frontier)?.entity, name, reply)
    }
  }
})
