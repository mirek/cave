// Isolated MCP historical fusion benchmark; setup and assertions are outside timing.
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import assert from 'node:assert/strict'
import { performance } from 'node:perf_hooks'
import { open } from '../packages/store/src/index.ts'
import { createToolSurface } from '../packages/mcp/src/server.ts'
const store = open()
try {
  const aliases = Array.from({ length: 100 }, (_, i) => `entity/${i} ALIAS entity/${i + 1}`)
  const claims = Array.from({ length: 100 }, (_, i) => `entity/0 HAS score: 10 ms +/- 2 ms @src:source/${i}`)
  const asOf = store.ingest([...aliases, ...claims].join('\n')).ids.at(-1)
  const surface = createToolSurface(store)
  const args = { pattern: '?entity HAS score: ?score', aliases: true, asOf }
  const expected = surface.call('cave_fuse', args)
  assert.equal(expected.isError, undefined)
  assert.match(expected.content[0].text, /fused 100 estimate/)
  const samples = []
  for (let i = 0; i < 5; i++) {
    const start = performance.now()
    const result = surface.call('cave_fuse', args)
    samples.push(performance.now() - start)
    assert.deepEqual(result, expected)
  }
  console.log(JSON.stringify({
    runtime: process.version,
    toolsSha256: createHash('sha256').update(readFileSync(new URL('../packages/mcp/src/tools.ts', import.meta.url))).digest('hex'),
    outputSha256: createHash('sha256').update(JSON.stringify(expected)).digest('hex'),
    aliases: 100,
    estimates: 100,
    samplesMs: samples,
    medianMs: [...samples].sort((a, b) => a - b)[2]
  }, null, 2))
} finally { store.close() }
