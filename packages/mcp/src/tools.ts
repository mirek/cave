/**
 * The CAVE engine surface exposed as MCP tools, all operating on one open
 * `@cavelang/store` database:
 *
 * | Tool | Purpose |
 * |---|---|
 * | `cave_add` | append CAVE text (extraction output) to the store |
 * | `cave_query` | run a CAVE-Q pattern (spec §12) |
 * | `cave_fuse` | Bayesian fusion of numeric estimates (§10.1) — named computation |
 * | `cave_search` | full-text search over claims and comments |
 * | `cave_about` | current claims about an entity, both directions |
 * | `cave_neighbors` | named forward + inverse edges of an entity (§13.3) |
 * | `cave_reconstruct` | cave-loop active reconstruction from seed cues (§18) |
 * | `cave_derive` | fire the stored rules (§24) — named computation |
 * | `cave_export` | canonical CAVE text of the store |
 * | `cave_lint` | parse text and report diagnostics without storing |
 *
 * Results are text — canonical CAVE lines wherever claims are returned,
 * because that is the notation the client model is instructed with.
 *
 * Every tool declares its permission class; `scopedTools` narrows the
 * served surface to a `Scope` (`--read-only`, `--permissions`, `--tools`) —
 * the minimum viable agent permission boundary.
 */

import { Claim, Key, Multiplier, Value } from '@cavelang/core'
import { parseDocument } from '@cavelang/parser'
import { canonicalizeText, emitClaim } from '@cavelang/canonical'
import { Sensitivity } from '@cavelang/store'
import type { Store } from '@cavelang/store'
import { defaultLimit as defaultQueryLimit, page as caveQueryPage, query as caveQuery } from '@cavelang/query'
import { estimateOf, fuse } from '@cavelang/fusion'
import { derive } from '@cavelang/rules'
import { reconstruct, heuristicPolicy, sqliteStore } from '@cavelang/loop'
import { act, listActions, type ActReport, type ListedAction } from '@cavelang/act'

/** Per-connection state the server threads into tool calls. */
export type ToolContext = {
  /**
   * Actor provenance stamp for appends (spec §9.5), without the `src:`
   * prefix — e.g. `agent/claude-code`. `undefined` disables stamping.
   */
  readonly source?: string
  /** Out-of-band hook command templates for action tools (spec §25.4). */
  readonly hooks?: Readonly<Record<string, string>>
}

export const permissions = ['read', 'evaluate', 'record', 'action'] as const
export type Permission = typeof permissions[number]

export type Tool = {
  readonly name: string
  readonly description: string
  /** Evaluation is ephemeral, recording is durable, and action may cause effects. */
  readonly permission: Permission
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
  /** Serve only these operation classes; `readOnly` removes record/action. */
  readonly permissions?: readonly Permission[]
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

const integer = (value: unknown, name: string): number => {
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    throw new Error(`${name} must be an integer`)
  }
  return value
}

/**
 * Current claims mentioning `entity` on either endpoint, as canonical
 * lines — through the alias closure (spec §13.6) when asked, restricted
 * to the §26 resolved winners when asked. A retracted (`@ 0%`) current
 * belief has no current support (spec §9.3) and is skipped, matching
 * the CAVE-Q default and store traversal.
 */
const aboutLines = (store: Store, entity: string, aliases: boolean, resolve: boolean): string[] => {
  const names = new Set(aliases ? store.aliasesOf(entity) : [entity])
  const rows = resolve ? store.resolvedBeliefs({ aliases }) : store.currentBeliefs()
  return rows
    .filter(row => row.conf > 0 && (names.has(row.subject) || (row.object !== null && names.has(row.object))))
    .map(row => emitClaim(store.toClaim(row)))
}

/**
 * Multiplier-compacted rendering of a fused number, 4 significant digits:
 * `19965517241` → `19.97B` (spec §7.1 multipliers, largest that fits).
 * The residual digits go through `Value.formatNumber` — tiny (`2e-7`) and
 * huge (`2e+22` after T-compression) magnitudes must still emit as plain
 * decimal, the only number form the CAVE grammar accepts (spec §16).
 */
const compactNumber = (n: number): string => {
  for (const [letter, factor] of Object.entries(Multiplier.factors)) {
    if (Math.abs(n) >= factor) {
      return `${Value.formatNumber(Number((n / factor).toPrecision(4)))}${letter}`
    }
  }
  return Value.formatNumber(Number(n.toPrecision(4)))
}

/** Compact number with its unit as CAVE writes values: `19.97B USD/yr`, `94.5%`. */
const withUnit = (n: number, unit: undefined | string): string =>
  `${compactNumber(n)}${unit === undefined ? '' : unit === '%' ? '%' : ` ${unit}`}`

/**
 * The §26 quantity of a claim — its claim key modulo `src:` contexts, the
 * resolution-group identity of "one fact, several voices". Fusion only
 * makes sense within one quantity (spec §10.1). `representative` widens
 * the group through the alias closure (spec §26.1's smallest-member
 * canonicalization) — the subject suffices, because only attribute and
 * metric payloads carry estimates.
 */
const quantityOf = (claim: Claim.t, representative: (name: string) => string): string => {
  const [subject, verb, , payload, contexts] =
    JSON.parse(Key.of(claim)) as [string, string, number, string, string[]]
  return JSON.stringify([
    subject.startsWith('e:') ? `e:${representative(subject.slice(2))}` : subject,
    verb,
    payload,
    contexts.filter(context => !context.startsWith('src:'))
  ])
}

/**
 * The claims `cave_fuse` considers: matched store rows (`pattern`, deduped
 * — one row may solve a pattern several ways), current claims an entity
 * is the subject of (`about` — the only reach into metric `IS` series,
 * which CAVE-Q variables cannot bind), or literal CAVE text that never
 * touches the store (`text`). Exactly one selector, so the answer's
 * provenance is unambiguous.
 */
const selectFuseClaims = (store: Store, args: Record<string, unknown>): Claim.t[] => {
  const selectors = (['pattern', 'about', 'text'] as const).filter(name => typeof args[name] === 'string')
  const selector = selectors.length === 1 ? selectors[0] : undefined
  if (selector === undefined) {
    throw new Error('provide exactly one of pattern (CAVE-Q over the store), about (an entity name) or text (literal CAVE lines)')
  }
  if (typeof args['asOf'] === 'string' && selector !== 'pattern') {
    throw new Error('asOf composes with pattern only')
  }
  if (selector === 'pattern') {
    const matches = caveQuery(store, text(args['pattern'], 'pattern'), {
      aliases: args['aliases'] === true,
      ...typeof args['asOf'] === 'string' ? { asOf: args['asOf'] } : {}
    })
    const rows = new Map(matches.flatMap(match => match.row === undefined ? [] : [[match.row.id, match.row] as const]))
    return [...rows.values()].map(row => store.toClaim(row))
  }
  if (selector === 'about') {
    const entity = text(args['about'], 'about')
    const names = new Set(args['aliases'] === true ? store.aliasesOf(entity) : [entity])
    return store.currentBeliefs()
      .filter(row => names.has(row.subject) && row.conf > 0)
      .map(row => store.toClaim(row))
  }
  const result = canonicalizeText(text(args['text'], 'text'), store.registry())
  if (result.problems.length > 0) {
    throw new Error(result.problems.map(problem => `line ${problem.line}: ${problem.message}`).join('\n'))
  }
  return result.claims.map(entry => entry.claim)
}

export const tools: readonly Tool[] = [
  {
    name: 'cave_add',
    description: 'Append CAVE claims to the knowledge database. Input is CAVE text ' +
      '(one claim per line, e.g. "auth/middleware USES jwt @ 90%"). Lenient by default — ' +
      'invalid lines are reported and skipped; set strict to reject the whole batch instead. ' +
      'Claims without a @src: context are stamped with the connected agent\'s source ' +
      'context (spec §9.5).',
    permission: 'record',
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
    permission: 'read',
    inputSchema: {
      type: 'object',
      required: ['pattern'],
      properties: {
        pattern: { type: 'string', description: 'CAVE-Q pattern; WHERE filters on following lines' },
        all: { type: 'boolean', description: 'match the full append-only history, not just current beliefs' },
        aliases: { type: 'boolean', description: 'resolve entities through current ALIAS claims (union of aliased names, spec §13.6)' },
        asOf: { type: 'string', description: 'resolve beliefs as of a past moment (spec §12.3): a date (whole day included), a timestamp (whole second), or a transaction id — rows recorded later are invisible' },
        at: { type: 'string', description: 'anchor in valid time (spec §32.4): a date-like period (its start instant) or a timestamp — claims whose time contexts (@2026-Q1, @2025..2028) do not cover it are invisible, timeless claims always match, and trajectory values (20B -> 40B USD/yr) interpolate at the instant; composes with asOf' },
        resolve: { type: 'boolean', description: 'match resolved winners only (spec §26): contested facts — one fact from several sources, or opposite polarity — collapse to the row the resolution policy picks; incompatible with all' },
        limit: { type: 'integer', minimum: 1, maximum: 1000, default: defaultQueryLimit, description: `matches per page (default ${defaultQueryLimit})` },
        cursor: { type: 'string', description: 'opaque continuation from a prior cave_query page; freezes the original transaction snapshot' }
      }
    },
    run: (store, args) => {
      const result = caveQueryPage(store, text(args['pattern'], 'pattern'), {
        all: args['all'] === true,
        aliases: args['aliases'] === true,
        resolve: args['resolve'] === true,
        limit: args['limit'] === undefined ? defaultQueryLimit : integer(args['limit'], 'limit'),
        ...typeof args['cursor'] === 'string' ? { cursor: args['cursor'] } : {},
        ...typeof args['asOf'] === 'string' ? { asOf: args['asOf'] } : {},
        ...typeof args['at'] === 'string' ? { at: args['at'] } : {}
      })
      const matches = result.matches
      if (matches.length === 0) {
        return result.next === undefined ? 'no matches' : `no matches\nnext cursor: ${result.next}`
      }
      const lines = matches.map(match => {
        const bindings = Object.entries(match.bindings)
          .map(([name, value]) => `?${name} = ${value}`)
          .join('  ')
        let line = match.claim?.claim.raw
        // An interpolated trajectory shows its value at the anchor
        // (spec §32.4); value-slot bindings already carry it.
        if (match.at !== undefined && line !== undefined && bindings === '') {
          line = `${line} ; at ${String(args['at'])}: ${match.at.text}`
        }
        return bindings === '' ? line ?? 'match' : line === undefined ? bindings : `${bindings}  ; ${line}`
      })
      if (result.next !== undefined) lines.push(`next cursor: ${result.next}`)
      return lines.join('\n')
    }
  },
  {
    name: 'cave_fuse',
    description: 'Bayesian fusion of independent numeric estimates of one quantity (spec §10.1) — ' +
      'delegate the precision-weighted math instead of doing arithmetic in tokens. Select the ' +
      'estimates with a CAVE-Q pattern (e.g. "openai HAS revenue: ?v" — the same fact from ' +
      'several sources), with about (an entity name — reaches metric series like "revenue IS ' +
      '20B USD/yr +/- 0.5B USD/yr"), or as literal CAVE text lines. Only positive claims with a ' +
      'numeric value and +/- uncertainty carry an estimate (σ = Δ/k, spec §7.2); confidence ' +
      'weights precision. Returns the posterior mean and sigma plus a value ready to write back.',
    permission: 'evaluate',
    inputSchema: {
      type: 'object',
      properties: {
        pattern: { type: 'string', description: 'CAVE-Q pattern selecting the store rows to fuse (exactly one of pattern/about/text)' },
        about: { type: 'string', description: 'entity whose current claims carry the estimates (exactly one of pattern/about/text)' },
        text: { type: 'string', description: 'CAVE lines carrying the estimates, fused without touching the store (exactly one of pattern/about/text)' },
        aliases: { type: 'boolean', description: 'pattern/about match through the alias closure (spec §13.6)' },
        asOf: { type: 'string', description: 'fuse the estimates believed at a past moment (spec §12.3): a date, timestamp or transaction id; pattern only' }
      }
    },
    run: (store, args) => {
      const claims = selectFuseClaims(store, args)
      const estimates = claims.flatMap(claim => {
        const estimate = estimateOf(claim)
        return claim.negated || estimate === undefined || !((estimate.conf ?? 1) > 0) ? [] : [{ claim, estimate }]
      })
      if (estimates.length === 0) {
        return claims.length === 0 ?
          'nothing to fuse: no matching claims' :
          `nothing to fuse: none of the ${claims.length} claim(s) carries a positive numeric estimate with +/- uncertainty`
      }
      const representative = args['aliases'] === true ?
        (name: string): string => store.aliasesOf(name).reduce((min, candidate) => candidate < min ? candidate : min) :
        (name: string): string => name
      const quantities = new Map<string, Claim.t>()
      for (const { claim } of estimates) {
        const quantity = quantityOf(claim, representative)
        if (!quantities.has(quantity)) {
          quantities.set(quantity, claim)
        }
      }
      if (quantities.size > 1) {
        throw new Error([
          `cannot fuse across ${quantities.size} quantities — spec §10.1 fuses independent estimates ` +
          'of one quantity (one claim key modulo @src: contexts); narrow the selection. Found:',
          ...[...quantities.values()].map(claim => `  ${emitClaim(claim)}`)
        ].join('\n'))
      }
      const posterior = fuse(estimates.map(({ estimate }) => estimate))!
      const unit = posterior.unit
      const skipped = claims.length - estimates.length
      return [
        `fused ${estimates.length} estimate(s)${skipped > 0 ? `, skipped ${skipped} without a positive numeric +/- estimate` : ''}:`,
        ...estimates.map(({ claim }) => `  ${emitClaim(claim)}`),
        `posterior: ${withUnit(posterior.mean, unit)} +/- ${withUnit(2 * posterior.sigma, unit)} (2σ)` +
        ` ; mean ${Value.formatNumber(posterior.mean)}, sigma ${Value.formatNumber(posterior.sigma)}`
      ].join('\n')
    }
  },
  {
    name: 'cave_search',
    description: 'Full-text search over subjects, objects, values, comments and raw lines. ' +
      'The query is a literal phrase by default; set raw for FTS5 MATCH syntax (AND/OR/NEAR).',
    permission: 'read',
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
    permission: 'read',
    inputSchema: {
      type: 'object',
      required: ['entity'],
      properties: {
        entity: { type: 'string', description: 'entity name, e.g. auth/middleware' },
        aliases: { type: 'boolean', description: 'include claims about aliased names (current ALIAS claims, spec §13.6)' },
        resolve: { type: 'boolean', description: 'restrict to resolved winners (spec §26): contested facts collapse to the row the resolution policy picks' }
      }
    },
    run: (store, args) =>
      aboutLines(store, text(args['entity'], 'entity'), args['aliases'] === true, args['resolve'] === true)
        .join('\n') || 'no claims'
  },
  {
    name: 'cave_neighbors',
    description: 'Graph edges of an entity: forward relations (subject side) and inverse-named ' +
      'reverse relations (object side, spec §13.3). Use to walk the knowledge graph.',
    permission: 'read',
    inputSchema: {
      type: 'object',
      required: ['entity'],
      properties: {
        entity: { type: 'string' },
        aliases: { type: 'boolean', description: 'include edges of aliased names (current ALIAS claims, spec §13.6)' },
        resolve: { type: 'boolean', description: 'walk resolved winners only (spec §26): contested edges collapse to the row the resolution policy picks' }
      }
    },
    run: (store, args) => {
      const entity = text(args['entity'], 'entity')
      const options = { aliases: args['aliases'] === true, resolve: args['resolve'] === true }
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
    permission: 'evaluate',
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
      const { claims, trace } = reconstruct(sqliteStore(store), heuristicPolicy(options), seeds)
      return [
        `expanded ${trace.length} cue(s): ${trace.map(step => step.cue.entity).join(' → ') || 'none'}`,
        ...claims.map(claim => emitClaim(claim))
      ].join('\n')
    }
  },
  {
    name: 'cave_derive',
    description: 'Fire the rules declared in the knowledge database (spec §24): forward chaining ' +
      'over current beliefs. Derived claims append with @src:rule/<digest> provenance, BECAUSE ' +
      'edges to their premise rows and VIA to the rule; confidence is noisy-AND; re-runs are ' +
      'idempotent and incremental by tx watermark, and retracting a premise retracts dependents. ' +
      'Declare rules first as ordinary claims via cave_add, e.g. ' +
      'rule/needs HAS rule: `?x NEEDS ?y, ?y NEEDS ?z => ?x NEEDS ?z`. ' +
      'Set dryRun to preview without appending.',
    permission: 'record',
    inputSchema: {
      type: 'object',
      properties: {
        dryRun: { type: 'boolean', description: 'evaluate inside a rolled-back transaction; report only, append nothing' },
        full: { type: 'boolean', description: 'ignore stored watermarks — re-fire every rule (spec §24.4)' },
        aliases: { type: 'boolean', description: 'premises match through the alias closure (spec §13.6)' },
        minConf: { type: 'number', description: 'conclusions below this confidence are not asserted (default 0.05)' },
        maxPasses: { type: 'number', description: 'fixpoint guard — maximum evaluation passes (default 20)' }
      }
    },
    run: (store, args) => {
      const minConf = args['minConf']
      if (minConf !== undefined && (typeof minConf !== 'number' || !Number.isFinite(minConf) || minConf < 0 || minConf > 1)) {
        throw new Error('minConf must be a number in 0..1')
      }
      const maxPasses = args['maxPasses']
      if (maxPasses !== undefined && (typeof maxPasses !== 'number' || !Number.isInteger(maxPasses) || maxPasses < 1)) {
        throw new Error('maxPasses must be a positive integer')
      }
      const dryRun = args['dryRun'] === true
      const report = derive(store, {
        dryRun,
        full: args['full'] === true,
        aliases: args['aliases'] === true,
        ...minConf === undefined ? {} : { minConf },
        ...maxPasses === undefined ? {} : { maxPasses }
      })
      if (report.rules.length === 0 && report.problems.length === 0) {
        return 'no rules declared — declare one with cave_add: rule/<name> HAS rule: `premises => conclusion`'
      }
      return [
        ...report.problems.map(problem => `${problem.subject}: ${problem.problems.join('; ')}`),
        ...report.rules.flatMap(rule => [
          `${rule.subject}: ` +
          (rule.fired ?
            `${rule.solutions} solution(s), +${rule.appended} appended, ${rule.updated} updated, ` +
            `${rule.retracted} retracted, ${rule.unchanged} unchanged` :
            'unchanged premises, skipped') +
          (rule.label === undefined ? '' : ` ; ${rule.label}`),
          ...rule.problems.map(problem => `  ${problem}`)
        ]),
        ...report.notes.map(note => `note: ${note}`),
        `derived${dryRun ? ' (dry run)' : ''}${report.complete ? '' : ' (truncated)'}: +${report.appended} appended, ${report.updated} updated, ` +
        `${report.retracted} retracted, ${report.unchanged} unchanged (${report.passes} pass(es))`
      ].join('\n')
    }
  },
  {
    name: 'cave_export',
    description: 'Export sensitivity-scoped canonical CAVE text (default maximum internal). ' +
      'Set maxSensitivity to restricted for complete portable history; current drops superseded history.',
    permission: 'read',
    inputSchema: {
      type: 'object',
      properties: {
        current: { type: 'boolean' },
        maxSensitivity: { type: 'string', enum: Sensitivity.levels }
      }
    },
    run: (store, args) => {
      const maximum = args['maxSensitivity'] === undefined ?
        Sensitivity.defaultMaximum :
        Sensitivity.parse(text(args['maxSensitivity'], 'maxSensitivity'))
      if (maximum === undefined) {
        throw new Error(`maxSensitivity must be one of ${Sensitivity.levels.join(', ')}`)
      }
      return store.exportText({ current: args['current'] === true, maxSensitivity: maximum }) || '; empty store'
    }
  },
  {
    name: 'cave_lint',
    description: 'Parse CAVE text and report diagnostics without storing anything. Use to ' +
      'validate extraction output before cave_add.',
    permission: 'evaluate',
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

/** Tool-name prefix of generated action tools (spec §25.5). */
export const actToolPrefix = 'act_'

/**
 * MCP tool name of an action: `act_` plus the action name with
 * characters outside the MCP tool alphabet mapped to `_`
 * (`team/promote` → `act_team_promote`).
 */
export const actToolName = (action: string): string =>
  `${actToolPrefix}${action.replaceAll(/[^A-Za-z0-9_-]/g, '_')}`

const renderReport = (report: ActReport): string => {
  if (!report.ok) {
    const violations = (report.violations ?? []).map(violation =>
      `  ${violation.entity} missing ${violation.expectation.kind} ${violation.expectation.name}`)
    return [`${report.action}: ${report.error}`, ...violations].join('\n')
  }
  const lines = [
    `executed ${report.subject}${report.dryRun ? ' (dry run)' : ''}: ` +
    `+${report.appended} appended, ${report.updated} updated, ${report.unchanged} unchanged`,
    ...report.effects.map(effect => `  ${effect.outcome}: ${effect.line}`)
  ]
  if (report.hook !== undefined) {
    lines.push(report.hook.fired ?
      `hook ${report.hook.name}: ${report.hook.error ?? 'ok'}` :
      `hook ${report.hook.name}: not fired (${report.hook.note})`)
  }
  return lines.join('\n')
}

/** One generated tool per current positive action (spec §25.5). */
const actionTool = (action: ListedAction): Tool => ({
  name: actToolName(action.name),
  description: `${action.description ?? `Execute the ${action.name} action`}. ` +
    'Governed write (spec §25): preconditions are validated against current belief, ' +
    'effects append atomically with provenance and lineage; a failed precondition ' +
    `appends nothing. Body: \`${action.text}\`` +
    (action.hook === undefined ? '' : ` — names the out-of-band hook "${action.hook}"`) + '.',
  permission: 'action',
  inputSchema: {
    type: 'object',
    required: [...action.params.map(param => param.name)],
    properties: Object.fromEntries(action.params.map(param => [
      param.name,
      { type: 'string', ...param.doc === undefined ? {} : { description: param.doc } }
    ]))
  },
  run: (store, args, context) => {
    const report = act(store, action.name, args, {
      ...context.hooks === undefined ? {} : { hooks: context.hooks }
    })
    const text = renderReport(report)
    if (!report.ok || report.hook?.error !== undefined) {
      throw new Error(text)
    }
    return text
  }
})

/**
 * @returns the generated action tools of the store's current positive
 * declarations (spec §25.5), computed per call so an action declared
 * mid-session appears without reconnecting. Actions whose stored body
 * does not parse are skipped, as are name collisions after MCP-alphabet
 * mapping (first declaration wins).
 */
export const actionTools = (store: Store): Tool[] => {
  const generated = new Map<string, Tool>()
  for (const action of listActions(store)) {
    if (!action.ok) {
      continue
    }
    const tool = actionTool(action)
    if (!generated.has(tool.name)) {
      generated.set(tool.name, tool)
    }
  }
  return [...generated.values()]
}

/**
 * @returns the action tools served under a scope (spec §25.5): only with
 * `action` permission, and only the listed names under `tools` —
 * an `act_`-prefixed scope entry is validated here, at call time, because
 * it scopes whichever actions exist when asked.
 */
const allowedPermissions = (scope: Scope): ReadonlySet<Permission> => {
  const requested = new Set(scope.permissions ?? permissions)
  if (scope.readOnly === true) {
    requested.delete('record')
    requested.delete('action')
  }
  return requested
}

export const allowsActions = (scope: Scope = {}): boolean =>
  allowedPermissions(scope).has('action') &&
  (scope.tools === undefined || scope.tools.some(name => name.startsWith(actToolPrefix)))

export const scopedActionTools = (store: Store, scope: Scope = {}): Tool[] =>
  allowsActions(scope) ?
    actionTools(store).filter(tool => scope.tools === undefined || scope.tools.includes(tool.name)) :
    []

/**
 * @returns the static tool surface actually served under a scope: `tools`
 * (when given) narrowed by permission and by `readOnly`. Throws on
 * names that exist nowhere and on a scope that serves nothing — a
 * misconfigured permission boundary must fail loudly, not serve quietly.
 * `act_`-prefixed names pass through: they scope generated action tools
 * (spec §25.5), resolved against the store at call time.
 */
export const scopedTools = (scope: Scope = {}): readonly Tool[] => {
  const unknownPermissions = (scope.permissions ?? []).filter(permission =>
    !(permissions as readonly string[]).includes(permission))
  if (unknownPermissions.length > 0) {
    throw new Error(`unknown permission(s): ${unknownPermissions.join(', ')} — available: ${permissions.join(', ')}`)
  }
  const unknown = (scope.tools ?? []).filter(name => !byName.has(name) && !name.startsWith(actToolPrefix))
  if (unknown.length > 0) {
    throw new Error(`unknown tool(s): ${unknown.join(', ')} — available: ${tools.map(tool => tool.name).join(', ')}, act_<action>`)
  }
  const allowed = allowedPermissions(scope)
  const served = tools.filter(tool =>
    (scope.tools === undefined || scope.tools.includes(tool.name)) &&
    allowed.has(tool.permission))
  if (served.length === 0 && !allowsActions(scope)) {
    throw new Error('the requested scope serves no tools')
  }
  return served
}
