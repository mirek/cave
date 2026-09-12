import { basename } from 'node:path'
import { fileURLToPath } from 'node:url'
import yauzl from 'yauzl'

const readZip = path => new Promise((resolve, reject) => {
  yauzl.open(path, { lazyEntries: true }, (error, zip) => {
    if (error) return reject(error)

    const entries = new Map()
    const wanted = new Set([
      'extension/package.json',
      'extension/language-configuration.json',
      'extension/dist/web-tree-sitter.wasm',
      'extension/dist/tree-sitter-cave.wasm',
      'extension/dist/highlights.scm',
    ])

    let failed = false
    const fail = error => {
      if (failed) return
      failed = true
      zip.close()
      reject(error)
    }
    zip.on('error', fail)
    zip.on('entry', entry => {
      if (failed) return
      if (entries.has(entry.fileName)) {
        return fail(new Error(`${basename(path)} contains duplicate archive path ${entry.fileName}`))
      }
      entries.set(entry.fileName, { size: entry.uncompressedSize })
      if (!wanted.has(entry.fileName)) return zip.readEntry()
      zip.openReadStream(entry, (streamError, stream) => {
        if (streamError) return fail(streamError)
        const chunks = []
        stream.on('data', chunk => chunks.push(chunk))
        stream.on('error', fail)
        stream.on('end', () => {
          if (failed) return
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
    if (entries.get(name).size === 0) throw new Error(`${basename(path)} contains empty ${name}`)
  }

  for (const name of entries.keys()) {
    if (/^extension\/(?:node_modules|src|test|test-host|\.vscode)(?:\/|$)/.test(name)) {
      throw new Error(`${basename(path)} includes development-only ${name}`)
    }
  }

  for (const name of ['extension/dist/web-tree-sitter.wasm', 'extension/dist/tree-sitter-cave.wasm']) {
    if (!WebAssembly.validate(entries.get(name).content)) {
      throw new Error(`${basename(path)} contains invalid WebAssembly in ${name}`)
    }
  }

  const queryName = 'extension/dist/highlights.scm'
  try {
    new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(entries.get(queryName).content)
  } catch (cause) {
    throw new Error(`${basename(path)} requires a UTF-8 highlight query in ${queryName}`, { cause })
  }

  const readObject = name => {
    try {
      const value = JSON.parse(new TextDecoder('utf-8', { fatal: true, ignoreBOM: true })
        .decode(entries.get(name).content))
      if (value === null || typeof value !== 'object' || Array.isArray(value)) {
        throw new TypeError('expected an object')
      }
      return value
    } catch (cause) {
      throw new Error(`${basename(path)} requires a UTF-8 JSON object in ${name}`, { cause })
    }
  }
  const manifest = readObject('extension/package.json')
  readObject('extension/language-configuration.json')
  if (manifest.name !== 'cave-language' || manifest.publisher !== 'MirekRusin') {
    throw new Error(`${basename(path)} has unexpected extension identity`)
  }
  if (manifest.version !== expectedVersion) {
    throw new Error(`${basename(path)} is version ${manifest.version}, expected ${expectedVersion}`)
  }
  if (manifest.main !== './dist/extension.js') {
    throw new Error(`${basename(path)} has an unexpected executable entry point`)
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [, , path, expectedVersion] = process.argv
  if (!path || !expectedVersion) throw new Error('usage: node verify-vsix.mjs <path> <version>')
  await verifyVsix(path, expectedVersion)
  console.log(`validated ${path}`)
}
