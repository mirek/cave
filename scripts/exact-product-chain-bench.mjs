/** Isolated observations of product chains within the default numeric input budget. */
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'

const source = new URL('../packages/solver/src/index.ts', import.meta.url).href
const args = process.argv.slice(2)
if (args.length > 1 || (args.length === 1 && args[0] !== '--baseline')) {
  throw new Error('Usage: node scripts/exact-product-chain-bench.mjs [--baseline]')
}
const baseline = args[0] === '--baseline'
const baselineLoader = new URL('../benchmarks/linear-product-chain-baseline.mjs', import.meta.url).href
const childTimeoutMs = 10_000
const childOldSpaceMb = 128
const samplesPerWorkload = 5
const measurements = []
for (const digits of [1_000, 5_000]) {
  for (const factors of [2, 10, 18]) for (const operation of ['linear', 'explain']) {
    const config = { digits, factors, operation }
    const script = `
      import assert from 'node:assert/strict';
      import { Adapter, Explain, Linear, Model } from ${JSON.stringify(source)};
      const config = ${JSON.stringify(config)};
      const n = '1' + '0'.repeat(config.digits - 2) + '1';
      const literal = (numerator, denominator) => ({ kind: 'literal', sort: 'real', value: { numerator, denominator } });
      const product = { kind: 'multiply', operands: Array.from({ length: config.factors }, () => literal('1', n)) };
      const model = { schema: Model.schema, variables: [{ id: 'x', sort: 'real' }],
        constraints: [{ id: 'positive', expression: { kind: 'gte',
          left: { kind: 'divide', left: { kind: 'variable', id: 'x' }, right: product },
          right: { kind: 'literal', sort: 'real', value: '0' } } }] };
      const result = { status: 'satisfied', backend: { name: 'fixture', version: '1' },
        diagnostics: [], elapsedMs: 0, assignment: { x: { sort: 'real', numerator: '1', denominator: '1' } } };
      const samples = [];
      for (let index = 0; index < ${samplesPerWorkload}; index++) {
        const start = performance.now();
        const value = config.operation === 'linear' ? Linear.model(model) : Explain.report(model, result, Adapter.defaultLimits);
        samples.push(performance.now() - start);
        if (config.operation === 'linear') assert.deepEqual(value, { linear: true, problems: [] });
        else assert.equal(value.outcome.hardConstraints[0].evaluation, 'satisfied');
      }
      samples.sort((a, b) => a - b);
      console.log(JSON.stringify({ ...config, medianMs: samples[${Math.floor(samplesPerWorkload / 2)}], samplesMs: samples, rssBytes: process.memoryUsage().rss }));
    `
    const child = spawnSync(process.execPath, [`--max-old-space-size=${childOldSpaceMb}`,
      ...(baseline ? ['--import', baselineLoader] : []), '--input-type=module', '-e', script],
      { encoding: 'utf8', timeout: childTimeoutMs, maxBuffer: 1024 * 1024 })
    if (child.error || child.status !== 0) throw new Error(`${JSON.stringify(config)} failed: ${child.error?.message ?? child.stderr}`, { cause: child.error })
    const measured = JSON.parse(child.stdout)
    for (const [key, value] of Object.entries(config)) assert.equal(measured[key], value)
    assert.ok(Number.isFinite(measured.medianMs) && measured.medianMs >= 0)
    measurements.push(measured)
  }
}
console.log(JSON.stringify({ format: 'cave.exact-product-chain-benchmark', version: 1,
  variant: baseline ? 'baseline' : 'current',
  runtime: { node: process.version, platform: process.platform, arch: process.arch },
  childTimeoutMs, childOldSpaceMb,
  measurement: {
    samplesPerWorkload,
    workload: 'Products of separately allocated unit fractions with a common large denominator; 2, 10 or 18 factors, within default maxNumericDigits.',
    timing: 'complete linear-analysis or explanation call; excludes fixture construction and result assertions',
    rss: 'after workload and assertions; includes runtime and imports; not peak or incremental memory',
    memoryLimit: 'V8 old space only; not a total-process memory cap',
  },
  measurements }))
