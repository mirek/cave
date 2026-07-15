/**
 * Optional Node.js Z3 adapter for CAVE's portable solver model.
 *
 * `z3-solver` is loaded only when `create()` is called. Importing this module
 * does not initialize WebAssembly or spawn Emscripten workers.
 */

export { create, type Runtime } from './runtime.ts'
