/** Reproduce bounded-probe tradeoffs in isolated source copies; run alone. */
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { cpSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'

const { values } = parseArgs({ options: { rounds: { type: 'string', default: '6' } } })
const rounds = Number(values.rounds)
assert.ok(Number.isSafeInteger(rounds) && rounds >= 1 && rounds <= 60, '--rounds must be an integer in 1..60')
const root = fileURLToPath(new URL('../', import.meta.url))
const sourceDirectory = join(root, 'packages/solver/src')
const digest = source => createHash('sha256').update(source).digest('hex')
const replaceOnce = (source, before, after) => {
  assert.equal(source.split(before).length, 2, `expected one source marker: ${before}`)
  return source.replace(before, after)
}
let focused = readFileSync(join(root, 'scripts/exact-sum-bench.mjs'), 'utf8')
focused = replaceOnce(focused, '[1_000, 10_000, 20_000]', '[20_000]')
focused = replaceOnce(focused, "['shared', 'delayed-shared', 'nearby', 'fibonacci']", "['delayed-shared', 'fibonacci']")
focused = replaceOnce(focused, "['linear', 'explain']", "['explain']")
const original = readFileSync(join(sourceDirectory, 'fraction-sum.ts'), 'utf8')
const markers = original.match(/step < \d+ && y !== 0n/g)
assert.equal(markers?.length, 1, 'expected one bounded denominator probe')
const steps = [4, 6, 8]
const orders = [[4, 6, 8], [6, 8, 4], [8, 4, 6], [8, 6, 4], [6, 4, 8], [4, 8, 6]]
const paths = ['scripts/fraction-sum-probe-bench.mjs', 'scripts/exact-sum-bench.mjs',
  ...readdirSync(sourceDirectory).filter(name => name.endsWith('.ts')).sort().map(name => `packages/solver/src/${name}`)]
const sources = Object.fromEntries(paths.map(path => [path, digest(readFileSync(join(root, path)))]))
const variants = {}, results = []
const scratch = mkdtempSync(join(tmpdir(), 'cave-sum-probe-'))
try {
  for (const count of steps) {
    const directory = join(scratch, String(count))
    mkdirSync(join(directory, 'packages/solver'), { recursive: true })
    mkdirSync(join(directory, 'scripts'))
    cpSync(sourceDirectory, join(directory, 'packages/solver/src'), { recursive: true })
    const changed = original.replace(markers[0], `step < ${count} && y !== 0n`)
    writeFileSync(join(directory, 'packages/solver/src/fraction-sum.ts'), changed)
    writeFileSync(join(directory, 'scripts/focused-sum.mjs'), focused)
    variants[count] = { helperSha256: digest(changed) }
  }
  for (let round = 0; round < rounds; round++) {
    for (const count of orders[round % orders.length]) {
      const child = spawnSync(process.execPath, [join(scratch, String(count), 'scripts/focused-sum.mjs')],
        { encoding: 'utf8', timeout: 60_000, maxBuffer: 2 ** 20 })
      assert.equal(child.error, undefined)
      assert.equal(child.status, 0, child.stderr)
      const report = JSON.parse(child.stdout)
      assert.equal(report.measurements.length, 4)
      for (const row of report.measurements) {
        assert.equal(row.digits, 20_000)
        assert.equal(row.operation, 'explain')
        assert.ok(['delayed-shared', 'fibonacci'].includes(row.family))
        assert.equal(row.samplesMs.length, 5)
        assert.equal(row.medianMs, [...row.samplesMs].sort((a, b) => a - b)[2])
      }
      results.push({ round, steps: count, report })
    }
  }
} finally { rmSync(scratch, { recursive: true, force: true }) }
console.log(JSON.stringify({ format: 'cave.fraction-sum-probe-comparison', version: 1,
  runtime: { node: process.version, platform: process.platform, arch: process.arch }, rounds, steps,
  method: 'All six variant orders rotate; six rounds balance order. Fresh child per workload, five retained timing calls and two untimed exact-value controls. Shortened runs are smoke checks, not stable timing evidence.',
  focusedHarnessSha256: digest(focused), sources, variants, results }, null, 2))
