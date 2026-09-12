/** Consecutive Fibonacci fractions exercise long Euclidean normalization paths. */
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'

const source = new URL('../packages/solver/src/index.ts', import.meta.url).href
const measurements = []
for (const index of [5_000, 25_000, 50_000, 200_000]) for (const operation of ['normalize', 'validate']) {
  const script = `
    import assert from 'node:assert/strict';
    import { Adapter, Exact, Model, Validate } from ${JSON.stringify(source)};
    const fib = n => {
      if (n === 0) return [0n, 1n];
      const [a, b] = fib(Math.floor(n / 2));
      const c = a * (2n * b - a), d = a * a + b * b;
      return n % 2 === 0 ? [c, d] : [d, c + d];
    };
    const [a, b] = fib(${index});
    const value = { numerator: String(a), denominator: String(b) };
    const numericDigits = value.numerator.length + value.denominator.length;
    assert.ok(numericDigits <= Adapter.defaultLimits.maxNumericDigits);
    const model = { schema: Model.schema, variables: [], constraints: [],
      objectives: [{ id: 'constant', direction: 'minimize', expression: { kind: 'literal', sort: 'real', value } }] };
    const samples = [];
    console.log(JSON.stringify({ event: 'fixture', numericDigits, numeratorDigits: value.numerator.length, denominatorDigits: value.denominator.length }));
    for (let sample = 0; sample < 3; sample++) {
      const start = performance.now();
      const result = ${JSON.stringify(operation)} === 'normalize' ? Exact.rational(value) : Validate.model(model);
      samples.push(performance.now() - start);
      if (${JSON.stringify(operation)} === 'normalize') assert.deepEqual(result, value);
      else assert.equal(result.variables, 0);
      console.log(JSON.stringify({ event: 'sample', ms: samples.at(-1) }));
    }
    samples.sort((a, b) => a - b);
    console.log(JSON.stringify({ index: ${index}, operation: ${JSON.stringify(operation)}, numericDigits,
      numeratorDigits: value.numerator.length, denominatorDigits: value.denominator.length,
      medianMs: samples[1], samplesMs: samples, rssBytes: process.memoryUsage().rss }));
  `
  const child = spawnSync(process.execPath, ['--max-old-space-size=128', '--input-type=module', '-e', script],
    { encoding: 'utf8', timeout: 10_000, maxBuffer: 1024 * 1024 })
  const rows = child.stdout.trim().split('\n').filter(Boolean).map(line => JSON.parse(line))
  if (child.error?.code === 'ETIMEDOUT') {
    const fixture = rows.find(row => row.event === 'fixture')
    assert.ok(fixture, 'fixture construction must finish before a timing timeout is reported')
    const samplesMs = rows.filter(row => row.event === 'sample').map(row => row.ms)
    measurements.push({ index, operation, status: 'timeout', numericDigits: fixture.numericDigits,
      numeratorDigits: fixture.numeratorDigits, denominatorDigits: fixture.denominatorDigits,
      samplesMs, completedSamples: samplesMs.length, childTimeoutMs: 10_000 })
    continue
  }
  if (child.error || child.status !== 0) throw new Error(`${operation}/${index} failed: ${child.error?.message ?? child.stderr}`, { cause: child.error })
  const measured = rows.at(-1)
  assert.equal(measured.index, index)
  assert.equal(measured.operation, operation)
  assert.ok(Number.isFinite(measured.medianMs) && measured.medianMs >= 0)
  measurements.push({ ...measured, status: 'complete' })
}
console.log(JSON.stringify({ format: 'cave.exact-gcd-benchmark', version: 1,
  runtime: { node: process.version, platform: process.platform, arch: process.arch },
  childTimeoutMs: 10_000, childOldSpaceMb: 128, measurements }))
