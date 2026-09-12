/** Isolated observations of equal-denominator arithmetic; not CI timing gates. */
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'

const source = new URL('../packages/solver/src/index.ts', import.meta.url).href
const measurements = []
for (const digits of [1_000, 10_000, 25_000]) {
  for (const operation of ['compare', 'linear', 'explain']) {
    const script = `
      import assert from 'node:assert/strict';
      import { Adapter, Exact, Explain, Linear, Model } from ${JSON.stringify(source)};
      const denominator = '1' + '0'.repeat(${digits} - 2) + '1';
      const fraction = numerator => ({ numerator: String(numerator), denominator });
      const literal = numerator => ({ kind: 'literal', sort: 'real', value: fraction(numerator) });
      const model = {
        schema: Model.schema, variables: [{ id: 'x', sort: 'real' }],
        constraints: [{ id: 'positive', expression: { kind: 'gte',
          left: { kind: 'divide', left: { kind: 'variable', id: 'x' },
            right: { kind: 'add', operands: [literal(1), literal(1)] } },
          right: { kind: 'literal', sort: 'real', value: '0' } } }]
      };
      const result = { status: 'satisfied', backend: { name: 'fixture', version: '1' },
        diagnostics: [], elapsedMs: 0, assignment: { x: { sort: 'real', numerator: '1', denominator: '1' } } };
      const run = () => ${JSON.stringify(operation)} === 'compare' ? Exact.compare(fraction(1), fraction(2))
        : ${JSON.stringify(operation)} === 'linear' ? Linear.model(model)
        : Explain.report(model, result, Adapter.defaultLimits);
      const samples = [];
      for (let index = 0; index < 5; index++) {
        const start = performance.now();
        const value = run();
        samples.push(performance.now() - start);
        if (${JSON.stringify(operation)} === 'compare') assert.equal(value, -1);
        else if (${JSON.stringify(operation)} === 'linear') assert.deepEqual(value, { linear: true, problems: [] });
        else assert.equal(value.outcome.hardConstraints[0].evaluation, 'satisfied');
      }
      samples.sort((a, b) => a - b);
      console.log(JSON.stringify({ operation: ${JSON.stringify(operation)}, denominatorDigits: ${digits},
        medianMs: samples[2], samplesMs: samples, rssBytes: process.memoryUsage().rss }));
    `
    const child = spawnSync(process.execPath, ['--max-old-space-size=128', '--input-type=module', '-e', script],
      { encoding: 'utf8', timeout: 10_000, maxBuffer: 1024 * 1024 })
    if (child.error || child.status !== 0) throw new Error(`${operation}/${digits} failed: ${child.error?.message ?? child.stderr}`, { cause: child.error })
    const measured = JSON.parse(child.stdout)
    assert.equal(measured.operation, operation)
    assert.equal(measured.denominatorDigits, digits)
    assert.ok(Number.isFinite(measured.medianMs) && measured.medianMs >= 0)
    measurements.push(measured)
  }
}
console.log(JSON.stringify({ format: 'cave.exact-intermediate-benchmark', version: 1,
  runtime: { node: process.version, platform: process.platform, arch: process.arch }, measurements }))
