import { createHash } from 'node:crypto'
import {
  chmodSync,
  createReadStream,
  createWriteStream,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { gunzipSync } from 'node:zlib'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const grammar = join(root, 'packages/tree-sitter-cave')
const manifestPath = join(root, 'scripts/grammar-toolchain.json')
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
const platform = `${process.platform}-${process.arch}`
const cache = resolve(process.env.CAVE_GRAMMAR_CACHE
  ?? join(homedir(), '.cache/cave/grammar-toolchain'))
const downloads = join(cache, 'downloads')
const offline = /^(1|true)$/i.test(process.env.CAVE_GRAMMAR_OFFLINE ?? '')
const recovery = 'pnpm grammar:prepare'

const fail = message => {
  throw new Error(`${message}\nRecovery: ${recovery}`)
}

const sha256 = async path => {
  const hash = createHash('sha256')
  await pipeline(createReadStream(path), hash)
  return hash.digest('hex')
}

const checkedArtifact = async (name, definition) => {
  const artifact = definition.artifacts[platform]
  if (!artifact) {
    fail(`${name} ${definition.version} has no pinned artifact for ${platform}.`)
  }

  mkdirSync(downloads, { recursive: true })
  const path = join(downloads, artifact.file)
  if (existsSync(path)) {
    const actual = await sha256(path)
    if (actual === artifact.sha256) return { ...artifact, path }
    if (offline) {
      fail(`${artifact.file} has SHA-256 ${actual}; expected ${artifact.sha256}. Offline mode cannot replace it.`)
    }
    console.error(`Discarding ${artifact.file}: SHA-256 ${actual} does not match ${artifact.sha256}.`)
    rmSync(path, { force: true })
  } else if (offline) {
    fail(`Offline artifact is missing: ${path}\nExpected SHA-256: ${artifact.sha256}`)
  }

  const url = `${definition.baseUrl}/${artifact.file}`
  const temporary = `${path}.${process.pid}.part`
  console.error(`Downloading ${url}`)
  let response
  try {
    response = await fetch(url)
    if (!response.ok || !response.body) {
      fail(`Could not download ${url}: HTTP ${response.status} ${response.statusText}.`)
    }
    await pipeline(Readable.fromWeb(response.body), createWriteStream(temporary, { flags: 'wx' }))
    const actual = await sha256(temporary)
    if (actual !== artifact.sha256) {
      fail(`${artifact.file} has SHA-256 ${actual}; expected ${artifact.sha256}.`)
    }
    renameSync(temporary, path)
  } catch (error) {
    rmSync(temporary, { force: true })
    throw error
  }
  return { ...artifact, path }
}

const prepareTreeSitter = async () => {
  const artifact = await checkedArtifact('tree-sitter', manifest.treeSitter)
  const bytes = gunzipSync(readFileSync(artifact.path))
  const expected = createHash('sha256').update(bytes).digest('hex')
  const directory = join(cache, 'tools/tree-sitter', manifest.treeSitter.version, platform)
  const executable = join(directory, process.platform === 'win32' ? 'tree-sitter.exe' : 'tree-sitter')
  const current = existsSync(executable) ? await sha256(executable) : undefined
  if (current !== expected) {
    mkdirSync(directory, { recursive: true })
    writeFileSync(executable, bytes, { mode: 0o755 })
    chmodSync(executable, 0o755)
  }
  return executable
}

const prepareWasiSdk = async () => {
  const artifact = await checkedArtifact('wasi-sdk', manifest.wasiSdk)
  const directory = join(cache, 'tools/wasi-sdk', manifest.wasiSdk.version, platform)
  const marker = join(directory, '.cave-source-sha256')
  const version = join(directory, 'VERSION')
  if (existsSync(marker) && existsSync(version)
      && readFileSync(marker, 'utf8').trim() === artifact.sha256
      && readFileSync(version, 'utf8').startsWith(manifest.wasiSdk.version)) {
    return directory
  }

  const staging = `${directory}.${process.pid}.tmp`
  rmSync(staging, { force: true, recursive: true })
  mkdirSync(staging, { recursive: true })
  console.error(`Extracting verified ${artifact.file}`)
  const extraction = spawnSync('tar', ['-xzf', artifact.path, '-C', staging], {
    encoding: 'utf8'
  })
  if (extraction.status !== 0) {
    rmSync(staging, { force: true, recursive: true })
    fail(`Could not extract ${artifact.file} with tar: ${extraction.stderr || extraction.error?.message || 'unknown error'}`)
  }
  const entries = readdirSync(staging, { withFileTypes: true }).filter(entry => entry.isDirectory())
  if (entries.length !== 1) {
    rmSync(staging, { force: true, recursive: true })
    fail(`${artifact.file} did not contain exactly one SDK directory.`)
  }
  const extracted = join(staging, entries[0].name)
  writeFileSync(join(extracted, '.cave-source-sha256'), `${artifact.sha256}\n`)
  mkdirSync(dirname(directory), { recursive: true })
  rmSync(directory, { force: true, recursive: true })
  renameSync(extracted, directory)
  rmSync(staging, { force: true, recursive: true })
  if (!existsSync(version) || !readFileSync(version, 'utf8').startsWith(manifest.wasiSdk.version)) {
    rmSync(directory, { force: true, recursive: true })
    fail(`The extracted SDK does not report version ${manifest.wasiSdk.version}.`)
  }
  return directory
}

const prepare = async () => {
  const [treeSitter, wasiSdk] = await Promise.all([prepareTreeSitter(), prepareWasiSdk()])
  return { treeSitter, wasiSdk }
}

const run = (executable, args, environment = {}) => {
  const result = spawnSync(executable, args, {
    cwd: grammar,
    env: { ...process.env, ...environment },
    stdio: 'inherit'
  })
  if (result.error) fail(`Could not run ${executable}: ${result.error.message}`)
  if (result.status !== 0) process.exit(result.status ?? 1)
}

const command = process.argv[2] ?? 'prepare'
if (!['prepare', 'generate', 'build', 'test', 'verify'].includes(command)) {
  fail(`Unknown grammar toolchain command: ${command}.`)
}

const { treeSitter, wasiSdk } = await prepare()
console.error(`Verified tree-sitter ${manifest.treeSitter.version} and wasi-sdk ${manifest.wasiSdk.version} for ${platform}.`)

if (command === 'generate') run(treeSitter, ['generate'])
if (['build', 'test', 'verify'].includes(command)) {
  run(treeSitter, ['generate'])
  run(treeSitter, ['build', '--wasm', '-o', 'tree-sitter-cave.wasm'], {
    TREE_SITTER_WASI_SDK_PATH: wasiSdk
  })
}
if (command === 'test') run(treeSitter, ['test'])
if (command === 'verify') {
  run('git', [
    'diff', '--exit-code', '--',
    ':(top)packages/tree-sitter-cave/src',
    ':(top)packages/tree-sitter-cave/tree-sitter-cave.wasm'
  ])
}
