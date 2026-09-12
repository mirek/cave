/** Deterministic differential audit; run with either supported Node major. */
import assert from 'node:assert/strict'
import { open } from '../packages/store/src/index.ts'
import {
  memoryStoreOfText, sqliteStore, reconstruct, reconstructAsync, heuristicPolicy
} from '../packages/loop/src/index.ts'
import { emitClaim } from '../packages/canonical/src/index.ts'

const seed = 0xcafe1234
let random = seed
const pick = values => {
  random = (Math.imul(random, 1664525) + 1013904223) >>> 0
  return values[Math.floor(random / 2 ** 32 * values.length)]
}
const entities = ['alpha', 'beta', 'café', '服务', 'api.example', 'topic/one', '"literal"', '`code`']
const edgeOf = edge => ({ ...edge, claim: emitClaim(edge.claim) })
const reconstructionOf = result => ({
  claims: result.claims.map(emitClaim),
  trace: result.trace.map(step => ({ ...step, edges: step.edges.map(edgeOf) })),
  frontier: result.state.frontier,
  visited: [...result.state.visited],
  collected: result.state.collected.map(emitClaim),
  steps: result.state.steps
})
const asyncPolicy = () => {
  const policy = heuristicPolicy()
  return Object.fromEntries(Object.entries(policy).map(([name, decide]) => [name, async (...args) => {
    await Promise.resolve()
    return decide(...args)
  }]))
}

const fixtures = 100
let checks = 0
for (let fixture = 0; fixture < fixtures; fixture++) {
  const lines = ['LINKS IS verb', 'LINKS REVERSE LINKED-BY']
  for (let index = 0; index < 60; index++) {
    const subject = pick(entities)
    const object = pick(entities)
    const verb = pick(['USES', 'CONTAINS', 'LINKS', 'LINKED-BY'])
    const body = pick([
      `${subject} ${verb} ${object}`,
      `${subject} ${verb} NOT ${object}`,
      `${subject} HAS count: ${index}`,
      `${subject} EXISTS`
    ])
    lines.push(`${body}${pick(['', ' @src:one', ' @src:two'])}${pick(['', ' @ 0%', ' @ 50%', ' @ 90%'])}`)
    if (index % 7 === 0) lines.push(lines.at(-1))
  }
  const text = lines.join('\n')
  const db = open()
  try {
    db.ingest(text, { strict: true })
    const sql = sqliteStore(db)
    const memory = memoryStoreOfText(text)
    for (const entity of entities) {
      for (const method of ['forward', 'reverse', 'claimsAbout', 'expandTopic', 'topicsOf']) {
        const project = items => items.map(method === 'claimsAbout' ? emitClaim
          : method === 'forward' || method === 'reverse' ? edgeOf : value => value)
        assert.deepEqual(project(memory[method](entity)), project(sql[method](entity)),
          `fixture ${fixture}: ${method} ${entity}`)
        checks++
      }
      const expected = reconstructionOf(reconstruct(sql, heuristicPolicy(), [entity]))
      assert.deepEqual(reconstructionOf(reconstruct(memory, heuristicPolicy(), [entity])), expected,
        `fixture ${fixture}: synchronous reconstruction ${entity}`)
      checks++
      for (const [name, store] of [['memory', memory], ['sqlite', sql]]) {
        assert.deepEqual(reconstructionOf(await reconstructAsync(store, asyncPolicy(), [entity])), expected,
          `fixture ${fixture}: asynchronous ${name} reconstruction ${entity}`)
        checks++
      }
    }
  } catch (error) {
    console.error(`Failing fixture ${fixture}, seed ${seed.toString(16)}:\n${text}`)
    throw error
  } finally {
    db.close()
  }
}
console.log(JSON.stringify({ node: process.version, fixtures, checks, seed: seed.toString(16) }))
