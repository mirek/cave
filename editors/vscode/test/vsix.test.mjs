import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { crc32 } from 'node:zlib'
import { verifyVsix } from '../verify-vsix.mjs'

// Minimal stored ZIP fixtures, independent of vsce's packaging implementation.
const zip = entries => {
  const local = []
  const central = []
  let offset = 0
  for (const [path, text] of entries) {
    const name = Buffer.from(path)
    const data = Buffer.from(text)
    const header = Buffer.alloc(30)
    header.writeUInt32LE(0x04034b50)
    header.writeUInt16LE(20, 4)
    header.writeUInt32LE(crc32(data), 14)
    header.writeUInt32LE(data.length, 18)
    header.writeUInt32LE(data.length, 22)
    header.writeUInt16LE(name.length, 26)
    const directory = Buffer.alloc(46)
    directory.writeUInt32LE(0x02014b50)
    directory.writeUInt16LE(20, 4)
    directory.writeUInt16LE(20, 6)
    header.copy(directory, 8, 6, 28)
    directory.writeUInt32LE(offset, 42)
    local.push(header, name, data)
    central.push(directory, name)
    offset += header.length + name.length + data.length
  }
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50)
  end.writeUInt16LE(entries.length, 8)
  end.writeUInt16LE(entries.length, 10)
  end.writeUInt32LE(central.reduce((size, part) => size + part.length, 0), 12)
  end.writeUInt32LE(offset, 16)
  return Buffer.concat([...local, ...central, end])
}

const manifest = { name: 'cave-language', publisher: 'MirekRusin', version: '0.0.0', main: './dist/extension.js' }
const fixture = () => ({
  '[Content_Types].xml': '<Types/>',
  'extension.vsixmanifest': '<PackageManifest/>',
  'extension/package.json': JSON.stringify(manifest),
  'extension/readme.md': '# CAVE',
  'extension/License.md': 'CC0',
  'extension/language-configuration.json': '{}',
  'extension/dist/extension.js': 'exports.activate = () => {}',
  'extension/dist/extension.js.map': '{}',
  'extension/dist/web-tree-sitter.wasm': Buffer.from([0, 97, 115, 109, 1, 0, 0, 0]),
  'extension/dist/tree-sitter-cave.wasm': Buffer.from([0, 97, 115, 109, 1, 0, 0, 0]),
  'extension/dist/highlights.scm': '(verb) @keyword',
})

test('VSIX validation requires UTF-8 JSON objects for manifest and language configuration', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'cave-vsix-json-'))
  const path = join(dir, 'fixture.vsix')
  try {
    for (const name of ['extension/language-configuration.json', 'extension/package.json']) {
      const malformedUtf8 = Buffer.from(
        JSON.stringify({ ...manifest, description: 'PLACEHOLDER' }).replace('PLACEHOLDER', '\u0001'))
      malformedUtf8[malformedUtf8.indexOf(1)] = 0xff
      for (const content of ['{', 'null', '[]', '42', malformedUtf8]) {
        writeFileSync(path, zip(Object.entries({ ...fixture(), [name]: content })))
        await assert.rejects(verifyVsix(path, manifest.version), error =>
          error.message.includes(name) && /UTF-8 JSON object/.test(error.message))
      }
    }
    writeFileSync(path, zip(Object.entries({ ...fixture(),
      'extension/package.json': JSON.stringify({ ...manifest, description: 'café 😀 �' }),
      'extension/language-configuration.json': JSON.stringify({ comments: { lineComment: '//' } }),
    })))
    await verifyVsix(path, manifest.version)
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('VSIX validation rejects malformed UTF-8 highlight queries and accepts authored Unicode', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'cave-vsix-query-'))
  const path = join(dir, 'fixture.vsix')
  const name = 'extension/dist/highlights.scm'
  try {
    for (const bytes of [[0xff], [0xe2, 0x82], [0xed, 0xa0, 0x80]]) {
      const content = Buffer.concat([Buffer.from('(verb) @keyword\n; '), Buffer.from(bytes)])
      writeFileSync(path, zip(Object.entries({ ...fixture(), [name]: content })))
      await assert.rejects(verifyVsix(path, manifest.version), error => {
        assert.match(error.message, /UTF-8 highlight query/)
        assert.ok(error.message.includes(name))
        assert.ok(error.cause instanceof TypeError)
        return true
      })
    }
    writeFileSync(path, zip(Object.entries({ ...fixture(), [name]: '(verb) @keyword\n; café 😀 �' })))
    await verifyVsix(path, manifest.version)
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('VSIX validation rejects empty required files and incorrect executable entry points', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'cave-vsix-'))
  const path = join(dir, 'fixture.vsix')
  const check = async entries => {
    writeFileSync(path, zip(Object.entries(entries)))
    return verifyVsix(path, manifest.version)
  }
  try {
    await check(fixture())
    for (const name of Object.keys(fixture())) {
      await assert.rejects(check({ ...fixture(), [name]: '' }), /contains empty/)
    }
    for (const main of [undefined, './missing.js', '', 42]) {
      await assert.rejects(check({ ...fixture(), 'extension/package.json': JSON.stringify({ ...manifest, main }) }), /entry point/)
    }
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('VSIX validation rejects duplicate archive paths regardless of entry order', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'cave-vsix-duplicates-'))
  const path = join(dir, 'fixture.vsix')
  try {
    for (const name of ['extension/package.json', 'extension/dist/extension.js', 'extension/dist/tree-sitter-cave.wasm']) {
      const duplicate = [name, name.endsWith('package.json') ? JSON.stringify({ ...manifest, main: './missing.js' }) : 'different contents']
      for (const entries of [[duplicate, ...Object.entries(fixture())], [...Object.entries(fixture()), duplicate]]) {
        writeFileSync(path, zip(entries))
        await assert.rejects(verifyVsix(path, manifest.version), /duplicate archive path/)
      }
    }
    writeFileSync(path, zip(Object.entries(fixture())))
    await verifyVsix(path, manifest.version)
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('VSIX validation rejects malformed or truncated WebAssembly payloads', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'cave-vsix-wasm-'))
  const path = join(dir, 'fixture.vsix')
  try {
    for (const name of ['extension/dist/web-tree-sitter.wasm', 'extension/dist/tree-sitter-cave.wasm']) {
      for (const bytes of [Buffer.from('not wasm'), Buffer.from([0, 97, 115, 109, 1]),
        Buffer.from([0, 97, 115, 109, 1, 0, 0, 0, 1, 2, 0])]) {
        writeFileSync(path, zip(Object.entries({ ...fixture(), [name]: bytes })))
        await assert.rejects(verifyVsix(path, manifest.version), /invalid WebAssembly/)
      }
    }
    writeFileSync(path, zip(Object.entries(fixture())))
    await verifyVsix(path, manifest.version)
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('VSIX validation excludes host tests and editor development configuration', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'cave-vsix-development-'))
  const path = join(dir, 'fixture.vsix')
  try {
    for (const name of ['extension/test-host/index.cjs', 'extension/.vscode/launch.json',
      'extension/.vscode/tasks.json', 'extension/src/extension.ts',
      'extension/test/token-ranges.test.mjs', 'extension/node_modules/example/index.js']) {
      writeFileSync(path, zip(Object.entries({ ...fixture(), [name]: 'development-only fixture' })))
      await assert.rejects(verifyVsix(path, manifest.version), /includes development-only/)
    }
    writeFileSync(path, zip(Object.entries(fixture())))
    await verifyVsix(path, manifest.version)
  } finally { rmSync(dir, { recursive: true, force: true }) }
})
