/**
 * The CAVE engine surface exposed as MCP tools, all operating on one open
 * `@cavelang/store` database:
 *
 * | Tool | Purpose |
 * |---|---|
 * | `cave_add` | append CAVE text (extraction output) to the store |
 * | `cave_query` | run a CAVE-Q pattern (spec §12) |
 * | `cave_search` | full-text search over claims and comments |
 * | `cave_about` | current claims about an entity, both directions |
 * | `cave_neighbors` | named forward + inverse edges of an entity (§13.3) |
 * | `cave_reconstruct` | cave-loop active reconstruction from seed cues (§18) |
 * | `cave_export` | canonical CAVE text of the store |
 * | `cave_lint` | parse text and report diagnostics without storing |
 *
 * Results are text — canonical CAVE lines wherever claims are returned,
 * because that is the notation the client model is instructed with.
 *
 * Every tool declares whether it writes to the store; `scopedTools`
 * narrows the served surface to a `Scope` (`--read-only`, `--tools`) —
 * the minimum viable agent permission boundary.
 */

import { parseDocument } from '@cavelang/parser'
import { emitClaim } from '@cavelang/canonical'
import type { Store } from '@cavelang/store'
import { query as caveQuery } from '@cavelang/query'
import { reconstruct, heuristicPolicy, type CaveStore } from '@cavelang/loop'

/** Per-connection state the server threads into tool calls. */
export type ToolContext = {
  /**
   * Actor provenance stamp for appends (spec §9.5), without the `src:`
   * prefix — e.g. `agent/claude-code`. `undefined` disables stamping.
   */
  readonly source?: string
}

export type Tool = {
  readonly name: string
  readonly description: string
  /**
   * `true` when the tool appends to the store — read-only scopes drop it.
   * Every tool declares this explicitly: the serving boundary must never
   * depend on a forgotten default.
   */
  readonly writes: boolean
  readonly inputSchema: object
  readonly run: (store: Store, args: Record<string, unknown>, context: ToolContext) => string
}

/**
 * Serving scope — which tools the server exposes (the minimum viable
 * agent permission boundary). Tools outside the scope are absent from
 * `tools/list` and indistinguishable from nonexistent in `tools/call`.
 */
export type Scope = {
  /** Serve only tools that never write to the store (drops `cave_add`). */
  readonly readOnly?: boolean
  /**
   * Serve only these tools, by name. `readOnly` narrows further: a
   * writing tool listed here is still not served.
   */
  readonly tools?: readonly string[]
}

const text = (value: unknown, name: string): string => {
  if (typeof value !== 'string' || value === '') {
    throw new Error(`${name} must be a non-empty string`)
  }
  return value
}

/**
 * Current claims mentioning `entity` on either endpoint, as canonical
 * lines — through the alias closure (spec §13.6) when asked.
 */
const aboutLines = (store: Store, entity: string, aliases: boolean): string[] => {
  const names = new Set(aliases ? store.aliasesOf(entity) : [entity])
  return store.currentBeliefs()
    .filter(row => names.has(row.subject) || (row.object !== null && names.has(row.object)))
    .map(row => emitClaim(store.toClaim(row)))
}

/** `@cavelang/loop` store contract over the SQLite store (spec §18). */
const loopStore = (store: Store): CaveStore => ({
  forward: entity =>
    store.forward(entity).map(fact => ({
      from: entity,
      to: fact.target,
      verb: fact.verb,
      rel: fact.verb,
      conf: fact.row.conf,
      claim: store.toClaim(fact.row)
    })),
  reverse: entity =>
    store.reverse(entity).map(fact => ({
      from: entity,
      to: fact.source,
      verb: fact.verb,
      ...fact.rel === undefined ? {} : { rel: fact.rel },
      conf: fact.row.conf,
      claim: store.toClaim(fact.row)
    })),
  claimsAbout: entity =>
    store.currentBeliefs()
      .filter(row => row.subject === entity || row.object === entity)
      .map(row => store.toClaim(row)),
  expandTopic: topic => store.topicMembers(topic),
  topicsOf: entity => store.topicsOf(entity)
})

export const tools: readonly Tool[] = [
  {
    name: 'cave_add',
    description: 'Append CAVE claims to the knowledge database. Input is CAVE text ' +
      '(one claim per line, e.g. "auth/middleware USES jwt @ 90%"). Lenient by default — ' +
      'invalid lines are reported and skipped; set strict to reject the whole batch instead. ' +
      'Claims without a @src: context are stamped with the connected agent\'s source ' +
      'context (spec §9.5).',
    writes: true,
    inputSchema: {
      type: 'object',
      required: ['text'],
      properties: {
        text: { type: 'string', description: 'CAVE text, one claim per line' },
        strict: { type: 'boolean', description: 'reject the whole batch on any problem' }
      }
    },
    run: (store, args, context) => {
      const result = store.ingest(text(args['text'], 'text'), {
        strict: args['strict'] === true,
        ...context.source === undefined ? {} : { source: context.source }
      })
      const problems = result.problems.map(problem => `line ${problem.line}: ${problem.message}`)
      return [
        `added ${result.ids.length} claim(s), ${result.edges} edge(s)`,
        ...problems.length > 0 ? ['problems:', ...problems.map(problem => `  ${problem}`)] : []
      ].join('\n')
    }
  },
  {
    name: 'cave_query',
    description: 'Run a CAVE-Q graph pattern (spec §12). Examples: "?x USES jwt" — ' +
      'all systems using jwt; "?x HAS bug: ?bug #security"; "?cause CAUSE app/crash\\nWHERE conf >= 0.7"; ' +
      '"terrier EXTENDS+ animal" (transitive); "?x PART-OF monorepo" (inverse verbs work). ' +
      'Runs over supported current beliefs by default.',
    writes: false,
    inputSchema: {
      type: 'object',
      required: ['pattern'],
      properties: {
        pattern: { type: 'string', description: 'CAVE-Q pattern; WHERE filters on following lines' },
        all: { type: 'boolean', description: 'match the full append-only history, not just current beliefs' },
        aliases: { type: 'boolean', description: 'resolve entities through current ALIAS claims (union of aliased names, spec §13.6)' },
        asOf: { type: 'string', description: 'resolve beliefs as of a past moment (spec §12.3): a date (whole day included), a timestamp (whole second), or a transaction id — rows recorded later are invisible' }
      }
    },
    run: (store, args) => {
      const matches = caveQuery(store, text(args['pattern'], 'pattern'), {
        all: args['all'] === true,
        aliases: args['aliases'] === true,
        ...typeof args['asOf'] === 'string' ? { asOf: args['asOf'] } : {}
      })
      if (matches.length === 0) {
        return 'no matches'
      }
      return matches.map(match => {
        const bindings = Object.entries(match.bindings)
          .map(([name, value]) => `?${name} = ${value}`)
          .join('  ')
        const line = match.row === undefined ? undefined : match.row.raw_line
        return bindings === '' ? line ?? 'match' : line === undefined ? bindings : `${bindings}  ; ${line}`
      }).join('\n')
    }
  },
  {
    name: 'cave_search',
    description: 'Full-text search over subjects, objects, values, comments and raw lines. ' +
      'The query is a literal phrase by default; set raw for FTS5 MATCH syntax (AND/OR/NEAR).',
    writes: false,
    inputSchema: {
      type: 'object',
      required: ['query'],
      properties: {
        query: { type: 'string' },
        raw: { type: 'boolean', description: 'treat query as FTS5 MATCH syntax' }
      }
    },
    run: (store, args) =>
      store.search(text(args['query'], 'query'), { raw: args['raw'] === true })
        .map(row => row.raw_line)
        .join('\n') || 'no matches'
  },
  {
    name: 'cave_about',
    description: 'Everything currently believed about an entity — claims where it appears as ' +
      'subject or object, emitted as canonical CAVE lines.',
    writes: false,
    inputSchema: {
      type: 'object',
      required: ['entity'],
      properties: {
        entity: { type: 'string', description: 'entity name, e.g. auth/middleware' },
        aliases: { type: 'boolean', description: 'include claims about aliased names (current ALIAS claims, spec §13.6)' }
      }
    },
    run: (store, args) =>
      aboutLines(store, text(args['entity'], 'entity'), args['aliases'] === true).join('\n') || 'no claims'
  },
  {
    name: 'cave_neighbors',
    description: 'Graph edges of an entity: forward relations (subject side) and inverse-named ' +
      'reverse relations (object side, spec §13.3). Use to walk the knowledge graph.',
    writes: false,
    inputSchema: {
      type: 'object',
      required: ['entity'],
      properties: {
        entity: { type: 'string' },
        aliases: { type: 'boolean', description: 'include edges of aliased names (current ALIAS claims, spec §13.6)' }
      }
    },
    run: (store, args) => {
      const entity = text(args['entity'], 'entity')
      const options = { aliases: args['aliases'] === true }
      // Endpoints print as stored — under aliases a matched row may name
      // an aliased spelling, and union semantics never rewrites it.
      const forward = store.forward(entity, options)
        .map(fact => `${fact.row.subject} ${fact.verb} ${fact.target}`)
      const reverse = store.reverse(entity, options)
        .map(fact => fact.rel === undefined ?
          `${fact.source} ${fact.verb} ${fact.row.object} ; no inverse name declared` :
          `${fact.row.object} ${fact.rel} ${fact.source}`)
      return [...forward, ...reverse].join('\n') || 'no edges'
    }
  },
  {
    name: 'cave_reconstruct',
    description: 'Active memory reconstruction (spec §18): starting from seed entities, walk the ' +
      'graph best-first across forward and inverse edges, collecting related claims. Use when a ' +
      'plain query is too narrow — e.g. reconstruct everything relevant to a symptom.',
    writes: false,
    inputSchema: {
      type: 'object',
      required: ['seeds'],
      properties: {
        seeds: { type: 'array', items: { type: 'string' }, description: 'seed entity names (cues)' },
        maxSteps: { type: 'number', description: 'expansion budget (default 16)' },
        maxClaims: { type: 'number', description: 'stop after collecting this many claims' }
      }
    },
    run: (store, args) => {
      const seeds = Array.isArray(args['seeds']) ? args['seeds'].filter(seed => typeof seed === 'string') : []
      if (seeds.length === 0) {
        throw new Error('seeds must be a non-empty array of entity names')
      }
      const options = {
        ...typeof args['maxSteps'] === 'number' ? { maxSteps: args['maxSteps'] } : {},
        ...typeof args['maxClaims'] === 'number' ? { maxClaims: args['maxClaims'] } : {}
      }
      const { claims, trace } = reconstruct(loopStore(store), heuristicPolicy(options), seeds)
      return [
        `expanded ${trace.length} cue(s): ${trace.map(step => step.cue.entity).join(' → ') || 'none'}`,
        ...claims.map(claim => emitClaim(claim))
      ].join('\n')
    }
  },
  {
    name: 'cave_export',
    description: 'Export the knowledge database as canonical CAVE text — the interchange/backup ' +
      'format. Set current to export only current beliefs (drops superseded history).',
    writes: false,
    inputSchema: {
      type: 'object',
      properties: { current: { type: 'boolean' } }
    },
    run: (store, args) =>
      store.exportText({ current: args['current'] === true }) || '; empty store'
  },
  {
    name: 'cave_lint',
    description: 'Parse CAVE text and report diagnostics without storing anything. Use to ' +
      'validate extraction output before cave_add.',
    writes: false,
    inputSchema: {
      type: 'object',
      required: ['text'],
      properties: { text: { type: 'string' } }
    },
    run: (_store, args) => {
      const document = parseDocument(text(args['text'], 'text'))
      if (document.diagnostics.length === 0) {
        return `ok: ${document.lines.filter(line => line.kind !== 'blank' && line.kind !== 'comment').length} structural line(s)`
      }
      return document.diagnostics
        .map(diagnostic => `line ${diagnostic.line}: ${diagnostic.message}`)
        .join('\n')
    }
  }
]

export const byName: ReadonlyMap<string, Tool> =
  new Map(tools.map(tool => [tool.name, tool]))

/**
 * @returns the tool surface actually served under a scope: `tools` (when
 * given) narrowed to writers-excluded under `readOnly`. Throws on names
 * that exist nowhere and on a scope that serves nothing — a misconfigured
 * permission boundary must fail loudly, not serve quietly.
 */
export const scopedTools = (scope: Scope = {}): readonly Tool[] => {
  const unknown = (scope.tools ?? []).filter(name => !byName.has(name))
  if (unknown.length > 0) {
    throw new Error(`unknown tool(s): ${unknown.join(', ')} — available: ${tools.map(tool => tool.name).join(', ')}`)
  }
  const served = tools.filter(tool =>
    (scope.tools === undefined || scope.tools.includes(tool.name)) &&
    (scope.readOnly !== true || !tool.writes))
  if (served.length === 0) {
    throw new Error('the requested scope serves no tools')
  }
  return served
}
