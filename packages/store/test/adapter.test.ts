import { nodeSqliteAdapter } from '@cavelang/store/adapter/node'
import { sqliteAdapterContract } from './adapter-contract.ts'

sqliteAdapterContract(nodeSqliteAdapter, {
  backup: true,
  fullText: 'fts5',
  loadExtension: true,
})
