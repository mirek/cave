#!/usr/bin/env node
import assert from 'node:assert/strict'
import { performance } from 'node:perf_hooks'
import { open } from '../packages/store/src/index.ts'
import { report } from '../packages/view/src/index.ts'

const store = open()
try {
  store.ingest('api HAS status: ready')
  const splice = '`cave-q: api HAS status: ?v`'
  const examples = {
    indented: `    ${splice}\n`,
    html: `<!-- ${splice} -->\n`,
    multiline: `Example: \`\` first\n${splice}\nlast \`\`.\n\n`,
    repeated: `Value: ${splice}\n`
  }
  const measurements = []
  for (const [kind, example] of Object.entries(examples)) {
    for (const count of [1_000, 10_000]) {
      const prefix = example.repeat(count)
      const expectedPrefix = kind === 'repeated' ? 'Value: ready[^c1]\n'.repeat(count) : prefix
      const template = `${prefix}\nLive: ${splice}\n`
      const samplesMs = []
      for (let iteration = 0; iteration < 5; iteration++) {
        const start = performance.now()
        const result = report(store, template)
        samplesMs.push(performance.now() - start)
        assert.deepEqual(result.problems, [], `${kind}/${count}`)
        assert.equal(result.citations, 1, `${kind}/${count}`)
        assert.ok(result.markdown.startsWith(`${expectedPrefix}\nLive: ready[^c1]\n`), `${kind}/${count}: literal examples changed or live splice failed`)
      }
      measurements.push({ kind, examples: count, bytes: Buffer.byteLength(template),
        medianMs: [...samplesMs].sort((a, b) => a - b)[2], samplesMs })
    }
  }
  const compact = report(store, '```cave-q\napi HAS status: ?v\n- ?v\n```')
  for (const kind of ['blank-block', 'blank-fragment']) {
    for (const count of [1_000, 10_000, 100_000]) {
      const blanks = '\n'.repeat(count)
      const template = kind === 'blank-block' ? `\`\`\`cave-q\n${blanks}\`\`\`` :
        `\`\`\`cave-q\n${blanks}api HAS status: ?v\n${blanks}- ?v\n\`\`\``
      const samplesMs = []
      for (let iteration = 0; iteration < 5; iteration++) {
        const start = performance.now()
        const result = report(store, template)
        samplesMs.push(performance.now() - start)
        if (kind === 'blank-block') {
          assert.equal(result.citations, 0)
          assert.equal(result.markdown, '*(invalid query)*\n')
          assert.equal(result.problems.length, 1)
          assert.equal(result.problems[0].line, count + 2)
          assert.match(result.problems[0].message, /empty cave-q block/)
        } else {
          assert.deepEqual(result, compact, `${kind}/${count}: padding changed rendered output`)
        }
      }
      measurements.push({ kind, blankLinesPerPrefix: count, bytes: Buffer.byteLength(template),
        medianMs: [...samplesMs].sort((a, b) => a - b)[2], samplesMs })
    }
  }
  console.log(JSON.stringify({ format: 'cave.report-benchmark', version: 1,
    runtime: { node: process.version, sqlite: process.versions.sqlite, platform: process.platform, arch: process.arch },
    measurements }))
} finally { store.close() }
