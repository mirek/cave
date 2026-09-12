#!/usr/bin/env node
import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'

const db = new DatabaseSync(':memory:')
try {
  const expected = 'before\0after'
  const row = db.prepare('SELECT ? AS text, hex(?) AS bytes').get(expected, expected)
  assert.equal(row.bytes, Buffer.from(expected).toString('hex').toUpperCase(), 'SQLite must retain the complete UTF-8 bytes')
  assert.equal(row.text, expected, 'node:sqlite must decode text past embedded NUL characters')
  console.log(`SQLite text round-trip passed on Node ${process.versions.node}`)
} finally {
  db.close()
}
