/**
 * Storage schema (spec §13.1, §13.2) — verbatim from the specification,
 * with `IF NOT EXISTS` added so opening an existing database is idempotent.
 */

import type { DatabaseSync } from 'node:sqlite'

export const ddl = `
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

CREATE VIRTUAL TABLE IF NOT EXISTS cave_fts USING fts5(
  claim_id, subject, verb, object, attribute, value_text, comment, raw_line
);
`

/** Creates all tables and indexes. */
export const init = (db: DatabaseSync): void => {
  db.exec(ddl)
}
