/** Full explanation costs for shared expression graphs and equivalent trees. */
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'

const source = new URL('../packages/solver/src/index.ts', import.meta.url).href
const measurements = []
for (const depth of [8, 10, 12]) for (const shape of ['shared', 'tree']) {
  const config = { depth, shape }
  const script = `
    import assert from 'node:assert/strict';
    import { Adapter, Explain, Model } from ${JSON.stringify(source)};
    const { depth, shape } = ${JSON.stringify(config)};
    const build = n => {
      if (n === 0) return { kind: 'variable', id: 'x' };
      const left = build(n - 1);
      return { kind: 'add', operands: [left, shape === 'shared' ? left : build(n - 1)] };
    };
    const model = { schema: Model.schema, variables: [{ id: 'x', sort: 'int', min: '-10', max: '10' }], constraints: [{ id: 'sum',
      expression: { kind: 'eq', left: build(depth), right: { kind: 'literal', sort: 'int', value: String(2 ** depth) } } }] };
    const result = { status: 'satisfied', assignment: { x: { sort: 'int', value: '1' } },
      backend: { name: 'fixture', version: '1' }, diagnostics: [], elapsedMs: 0 };
    const samplesMs = [];
    for (let i = 0; i < 5; i++) {
      const start = performance.now();
      const report = Explain.report(model, result, Adapter.defaultLimits);
      samplesMs.push(performance.now() - start);
      assert.equal(report.outcome.hardConstraints[0].evaluation, 'satisfied');
    }
    console.log(JSON.stringify({ depth, shape, medianMs: [...samplesMs].sort((a,b) => a-b)[2], samplesMs,
      rssBytes: process.memoryUsage().rss }));
  `
  const child = spawnSync(process.execPath, ['--max-old-space-size=128', '--input-type=module', '-e', script],
    { encoding: 'utf8', timeout: 10_000, maxBuffer: 1024 * 1024 })
  if (child.error || child.status !== 0) throw new Error(`${JSON.stringify(config)}: ${child.error?.message ?? child.stderr}`, { cause: child.error })
  const measured = JSON.parse(child.stdout)
  assert.equal(measured.depth, depth)
  assert.equal(measured.shape, shape)
  assert.equal(measured.samplesMs.length, 5)
  assert.ok(measured.samplesMs.every(value => Number.isFinite(value) && value >= 0))
  measurements.push(measured)
}
console.log(JSON.stringify({ format: 'cave.explanation-sharing-benchmark', version: 1,
  runtime: { node: process.version, platform: process.platform, arch: process.arch },
  childTimeoutMs: 10_000, childOldSpaceMb: 128, samplesPerWorkload: 5,
  timing: 'complete Explain.report, including cloning, validation and digest; excludes fixture construction and result assertions',
  rss: 'after workload and assertions; not peak memory or a total-process limit', measurements }))
