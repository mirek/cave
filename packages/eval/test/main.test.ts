import { test } from 'node:test'
import * as assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { meetsMin, render } from '@cavelang/eval'
import type { Report } from '@cavelang/eval'

const packageDir = resolve(dirname(fileURLToPath(import.meta.url)), '..')

const evalCli = (args: readonly string[]): { status: number | null, stdout: string, stderr: string } => {
  const result = spawnSync(
    process.execPath,
    ['--disable-warning=ExperimentalWarning', join(packageDir, 'test', 'bin.ts'), ...args],
    { encoding: 'utf8', cwd: packageDir }
  )
  return { status: result.status, stdout: result.stdout, stderr: result.stderr }
}

const withSuite = (body: (dir: string) => void): void => {
  const dir = mkdtempSync(join(tmpdir(), 'cave-eval-main-'))
  writeFileSync(join(dir, 'notes.md'), 'The api service exists and uses jwt.')
  writeFileSync(join(dir, 'notes.golden.cave'), 'api IS service\napi USES jwt')
  writeFileSync(join(dir, 'notes.queries.cave'), '?x USES jwt\n  ?x = api')
  try {
    body(dir)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

test('cave eval end to end: text report, exit 0, --min gating, --json', () =>
  withSuite(dir => {
    const args = [dir, '--stdout', '--agent', 'cat notes.golden.cave']
    const happy = evalCli(args)
    assert.equal(happy.status, 0, happy.stderr)
    assert.match(happy.stdout, /eval: 1 case\(s\), 1 run\(s\) each/)
    assert.match(happy.stdout, /2 golden claim\(s\), 1 query\(ies\), source notes\.md/)
    assert.match(happy.stdout, /run 1\/1: 2 claim\(s\) — 2 matched; P 100% R 100% F1 100%; queries 1\/1/)
    assert.match(happy.stdout, /suite: P 100% R 100% F1 100%; queries 100%/)

    const gated = evalCli([...args, '--min', '100%'])
    assert.equal(gated.status, 0)

    const json = evalCli([...args, '--json'])
    assert.equal(json.status, 0)
    const report = JSON.parse(json.stdout) as Report
    assert.equal(report.okRuns, 1)
    assert.equal(report.mean!.f1, 1)
  }))

test('cave eval exits 1 on failed runs, unmet --min, and fixture problems', () =>
  withSuite(dir => {
    const failing = evalCli([dir, '--stdout', '--agent', 'exit 7'])
    assert.equal(failing.status, 1)
    assert.match(failing.stdout, /FAILED — agent exited with 7/)

    const partial = evalCli([dir, '--stdout', '--agent', 'echo "api IS service"', '--min', '90%'])
    assert.equal(partial.status, 1)
    assert.match(partial.stdout, /miss: api USES jwt/)
    assert.match(partial.stderr, /below --min 90%/)

    writeFileSync(join(dir, 'orphan.golden.cave'), 'a IS b')
    const broken = evalCli([dir, '--stdout', '--agent', 'cat notes.golden.cave'])
    assert.equal(broken.status, 1)
    assert.match(broken.stdout, /fixture: .*orphan: no source file/)
    assert.match(broken.stdout, /1 fixture problem\(s\)/)

    writeFileSync(join(dir, 'orphan.md'), 'source')
    writeFileSync(join(dir, 'orphan.queries.cave'), 'ghost IS ?x\n  ?x = real')
    const skipped = evalCli([dir, '--stdout', '--agent', 'cat notes.golden.cave'])
    assert.equal(skipped.status, 1)
    assert.match(skipped.stdout, /orphan: fixture problem\(s\) — skipped/)
  }))

test('cave eval runs reconstruction cases without an agent — the heuristic baseline', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cave-eval-main-loop-'))
  try {
    writeFileSync(join(dir, 'incident.cave'), 'a CAUSE b\nc USES d')
    writeFileSync(join(dir, 'incident.golden.cave'), 'a CAUSE b')
    writeFileSync(join(dir, 'incident.loop.cave'), 'loop SEEDS b')
    const baseline = evalCli([dir])
    assert.equal(baseline.status, 0, baseline.stderr)
    assert.match(baseline.stdout, /1 golden claim\(s\), reconstruction over incident\.cave/)
    assert.match(baseline.stdout, /suite: P 100% R 100% F1 100%/)
    const json = JSON.parse(evalCli([dir, '--json']).stdout) as Report
    assert.equal(json.cases[0]!.kind, 'loop')
    assert.match(json.cases[0]!.runs[0]!.note!, /expanded \d+ cue\(s\): b/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('cave eval validates its arguments', () =>
  withSuite(dir => {
    assert.equal(evalCli(['--help']).status, 0)
    assert.match(evalCli(['--help']).stdout, /golden-fixture extraction, query and reconstruction evals/)
    const noSuite = evalCli(['--agent', 'cat'])
    assert.equal(noSuite.status, 1)
    assert.match(noSuite.stderr, /suite directories/)
    // --agent is optional (reconstruction cases run the heuristic baseline),
    // but an extraction case without one is a failed run.
    const noAgent = evalCli([dir])
    assert.equal(noAgent.status, 1)
    assert.match(noAgent.stdout, /FAILED — no agent configured/)
    assert.match(evalCli([dir, '--agent', 'cat', '--runs', '0']).stderr, /--runs/)
    assert.match(evalCli([dir, '--agent', 'cat', '--tolerance', '2']).stderr, /--tolerance/)
    assert.match(evalCli([dir, '--agent', 'cat', '--min', 'x']).stderr, /--min/)
    assert.match(evalCli([dir, '--agent', 'cat', '--timeout', '-1']).stderr, /--timeout/)
  }))

test('render and meetsMin cover judged scores and no-run reports', () => {
  const report: Report = {
    cases: [],
    runs: 1,
    okRuns: 0,
    failedRuns: 0,
    fixture: []
  }
  assert.match(render(report), /suite: no scored runs/)
  assert.equal(meetsMin(report, 0), false, 'no scored runs never clears a gate')

  const judged: Report = {
    ...report,
    okRuns: 1,
    mean: { precision: 0.6, recall: 0.6, f1: 0.6, judgedF1: 0.9, queryRate: 0.95 }
  }
  assert.equal(meetsMin(judged, 0.9), true, 'the judged F1 gates when a judge ran')
  assert.equal(meetsMin(judged, 0.96), false, 'the query rate gates too')
  assert.match(render(judged), /F1 60%, judged F1 90%; queries 95%/)
})
