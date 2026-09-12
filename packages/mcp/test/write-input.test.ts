import { test } from 'node:test'
import * as assert from 'node:assert/strict'
import { PassThrough } from 'node:stream'
import { once } from 'node:events'
import { open } from '@cavelang/store'
import { createToolSurface, serve } from '../src/server.ts'

for (const field of ['strict', 'dryRun', 'full', 'aliases'] as const) {
  test(`MCP write tool rejects malformed ${field} before appending claims`, () => {
    const store = open(), surface = createToolSurface(store)
    const tool = field === 'strict' ? 'cave_add' : 'cave_derive'
    try {
      store.ingest('a NEEDS b\nb NEEDS c\nrule/needs HAS rule: `?x NEEDS ?y, ?y NEEDS ?z => ?x NEEDS ?z`')
      const history = store.exportText({ tx: true, maxSensitivity: 'restricted' })
      for (const value of ['true', 'false', null, 0, 1, [], {}]) {
        const result = surface.call(tool, { ...(field === 'strict' ? { text: 'new IS service' } : {}), [field]: value })
        assert.equal(result.isError, true, JSON.stringify(value))
        assert.deepEqual(result.content, [{ type: 'text', text: `${field} must be a boolean` }])
        assert.equal(store.exportText({ tx: true, maxSensitivity: 'restricted' }), history)
      }
      const preview = surface.call('cave_derive', { dryRun: true, full: false, aliases: false })
      assert.equal(preview.isError, undefined)
      assert.match(preview.content[0].text, /derived \(dry run\)/)
      assert.equal(store.exportText({ tx: true, maxSensitivity: 'restricted' }), history)
      const valid = surface.call(tool, field === 'strict'
        ? { text: 'new IS service', strict: true }
        : { dryRun: false, full: true, aliases: false })
      assert.equal(valid.isError, undefined)
      assert.notEqual(store.exportText({ tx: true, maxSensitivity: 'restricted' }), history)
    } finally { store.close() }
  })
}


test('stdio write flags reject malformed previews and retain same-session recovery', async () => {
  const store = open(), input = new PassThrough(), output = new PassThrough()
  const controller = new AbortController(), fallback = setTimeout(() => controller.abort(), 5000)
  const serving = serve(store, input, output, { signal: controller.signal })
  let id = 0
  const call = async (name: string, args: Record<string, unknown>) => {
    const reply = once(output, 'data', { signal: controller.signal })
    input.write(JSON.stringify({ jsonrpc: '2.0', id: ++id, method: 'tools/call', params: {
      name, arguments: args,
      _meta: {
        'io.modelcontextprotocol/protocolVersion': '2026-07-28',
        'io.modelcontextprotocol/clientInfo': { name: 'test', version: '0' },
        'io.modelcontextprotocol/clientCapabilities': {}
      }
    } }) + '\n')
    const [bytes] = await reply
    const response = JSON.parse(String(bytes))
    assert.equal(response.id, id)
    assert.equal(response.error, undefined)
    return response.result
  }
  try {
    store.ingest('a NEEDS b\nb NEEDS c\nrule/needs HAS rule: `?x NEEDS ?y, ?y NEEDS ?z => ?x NEEDS ?z`')
    const history = () => store.exportText({ tx: true, maxSensitivity: 'restricted' })
    const before = history()
    for (const field of ['strict', 'dryRun', 'full', 'aliases']) {
      for (const value of ['true', 'false', null, 0]) {
        const result = await call(field === 'strict' ? 'cave_add' : 'cave_derive', {
          ...(field === 'strict' ? { text: 'new IS service' } : {}), [field]: value
        })
        assert.equal(result.isError, true)
        assert.deepEqual(result.content, [{ type: 'text', text: `${field} must be a boolean` }])
        assert.equal(history(), before)
      }
    }
    const preview = await call('cave_derive', { dryRun: true, full: false, aliases: false })
    assert.equal(preview.isError, undefined)
    assert.match(preview.content[0].text, /derived \(dry run\)/)
    assert.equal(history(), before)
    const added = await call('cave_add', { text: 'new IS service', strict: true })
    assert.equal(added.isError, undefined)
    assert.ok(store.currentBeliefs().some(row => row.subject === 'new'))
    const derived = await call('cave_derive', { dryRun: false, full: true, aliases: false })
    assert.equal(derived.isError, undefined)
    assert.ok(store.currentBeliefs().some(row => row.subject === 'a' && row.object === 'c'))
    input.end()
    await serving
    assert.equal(controller.signal.aborted, false)
  } finally {
    clearTimeout(fallback); controller.abort()
    await serving.catch(() => {})
    input.destroy(); output.destroy(); store.close()
  }
})
