/**
 * Authoritative inventory of the commands shipped by the `cave` binary.
 *
 * `importantOptions` is deliberately smaller than each command's complete
 * `--help`: it is the review contract for the package README's reference
 * table. Add a command or an option here when it becomes part of the public
 * surface; the documentation test then identifies every stale copy.
 */
export type CommandReference = {
  readonly name: string
  readonly importantOptions: readonly string[]
  /** The command implementation and detailed help live in another package. */
  readonly delegated?: true
}

export const commandRegistry = [
  { name: 'parse', importantOptions: ['--json'] },
  { name: 'highlight', importantOptions: [] },
  { name: 'add', importantOptions: ['--strict', '--check', '--no-prelude', '--no-src'] },
  { name: 'import', importantOptions: ['--strict', '--no-prelude'] },
  { name: 'query', importantOptions: ['--json', '--limit', '--cursor', '--all', '--aliases', '--as-of', '--at', '--resolve', '--no-prelude'] },
  { name: 'resolve', importantOptions: ['--aliases', '--policy', '--json', '--no-prelude'] },
  { name: 'derive', importantOptions: ['--dry-run', '--full', '--aliases', '--min-conf', '--max-passes', '--list', '--retract', '--json', '--no-prelude'] },
  { name: 'act', importantOptions: ['--declare', '--list', '--retract', '--dry-run', '--no-check', '--aliases', '--hooks', '--json', '--no-prelude'] },
  { name: 'automate', importantOptions: ['--once', '--declare', '--list', '--retract', '--hooks', '--agent', '--json', '--no-prelude'], delegated: true },
  { name: 'check', importantOptions: ['--stale', '--json', '--no-prelude'] },
  { name: 'backup', importantOptions: ['--out', '--force', '--verify', '--sha256'] },
  { name: 'restore', importantOptions: ['--db', '--force', '--sha256'] },
  { name: 'generate', importantOptions: ['--out', '--version', '--no-prelude'] },
  { name: 'suggest-alias', importantOptions: ['--min', '--limit', '--agent', '--timeout', '--write', '--json', '--no-prelude'] },
  { name: 'sync', importantOptions: ['--as', '--into', '--dry-run', '--no-record', '--json', '--no-prelude'] },
  { name: 'export', importantOptions: ['--out', '--current', '--tx', '--max-sensitivity', '--no-prelude'] },
  { name: 'report', importantOptions: ['--out', '--aliases', '--resolve', '--as-of', '--at', '--max-sensitivity', '--no-prelude'] },
  { name: 'serve', importantOptions: ['--port', '--host', '--max-sensitivity', '--no-prelude'], delegated: true },
  { name: 'mcp', importantOptions: ['--read-only', '--permissions', '--tools', '--hooks', '--no-prelude', '--src', '--no-src'], delegated: true },
  { name: 'ingest', importantOptions: ['--agent', '--stdout', '--lenient', '--plan', '--dry-run', '--json', '--no-prelude'], delegated: true },
  { name: 'eval', importantOptions: ['--agent', '--judge', '--runs', '--stdout', '--min', '--json', '--no-prelude'], delegated: true },
  { name: 'connect', importantOptions: ['--map', '--key', '--watch', '--prune', '--query', '--dry-run', '--no-prelude'], delegated: true },
  { name: 'reconstruct', importantOptions: ['--query', '--agent', '--steps', '--claims', '--timeout', '--trace', '--no-prelude'] },
  { name: 'doctor', importantOptions: ['--hooks', '--json'] },
  { name: 'demo', importantOptions: [] },
  { name: 'version', importantOptions: [] },
  { name: 'help', importantOptions: [] }
] as const satisfies readonly CommandReference[]

export const delegatedCommandNames: readonly string[] = commandRegistry
  .filter(command => 'delegated' in command && command.delegated === true)
  .map(command => command.name)
