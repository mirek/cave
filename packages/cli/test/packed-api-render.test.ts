import { test } from 'node:test'
import * as assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import ts from 'typescript'
// @ts-expect-error the packed verification helper is plain JavaScript
import { renderPackedModule } from '../../../scripts/packed-api-render.mjs'

function render(files: Record<string, string>): string[] {
  const scratch = mkdtempSync(join(tmpdir(), 'cave-packed-render-'))
  try {
    const dir = join(scratch, 'node_modules', '@cavelang', 'fixture')
    mkdirSync(dir, { recursive: true })
    for (const [name, source] of Object.entries(files)) writeFileSync(join(dir, name), source)
    const entry = join(dir, 'index.d.ts')
    const program = ts.createProgram([entry], {
      noLib: true, types: [], module: ts.ModuleKind.NodeNext,
      moduleResolution: ts.ModuleResolutionKind.NodeNext,
    })
    assert.deepEqual(program.getSyntacticDiagnostics(), [])
    assert.deepEqual(program.getSemanticDiagnostics(), [])
    const checker = program.getTypeChecker()
    const source = program.getSourceFile(entry)!
    return Array.from(renderPackedModule(checker, source, checker.getSymbolAtLocation(source), '@cavelang/fixture'))
  } finally { rmSync(scratch, { recursive: true, force: true }) }
}

test('packed API rendering retains every declaration in a broad namespace', () => {
  const size = 17_000
  const names = Array.from({ length: size }, (_, i) => `value${i}`)
  const lines = render({ 'index.d.ts': names.map(name => `export declare const ${name}: number;`).join('\n') })
  assert.equal(lines.length, size * 8)
  const sorted = names.sort((a, b) => a.localeCompare(b))
  for (let i = 0; i < size; i++) {
    assert.deepEqual(lines.slice(i * 8, (i + 1) * 8), [
      `### \`${sorted[i]}\``, '', 'Kind: value.', '',
      '```ts', `export declare const ${sorted[i]}: number;`, '```', '',
    ])
  }
})

test('packed API rendering terminates self-reexports and retains sibling declarations', () => {
  assert.deepEqual(render({
    'index.d.ts': "export * as self from './index.js';\nexport declare const value: number;",
  }), [
    '### `self`', '', 'Kind: value, namespace.', '',
    'Namespace reference: `@cavelang/fixture`.', '',
    '### `value`', '', 'Kind: value.', '', '```ts',
    'export declare const value: number;', '```', '',
  ])
})

test('packed API rendering detects mutual cycles separately in each alias branch', () => {
  const lines = render({
    'index.d.ts': "export * as first from './child.js';\nexport * as second from './child.js';",
    'child.d.ts': "export * as parent from './index.js';\nexport declare const value: number;",
  })
  assert.deepEqual(lines.filter(line => line.startsWith('#')), [
    '### `first`', '#### `parent`', '#### `value`',
    '### `second`', '#### `parent`', '#### `value`',
  ])
  assert.equal(lines.filter(line => line === 'Namespace reference: `@cavelang/fixture`.').length, 2)
  assert.equal(lines.filter(line => line === 'export declare const value: number;').length, 2)
})
