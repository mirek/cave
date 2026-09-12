import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { createHash } from 'node:crypto'
import { gzipSync } from 'node:zlib'
import { spawn, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

for (const phase of ['headers', 'body']) test(`grammar downloads time out during stalled ${phase} and remove partial files`, { timeout: 10000 }, async () => {
  const root = mkdtempSync(join(tmpdir(), 'cave-grammar-download-'))
  let requests = 0
  const server = createServer((_request, response) => {
    requests++
    if (phase === 'body') {
      response.writeHead(200, { 'content-type': 'application/octet-stream' })
      response.write('incomplete artifact')
    }
  })
  try {
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    const address = server.address()
    assert.ok(address && typeof address === 'object')
    mkdirSync(join(root, 'scripts'))
    writeFileSync(join(root, 'scripts/grammar-toolchain.mjs'), readFileSync(new URL('../../../scripts/grammar-toolchain.mjs', import.meta.url)))
    const manifest = JSON.parse(readFileSync(new URL('../../../scripts/grammar-toolchain.json', import.meta.url), 'utf8'))
    for (const tool of [manifest.treeSitter, manifest.wasiSdk]) tool.baseUrl = `http://127.0.0.1:${address.port}`
    writeFileSync(join(root, 'scripts/grammar-toolchain.json'), JSON.stringify(manifest))
    const cache = join(root, 'cache')
    const child = spawn(process.execPath, [join(root, 'scripts/grammar-toolchain.mjs'), 'prepare'], {
      // Allow both local requests to reach the fixture under workspace load;
      // the server deliberately never completes either response.
      env: { ...process.env, CAVE_GRAMMAR_CACHE: cache, CAVE_GRAMMAR_OFFLINE: '0', CAVE_GRAMMAR_DOWNLOAD_TIMEOUT_SECONDS: '1' },
      stdio: ['ignore', 'pipe', 'pipe'], timeout: 5000
    })
    let stderr = ''
    child.stderr.setEncoding('utf8').on('data', chunk => { stderr += chunk })
    child.stdout.resume()
    const result = await new Promise<{ code: number | null, signal: string | null }>((resolve, reject) => {
      child.once('error', reject)
      child.once('close', (code, signal) => resolve({ code, signal }))
    })
    assert.equal(result.signal, null, stderr)
    assert.equal(result.code, 1, stderr)
    assert.match(stderr, /timeout|timed out/i)
    assert.equal(requests, 2)
    assert.deepEqual(readdirSync(join(cache, 'downloads')), [])
  } finally {
    server.closeAllConnections()
    await new Promise<void>(resolve => server.close(() => resolve()))
    rmSync(root, { recursive: true, force: true })
  }
})

test('grammar download deadlines reject invalid settings before creating a cache', () => {
  const root = mkdtempSync(join(tmpdir(), 'cave-grammar-deadline-'))
  const cache = join(root, 'cache')
  try {
    for (const timeout of ['', '0', '-1', 'NaN', 'Infinity', '2147483.648']) {
      const result = spawnSync(process.execPath, [fileURLToPath(new URL('../../../scripts/grammar-toolchain.mjs', import.meta.url)), 'prepare'], {
        env: { ...process.env, CAVE_GRAMMAR_CACHE: cache, CAVE_GRAMMAR_DOWNLOAD_TIMEOUT_SECONDS: timeout },
        encoding: 'utf8', timeout: 3000
      })
      assert.ifError(result.error)
      assert.equal(result.signal, null)
      assert.equal(result.status, 1)
      assert.match(result.stderr, /CAVE_GRAMMAR_DOWNLOAD_TIMEOUT_SECONDS must be positive/)
      assert.equal(existsSync(cache), false)
    }
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test('grammar setup retries timed-out downloads and reuses verified archives offline', { timeout: 15000 }, async () => {
  const root = mkdtempSync(join(tmpdir(), 'cave-grammar-retry-'))
  const cache = join(root, 'cache')
  const platform = `${process.platform}-${process.arch}`
  let stalled = true, failTree = false, requests = 0
  const archives = new Map<string, Buffer>()
  const server = createServer((request, response) => {
    requests++
    if (stalled) { response.writeHead(200); response.write('partial'); return }
    if (failTree && request.url === '/tree.gz') { response.writeHead(503); response.end('unavailable'); return }
    const body = archives.get(request.url!)
    assert.ok(body)
    response.writeHead(200, { 'content-length': body.length })
    if (failTree) {
      response.flushHeaders()
      setTimeout(() => response.end(body), 150)
    } else response.end(body)
  })
  try {
    mkdirSync(join(root, 'scripts'))
    mkdirSync(join(root, 'source/sdk'), { recursive: true })
    writeFileSync(join(root, 'source/sdk/VERSION'), 'test-sdk\n')
    const archive = join(root, 'sdk.tar.gz')
    const tar = spawnSync('tar', ['-czf', archive, '-C', join(root, 'source'), 'sdk'], { encoding: 'utf8', timeout: 3000 })
    assert.ifError(tar.error)
    assert.equal(tar.status, 0, tar.stderr)
    archives.set('/tree.gz', gzipSync(Buffer.from('fixture executable bytes\n')))
    archives.set('/sdk.tar.gz', readFileSync(archive))
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    const address = server.address()
    assert.ok(address && typeof address === 'object')
    const definition = (version: string, file: string) => ({ version,
      baseUrl: `http://127.0.0.1:${address.port}`, artifacts: { [platform]: {
        file, sha256: createHash('sha256').update(archives.get(`/${file}`)!).digest('hex')
      } } })
    writeFileSync(join(root, 'scripts/grammar-toolchain.json'), JSON.stringify({
      treeSitter: definition('test-tree', 'tree.gz'), wasiSdk: definition('test-sdk', 'sdk.tar.gz')
    }))
    writeFileSync(join(root, 'scripts/grammar-toolchain.mjs'), readFileSync(new URL('../../../scripts/grammar-toolchain.mjs', import.meta.url)))
    const run = async (offline = false) => {
      const child = spawn(process.execPath, [join(root, 'scripts/grammar-toolchain.mjs'), 'prepare'], {
        env: { ...process.env, CAVE_GRAMMAR_CACHE: cache, CAVE_GRAMMAR_OFFLINE: offline ? '1' : '0',
          // Give both requests time to reach localhost under workspace load;
          // the fixture keeps them stalled until the deadline expires.
          CAVE_GRAMMAR_DOWNLOAD_TIMEOUT_SECONDS: stalled ? '1' : '2' },
        stdio: ['ignore', 'pipe', 'pipe'], timeout: 5000
      })
      let stderr = ''
      child.stderr.setEncoding('utf8').on('data', chunk => { stderr += chunk })
      child.stdout.resume()
      return await new Promise<{ code: number | null, signal: string | null, stderr: string }>((resolve, reject) => {
        child.once('error', reject)
        child.once('close', (code, signal) => resolve({ code, signal, stderr }))
      })
    }
    const failed = await run()
    assert.equal(failed.signal, null, failed.stderr)
    assert.equal(failed.code, 1)
    assert.match(failed.stderr, /timeout|timed out/i)
    assert.deepEqual(readdirSync(join(cache, 'downloads')), [])
    assert.equal(requests, 2)
    stalled = false
    failTree = true
    const partial = await run()
    assert.equal(partial.signal, null, partial.stderr)
    assert.equal(partial.code, 1)
    assert.match(partial.stderr, /HTTP 503/)
    assert.equal(requests, 4)
    assert.deepEqual(readdirSync(join(cache, 'downloads')), ['sdk.tar.gz'])
    assert.deepEqual(readFileSync(join(cache, 'downloads/sdk.tar.gz')), archives.get('/sdk.tar.gz'))
    assert.equal(readFileSync(join(cache, 'tools/wasi-sdk/test-sdk', platform, 'VERSION'), 'utf8'), 'test-sdk\n')
    failTree = false
    const recovered = await run()
    assert.equal(recovered.signal, null, recovered.stderr)
    assert.equal(recovered.code, 0, recovered.stderr)
    assert.equal(requests, 5)
    for (const [path, bytes] of archives) assert.deepEqual(readFileSync(join(cache, 'downloads', path.slice(1))), bytes)
    assert.equal(readFileSync(join(cache, 'tools/wasi-sdk/test-sdk', platform, 'VERSION'), 'utf8'), 'test-sdk\n')
    const offline = await run(true)
    assert.equal(offline.signal, null, offline.stderr)
    assert.equal(offline.code, 0, offline.stderr)
    assert.equal(requests, 5)
  } finally {
    server.closeAllConnections()
    await new Promise<void>(resolve => server.close(() => resolve()))
    rmSync(root, { recursive: true, force: true })
  }
})

for (const reportedVersion of [undefined, '29.01', 'directory-version', 'directory-marker']) test(`grammar SDK rejects ${reportedVersion ?? 'missing version'} before replacing an installation`, () => {
  const root = mkdtempSync(join(tmpdir(), 'cave-grammar-sdk-'))
  const cache = join(root, 'cache')
  const platform = `${process.platform}-${process.arch}`
  const installed = join(cache, 'tools/wasi-sdk/29.0', platform)
  try {
    mkdirSync(join(root, 'scripts'))
    mkdirSync(join(root, 'source/sdk'), { recursive: true })
    mkdirSync(join(cache, 'downloads'), { recursive: true })
    mkdirSync(installed, { recursive: true })
    writeFileSync(join(installed, 'VERSION'), 'previous installation\n')
    writeFileSync(join(installed, '.cave-source-sha256'), 'previous checksum\n')
    writeFileSync(join(installed, 'retained-file'), 'keep until replacement validates\n')
    writeFileSync(join(root, 'scripts/grammar-toolchain.mjs'), readFileSync(new URL('../../../scripts/grammar-toolchain.mjs', import.meta.url)))
    const tree = gzipSync(Buffer.from('fixture executable\n'))
    writeFileSync(join(cache, 'downloads/tree.gz'), tree)
    const prepareArchive = (version: string | undefined) => {
      const versionPath = join(root, 'source/sdk/VERSION')
      const markerPath = join(root, 'source/sdk/.cave-source-sha256')
      rmSync(versionPath, { recursive: true, force: true })
      rmSync(markerPath, { recursive: true, force: true })
      if (version === 'directory-version') mkdirSync(versionPath)
      else if (version !== undefined) writeFileSync(versionPath, `${version === 'directory-marker' ? '29.0' : version}\nwasi-libc: fixture\n`)
      if (version === 'directory-marker') mkdirSync(markerPath)
      const archive = join(cache, 'downloads/sdk.tar.gz')
      const tar = spawnSync('tar', ['-czf', archive, '-C', join(root, 'source'), 'sdk'], { encoding: 'utf8', timeout: 3000 })
      assert.ifError(tar.error)
      assert.equal(tar.status, 0, tar.stderr)
      const definition = (version: string, file: string, bytes: Buffer) => ({ version, baseUrl: 'https://unused.invalid',
        artifacts: { [platform]: { file, sha256: createHash('sha256').update(bytes).digest('hex') } } })
      writeFileSync(join(root, 'scripts/grammar-toolchain.json'), JSON.stringify({
        treeSitter: definition('test-tree', 'tree.gz', tree),
        wasiSdk: definition('29.0', 'sdk.tar.gz', readFileSync(archive))
      }))
    }
    const run = () => {
      const result = spawnSync(process.execPath, [join(root, 'scripts/grammar-toolchain.mjs'), 'prepare'], {
        env: { ...process.env, CAVE_GRAMMAR_CACHE: cache, CAVE_GRAMMAR_OFFLINE: '1', CAVE_GRAMMAR_DOWNLOAD_TIMEOUT_SECONDS: '2' },
        encoding: 'utf8', timeout: 5000
      })
      assert.ifError(result.error)
      assert.equal(result.signal, null, result.stderr)
      return result
    }
    prepareArchive(reportedVersion)
    const rejected = run()
    assert.equal(rejected.status, 1, rejected.stderr)
    assert.match(rejected.stderr, reportedVersion?.startsWith('directory-') ? /EISDIR|EACCES|EPERM/ : /does not report version 29\.0/)
    assert.equal(readFileSync(join(installed, 'VERSION'), 'utf8'), 'previous installation\n')
    assert.equal(readFileSync(join(installed, '.cave-source-sha256'), 'utf8'), 'previous checksum\n')
    assert.equal(readFileSync(join(installed, 'retained-file'), 'utf8'), 'keep until replacement validates\n')
    assert.deepEqual(readdirSync(join(cache, 'tools/wasi-sdk/29.0')), [platform])
    prepareArchive('29.0')
    const recovered = run()
    assert.equal(recovered.status, 0, recovered.stderr)
    assert.equal(readFileSync(join(installed, 'VERSION'), 'utf8'), '29.0\nwasi-libc: fixture\n')
    assert.equal(existsSync(join(installed, 'retained-file')), false)
    // A matching archive marker does not make a prefix-only version trustworthy.
    writeFileSync(join(installed, 'VERSION'), '29.01\n')
    const repaired = run()
    assert.equal(repaired.status, 0, repaired.stderr)
    assert.equal(readFileSync(join(installed, 'VERSION'), 'utf8'), '29.0\nwasi-libc: fixture\n')
    const expectedMarker = readFileSync(join(installed, '.cave-source-sha256'), 'utf8')
    for (const field of ['VERSION', '.cave-source-sha256']) {
      const path = join(installed, field)
      rmSync(path)
      mkdirSync(path)
      writeFileSync(join(path, 'unexpected-child'), 'corrupt cached metadata\n')
      const repairedDirectory = run()
      assert.equal(repairedDirectory.status, 0, repairedDirectory.stderr)
      assert.equal(readFileSync(join(installed, 'VERSION'), 'utf8'), '29.0\nwasi-libc: fixture\n')
      assert.equal(readFileSync(join(installed, '.cave-source-sha256'), 'utf8'), expectedMarker)
    }
    assert.deepEqual(readdirSync(join(cache, 'tools/wasi-sdk/29.0')), [platform])
  } finally { rmSync(root, { recursive: true, force: true }) }
})
