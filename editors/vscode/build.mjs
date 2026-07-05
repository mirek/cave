/**
 * Bundles the extension and copies the runtime assets it loads from `dist/`:
 * the web-tree-sitter runtime WASM, the CAVE grammar WASM and the highlight
 * query (single source shared with `@cavelang/highlight`).
 */

import { copyFileSync, mkdirSync } from 'node:fs'
import { createRequire } from 'node:module'
import { build } from 'esbuild'

const require = createRequire(import.meta.url)

mkdirSync('dist', { recursive: true })

await build({
  entryPoints: ['src/extension.ts'],
  bundle: true,
  external: ['vscode'],
  platform: 'node',
  format: 'cjs',
  sourcemap: true,
  outfile: 'dist/extension.js'
})

copyFileSync(
  require.resolve('web-tree-sitter/web-tree-sitter.wasm'),
  'dist/web-tree-sitter.wasm'
)
copyFileSync(require.resolve('@cavelang/tree-sitter-cave/wasm'), 'dist/tree-sitter-cave.wasm')
copyFileSync(require.resolve('@cavelang/tree-sitter-cave/highlights'), 'dist/highlights.scm')
