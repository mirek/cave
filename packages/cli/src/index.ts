/**
 * `@cavelang/cli` — the `cave` command (parse / add / query / resolve / derive / act / check / suggest-alias / sync / export / report / reconstruct / demo).
 * Programmatic access to the same implementations lives here; `dispatch`
 * and `runCli` expose the shared awaited command lifecycle.
 */

export { actCommand, addCommand, backupCommand, cave, checkCommand, commandHelp, demoCommand, deriveCommand, exportCommand, generateCommand, helpCommand, highlightCommand, importCommand, parseCommand, queryCommand, reconstructCommand, reportCommand, resolveCommand, restoreCommand, suggestAliasCommand, syncCommand, usage, versionCommand } from './cli.ts'
export { dispatch, runCli } from './dispatch.ts'
export type { CommandRuntime } from './dispatch.ts'
export type { Output } from './cli.ts'
export { diagnose, doctorCommand } from './doctor.ts'
export type { DoctorCheck, DoctorOutput, DoctorReport, DoctorStatus } from './doctor.ts'
