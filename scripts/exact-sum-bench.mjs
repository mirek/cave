/** Isolated full-operation observations for shared and coprime denominators. */
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'

const source = new URL('../packages/solver/src/index.ts', import.meta.url).href
const measurements = []
for (const digits of [1_000, 10_000, 20_000]) for (const kind of ['add', 'subtract']) {
  for (const family of ['shared', 'delayed-shared', 'nearby', 'fibonacci']) for (const operation of ['linear', 'explain']) {
    const config = { digits, kind, family, operation }
    const script = `
      import assert from 'node:assert/strict';
      import { Adapter, Explain, Linear, Model } from ${JSON.stringify(source)};
      const config = ${JSON.stringify(config)};
      const n = BigInt('1' + '0'.repeat(config.digits - 2) + '1');
      const fib = index => {
        if (index === 0) return [0n, 1n];
        const [a, b] = fib(Math.floor(index / 2));
        const c = a * (2n * b - a), d = a * a + b * b;
        return index % 2 === 0 ? [c, d] : [d, c + d];
      };
      const [b, d] = config.family === 'shared' ? [3n * n, 5n * n]
        : config.family === 'delayed-shared' ? [13n * n, 21n * n]
        : config.family === 'nearby' ? [n, n + 2n] : fib(Math.floor(config.digits * 4.78));
      const literal = denominator => ({ kind: 'literal', sort: 'real', value: { numerator: '1', denominator: String(denominator) } });
      const left = literal(b), right = literal(d);
      const product = config.kind === 'add' ? { kind: 'add', operands: [left, right] }
        : { kind: 'subtract', left, right };
      const model = { schema: Model.schema, variables: [{ id: 'x', sort: 'real' }],
        constraints: [{ id: 'positive', expression: { kind: 'gte',
          left: { kind: 'divide', left: { kind: 'variable', id: 'x' }, right: product },
          right: { kind: 'literal', sort: 'real', value: '0' } } }] };
      const result = { status: 'satisfied', backend: { name: 'fixture', version: '1' },
        diagnostics: [], elapsedMs: 0, assignment: { x: { sort: 'real', numerator: '1', denominator: '1' } } };
      const samples = [];
      for (let index = 0; index < 5; index++) {
        const start = performance.now();
        const value = config.operation === 'linear' ? Linear.model(model) : Explain.report(model, result, Adapter.defaultLimits);
        samples.push(performance.now() - start);
        if (config.operation === 'linear') assert.deepEqual(value, { linear: true, problems: [] });
        else assert.equal(value.outcome.hardConstraints[0].evaluation, 'satisfied');
      }
      // Independently derive the reciprocal of 1/b +/- 1/d outside timing.
      let numerator = b * d, denominator = config.kind === 'add' ? b + d : d - b;
      let a = numerator, divisor = denominator;
      while (divisor !== 0n) [a, divisor] = [divisor, a % divisor];
      numerator /= a; denominator /= a;
      const exactModel = { ...model,
        variables: [...model.variables, { id: 'expected', sort: 'real' }],
        constraints: [{ id: 'exact', expression: { kind: 'eq',
          left: model.constraints[0].expression.left,
          right: { kind: 'variable', id: 'expected' }
        } }] };
      for (const [offset, evaluation] of [[0n, 'satisfied'], [1n, 'violated']]) {
        const checked = Explain.report(exactModel, { ...result, assignment: {
          ...result.assignment, expected: { sort: 'real',
            numerator: String(numerator + offset * denominator), denominator: String(denominator) }
        } }, Adapter.defaultLimits);
        assert.equal(checked.outcome.hardConstraints[0].evaluation, evaluation);
      }
      const ordered = [...samples].sort((a, b) => a - b);
      console.log(JSON.stringify({ ...config, medianMs: ordered[2], samplesMs: samples, rssBytes: process.memoryUsage().rss }));
    `
    const child = spawnSync(process.execPath, ['--max-old-space-size=128', '--input-type=module', '-e', script],
      { encoding: 'utf8', timeout: 10_000, maxBuffer: 1024 * 1024 })
    if (child.error || child.status !== 0) throw new Error(`${JSON.stringify(config)} failed: ${child.error?.message ?? child.stderr}`, { cause: child.error })
    const measured = JSON.parse(child.stdout)
    for (const [key, value] of Object.entries(config)) assert.equal(measured[key], value)
    assert.ok(Number.isFinite(measured.medianMs) && measured.medianMs >= 0)
    measurements.push(measured)
  }
}
console.log(JSON.stringify({ format: 'cave.exact-sum-benchmark', version: 2,
  runtime: { node: process.version, platform: process.platform, arch: process.arch },
  childTimeoutMs: 10_000, childOldSpaceMb: 128,
  measurement: {
    samplesPerWorkload: 5,
    discardedWarmupSamples: 0,
    sampleOrder: 'execution order; median computed from a sorted copy',
    exactControlsPerWorkload: 2,
    exactControls: 'untimed analytic reciprocal equality and expected-plus-one inequality; normalized with independent Euclid; expected value supplied as assignment under default limits',
    timing: 'complete linear-analysis or explanation call; excludes fixture construction and assertions',
    rss: 'after workload and extra magnitude controls; not peak or incremental memory',
    memoryLimit: 'V8 old space only; not a total-process memory cap'
  }, measurements }))
