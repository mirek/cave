/**
 * `@cave/cli` — the `cave` command (parse / add / query / export / demo).
 * Programmatic access to the same implementations lives here.
 */

export { addCommand, cave, demoCommand, exportCommand, parseCommand, queryCommand, usage } from './cli.ts'
export type { Output } from './cli.ts'
