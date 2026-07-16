/** Deterministic chain/branch/cycle benchmark for seeded transitive plans. */

import { performance } from 'node:perf_hooks'
import { open } from '@cavelang/store'
import { query } from '../src/compile.ts'

type Case = { readonly name: string, readonly edges: readonly string[], readonly seed: string }

const cases: readonly Case[] = [
  {
    name: 'chain',
    edges: Array.from({ length: 120 }, (_, index) => `n/${index} REACHES n/${index + 1}`),
    seed: 'n/0'
  },
  {
    name: 'branches',
    edges: Array.from({ length: 127 }, (_, index) => [
      `tree/${index} REACHES tree/${index * 2 + 1}`,
      `tree/${index} REACHES tree/${index * 2 + 2}`
    ]).flat(),
    seed: 'tree/0'
  },
  {
    name: 'cycle',
    edges: Array.from({ length: 120 }, (_, index) => `ring/${index} REACHES ring/${(index + 1) % 120}`),
    seed: 'ring/0'
  }
]

for (const entry of cases) {
  const store = open()
  store.ingest(entry.edges.join('\n'))
  const run = (input: string): { readonly ms: number, readonly matches: number } => {
    const start = performance.now()
    const matches = query(store, input).length
    return { ms: Number((performance.now() - start).toFixed(3)), matches }
  }
  const bound = run(`${entry.seed} REACHES+ ?destination`)
  const unbound = run('?source REACHES+ ?destination')
  process.stdout.write(`${JSON.stringify({ scenario: entry.name, edges: entry.edges.length, bound, unbound })}\n`)
  store.close()
}
