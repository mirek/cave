import { nodeSqliteAdapter } from './node-adapter.ts'
import { openWith } from './runtime.ts'
import type { OpenOptions, Store } from './runtime.ts'

export type { Store } from './runtime.ts'

/** Open a CAVE store with the Node.js builtin SQLite adapter. */
export const open = (path: string = ':memory:', options: OpenOptions = {}): Store =>
  openWith(nodeSqliteAdapter, path, options)
