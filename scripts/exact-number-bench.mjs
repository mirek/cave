/** Isolated measurements of exact decimal expansion, excluding process startup. */
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'

const source = new URL('../packages/solver/src/index.ts', import.meta.url).href
const measurements = []
for (const exponent of [1_000, 10_000, 100_000, 1_000_000]) {
  const script = `
    import assert from 'node:assert/strict';
    import { Exact } from ${JSON.stringify(source)};
    const input = '1e-' + ${exponent};
    const start = performance.now();
    const result = Exact.rational(input);
    const ms = performance.now() - start;
    const rssBytes = process.memoryUsage().rss;
    assert.equal(result.numerator, '1');
    assert.equal(result.denominator.length, ${exponent} + 1);
    assert.match(result.denominator, /^10+$/);
    console.log(JSON.stringify({ exponent: ${exponent}, inputBytes: input.length,
      denominatorDigits: result.denominator.length, ms, rssBytes }));
  `
  const child = spawnSync(process.execPath,
    ['--max-old-space-size=128', '--input-type=module', '-e', script],
    { encoding: 'utf8', timeout: 10_000, maxBuffer: 1024 * 1024 })
  if (child.error || child.status !== 0) {
    throw new Error(`exact expansion ${exponent} failed: ${child.error?.message ?? child.stderr}`, { cause: child.error })
  }
  const result = JSON.parse(child.stdout)
  assert.equal(result.exponent, exponent)
  assert.ok(Number.isFinite(result.ms) && result.ms >= 0)
  measurements.push(result)
}
console.log(JSON.stringify({ format: 'cave.exact-expansion-report', version: 1,
  runtime: { node: process.version, platform: process.platform, arch: process.arch },
  childTimeoutMs: 10_000, childOldSpaceMb: 128, measurements }))
