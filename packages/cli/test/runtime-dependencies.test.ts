import { test } from 'node:test'
import * as assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const checker = fileURLToPath(new URL('../../../scripts/check-runtime-dependencies.mjs', import.meta.url))
const check = (manifest: object, source: string) => {
  const dir = mkdtempSync(join(tmpdir(), 'cave-runtime-deps-'))
  try {
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'fixture', ...manifest }))
    mkdirSync(join(dir, 'dist', 'internal'), { recursive: true })
    mkdirSync(join(dir, 'dist', 'src'), { recursive: true })
    mkdirSync(join(dir, 'dist', 'test'), { recursive: true })
    writeFileSync(join(dir, 'dist', 'test', 'development.js'), "import 'test-only';")
    writeFileSync(join(dir, 'dist', 'internal', 'module.js'), source)
    return spawnSync(process.execPath, [checker, dir], { encoding: 'utf8' })
  } finally { rmSync(dir, { recursive: true, force: true }) }
}

test('runtime dependency checks reject dev-only static, re-export and dynamic imports', () => {
  const result = check({ devDependencies: { 'dev-only': '1', '@scope/parser': '1', 'lazy-only': '1' } },
    "import 'dev-only'; export { parse } from '@scope/parser/subpath'; const load = () => import('lazy-only');")
  assert.notEqual(result.status, 0)
  for (const name of ['dev-only', '@scope/parser/subpath', 'lazy-only']) assert.ok(result.stderr.includes(name), result.stderr)
  assert.match(result.stderr, /dist[\\/]internal[\\/]module\.js/)
})

test('runtime dependency checks accept declared packages, self imports and builtins', () => {
  const result = check({ dependencies: { '@scope/parser': '1' }, optionalDependencies: { optional: '1' }, peerDependencies: { peer: '1' } },
    "import '@scope/parser/subpath'; import 'fixture/internal'; import 'node:fs'; import 'path'; import './local.js'; import '#alias'; import(`optional`); require('peer'); require.resolve('peer/subpath'); client.require('not-a-module');")
  assert.equal(result.status, 0, result.stderr)
})

test('runtime dependency checks ignore import-looking text and flag literal CommonJS loads', () => {
  const result = check({}, `// import 'comment-only'\nconst text = "import 'text-only'"; require('missing-runtime'); require.resolve('missing-lookup');`)
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /missing-runtime/)
  assert.match(result.stderr, /missing-lookup/)
  assert.doesNotMatch(result.stderr, /comment-only|text-only/)
})

test('runtime dependency checks include literal import.meta.resolve lookups', () => {
  const rejected = check({ devDependencies: { 'lookup-only': '1' } },
    "const executable = import.meta.resolve('lookup-only/bin'); const lazy = () => import.meta.resolve(`missing-lookup`);")
  assert.notEqual(rejected.status, 0)
  assert.match(rejected.stderr, /lookup-only\/bin/)
  assert.match(rejected.stderr, /missing-lookup/)
  const accepted = check({ dependencies: { runtime: '1' } },
    "import.meta.resolve('runtime/bin'); import.meta.resolve('fixture'); import.meta.resolve('node:fs'); import.meta.resolve('./local.js'); client.meta.resolve('not-a-module');")
  assert.equal(accepted.status, 0, accepted.stderr)
})

test('runtime dependency checks reject nonexistent node builtins', () => {
  const result = check({}, "import 'node:cave-missing'; require('node:fs/missing'); import.meta.resolve('node:path/missing');")
  assert.notEqual(result.status, 0)
  for (const name of ['node:cave-missing', 'node:fs/missing', 'node:path/missing']) {
    assert.ok(result.stderr.includes(name), result.stderr)
  }
  assert.match(result.stderr, /unknown Node builtin/)
  const valid = check({}, "import 'node:fs/promises'; import 'node:test'; import.meta.resolve('node:sqlite');")
  assert.equal(valid.status, 0, valid.stderr)
})

test('runtime dependency checks include literal bracket-form module lookups', () => {
  const rejected = check({}, "require['resolve']('missing-require'); import.meta[`resolve`]('missing-meta'); client['resolve']('not-a-module');")
  assert.notEqual(rejected.status, 0)
  assert.match(rejected.stderr, /missing-require/)
  assert.match(rejected.stderr, /missing-meta/)
  assert.doesNotMatch(rejected.stderr, /not-a-module/)
  const accepted = check({ dependencies: { runtime: '1' } },
    "require['resolve']('runtime/bin'); import.meta['resolve']('node:fs');")
  assert.equal(accepted.status, 0, accepted.stderr)
})

test('runtime dependency checks retain literals through grouping parentheses', () => {
  const rejected = check({}, "(require)(('missing-call')); (require).resolve(('missing-lookup')); (import.meta)['resolve']((`missing-meta`)); import(('missing-import')); require[('resolve')]('missing-member'); import.meta[(`resolve`)]('missing-meta-member');")
  assert.notEqual(rejected.status, 0)
  for (const name of ['missing-call', 'missing-lookup', 'missing-meta', 'missing-import', 'missing-member', 'missing-meta-member']) {
    assert.ok(rejected.stderr.includes(name), rejected.stderr)
  }
  const accepted = check({ dependencies: { runtime: '1' } }, "(require)(('runtime')); (import.meta).resolve(('node:fs'));")
  assert.equal(accepted.status, 0, accepted.stderr)
})
