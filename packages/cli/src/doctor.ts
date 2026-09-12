/** Read-only installation, runtime, and store diagnostics for `cave doctor`. */

import { existsSync, readFileSync, statSync } from 'node:fs'
import { readHooks } from './hooks-config.ts'
import { createRequire } from 'node:module'
import { dirname, join, parse } from 'node:path'
import { parseArgs } from 'node:util'
import type { StatementSync } from 'node:sqlite'
import { Key, Uuidv7, Version } from '@cavelang/core'
import { emitClaim } from '@cavelang/canonical'
import { directCommand, runProcessSync } from '@cavelang/loop'
import { Row, Schema, defaultDbPath, kindOf, openText } from '@cavelang/store'
import { assemble } from '@cavelang/connect'
import { nodeSqliteAdapter } from '@cavelang/store/adapter/node'
import type { SqliteDatabase } from '@cavelang/store/adapter'

export type DoctorStatus = 'pass' | 'warn' | 'fail'

export type DoctorCheck = {
  readonly id: string
  readonly status: DoctorStatus
  readonly summary: string
  readonly remediation?: string
}

export type DoctorReport = {
  readonly format: 'cave.doctor'
  readonly version: 1
  readonly ok: boolean
  readonly caveVersion: string
  readonly runtime: {
    readonly node: string
    readonly platform: NodeJS.Platform
    readonly arch: string
  }
  readonly configuration: {
    readonly database: {
      readonly source: 'flag' | 'environment' | 'default'
      readonly kind: 'memory' | 'file' | 'text'
      readonly exists: boolean
      readonly schemaVersion?: number
      readonly claims?: number
    }
    readonly hooks: {
      readonly source: 'flag' | 'none'
      readonly exists: boolean
      readonly entries?: number
    }
  }
  readonly checks: readonly DoctorCheck[]
}

export type DoctorOutput = {
  readonly code: number
  readonly out: string
  readonly err: string
}

const requiredNode = '24.16.0'
const supportedNodeRange = '^24.16.0 || ^26.1.0'

const versionParts = (value: string): readonly [number, number, number] | undefined => {
  const match = /^(\d+)\.(\d+)\.(\d+)/.exec(value)
  return match === null ? undefined : [Number(match[1]), Number(match[2]), Number(match[3])]
}

const numericVersion = (value: string): string | undefined => {
  const parts = versionParts(value)
  return parts === undefined ? undefined : parts.join('.')
}

const atLeast = (actual: string, required: string): boolean => {
  const a = versionParts(actual)
  const b = versionParts(required)
  if (a === undefined || b === undefined) return false
  for (let index = 0; index < 3; index += 1) {
    if (a[index]! !== b[index]!) return a[index]! > b[index]!
  }
  return true
}

// Only stable releases are supported: a nightly or release-candidate build such
// as `26.0.0-nightly20260829` or `24.0.0-rc.1` carries the numeric prefix of a
// supported line but satisfies neither the engine range nor the CI matrix.
const stableVersion = /^\d+\.\d+\.\d+$/

export const isSupportedNodeVersion = (value: string): boolean => {
  if (!stableVersion.test(value)) return false
  const major = versionParts(value)?.[0]
  if (major === 24) return atLeast(value, requiredNode)
  return major === 26 && atLeast(value, '26.1.0')
}

const check = (
  id: string,
  status: DoctorStatus,
  summary: string,
  remediation?: string
): DoctorCheck => ({ id, status, summary, ...remediation === undefined ? {} : { remediation } })

const nodeCheck = (): DoctorCheck =>
  isSupportedNodeVersion(process.versions.node) ?
    check('runtime.node', 'pass', `Node ${process.versions.node} satisfies ${supportedNodeRange}`) :
    check('runtime.node', 'fail', `Node ${process.versions.node} is unsupported`,
      `Install Node 24.16.0+ in the 24.x line or Node 26.1.0+ in the 26.x line and rerun cave doctor.`)

const sqliteCheck = (): readonly DoctorCheck[] => {
  let db: SqliteDatabase | undefined
  const result = (() => {
    try {
      db = nodeSqliteAdapter.open(':memory:')
      db.exec('PRAGMA foreign_keys = ON')
      const sqlite = db.prepare('SELECT sqlite_version() AS version').get()?.['version']
      const json = db.prepare(`SELECT json_valid('{}') AS available`).get()?.['available']
      const foreignKeys = db.prepare('PRAGMA foreign_keys').get()?.['foreign_keys']
      db.exec('CREATE VIRTUAL TABLE doctor_fts USING fts5(value)')
      db.exec('DROP TABLE doctor_fts')
      if (typeof sqlite !== 'string' || json !== 1 || foreignKeys !== 1 ||
          nodeSqliteAdapter.capabilities.loadExtension === undefined) {
        throw new Error('capability unavailable')
      }
      return check('runtime.sqlite', 'pass',
        `SQLite ${sqlite} supports FTS5, JSON functions, foreign keys, and extension loading`)
    } catch {
      return check('runtime.sqlite', 'fail', 'The Node SQLite runtime lacks a required capability',
        `Use an official Node ${requiredNode}+ build with SQLite FTS5 and JSON support.`)
    }
  })()
  try { db?.close() } catch {
    return [result, check('runtime.sqlite.cleanup', 'fail', 'The SQLite capability probe could not be closed cleanly',
      'Retry diagnosis in a new process.')]
  }
  return [result]
}

const grammarCheck = (): DoctorCheck => {
  try {
    const fromHighlight = createRequire(import.meta.resolve('@cavelang/highlight'))
    const assets = [
      fromHighlight.resolve('@cavelang/tree-sitter-cave/wasm'),
      fromHighlight.resolve('@cavelang/tree-sitter-cave/highlights')
    ]
    if (assets.some(asset => !statSync(asset).isFile() || statSync(asset).size === 0)) {
      throw new Error('asset unavailable')
    }
    return check('package.grammar', 'pass', 'Grammar WASM and highlight query are installed')
  } catch {
    return check('package.grammar', 'fail', 'Grammar assets are missing from the installed package layout',
      'Reinstall @cavelang/cli without omitting its production dependencies.')
  }
}

type Workspace = { readonly packageManager: string }

const workspaceFrom = (start: string): Workspace | undefined => {
  let directory = start
  while (true) {
    if (existsSync(join(directory, 'pnpm-workspace.yaml'))) {
      try {
        const manifest = JSON.parse(readFileSync(join(directory, 'package.json'), 'utf8')) as {
          packageManager?: unknown
        }
        if (typeof manifest.packageManager === 'string' && manifest.packageManager.startsWith('pnpm@')) {
          return { packageManager: manifest.packageManager }
        }
      } catch {
        return { packageManager: 'pnpm' }
      }
      return { packageManager: 'pnpm' }
    }
    const parent = dirname(directory)
    if (parent === directory || directory === parse(directory).root) return undefined
    directory = parent
  }
}

const pnpmCheck = (): DoctorCheck => {
  const workspace = workspaceFrom(process.cwd())
  if (workspace === undefined) {
    return check('workspace.pnpm', 'pass', 'pnpm is not required for this installed CLI')
  }
  let actual: string | undefined
  try {
    // Windows command shims are batch files and cannot be executed directly
    // with shell:false. Use the fixed system launcher without interpolating
    // any user-controlled data; POSIX resolves pnpm as an ordinary executable.
    const command = process.platform === 'win32' ?
      directCommand(process.env['ComSpec'] ?? 'cmd.exe', ['/d', '/s', '/c', 'pnpm --version']) :
      directCommand('pnpm', ['--version'])
    const result = runProcessSync(command, {
      timeoutMs: 3_000,
      maxStdoutBytes: 1024,
      maxStderrBytes: 1024
    })
    actual = result.code === 0 ? numericVersion(result.stdout.trim()) : undefined
  } catch {
    actual = undefined
  }
  const pinned = workspace.packageManager.startsWith('pnpm@')
  const required = pinned ? numericVersion(workspace.packageManager.slice('pnpm@'.length)) : undefined
  if (actual === undefined) {
    return check('workspace.pnpm', 'fail', 'This workspace requires pnpm, but pnpm is unavailable',
      'Enable Corepack or install the pnpm version declared by the workspace.')
  }
  if (required !== undefined && !atLeast(actual, required)) {
    return check('workspace.pnpm', 'fail', `pnpm ${actual} is older than the workspace requirement`,
      `Enable Corepack or install pnpm ${required}.`)
  }
  return check('workspace.pnpm', 'pass', `pnpm ${actual} satisfies the workspace requirement`)
}

type DatabaseConfiguration = DoctorReport['configuration']['database']

type DatabaseInspection = {
  readonly configuration: DatabaseConfiguration
  readonly checks: readonly DoctorCheck[]
}

const finishDatabaseInspection = (result: DatabaseInspection, close: () => void): DatabaseInspection => {
  try { close() } catch {
    return {
      ...result,
      checks: [...result.checks, check('store.cleanup', 'fail', 'The database connection could not be closed cleanly',
        'Retry diagnosis in a new process; cave doctor made no repairs.')]
    }
  }
  return result
}

const inspectDatabase = (path: string, source: DatabaseConfiguration['source']): DatabaseInspection => {
  const memory = path === ':memory:'
  const exists = memory || existsSync(path)
  const base: DatabaseConfiguration = { source, kind: memory ? 'memory' : 'file', exists }
  if (!exists) {
    return {
      configuration: base,
      checks: [check('store.database', 'warn', 'The configured database does not exist yet',
        'Run cave add to create it, or pass --db for an existing store.')]
    }
  }
  if (!memory && kindOf(path) === 'text') {
    // A CAVE text file is a read-only store assembled in memory (spec
    // §13.7, §23.4): replay it, sources included, and count what it holds.
    const configuration: DatabaseConfiguration = { ...base, kind: 'text' }
    let store: ReturnType<typeof openText> | undefined
    const result: DatabaseInspection = (() => {
      try {
        store = openText(path, { assemble })
        const claims = store.currentBeliefs().filter(row => row.conf > 0).length
        return {
          configuration: { ...configuration, claims },
          checks: [check('store.database', 'pass',
            `CAVE text store assembled in memory (${claims} current claim(s)); text stores are read-only`)]
        }
      } catch {
        return {
          configuration,
          checks: [check('store.database', 'fail',
            'The CAVE text store or one of its declared sources could not be loaded',
            'Fix the file (cave parse) or the source it declares; a text store is read-only.')]
        }
      }
    })()
    return finishDatabaseInspection(result, () => store?.close())
  }

  let db: SqliteDatabase | undefined
  let observed = base
  const result = (() => {
    try {
      db = nodeSqliteAdapter.open(path, { readOnly: true })
      // Keep schema, integrity, row and search diagnostics on one read snapshot.
      // Closing the owned connection releases this read-only transaction.
      db.exec('BEGIN')
      const version = db.prepare('PRAGMA user_version').get()?.['user_version']
      if (typeof version !== 'number') throw new Error('invalid version')
      const caveObjects = db.prepare(
        `SELECT count(*) AS count FROM sqlite_schema WHERE name LIKE 'cave!_%' ESCAPE '!' OR name LIKE 'idx!_cave!_%' ESCAPE '!'`
      ).get()?.['count']
      const configuration = { ...base, schemaVersion: version }
      observed = configuration

      if (version > Schema.currentVersion) {
        return {
          configuration,
          checks: [check('store.database', 'fail',
            `Database schema ${version} is newer than supported schema ${Schema.currentVersion}`,
            'Upgrade CAVE before opening this database.')]
        }
      }
      if (version === 0 && caveObjects === 0) {
        return {
          configuration,
          checks: [check('store.database', 'warn', 'The database is readable but is not initialized as a CAVE store',
            'Run cave add to initialize it; cave doctor made no changes.')]
        }
      }
      if (version < Schema.currentVersion) {
        return {
          configuration,
          checks: [check('store.database', 'warn',
            `Database schema ${version} needs migration to schema ${Schema.currentVersion}`,
            'Close every user and copy the database file as a rollback point, then open it with a writing command such as cave add to migrate it; reads never migrate.')]
        }
      }

      Schema.validate(db, version)
      const integrity = db.prepare('PRAGMA integrity_check').all()
      if (integrity.length !== 1 || integrity[0]?.['integrity_check'] !== 'ok') {
        return {
          configuration,
          checks: [check('store.integrity', 'fail', 'SQLite integrity checking failed',
            'Restore a verified backup or recover the database with SQLite tooling.')]
        }
      }
      const foreignKeys = db.prepare('PRAGMA foreign_key_check').all()
      if (foreignKeys.length > 0) {
        return {
          configuration,
          checks: [check('store.integrity', 'fail', 'The store contains broken foreign-key references',
            'Restore a verified backup or repair the affected database rows.')]
        }
      }
      const claims = db.prepare('SELECT count(*) AS count FROM cave_claim').get()?.['count']
      if (typeof claims !== 'number') throw new Error('invalid count')
      let invalidRows = db.prepare(`SELECT EXISTS (
        SELECT 1 FROM cave_claim WHERE negated NOT IN (0, 1) OR importance NOT IN (0, 1)
          OR value_approx NOT IN (0, 1)
          OR (object IS NOT NULL AND (attribute IS NOT NULL OR value_text IS NOT NULL))
          OR (attribute IS NOT NULL AND value_text IS NULL)
          OR typeof(conf) NOT IN ('integer', 'real') OR conf NOT BETWEEN 0 AND 1
          OR (sigma_level IS NOT NULL AND (typeof(sigma_level) NOT IN ('integer', 'real')
            OR NOT (sigma_level > 0 AND sigma_level <= ?)))
      ) OR EXISTS (
        SELECT 1 FROM cave_provenance WHERE typeof(value) <> 'text' OR value = ''
      ) OR EXISTS (
        SELECT 1 FROM cave_edge WHERE role IS NULL OR role NOT IN ('WHEN', 'VIA', 'BECAUSE', 'QUALIFIES')
      ) AS invalid`).get(Number.MAX_VALUE)?.['invalid']
      if (typeof invalidRows !== 'number') throw new Error('invalid row check')
      if (invalidRows === 0) {
        // Stream stored history without collecting rows; projections must agree with
        // authored values even when a SQL filter would otherwise hide the row.
        // This connection is owned by nodeSqliteAdapter, which returns native statements.
        const rows = db.prepare('SELECT * FROM cave_claim') as StatementSync
        const contexts = db.prepare('SELECT context FROM cave_context WHERE claim_id = ?')
        const tags = db.prepare('SELECT key, value FROM cave_tag WHERE claim_id = ?')
        for (const row of rows.iterate()) {
          if (typeof row.id !== 'string' || !Uuidv7.is(row.id) || row.tx !== row.id) {
            invalidRows = 1
            break
          }
          try {
            const claim = Row.toClaim(row as unknown as Row.t,
              contexts.all(row.id).map(entry => entry.context as string),
              tags.all(row.id) as { key: string, value: null | string }[])
            emitClaim(claim)
            if (Key.of(claim) !== row.claim_key) {
              invalidRows = 1
              break
            }
          } catch {
            invalidRows = 1
            break
          }
        }
      }
      // SQLite's integrity_check cannot tell whether the separate FTS content
      // still represents the claims. Compare one snapshot, including counts so
      // duplicate entries cannot disappear under EXCEPT's set semantics.
      const searchColumns = 'subject, verb, object, attribute, value_text, comment, raw_line'
      const searchMismatch = db.prepare(`SELECT
        (SELECT count(*) FROM cave_claim) <> (SELECT count(*) FROM cave_fts)
        OR EXISTS (
          SELECT id, ${searchColumns} FROM cave_claim
          EXCEPT SELECT claim_id, ${searchColumns} FROM cave_fts
        ) AS mismatch`).get()?.['mismatch']
      if (typeof searchMismatch !== 'number') throw new Error('invalid search check')
      return {
        configuration: { ...configuration, claims },
        checks: [
          check('store.database', 'pass', `CAVE schema ${version} is compatible (${claims} claim(s))`),
          check('store.integrity', 'pass', 'SQLite integrity and foreign-key checks passed'),
          invalidRows === 0 ?
            check('store.rows', 'pass', 'Stored payloads, provenance, flags, confidence and sigma levels are valid') :
            check('store.rows', 'fail', 'Stored claims contain invalid transaction identities, claim keys, terms, tags, edge roles, payload columns, provenance values, boolean flags, confidence, sigma levels, authored values or numeric caches',
              'Restore a verified backup or repair the affected stored rows before exporting; cave doctor made no changes.'),
          searchMismatch === 0 ?
            check('store.search', 'pass', 'Search entries match the stored claims') :
            check('store.search', 'fail', 'Search entries are missing, duplicated, orphaned, or stale',
              'Restore a verified backup or rebuild the search index from the stored claims with SQLite tooling; cave doctor made no changes.')
        ]
      }
    } catch {
      return {
        configuration: observed,
        checks: [check('store.database', 'fail', 'The configured database is unreadable or has an incompatible schema',
          'Check file permissions, restore a verified backup, or pass --db for another store.')]
      }
    }
  })()
  return finishDatabaseInspection(result, () => db?.close())
}

type HooksConfiguration = DoctorReport['configuration']['hooks']

const inspectHooks = (path: string | undefined): {
  readonly configuration: HooksConfiguration
  readonly check: DoctorCheck
} => {
  if (path === undefined) {
    return {
      configuration: { source: 'none', exists: false },
      check: check('config.hooks', 'pass', 'No optional hooks file was configured')
    }
  }
  const configuration = { source: 'flag' as const, exists: existsSync(path) }
  if (!configuration.exists) {
    return {
      configuration,
      check: check('config.hooks', 'fail', 'The configured hooks file does not exist',
        'Create a UTF-8 JSON object with nonblank hook names and Unicode shell command strings, or omit --hooks.')
    }
  }
  try {
    const entries = Object.entries(readHooks(path))
    return {
      configuration: { ...configuration, entries: entries.length },
      check: check('config.hooks', 'pass', `Hooks configuration is valid (${entries.length} entr${entries.length === 1 ? 'y' : 'ies'})`)
    }
  } catch {
    return {
      configuration,
      check: check('config.hooks', 'fail', 'The configured hooks file is unreadable or malformed',
        'Use valid UTF-8 JSON with nonblank hook names and string commands; names and commands must have no unpaired Unicode surrogates.')
    }
  }
}

export const diagnose = (options: { readonly db?: string, readonly hooks?: string } = {}): DoctorReport => {
  const configuredDb = options.db, configuredHooks = options.hooks
  const databasePath = configuredDb ?? defaultDbPath()
  const databaseSource: DatabaseConfiguration['source'] = configuredDb !== undefined ? 'flag' :
    process.env['CAVE_DB'] !== undefined ? 'environment' : 'default'
  const database = inspectDatabase(databasePath, databaseSource)
  const hooks = inspectHooks(configuredHooks)
  const checks = [
    nodeCheck(),
    ...sqliteCheck(),
    grammarCheck(),
    pnpmCheck(),
    ...database.checks,
    hooks.check
  ]
  return {
    format: 'cave.doctor',
    version: 1,
    ok: checks.every(entry => entry.status !== 'fail'),
    caveVersion: Version.current(),
    runtime: { node: process.versions.node, platform: process.platform, arch: process.arch },
    configuration: { database: database.configuration, hooks: hooks.configuration },
    checks
  }
}

const render = (report: DoctorReport): string => {
  const lines = [`cave doctor ${report.caveVersion}`]
  for (const entry of report.checks) {
    lines.push(`${entry.status.toUpperCase().padEnd(4)} ${entry.summary}`)
    if (entry.remediation !== undefined) lines.push(`     ${entry.remediation}`)
  }
  const failures = report.checks.filter(entry => entry.status === 'fail').length
  const warnings = report.checks.filter(entry => entry.status === 'warn').length
  lines.push(report.ok ?
    `result: ready${warnings === 0 ? '' : ` with ${warnings} warning(s)`}` :
    `result: ${failures} problem(s), ${warnings} warning(s)`)
  return `${lines.join('\n')}\n`
}

export const doctorCommand = (argv: readonly string[]): DoctorOutput => {
  const { values, positionals } = parseArgs({
    args: [...argv],
    options: {
      db: { type: 'string' },
      hooks: { type: 'string' },
      json: { type: 'boolean' }
    },
    allowPositionals: true
  })
  if (positionals.length > 0) {
    return { code: 2, out: '', err: 'cave doctor: unexpected positional arguments\n' }
  }
  const report = diagnose({
    ...values.db === undefined ? {} : { db: values.db },
    ...values.hooks === undefined ? {} : { hooks: values.hooks }
  })
  return {
    code: report.ok ? 0 : 1,
    out: values.json === true ? `${JSON.stringify(report, undefined, 2)}\n` : render(report),
    err: ''
  }
}
