import { test } from 'node:test'
import * as assert from 'node:assert/strict'
import { copyFileSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { open, Schema } from '@cavelang/store'

type QueryPlanRow = {
  readonly detail: string
}

const queryPlan = (store: ReturnType<typeof open>, sql: string): string =>
  (store.db.prepare(`EXPLAIN QUERY PLAN ${sql}`).all('claim-id') as QueryPlanRow[])
    .map(row => row.detail)
    .join('\n')

test('version 1 requires a writing upgrade and leaves a closed backup unchanged', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cave-schema-v1-'))
  const path = join(dir, 'old.db'), backup = join(dir, 'old.backup.db')
  try {
    const source = open(path)
    source.ingest('api IS service\n  WHEN review IS complete', { provenance: { sources: ['manual'], domains: ['team/platform'] } })
    const before = source.exportText({ tx: true, maxSensitivity: 'restricted' })
    source.db.exec('DROP INDEX idx_cave_tx')
    source.db.exec('PRAGMA user_version = 1')
    source.close()
    copyFileSync(path, backup)
    for (const access of ['read-only', 'no-migrate'] as const) {
      assert.throws(() => open(path, { access }), /schema version 1 needs migration to 2/)
    }
    const upgraded = open(path)
    assert.equal(Schema.versionOf(upgraded.db), 2)
    assert.equal(upgraded.exportText({ tx: true, maxSensitivity: 'restricted' }), before)
    upgraded.close()
    const untouched = new DatabaseSync(backup)
    assert.equal(Schema.versionOf(untouched), 1)
    assert.equal(untouched.prepare("SELECT 1 FROM sqlite_schema WHERE name = 'idx_cave_tx'").get(), undefined)
    untouched.close()
    const restored = open(backup)
    assert.equal(restored.exportText({ tx: true, maxSensitivity: 'restricted' }), before)
    restored.close()
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('metadata lookups by claim use covering indexes', () => {
  const store = open()
  try {
    assert.equal((store.db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version,
      Schema.currentVersion)
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

test('version 0 upgrades deterministically without losing data', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cave-schema-'))
  const path = join(dir, 'existing.db')
  try {
    const existing = open(path)
    existing.ingest('api HAS owner: platform @production #team:core')
    existing.db.exec('DROP INDEX IF EXISTS idx_cave_context_claim')
    existing.db.exec('DROP INDEX IF EXISTS idx_cave_tag_claim')
    existing.db.exec('DROP INDEX IF EXISTS idx_cave_provenance_lookup')
    existing.db.exec('PRAGMA user_version = 0')
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
      assert.equal((upgraded.db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version,
        Schema.currentVersion)
    } finally {
      upgraded.close()
    }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('a newer schema version fails clearly without modifying the database', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cave-schema-newer-'))
  const path = join(dir, 'future.db')
  try {
    const future = new DatabaseSync(path)
    future.exec(`PRAGMA user_version = ${Schema.currentVersion + 1}`)
    future.exec('CREATE TABLE future_data (value TEXT)')
    future.exec("INSERT INTO future_data VALUES ('kept')")
    future.close()
    assert.throws(() => open(path), /schema version 3 is newer than this runtime supports \(2\); upgrade CAVE/)
    const unchanged = new DatabaseSync(path)
    assert.equal((unchanged.prepare('PRAGMA user_version').get() as { user_version: number }).user_version, Schema.currentVersion + 1)
    assert.equal((unchanged.prepare('SELECT value FROM future_data').get() as { value: string }).value, 'kept')
    assert.equal(unchanged.prepare("SELECT 1 FROM sqlite_schema WHERE name = 'cave_claim'").get(), undefined)
    unchanged.close()
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('a damaged current schema fails validation instead of silently repairing itself', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cave-schema-invalid-'))
  const path = join(dir, 'invalid.db')
  try {
    const store = open(path)
    store.db.exec('DROP INDEX idx_cave_context_claim')
    store.close()
    assert.throws(() => open(path),
      /schema version 2 is incompatible: missing index idx_cave_context_claim/)
    const unchanged = new DatabaseSync(path)
    assert.equal(unchanged.prepare(
      "SELECT 1 FROM sqlite_schema WHERE name = 'idx_cave_context_claim'").get(), undefined)
    unchanged.close()
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('a failed migration rolls back completely and a later open resumes from version 0', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cave-schema-rollback-'))
  const path = join(dir, 'interrupted.db')
  try {
    const incompatible = new DatabaseSync(path)
    incompatible.exec('CREATE VIEW cave_provenance AS SELECT 1 AS wrong')
    incompatible.close()
    assert.throws(() => open(path), /schema migration 0 -> 1 failed/)

    const rolledBack = new DatabaseSync(path)
    assert.equal((rolledBack.prepare('PRAGMA user_version').get() as { user_version: number }).user_version, 0)
    assert.equal(rolledBack.prepare("SELECT 1 FROM sqlite_schema WHERE name = 'cave_claim'").get(), undefined,
      'tables created before the failure rolled back')
    rolledBack.exec('DROP VIEW cave_provenance')
    rolledBack.close()

    const resumed = open(path)
    assert.equal((resumed.db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version, Schema.currentVersion)
    resumed.close()
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('a closed-store backup remains independently recoverable across migration', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cave-schema-backup-'))
  const path = join(dir, 'legacy.db')
  const backupPath = join(dir, 'legacy.backup.db')
  try {
    const legacy = open(path)
    legacy.ingest('api HAS owner: platform @src:inventory')
    legacy.db.exec('DROP TABLE cave_provenance')
    legacy.db.exec('PRAGMA user_version = 0')
    legacy.close()
    copyFileSync(path, backupPath)

    const upgraded = open(path)
    assert.deepEqual(upgraded.provenanceOf(upgraded.currentBeliefs()[0]!).sources, ['inventory'])
    upgraded.close()

    const untouched = new DatabaseSync(backupPath)
    assert.equal((untouched.prepare('PRAGMA user_version').get() as { user_version: number }).user_version, 0)
    assert.equal(untouched.prepare("SELECT 1 FROM sqlite_schema WHERE name = 'cave_provenance'").get(), undefined)
    untouched.close()

    const restored = open(backupPath)
    assert.equal(restored.currentBeliefs()[0]!.subject, 'api')
    assert.deepEqual(restored.provenanceOf(restored.currentBeliefs()[0]!).sources, ['inventory'])
    restored.close()
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('schema validation rejects a non-FTS virtual search table', () => {
  const store = open()
  try {
    const ddl = store.db.prepare("SELECT sql FROM sqlite_schema WHERE name = 'cave_fts'").get()!.sql
    store.db.exec('DROP TABLE cave_fts')
    store.db.exec('CREATE VIRTUAL TABLE cave_fts USING rtree(claim_id, subject, verb, object, attribute, value_text, comment, raw_line, cave_fts)')
    const before = JSON.stringify(store.db.prepare('SELECT * FROM sqlite_schema').all())
    assert.throws(() => Schema.check(store.db), /cave_fts.*full-text/)
    assert.equal(JSON.stringify(store.db.prepare('SELECT * FROM sqlite_schema').all()), before)
    store.db.exec('DROP TABLE cave_fts')
    store.db.exec(ddl as string)
    assert.doesNotThrow(() => Schema.check(store.db))
    store.ingest('api IS service')
    assert.equal(store.search('service').length, 1)
  } finally { store.close() }
})
