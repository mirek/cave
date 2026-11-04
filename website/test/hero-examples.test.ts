import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { heroExamples, type HeroRun } from '../src/hero-examples.ts'

// The homepage shows these outputs as real results, so replay each one
// through the workspace CLI, MCP server or solver fixture against a fresh store.
const cli = fileURLToPath(new URL('../../packages/cli/src/main.ts', import.meta.url))
const solverWorkflow = fileURLToPath(new URL('../../packages/solver-z3/src/workflow-main.ts', import.meta.url))
const env = { ...process.env, NODE_NO_WARNINGS: '1', CAVE_DB: '' }

/** stdout of a node entrypoint; nonzero exits are fine (cave check reports violations with 1). */
const run = (cwd: string, entry: string, args: readonly string[], input?: string): string => {
  const result = spawnSync(process.execPath, [entry, ...args], { cwd, env, input, encoding: 'utf8' })
  if (result.error !== undefined) throw result.error
  assert.ok(result.status === 0 || result.status === 1, `${args.join(' ')} exited ${result.status}: ${result.stderr}`)
  return result.stdout
}

const lines = (text: string): string[] => text.trimEnd().split('\n')

const callTool = (cwd: string, tool: string, args: Readonly<Record<string, string>>): string => {
  const requests = [
    { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'hero-examples', version: '0' } } },
    { jsonrpc: '2.0', method: 'notifications/initialized' },
    { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: tool, arguments: args } },
  ]
  const stdout = run(cwd, cli, ['mcp', '--db', 'hero.db'], `${requests.map(request => JSON.stringify(request)).join('\n')}\n`)
  const reply = lines(stdout).map(line => JSON.parse(line) as { id?: number, result?: { content: { text: string }[] } }).find(message => message.id === 2)
  assert.ok(reply?.result, `no ${tool} result in ${stdout}`)
  return reply.result.content.map(part => part.text).join('\n')
}

type Point = { value: { value: string }, report: { explanation: { run: { inputs: { id: string, evidenceRowIds: string[] }[] } } } }

/**
 * Contiguous ranges of the swept variable that share one optimal architecture.
 * With `--db`, every point must cite the store row its team size came from.
 */
const summarizeSensitivity = (stdout: string, args: readonly string[]): string[] => {
  const report = JSON.parse(stdout) as { points: Point[] }
  if (args.includes('--db')) {
    for (const point of report.points) {
      const input = point.report.explanation.run.inputs.find(candidate => candidate.id === 'team-size')
      assert.equal(input?.evidenceRowIds.length, 1, 'the team size is bound from one stored claim')
    }
  }
  const architectureOf = (point: Point): string => {
    let found: string | undefined
    const visit = (value: unknown): void => {
      if (found !== undefined || value === null || typeof value !== 'object') return
      const record = value as Record<string, unknown>
      if (record.id === 'architecture' && typeof record.value === 'object' && record.value !== null) {
        found = String((record.value as { value: unknown }).value)
        return
      }
      for (const child of Object.values(record)) visit(child)
    }
    visit(point.report)
    assert.ok(found, 'every sensitivity point has an architecture assignment')
    return found
  }
  const ranges: { from: string, to: string, architecture: string }[] = []
  for (const point of report.points) {
    const architecture = architectureOf(point)
    const last = ranges.at(-1)
    if (last?.architecture === architecture) last.to = point.value.value
    else ranges.push({ from: point.value.value, to: point.value.value, architecture })
  }
  return ranges.map(({ from, to, architecture }) => `deploys ${from === to ? from : `${from}–${to}`} → ${architecture}`)
}

const actual = (dir: string, step: HeroRun): string[] => {
  switch (step.kind) {
    case 'query': return lines(run(dir, cli, ['query', '--db', 'hero.db', step.pattern, ...(step.flags ?? [])]))
    case 'cave': return lines(run(dir, cli, [step.args[0]!, '--db', 'hero.db', ...step.args.slice(1)]))
    case 'mcp': return lines(callTool(dir, step.tool, step.arguments))
    case 'solver-sensitivity': return summarizeSensitivity(run(dir, solverWorkflow, step.args), step.args)
  }
}

/** Shown lines appear in order; a shown line ending in ' …' matches a real line by prefix. */
const assertExcerpt = (real: readonly string[], shown: readonly string[], label: string) => {
  let at = 0
  for (const line of shown) {
    const matches = (candidate: string) => line.endsWith(' …') ? candidate.startsWith(line.slice(0, -2)) : candidate === line
    while (at < real.length && !matches(real[at]!)) at++
    assert.ok(at < real.length, `${label}: "${line}" not found in order in:\n${real.join('\n')}`)
    at++
  }
}

for (const example of heroExamples) {
  test(`homepage example "${example.key}" shows real output`, () => {
    const dir = mkdtempSync(join(tmpdir(), 'cave-hero-'))
    try {
      const load = example.load ?? 'add'
      if (load !== 'none') {
        writeFileSync(join(dir, 'hero.cave'), `${example.code}\n`)
        execFileSync(process.execPath, [cli, load, '--db', 'hero.db', 'hero.cave'], { cwd: dir, env, encoding: 'utf8' })
      }
      for (const step of example.runs) {
        const real = actual(dir, step)
        const label = `${example.key} ${step.kind}`
        if ('excerpt' in step && step.excerpt) assertExcerpt(real, step.output, label)
        else assert.deepEqual(real, step.output, label)
      }
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
}

test('homepage examples have unique keys and fit the console', () => {
  assert.equal(new Set(heroExamples.map(example => example.key)).size, heroExamples.length)
  assert.equal(heroExamples.length % 6, 0, 'tabs fill whole rows of six')
  for (const example of heroExamples) {
    assert.ok(example.code.split('\n').length <= 9, `${example.key} has at most nine lines`)
    assert.ok(example.runs.length > 0)
  }
})
