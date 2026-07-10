/**
 * `@cavelang/cli` — the `cave` command (parse / add / query / resolve / derive / act / check / suggest-alias / sync / export / report / reconstruct / demo).
 * Programmatic access to the same implementations lives here.
 */

export { actCommand, addCommand, cave, checkCommand, commandHelp, demoCommand, deriveCommand, exportCommand, helpCommand, highlightCommand, importCommand, parseCommand, queryCommand, reconstructCommand, reportCommand, resolveCommand, suggestAliasCommand, syncCommand, usage, versionCommand } from './cli.ts'
export type { Output } from './cli.ts'
