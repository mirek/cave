import { createReadStream } from 'node:fs'
import { basename } from 'node:path'
import { fileURLToPath } from 'node:url'
import yauzl from 'yauzl'

const readZip = path => new Promise((resolve, reject) => {
  yauzl.open(path, { lazyEntries: true }, (error, zip) => {
    if (error) return reject(error)

    const entries = new Map()
    const wanted = new Set([
      'extension/package.json',
      'extension/dist/web-tree-sitter.wasm',
      'extension/dist/tree-sitter-cave.wasm',
      'extension/dist/highlights.scm',
    ])

    zip.on('error', reject)
    zip.on('entry', entry => {
      entries.set(entry.fileName, { size: entry.uncompressedSize })
      if (!wanted.has(entry.fileName)) return zip.readEntry()
      zip.openReadStream(entry, (streamError, stream) => {
        if (streamError) return reject(streamError)
        const chunks = []
        stream.on('data', chunk => chunks.push(chunk))
        stream.on('error', reject)
        stream.on('end', () => {
          entries.get(entry.fileName).content = Buffer.concat(chunks)
          zip.readEntry()
        })
      })
    })
    zip.on('end', () => resolve(entries))
    zip.readEntry()
  })
})

const required = [
  '[Content_Types].xml',
  'extension.vsixmanifest',
  'extension/package.json',
  'extension/readme.md',
  'extension/License.md',
  'extension/language-configuration.json',
  'extension/dist/extension.js',
  'extension/dist/extension.js.map',
  'extension/dist/web-tree-sitter.wasm',
  'extension/dist/tree-sitter-cave.wasm',
  'extension/dist/highlights.scm',
]

export const verifyVsix = async (path, expectedVersion) => {
  const entries = await readZip(path)
  for (const name of required) {
    if (!entries.has(name)) throw new Error(`${basename(path)} omits ${name}`)
  }

  for (const name of entries.keys()) {
    if (/^extension\/(?:node_modules|src|test)\//.test(name)) {
      throw new Error(`${basename(path)} includes development-only ${name}`)
    }
  }

  const manifest = JSON.parse(entries.get('extension/package.json').content.toString('utf8'))
  if (manifest.name !== 'cave-language' || manifest.publisher !== 'cavelang') {
    throw new Error(`${basename(path)} has unexpected extension identity`)
  }
  if (manifest.version !== expectedVersion) {
    throw new Error(`${basename(path)} is version ${manifest.version}, expected ${expectedVersion}`)
  }

  for (const name of [
    'extension/dist/web-tree-sitter.wasm',
    'extension/dist/tree-sitter-cave.wasm',
    'extension/dist/highlights.scm',
  ]) {
    if ((entries.get(name).size ?? 0) === 0) throw new Error(`${basename(path)} contains empty ${name}`)
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [, , path, expectedVersion] = process.argv
  if (!path || !expectedVersion) throw new Error('usage: node verify-vsix.mjs <path> <version>')
  await verifyVsix(path, expectedVersion)
  console.log(`validated ${path}`)
}
