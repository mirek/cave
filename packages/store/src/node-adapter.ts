/** Node.js builtin SQLite implementation of the CAVE adapter contract. */

import { DatabaseSync } from 'node:sqlite'
import type { Adapter, Database } from './adapter.ts'

const asNodeDatabase = (db: Database): DatabaseSync => db as DatabaseSync

const sqliteString = (value: string): string => `'${value.replaceAll("'", "''")}'`

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
        // StatementSync has no explicit finalize API. A one-shot prepared
        // VACUUM can therefore keep the source file open on Windows until GC,
        // even after DatabaseSync.close(). exec leaves no statement wrapper.
        db.exec(`VACUUM INTO ${sqliteString(destination)}`)
      },
    },
  },
  open: (path, options = {}) => new DatabaseSync(path, options),
}
