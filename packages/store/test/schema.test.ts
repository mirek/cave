import { test } from 'node:test'
import * as assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { open } from '@cavelang/store'

type QueryPlanRow = {
  readonly detail: string
}

const queryPlan = (store: ReturnType<typeof open>, sql: string): string =>
  (store.db.prepare(`EXPLAIN QUERY PLAN ${sql}`).all('claim-id') as QueryPlanRow[])
    .map(row => row.detail)
    .join('\n')

test('metadata lookups by claim use covering indexes', () => {
  const store = open()
  try {
    assert.match(
      queryPlan(store, 'SELECT context FROM cave_context WHERE claim_id = ?'),
      /USING COVERING INDEX idx_cave_context_claim \(claim_id=\?\)/
    )
    assert.match(
      queryPlan(store, 'SELECT key, value FROM cave_tag WHERE claim_id = ?'),
      /USING COVERING INDEX idx_cave_tag_claim \(claim_id=\?\)/
    )
    assert.match(
      queryPlan(store, "SELECT claim_id FROM cave_provenance WHERE dimension = 'run' AND value = ?"),
      /USING COVERING INDEX idx_cave_provenance_lookup \(dimension=\? AND value=\?\)/
    )
  } finally {
    store.close()
  }
})

test('opening an existing store installs metadata claim indexes without losing data', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cave-schema-'))
  const path = join(dir, 'existing.db')
  try {
    const existing = open(path)
    existing.ingest('api HAS owner: platform @production #team:core')
    existing.db.exec('DROP INDEX IF EXISTS idx_cave_context_claim')
    existing.db.exec('DROP INDEX IF EXISTS idx_cave_tag_claim')
    existing.db.exec('DROP INDEX IF EXISTS idx_cave_provenance_lookup')
    existing.close()

    const upgraded = open(path)
    try {
      const indexes = upgraded.db.prepare(`
        SELECT name FROM sqlite_schema
        WHERE type = 'index' AND name IN (
          'idx_cave_context_claim', 'idx_cave_provenance_lookup', 'idx_cave_tag_claim'
        )
        ORDER BY name
      `).all() as { name: string }[]
      assert.deepEqual(indexes.map(row => row.name), [
        'idx_cave_context_claim',
        'idx_cave_provenance_lookup',
        'idx_cave_tag_claim'
      ])
      assert.equal(upgraded.byContext('production').length, 1)
      assert.equal(upgraded.byTag('team', 'core').length, 1)
    } finally {
      upgraded.close()
    }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
