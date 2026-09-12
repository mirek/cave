/** Node.js builtin SQLite implementation of the CAVE adapter contract. */

import { DatabaseSync } from 'node:sqlite'
import type { Adapter, Database } from './adapter.ts'
import { errorMessage } from './error-message.ts'

const asNodeDatabase = (db: Database): DatabaseSync => db as DatabaseSync

let verifiedText = false

/** Refuse lossy native text decoding before opening or creating caller data. */
const verifyText = (): void => {
  if (verifiedText) return
  const probe = new DatabaseSync(':memory:')
  try {
    const expected = 'before\0after'
    if (probe.prepare('SELECT ? AS value').get(expected)?.value !== expected) {
      throw new Error('CAVE: node:sqlite truncates embedded NUL text on this runtime; use Node 24.16.0+ (24.x) or 26.1.0+ (26.x)')
    }
  } catch (error) {
    try { probe.close() } catch (closeError) {
      throw new AggregateError([error, closeError],
        `CAVE native text probe failed: ${errorMessage(error)}; database close also failed: ${errorMessage(closeError)}`,
        { cause: error })
    }
    throw error
  }
  probe.close()
  verifiedText = true
}

export const nodeSqliteAdapter: Adapter = {
  name: 'node:sqlite',
  capabilities: {
    transactions: { immediate: true, savepoints: true },
    fullText: 'fts5',
    loadExtension: (db, path) => asNodeDatabase(db).loadExtension(path),
    backup: {
      location: db => asNodeDatabase(db).location(),
      inTransaction: db => asNodeDatabase(db).isTransaction,
      write: (db, destination) => {
        db.prepare('VACUUM INTO ?').run(destination)
      },
    },
  },
  open: (path, options = {}) => {
    verifyText()
    return new DatabaseSync(path, options)
  },
}
