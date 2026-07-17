/** Node.js builtin SQLite implementation of the CAVE adapter contract. */

import { DatabaseSync } from 'node:sqlite'
import type { Adapter, Database } from './adapter.ts'

const asNodeDatabase = (db: Database): DatabaseSync => db as DatabaseSync

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
  open: (path, options = {}) => new DatabaseSync(path, options),
}
