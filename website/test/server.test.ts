import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { request } from 'node:http'
import { once } from 'node:events'
import { fileURLToPath } from 'node:url'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const get = (url: string, path: string): Promise<number | undefined> => new Promise((resolve, reject) => {
  const req = request(url, { path }, response => {
    response.resume()
    response.on('error', reject)
    response.on('end', () => resolve(response.statusCode))
  })
  req.on('error', reject)
  req.end()
})

const withPreview = async (args: string[], body: (url: string) => Promise<void>): Promise<void> => {
  const child = spawn(process.execPath, [...args, fileURLToPath(new URL('./serve-dist.mjs', import.meta.url))], {
    env: { ...process.env, PORT: '0' }, stdio: ['ignore', 'pipe', 'pipe']
  })
  const stopped = once(child, 'close')
  try {
    const url = await new Promise<string>((resolve, reject) => {
      let output = ''
      child.stdout.setEncoding('utf8')
      child.stdout.on('data', chunk => {
        output += chunk
        const match = /http:\/\/127\.0\.0\.1:(\d+)\/cave\//.exec(output)
        if (match) resolve(match[0])
      })
      child.on('error', reject)
      child.on('exit', code => reject(new Error(`preview exited before ready: ${code}`)))
    })
    await body(url)
  } finally {
    child.kill()
    await stopped
  }
}

test('production preview refuses malformed paths without terminating', { timeout: 15000 }, () =>
  withPreview([], async url => {
    for (const path of ['/cave/%', '/cave/%E0%A4%A', '//[']) {
      assert.equal(await get(url, path), 400, path)
      assert.equal(await get(url, '/outside-preview'), 404)
    }
  }))

test('production preview survives file metadata and stream-open failures', { timeout: 15000 }, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'cave-preview-fault-'))
  try {
    const preload = join(dir, 'fault.mjs')
    writeFileSync(preload, `
import fs from 'node:fs'
import { Readable } from 'node:stream'
import { syncBuiltinESMExports } from 'node:module'
const exists = fs.existsSync, stat = fs.statSync, stream = fs.createReadStream
fs.existsSync = path => String(path).endsWith('-fault.js') || exists(path)
fs.statSync = (path, ...args) => {
  if (String(path).endsWith('stat-fault.js')) throw Object.assign(new Error('removed asset'), { code: 'ENOENT' })
  if (String(path).endsWith('stream-fault.js') || String(path).endsWith('read-fault.js')) return { isFile: () => true }
  return stat(path, ...args)
}
fs.createReadStream = (path, ...args) => {
  if (!String(path).endsWith('stream-fault.js') && !String(path).endsWith('read-fault.js')) return stream(path, ...args)
  const result = new Readable({ read() {} })
  process.nextTick(() => {
    if (String(path).endsWith('read-fault.js')) {
      result.emit('open', 1)
      result.push('partial asset')
      setImmediate(() => result.destroy(new Error('asset read failed')))
    } else result.destroy(Object.assign(new Error('denied asset'), { code: 'EACCES' }))
  })
  return result
}
syncBuiltinESMExports()
`)
    await withPreview(['--import', preload], async url => {
      assert.equal(await get(url, '/cave/stat-fault.js'), 404)
      assert.equal(await get(url, '/outside-preview'), 404)
      assert.equal(await get(url, '/cave/stream-fault.js'), 500)
      assert.equal(await get(url, '/outside-preview'), 404)
      await assert.rejects(get(url, '/cave/read-fault.js'))
      assert.equal(await get(url, '/outside-preview'), 404)
    })
  } finally { rmSync(dir, { recursive: true, force: true }) }
})
