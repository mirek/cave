/**
 * Bundles the extension and copies the runtime assets it loads from `dist/`:
 * the web-tree-sitter runtime WASM, the CAVE grammar WASM and the highlight
 * query (single source shared with `@cavelang/highlight`).
 */

import { copyFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { build } from 'esbuild'

const require = createRequire(import.meta.url)

mkdirSync('dist', { recursive: true })

// web-tree-sitter's ESM glue calls `createRequire(import.meta.url)`, which is
// `undefined` once esbuild lowers the bundle to CJS — substitute a shim that
// reconstructs the URL from `__filename` at runtime.
writeFileSync(
  'dist/import-meta-url-shim.js',
  "export var importMetaUrl = require('node:url').pathToFileURL(__filename).href\n"
)

await build({
  entryPoints: ['src/extension.ts'],
  bundle: true,
  external: ['vscode'],
  platform: 'node',
  format: 'cjs',
  sourcemap: true,
  define: { 'import.meta.url': 'importMetaUrl' },
  inject: ['dist/import-meta-url-shim.js'],
  outfile: 'dist/extension.js'
})

copyFileSync(
  require.resolve('web-tree-sitter/web-tree-sitter.wasm'),
  'dist/web-tree-sitter.wasm'
)
copyFileSync(require.resolve('@cavelang/tree-sitter-cave/wasm'), 'dist/tree-sitter-cave.wasm')
copyFileSync(require.resolve('@cavelang/tree-sitter-cave/highlights'), 'dist/highlights.scm')
