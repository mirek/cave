/** Deterministic representative performance gate. */

import { readFileSync } from 'node:fs'
import { performance } from 'node:perf_hooks'
import { open } from '../packages/store/src/index.ts'
import { evaluate } from '../packages/shape/src/check.ts'
import { page, query } from '../packages/query/src/index.ts'
import { compile } from '../packages/query/src/compile.ts'
import * as Pattern from '../packages/query/src/pattern.ts'
import { topics } from '../packages/view/src/api.ts'
import { clearScopedStoreCache, scopedStoreCacheStats } from '../packages/view/src/scope.ts'

const baseline = JSON.parse(readFileSync(
  new URL('../benchmarks/performance-baseline.json', import.meta.url), 'utf8'))
if (baseline.format !== 'cave.performance-baseline' || baseline.version !== 1) {
  throw new Error('performance benchmark: unsupported baseline format')
}

const measurements = {}
const measure = (name, body) => {
  const expected = baseline.workloads[name]
  if (expected === undefined) throw new Error(`performance benchmark: no baseline for ${name}`)
  const started = performance.now()
  const evidence = body()
  const ms = Number((performance.now() - started).toFixed(3))
  measurements[name] = {
    ms,
    baselineMs: expected.baselineMs,
    thresholdMs: expected.thresholdMs,
    ratio: Number((ms / expected.baselineMs).toFixed(2)),
    evidence
  }
}

const storeSize = store => {
  const pages = store.db.prepare('PRAGMA page_count').get().page_count
  const pageSize = store.db.prepare('PRAGMA page_size').get().page_size
  return {
    claims: store.db.prepare('SELECT COUNT(*) AS n FROM cave_claim').get().n,
    contexts: store.db.prepare('SELECT COUNT(*) AS n FROM cave_context').get().n,
    bytes: Number(pages) * Number(pageSize)
  }
}

const planOf = (store, compiled) =>
  store.db.prepare(`EXPLAIN QUERY PLAN ${compiled.sql}`).all(...compiled.params)
    .map(row => String(row.detail))

// One contested attribute group per entity, three independent source series.
const groups = 600
const sourceStore = open()
sourceStore.ingest(Array.from({ length: groups }, (_, index) => [
  `entity/${index} HAS score: ${index} @src:bench/a @ 70%`,
  `entity/${index} HAS score: ${index + 1} @src:bench/b @ 80%`,
  `entity/${index} HAS score: ${index + 2} @src:bench/c @ 90%`
]).flat().join('\n'), { strict: true })

let exported = ''
measure('export', () => {
  exported = sourceStore.exportText({ maxSensitivity: 'restricted' })
  const lines = exported.trim().split('\n').length
  if (lines !== groups * 3) throw new Error(`export benchmark: expected ${groups * 3} lines, got ${lines}`)
  return { lines }
})

const importedStore = open()
measure('import', () => {
  const result = importedStore.ingest(exported, { strict: true })
  if (result.ids.length !== groups * 3) {
    throw new Error(`import benchmark: expected ${groups * 3} rows, got ${result.ids.length}`)
  }
  return { inserted: result.ids.length }
})

measure('resolution', () => {
  const winners = importedStore.resolvedBeliefs()
  if (winners.length !== groups) {
    throw new Error(`resolution benchmark: expected ${groups} winners, got ${winners.length}`)
  }
  return { groups, winners: winners.length }
})

const shapeStore = open()
const shapeExpectations = 20
const shapeInstances = 500
shapeStore.ingest([
  ...Array.from({ length: shapeExpectations }, (_, index) => `service EXPECTS field-${index}`),
  ...Array.from({ length: shapeInstances }, (_, index) => `service/${index} IS service`)
].join('\n'), { strict: true })
measure('shape', () => {
  const result = evaluate(shapeStore)
  const expected = shapeExpectations * shapeInstances
  if (result.checks !== expected || result.violations.length !== expected) {
    throw new Error(`shape benchmark: expected ${expected} failed checks`)
  }
  return { checks: result.checks, violations: result.violations.length }
})

const queryStore = open()
const services = 1_500
const hops = 250
queryStore.ingest([
  ...Array.from({ length: services }, (_, index) => `service/${index} USES jwt`),
  ...Array.from({ length: hops }, (_, index) => `node/${index} REACHES node/${index + 1}`)
].join('\n'), { strict: true })

const boundedCompiled = compile(
  Pattern.parse('?service USES jwt'), queryStore.registry(), { limit: 101, offset: 0 })
measure('boundedQuery', () => {
  const result = page(queryStore, '?service USES jwt', { limit: 100 })
  if (result.matches.length !== 100 || result.next === undefined) {
    throw new Error('bounded query benchmark: expected a full page and continuation')
  }
  return { matches: result.matches.length, continuation: true }
})

const transitiveCompiled = compile(
  Pattern.parse('node/0 REACHES+ ?destination'), queryStore.registry(), {})
measure('transitiveQuery', () => {
  const matches = query(queryStore, 'node/0 REACHES+ ?destination')
  if (matches.length !== hops) {
    throw new Error(`transitive query benchmark: expected ${hops} matches, got ${matches.length}`)
  }
  return { hops, matches: matches.length }
})

const boundedPlan = planOf(queryStore, boundedCompiled)
const transitivePlan = planOf(queryStore, transitiveCompiled)
if (!boundedPlan.some(step => step.includes('INDEX')) ||
    !transitivePlan.some(step => step.includes('INDEX'))) {
  throw new Error('performance benchmark: query plan lost indexed access')
}

const viewTopics = 50
const sensitivitySuffixes = [
  ' #sensitivity:public',
  '',
  ' #sensitivity:confidential',
  ' #sensitivity:future-level'
]
const viewFixture = claims => {
  const store = open()
  store.ingest(Array.from({ length: claims }, (_, index) => {
    // Whole 50-row blocks rotate through all four policy cases so every
    // topic has the same visible population, independent of its index.
    const policy = Math.floor(index / viewTopics) % sensitivitySuffixes.length
    return `topic/${index % viewTopics} CONTAINS item/${index}${sensitivitySuffixes[policy]}`
  }).join('\n'), { strict: true })
  return store
}

const smallViewRows = 200
const smallViewStore = viewFixture(smallViewRows)
measure('scopedViewSmall', () => {
  let result = []
  const calls = 5
  for (let call = 0; call < calls; call += 1) result = topics(smallViewStore)
  const allocation = scopedStoreCacheStats(smallViewStore)
  if (result.length !== viewTopics || allocation.builds !== 1 || allocation.hits !== calls - 1 ||
      allocation.cachedClaims !== smallViewRows / 2) {
    throw new Error('small scoped-view benchmark did not reuse one correctly filtered projection')
  }
  return { calls, topics: result.length, allocation }
})

const largeViewRows = 5_000
const largeViewStore = viewFixture(largeViewRows)
measure('scopedViewLargeCold', () => {
  const result = topics(largeViewStore)
  const allocation = scopedStoreCacheStats(largeViewStore)
  if (result.length !== viewTopics || allocation.builds !== 1 ||
      allocation.cachedClaims !== largeViewRows / 2) {
    throw new Error('large scoped-view benchmark built an unexpected projection')
  }
  return { calls: 1, topics: result.length, allocation }
})

const warmViewCalls = 10
measure('scopedViewLargeWarm', () => {
  let result = []
  for (let call = 0; call < warmViewCalls; call += 1) result = topics(largeViewStore)
  const allocation = scopedStoreCacheStats(largeViewStore)
  if (result.length !== viewTopics || allocation.builds !== 1 || allocation.hits !== warmViewCalls) {
    throw new Error('large scoped-view benchmark rebuilt instead of reusing its projection')
  }
  return { calls: warmViewCalls, topics: result.length, allocation }
})

const coldViewMs = measurements.scopedViewLargeCold.ms
const warmViewMsPerCall = measurements.scopedViewLargeWarm.ms / warmViewCalls
if (warmViewMsPerCall * 5 >= coldViewMs) {
  throw new Error(
    `scoped-view benchmark: warm ${warmViewMsPerCall.toFixed(3)}ms/read is not at least 5x faster than cold ${coldViewMs}ms`)
}

// Restricted is the explicit complete-store path and must stay allocation-free.
clearScopedStoreCache(largeViewStore)
measure('restrictedViewLarge', () => {
  let result = []
  const calls = 10
  for (let call = 0; call < calls; call += 1) {
    result = topics(largeViewStore, { maxSensitivity: 'restricted' })
  }
  const allocation = scopedStoreCacheStats(largeViewStore)
  if (result.length !== viewTopics || allocation.projections !== 0 || allocation.builds !== 0) {
    throw new Error('restricted-view benchmark unexpectedly allocated a projection')
  }
  return { calls, topics: result.length, allocation }
})

const report = {
  format: 'cave.performance-report',
  version: 1,
  fixture: {
    resolutionGroups: groups,
    shapeExpectations,
    shapeInstances,
    services,
    hops,
    smallViewRows,
    largeViewRows,
    viewTopics
  },
  stores: {
    resolution: storeSize(importedStore),
    shape: storeSize(shapeStore),
    query: storeSize(queryStore),
    view: storeSize(largeViewStore)
  },
  plans: {
    bounded: boundedPlan,
    transitive: transitivePlan
  },
  measurements
}
process.stdout.write(`${JSON.stringify(report)}\n`)

const failures = Object.entries(measurements)
  .filter(([, result]) => result.ms > result.thresholdMs)
  .map(([name, result]) => `${name}: ${result.ms}ms > ${result.thresholdMs}ms`)

sourceStore.close()
importedStore.close()
shapeStore.close()
queryStore.close()
clearScopedStoreCache(smallViewStore)
smallViewStore.close()
largeViewStore.close()

if (failures.length > 0) {
  throw new Error(`performance regression threshold exceeded:\n${failures.join('\n')}`)
}
