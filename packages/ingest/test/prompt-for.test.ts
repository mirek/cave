import { test } from 'node:test'
import * as assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { open } from '@cavelang/store'
import { promptFor } from '@cavelang/ingest'

for (const field of ['path', 'content', 'instructions'] as const) {
  test(`promptFor captures ${field} once and reads fresh values on a later call`, () => {
    const dir = mkdtempSync(join(tmpdir(), 'cave-prompt-for-'))
    const store = open()
    try {
      writeFileSync(join(dir, 'first.md'), 'first file')
      writeFileSync(join(dir, 'later.md'), 'later file')
      const firstInstructions = join(dir, 'first-instructions.md')
      const laterInstructions = join(dir, 'later-instructions.md')
      writeFileSync(firstInstructions, 'first instructions')
      writeFileSync(laterInstructions, 'later instructions')
      const original = { path: 'first.md', digest: 'abc123', content: field === 'content' ? 'selected content' : undefined }
      const options = { cwd: dir, embed: field === 'path', mode: 'stdout' as const, instructions: firstInstructions }
      let reads = 0
      const next = field === 'path' ? 'later.md' : field === 'content' ? undefined : laterInstructions
      const get = () => ++reads === 1 ? field === 'instructions' ? firstInstructions : original[field] : next
      const file = field === 'instructions' ? original : { ...original, get [field]() { return get() } }
      const settings = field === 'instructions' ? { ...options, get instructions() { return get() } } : options
      const files = [file as typeof original]
      assert.equal(promptFor(store, files, settings), promptFor(store, [original], options))
      assert.equal(reads, 1)
      const laterFile = field === 'instructions' ? original : { ...original, [field]: next }
      const laterOptions = field === 'instructions' ? { ...options, instructions: next } : options
      assert.equal(promptFor(store, files, settings), promptFor(store, [laterFile], laterOptions))
      assert.equal(reads, 2)
    } finally {
      store.close()
      rmSync(dir, { recursive: true, force: true })
    }
  })
}
