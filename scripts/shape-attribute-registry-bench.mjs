/** Run alone: attribute-only checks after peer commits with unrelated vocabulary. */
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { performance } from 'node:perf_hooks'
import { open } from '../packages/store/src/index.ts'
import { evaluate } from '../packages/shape/src/index.ts'
const letters = index => {
  let text = ''
  do { text = String.fromCharCode(65 + index % 26) + text; index = Math.floor(index / 26) } while (index > 0)
  return text
}
for (const declarations of [100, 1000, 3000]) {
  const dir = mkdtempSync(join(tmpdir(), 'cave-shape-attribute-bench-'))
  const path = join(dir, 'knowledge.db')
  const writer = open(path)
  let reader
  try {
    assert.deepEqual(writer.ingest(Array.from({ length: declarations }, (_, i) => `CUSTOM-${letters(i)} IS verb`).join('\n') +
      '\nservice EXPECTS owner\napi IS service\napi HAS owner: team').problems, [])
    reader = open(path, { access: 'read-only' })
    evaluate(reader)
    const samples = []
    for (let sample = 0; sample < 5; sample++) {
      writer.ingest(`clock HAS tick: ${sample}`)
      const before = writer.exportText({ tx: true, maxSensitivity: 'restricted' })
      const start = performance.now()
      const result = evaluate(reader)
      samples.push(performance.now() - start)
      assert.equal(result.checks, 1)
      assert.deepEqual(result.violations, [])
      assert.equal(writer.exportText({ tx: true, maxSensitivity: 'restricted' }), before)
    }
    samples.sort((a, b) => a - b)
    console.log(JSON.stringify({ node: process.version, declarations, medianMs: samples[2] }))
  } finally { reader?.close(); writer.close(); rmSync(dir, { recursive: true, force: true }) }
}
