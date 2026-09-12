/** Isolated full-operation observations for cancelling and coprime fractions. */
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'

const source = new URL('../packages/solver/src/index.ts', import.meta.url).href
const childTimeoutMs = 10_000
const childOldSpaceMb = 128
const samplesPerWorkload = 5
const measurements = []
for (const digits of [1_000, 10_000, 20_000]) for (const kind of ['multiply', 'divide']) {
  for (const cancellation of [true, false]) for (const operation of ['linear', 'explain']) {
    const config = { digits, kind, cancellation, operation }
    const script = `
      import assert from 'node:assert/strict';
      import { Adapter, Explain, Linear, Model } from ${JSON.stringify(source)};
      const config = ${JSON.stringify(config)};
      const n = '1' + '0'.repeat(config.digits - 2) + '1';
      const m = '1' + '0'.repeat(config.digits - 2) + '3';
      const literal = (numerator, denominator) => ({ kind: 'literal', sort: 'real', value: { numerator, denominator } });
      const left = config.cancellation ? literal(m, n) : literal('1', n);
      const right = config.cancellation
        ? config.kind === 'multiply' ? literal(n, m) : literal(m, n)
        : config.kind === 'multiply' ? literal('1', m) : literal(m, '1');
      const product = config.kind === 'multiply' ? { kind: 'multiply', operands: [left, right] }
        : { kind: 'divide', left, right };
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
      // Independently derived reciprocal: cancelled products are one; otherwise n*m.
      // Keep these stronger magnitude controls outside the historical timed workload.
      const expected = config.cancellation ? 1n : BigInt(n) * BigInt(m);
      for (const [offset, evaluation] of [[0n, 'satisfied'], [1n, 'violated']]) {
        const exactModel = { ...model, constraints: [{ id: 'exact', expression: {
          kind: 'eq', left: model.constraints[0].expression.left,
          right: { kind: 'literal', sort: 'int', value: String(expected + offset) }
        } }] };
        const checked = Explain.report(exactModel, result, Adapter.defaultLimits);
        assert.equal(checked.outcome.hardConstraints[0].evaluation, evaluation);
      }
      const ordered = [...samples].sort((a, b) => a - b);
      console.log(JSON.stringify({ ...config, medianMs: ordered[${Math.floor(samplesPerWorkload / 2)}], samplesMs: samples, rssBytes: process.memoryUsage().rss }));
    `
    const child = spawnSync(process.execPath, [`--max-old-space-size=${childOldSpaceMb}`, '--input-type=module', '-e', script],
      { encoding: 'utf8', timeout: childTimeoutMs, maxBuffer: 1024 * 1024 })
    if (child.error || child.status !== 0) throw new Error(`${JSON.stringify(config)} failed: ${child.error?.message ?? child.stderr}`, { cause: child.error })
    const measured = JSON.parse(child.stdout)
    for (const [key, value] of Object.entries(config)) assert.equal(measured[key], value)
    assert.ok(Number.isFinite(measured.medianMs) && measured.medianMs >= 0)
    measurements.push(measured)
  }
}
console.log(JSON.stringify({ format: 'cave.exact-product-benchmark', version: 2,
  runtime: { node: process.version, platform: process.platform, arch: process.arch },
  childTimeoutMs, childOldSpaceMb,
  measurement: {
    samplesPerWorkload,
    discardedWarmupSamples: 0,
    sampleOrder: 'execution order; median computed from a sorted copy',
    exactControlsPerWorkload: 2,
    exactControls: 'untimed analytic reciprocal equality and expected-plus-one inequality; default model and explanation limits',
    timing: 'complete linear-analysis or explanation call; excludes fixture construction and result assertions',
    rss: 'after workload and extra magnitude controls; includes runtime and imports; not peak or incremental memory',
    memoryLimit: 'V8 old space only; not a total-process memory cap',
  },
  measurements }))
