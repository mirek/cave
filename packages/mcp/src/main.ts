/**
 * `cave mcp` entry — opens the knowledge database and serves MCP on stdio
 * until the client disconnects. Everything written to stdout is protocol;
 * the startup banner goes to stderr.
 */

import { readFileSync } from 'node:fs'
import { parseArgs } from 'node:util'
import { Registry } from '@cavelang/canonical'
import { defaultDbPath, open } from '@cavelang/store'
import { serve, serverInfo } from './server.ts'
import { scopedTools, type Permission, type Scope } from './tools.ts'

export const usage = `cave mcp — serve a CAVE knowledge database as an MCP server on stdio

Usage:
  cave mcp [--db <path>] [--no-prelude] [--read-only]
           [--permissions <list>] [--tools <list>]
           [--src <context>] [--no-src] [--hooks <file>]

Options:
  --db <path>      database file (default: $CAVE_DB, or cave.db)
  --no-prelude     open the store without the standard verb registry
  --read-only      serve only tools that never write (drops cave_add,
                   cave_derive and the generated act_<name> action tools)
  --permissions    serve only operation classes from read,evaluate,record,
                   action (comma-separated); evaluation is ephemeral,
                   recording is durable, and action may execute effects
  --tools <list>   serve only these tools (comma-separated); --read-only
                   still drops writing tools from the list; act_<name>
                   entries scope whichever actions exist at call time
  --src <context>  provenance stamp for appends, without the src: prefix
                   (default: agent/<client-name> from the MCP handshake)
  --no-src         do not stamp actor provenance on appends
  --hooks <file>   JSON file of out-of-band hook command templates for
                   action tools, name → shell template (spec §25.4);
                   default: $CAVE_HOOKS

Appended claims that carry no @src: context are stamped with the
connected client's source context (spec §9.5). Actions declared in the
store are served as generated act_<name> tools (spec §25.5) — the
governed write vocabulary — recomputed per tools/list. Tools outside the
served scope are absent from tools/list and unknown to tools/call. Runs
until the client disconnects; stdout is protocol, diagnostics go to
stderr.

Examples:
  cave mcp --db k.db
  cave mcp --db k.db --read-only
  cave mcp --db k.db --permissions read,evaluate
  cave mcp --db k.db --permissions action --tools act_mark-deployed
  cave mcp --db k.db --tools cave_query,cave_about,cave_search
  cave mcp --db k.db --tools cave_query,act_mark-deployed
  cave mcp --db k.db --hooks hooks.json
  cave mcp --db k.db --src pipeline/nightly
  claude mcp add cave -- cave mcp --db k.db`

/**
 * Loads a hooks configuration file (spec §25.4): a JSON object mapping
 * hook names to shell command templates. Throws on anything else — a
 * misconfigured side-effect surface must not come up at all.
 */
export const readHooks = (path: string): Record<string, string> => {
  const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'))
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed) ||
      Object.values(parsed).some(value => typeof value !== 'string')) {
    throw new Error(`${path}: hooks must be a JSON object of name → shell template strings`)
  }
  return parsed as Record<string, string>
}

export type RunContext = {
  readonly stdin?: NodeJS.ReadableStream
  readonly stdout?: NodeJS.WritableStream
  readonly stderr?: NodeJS.WritableStream
  readonly signal?: AbortSignal
}

/** Validates the single accepted `--src` spelling: a non-empty context token without `src:`. */
export const sourceFromOption = (value: undefined | string): undefined | string => {
  if (value === undefined) return undefined
  if (!/^[A-Za-z0-9._/:-]+$/.test(value)) {
    throw new Error('--src must be a context token (letters, digits, . _ / : -)')
  }
  if (value.startsWith('src:')) {
    throw new Error('--src must not include the src: prefix')
  }
  return value
}

/** Runs the server; resolves with the process exit code. */
export const runMcp = async (argv: readonly string[], context: RunContext = {}): Promise<number> => {
  const stdin = context.stdin ?? process.stdin
  const stdout = context.stdout ?? process.stdout
  const stderr = context.stderr ?? process.stderr
  const { values } = parseArgs({
    args: [...argv],
    options: {
      db: { type: 'string' },
      'no-prelude': { type: 'boolean' },
      'read-only': { type: 'boolean' },
      permissions: { type: 'string' },
      tools: { type: 'string' },
      src: { type: 'string' },
      'no-src': { type: 'boolean' },
      hooks: { type: 'string' },
      help: { type: 'boolean', short: 'h' }
    },
    allowPositionals: false
  })
  if (values.help === true) {
    stdout.write(`${usage}\n`)
    return 0
  }
  let sourceOverride: undefined | string
  try {
    sourceOverride = sourceFromOption(values.src)
  } catch (error) {
    stderr.write(`cave mcp: ${error instanceof Error ? error.message : String(error)}\n`)
    return 2
  }
  const scope: Scope = {
    ...values['read-only'] === true ? { readOnly: true } : {},
    ...values.permissions === undefined ? {} : {
      permissions: values.permissions.split(',').map(name => name.trim()).filter(name => name !== '') as Permission[]
    },
    ...values.tools === undefined ? {} : {
      tools: values.tools.split(',').map(name => name.trim()).filter(name => name !== '')
    }
  }
  let hooks: undefined | Record<string, string>
  try {
    // Validate the scope and hook configuration before touching the
    // database or the protocol — a misconfigured permission boundary or
    // side-effect surface must not come up at all.
    scopedTools(scope)
    const hooksPath = values.hooks ?? process.env['CAVE_HOOKS']
    hooks = hooksPath === undefined ? undefined : readHooks(hooksPath)
  } catch (error) {
    stderr.write(`cave mcp: ${error instanceof Error ? error.message : String(error)}\n`)
    return 2
  }
  const db = values.db ?? defaultDbPath()
  const store = open(db, values['no-prelude'] === true ? { registry: Registry.empty } : {})
  const scopeNote = [
    ...values['read-only'] === true ? ['read-only'] : [],
    ...scope.permissions === undefined ? [] : [`permissions ${scope.permissions.join(',')}`],
    ...scope.tools === undefined ? [] : [`tools ${scopedTools(scope).map(tool => tool.name).join(',')}`]
  ]
  stderr.write(`${serverInfo.name} mcp server ${serverInfo.version} — db ${db}` +
    `${scopeNote.length > 0 ? ` (${scopeNote.join('; ')})` : ''}\n`)
  try {
    await serve(store, stdin, stdout, {
      ...scope,
      ...values['no-src'] === true ? { source: false } : sourceOverride === undefined ? {} : { source: sourceOverride },
      ...hooks === undefined ? {} : { hooks },
      ...context.signal === undefined ? {} : { signal: context.signal }
    })
  } finally {
    store.close()
  }
  return 0
}
