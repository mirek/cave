import { fileURLToPath, URL } from 'node:url'
import react from '@vitejs/plugin-react'
import { defineConfig, type Plugin } from 'vite'

const stubPrefix = '\0cave-node-stub:'

/**
 * Workspace packages import Node built-ins at module top level for code paths
 * the browser never calls (version lookup, file stores, backups). A production
 * build tree-shakes them away; the dev server does not, and Vite's
 * browser-external proxy throws as soon as a named import is bound — which
 * failed the playground worker with "Runtime error". In dev only, replace each
 * `node:*` module with stubs carrying the same export names that throw if
 * actually called.
 */
const nodeBuiltinStubs = (): Plugin => ({
  name: 'cave-node-builtin-stubs',
  apply: 'serve',
  enforce: 'pre',
  resolveId(id) {
    if (id.startsWith('node:')) return stubPrefix + id.slice('node:'.length)
  },
  async load(id) {
    if (!id.startsWith(stubPrefix)) return
    const module = id.slice(stubPrefix.length)
    const real = await import(`node:${module}`) as Record<string, unknown>
    const names = Object.keys(real).filter(name => name !== 'default' && /^[A-Za-z_$][\w$]*$/.test(name))
    return [
      `const unavailable = name => () => { throw new Error(\`node:${module}.\${name} is unavailable in the browser\`) }`,
      ...names.map(name => `export const ${name} = unavailable(${JSON.stringify(name)})`),
      'export default {}',
    ].join('\n')
  },
})

export default defineConfig({
  // A relative base works for both mirek.github.io/cave and a custom domain.
  base: './',
  plugins: [nodeBuiltinStubs(), react()],
  resolve: {
    alias: {
      'util': fileURLToPath(new URL('./src/playground/util-shim.ts', import.meta.url)),
    },
  },
  // sql.js ships CommonJS: dev must pre-bundle it so the worker's default
  // import resolves (excluding it broke the dev playground). The wasm binary
  // is loaded separately through an explicit `?url` import.
  optimizeDeps: {
    include: ['sql.js'],
  },
  build: {
    target: 'es2022',
  },
})
