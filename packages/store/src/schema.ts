/** Ordered, transactional storage schema migrations (spec §13). */

import type { Capabilities, Database } from './adapter.ts'
import * as Provenance from './provenance.ts'

export const currentVersion = 1

const ddlBeforeFts = `
CREATE TABLE IF NOT EXISTS cave_claim (
  id            TEXT PRIMARY KEY,      -- UUIDv7
  tx            TEXT NOT NULL,         -- UUIDv7, lexicographic = transaction order

  subject       TEXT NOT NULL,         -- canonical (primary) direction
  verb          TEXT NOT NULL,         -- canonical (primary) verb
  negated       INTEGER NOT NULL DEFAULT 0,

  object        TEXT,                  -- relation object, entity, literal
  attribute     TEXT,                  -- for HAS attr: value
  value_text    TEXT,                  -- value as written (incl. ~, multiplier, delimiters)
  value_num     REAL,                  -- parsed numeric value when possible
  value_unit    TEXT,                  -- normalized unit string
  value_approx  INTEGER NOT NULL DEFAULT 0,

  delta_text    TEXT,
  delta_num     REAL,
  delta_unit    TEXT,
  sigma_level   REAL DEFAULT 2.0,

  conf          REAL NOT NULL DEFAULT 1.0,
  importance    INTEGER NOT NULL DEFAULT 0,

  comment       TEXT,
  raw_line      TEXT NOT NULL,         -- exactly as written, incl. inverse form

  claim_key     TEXT NOT NULL          -- normalized key; shared by forward/inverse readings
);

CREATE INDEX IF NOT EXISTS idx_cave_claim_key_tx ON cave_claim (claim_key, tx);
CREATE INDEX IF NOT EXISTS idx_cave_subject   ON cave_claim (subject);
CREATE INDEX IF NOT EXISTS idx_cave_verb      ON cave_claim (verb);
CREATE INDEX IF NOT EXISTS idx_cave_object    ON cave_claim (object);
CREATE INDEX IF NOT EXISTS idx_cave_attribute ON cave_claim (attribute);
CREATE INDEX IF NOT EXISTS idx_cave_conf      ON cave_claim (conf);

CREATE TABLE IF NOT EXISTS cave_context (
  claim_id TEXT NOT NULL,
  context  TEXT NOT NULL,
  FOREIGN KEY (claim_id) REFERENCES cave_claim(id)
);
CREATE INDEX IF NOT EXISTS idx_cave_context ON cave_context (context);
CREATE INDEX IF NOT EXISTS idx_cave_context_claim ON cave_context (claim_id, context);

CREATE TABLE IF NOT EXISTS cave_provenance (
  claim_id   TEXT NOT NULL,
  dimension  TEXT NOT NULL CHECK (dimension IN ('actor', 'source', 'run', 'domain')),
  value      TEXT NOT NULL,
  PRIMARY KEY (claim_id, dimension, value),
  FOREIGN KEY (claim_id) REFERENCES cave_claim(id)
);
CREATE INDEX IF NOT EXISTS idx_cave_provenance_lookup ON cave_provenance (dimension, value, claim_id);

CREATE TABLE IF NOT EXISTS cave_tag (
  claim_id TEXT NOT NULL,
  key      TEXT NOT NULL,
  value    TEXT,                       -- NULL for flat tags (spec §13.2)
  FOREIGN KEY (claim_id) REFERENCES cave_claim(id)
);
CREATE INDEX IF NOT EXISTS idx_cave_tag_key ON cave_tag (key, value);
CREATE INDEX IF NOT EXISTS idx_cave_tag_claim ON cave_tag (claim_id, key, value);

CREATE TABLE IF NOT EXISTS cave_edge (
  parent_id TEXT NOT NULL,
  role      TEXT NOT NULL,             -- WHEN, VIA, BECAUSE, QUALIFIES
  child_id  TEXT NOT NULL,
  FOREIGN KEY (parent_id) REFERENCES cave_claim(id),
  FOREIGN KEY (child_id)  REFERENCES cave_claim(id)
);
CREATE INDEX IF NOT EXISTS idx_cave_edge_parent ON cave_edge (parent_id);
CREATE INDEX IF NOT EXISTS idx_cave_edge_child  ON cave_edge (child_id);
CREATE INDEX IF NOT EXISTS idx_cave_edge_role   ON cave_edge (role);

`

const ftsDdl = (fullText: Capabilities['fullText']): string => `
CREATE VIRTUAL TABLE IF NOT EXISTS cave_fts USING ${fullText}(
  claim_id, subject, verb, object, attribute, value_text, comment, raw_line
);
`

/** Default Node/FTS5 schema SQL retained for callers that inspect the DDL. */
export const ddl = ddlBeforeFts + ftsDdl('fts5')

const ddlFor = (capabilities: Capabilities): string =>
  ddlBeforeFts + ftsDdl(capabilities.fullText)

type Migration = {
  readonly version: number
  readonly up: (db: Database, capabilities: Capabilities) => void
}

const migrations: readonly Migration[] = [
  {
    version: 1,
    up: (db, capabilities) => {
      db.exec(ddlFor(capabilities))
      Provenance.backfill(db)
    }
  }
]

const versionOf = (db: Database): number =>
  (db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version

const requiredTables = [
  'cave_claim', 'cave_context', 'cave_provenance', 'cave_tag', 'cave_edge', 'cave_fts'
] as const

const requiredIndexes = [
  'idx_cave_claim_key_tx', 'idx_cave_subject', 'idx_cave_verb', 'idx_cave_object',
  'idx_cave_attribute', 'idx_cave_conf', 'idx_cave_context', 'idx_cave_context_claim',
  'idx_cave_provenance_lookup', 'idx_cave_tag_key', 'idx_cave_tag_claim',
  'idx_cave_edge_parent', 'idx_cave_edge_child', 'idx_cave_edge_role'
] as const

const requiredColumns: Readonly<Record<string, readonly string[]>> = {
  cave_claim: [
    'id', 'tx', 'subject', 'verb', 'negated', 'object', 'attribute', 'value_text',
    'value_num', 'value_unit', 'value_approx', 'delta_text', 'delta_num', 'delta_unit',
    'sigma_level', 'conf', 'importance', 'comment', 'raw_line', 'claim_key'
  ],
  cave_context: ['claim_id', 'context'],
  cave_provenance: ['claim_id', 'dimension', 'value'],
  cave_tag: ['claim_id', 'key', 'value'],
  cave_edge: ['parent_id', 'role', 'child_id'],
  cave_fts: ['claim_id', 'subject', 'verb', 'object', 'attribute', 'value_text', 'comment', 'raw_line']
}

export const validate = (db: Database, version: number, schema = 'main'): void => {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(schema)) {
    throw new Error(`CAVE: invalid SQLite schema name ${JSON.stringify(schema)}`)
  }
  const objects = new Map(
    (db.prepare(`SELECT name, type FROM ${schema}.sqlite_schema WHERE name LIKE 'cave_%' OR name LIKE 'idx_cave_%'`)
      .all() as { name: string, type: string }[]).map(row => [row.name, row.type])
  )
  const problems = [
    ...requiredTables.flatMap(name => objects.has(name) ? [] : [`missing table ${name}`]),
    ...requiredIndexes.flatMap(name => objects.get(name) === 'index' ? [] : [`missing index ${name}`]),
    ...Object.entries(requiredColumns).flatMap(([table, required]) => {
      if (!objects.has(table)) {
        return []
      }
      const columns = new Set(
        (db.prepare(`PRAGMA ${schema}.table_info(${table})`).all() as { name: string }[]).map(row => row.name)
      )
      return required.flatMap(column => columns.has(column) ? [] : [`missing column ${table}.${column}`])
    })
  ]
  if (problems.length > 0) {
    throw new Error(`CAVE: schema version ${version} is incompatible: ${problems.join(', ')}`)
  }
}

/**
 * Upgrade every supported older version in order. Each step owns one SQLite
 * transaction, including its `user_version` update, so interruption leaves
 * either the old version or the complete next version and reopen can resume.
 */
export const init = (
  db: Database,
  capabilities: Capabilities = {
    transactions: { immediate: true, savepoints: true },
    fullText: 'fts5',
  }
): void => {
  let version = versionOf(db)
  if (version > currentVersion) {
    throw new Error(
      `CAVE: schema version ${version} is newer than this runtime supports (${currentVersion}); upgrade CAVE`)
  }
  for (const migration of migrations) {
    if (migration.version <= version) {
      continue
    }
    if (migration.version !== version + 1) {
      throw new Error(`CAVE: no schema migration path from version ${version} to ${migration.version}`)
    }
    db.exec('BEGIN IMMEDIATE')
    try {
      migration.up(db, capabilities)
      db.exec(`PRAGMA user_version = ${migration.version}`)
      validate(db, migration.version)
      db.exec('COMMIT')
      version = migration.version
    } catch (error) {
      try {
        db.exec('ROLLBACK')
      } catch {
        // SQLite may already have rolled back a failed statement.
      }
      const detail = error instanceof Error ? error.message : String(error)
      throw new Error(`CAVE: schema migration ${version} -> ${migration.version} failed: ${detail}`)
    }
  }
  validate(db, version)
}
