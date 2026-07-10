import { registerHooks } from 'node:module'

const shim = new URL('../src/playground/sqlite-node-shim.mjs', import.meta.url).href

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === 'node:sqlite') return { url: shim, shortCircuit: true }
    return nextResolve(specifier, context)
  },
})
