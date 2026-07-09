import { test } from 'node:test'
import * as assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createInterface } from 'node:readline'

const cliMain = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'cli', 'src', 'main.ts')

test('cave mcp speaks MCP over stdio end to end', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'cave-mcp-'))
  const db = join(dir, 'k.db')
  const child = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', cliMain, 'mcp', '--db', db], {
    stdio: ['pipe', 'pipe', 'pipe']
  })
  try {
    const lines = createInterface({ input: child.stdout })
    const pending = new Map<number, (response: Record<string, unknown>) => void>()
    lines.on('line', line => {
      const message = JSON.parse(line) as { id: number }
      pending.get(message.id)?.(message as unknown as Record<string, unknown>)
      pending.delete(message.id)
    })
    let nextId = 0
    const rpc = (method: string, params?: unknown): Promise<Record<string, unknown>> => {
      const id = ++nextId
      const promise = new Promise<Record<string, unknown>>((resolve, reject) => {
        const timer = setTimeout(() => {
          pending.delete(id)
          reject(new Error(`timeout waiting for ${method}`))
        }, 15_000)
        timer.unref()
        pending.set(id, response => {
          clearTimeout(timer)
          resolve(response)
        })
      })
      child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, ...params === undefined ? {} : { params } })}\n`)
      return promise
    }
    const text = (response: Record<string, unknown>): string =>
      ((response['result'] as Record<string, unknown>)['content'] as { text: string }[])[0]!.text

    const initialized = await rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '0' } })
    assert.equal((initialized['result'] as Record<string, unknown>)['protocolVersion'], '2025-06-18')
    child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })}\n`)

    const added = await rpc('tools/call', { name: 'cave_add', arguments: { text: 'auth USES jwt @ 90%' } })
    assert.match(text(added), /added 1 claim/)
    const queried = await rpc('tools/call', { name: 'cave_query', arguments: { pattern: '?x USES jwt' } })
    assert.match(text(queried), /\?x = auth/)

    child.stdin.end()
    const code = await new Promise<number | null>(resolve => child.on('close', resolve))
    assert.equal(code, 0)
  } finally {
    child.kill()
    rmSync(dir, { recursive: true, force: true })
  }
})

test('cave mcp --read-only --tools serves the narrowed surface over stdio', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'cave-mcp-'))
  const db = join(dir, 'k.db')
  const child = spawn(process.execPath, [
    '--disable-warning=ExperimentalWarning', cliMain, 'mcp', '--db', db,
    '--read-only', '--tools', 'cave_add,cave_query'
  ], { stdio: ['pipe', 'pipe', 'pipe'] })
  try {
    const lines = createInterface({ input: child.stdout })
    const pending = new Map<number, (response: Record<string, unknown>) => void>()
    lines.on('line', line => {
      const message = JSON.parse(line) as { id: number }
      pending.get(message.id)?.(message as unknown as Record<string, unknown>)
      pending.delete(message.id)
    })
    let nextId = 0
    const rpc = (method: string, params?: unknown): Promise<Record<string, unknown>> => {
      const id = ++nextId
      const promise = new Promise<Record<string, unknown>>((resolve, reject) => {
        const timer = setTimeout(() => {
          pending.delete(id)
          reject(new Error(`timeout waiting for ${method}`))
        }, 15_000)
        timer.unref()
        pending.set(id, response => {
          clearTimeout(timer)
          resolve(response)
        })
      })
      child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, ...params === undefined ? {} : { params } })}\n`)
      return promise
    }

    const initialized = await rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '0' } })
    assert.match((initialized['result'] as { instructions: string }).instructions, /read-only/)
    const listed = await rpc('tools/list')
    const names = ((listed['result'] as Record<string, unknown>)['tools'] as { name: string }[]).map(tool => tool.name)
    assert.deepEqual(names, ['cave_query'], '--read-only drops cave_add from the --tools list')
    const denied = await rpc('tools/call', { name: 'cave_add', arguments: { text: 'a USES b' } })
    assert.equal((denied['error'] as { code: number }).code, -32602)

    child.stdin.end()
    const code = await new Promise<number | null>(resolve => child.on('close', resolve))
    assert.equal(code, 0)
  } finally {
    child.kill()
    rmSync(dir, { recursive: true, force: true })
  }
})

test('cave mcp rejects an unknown --tools name before serving', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'cave-mcp-'))
  const db = join(dir, 'k.db')
  const child = spawn(process.execPath, [
    '--disable-warning=ExperimentalWarning', cliMain, 'mcp', '--db', db, '--tools', 'cave_nope'
  ], { stdio: ['pipe', 'pipe', 'pipe'] })
  try {
    let stderr = ''
    child.stderr.on('data', chunk => { stderr += String(chunk) })
    const code = await new Promise<number | null>(resolve => child.on('close', resolve))
    assert.equal(code, 2)
    assert.match(stderr, /unknown tool\(s\): cave_nope/)
    assert.ok(!existsSync(db), 'validation fails before the database is touched')
  } finally {
    child.kill()
    rmSync(dir, { recursive: true, force: true })
  }
})
