/** Read-only installation, runtime, and store diagnostics for `cave doctor`. */

import { existsSync, readFileSync, statSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, parse } from 'node:path'
import { spawnSync } from 'node:child_process'
import { parseArgs } from 'node:util'
import { Version } from '@cavelang/core'
import { Schema, defaultDbPath } from '@cavelang/store'
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
      readonly kind: 'memory' | 'file'
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

const requiredNode = '22.18.0'

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

const check = (
  id: string,
  status: DoctorStatus,
  summary: string,
  remediation?: string
): DoctorCheck => ({ id, status, summary, ...remediation === undefined ? {} : { remediation } })

const nodeCheck = (): DoctorCheck =>
  atLeast(process.versions.node, requiredNode) ?
    check('runtime.node', 'pass', `Node ${process.versions.node} satisfies >=${requiredNode}`) :
    check('runtime.node', 'fail', `Node ${process.versions.node} is unsupported`,
      `Install Node ${requiredNode} or newer and rerun cave doctor.`)

const sqliteCheck = (): DoctorCheck => {
  let db: SqliteDatabase | undefined
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
  } finally {
    db?.close()
  }
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
  const result = spawnSync('pnpm', ['--version'], {
    encoding: 'utf8',
    timeout: 3_000,
    stdio: ['ignore', 'pipe', 'ignore']
  })
  const actual = result.status === 0 ? numericVersion(result.stdout.trim()) : undefined
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

const inspectDatabase = (path: string, source: DatabaseConfiguration['source']): {
  readonly configuration: DatabaseConfiguration
  readonly checks: readonly DoctorCheck[]
} => {
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

  let db: SqliteDatabase | undefined
  let observed = base
  try {
    db = nodeSqliteAdapter.open(path, { readOnly: true })
    const version = db.prepare('PRAGMA user_version').get()?.['user_version']
    if (typeof version !== 'number') throw new Error('invalid version')
    const caveObjects = db.prepare(
      `SELECT count(*) AS count FROM sqlite_schema WHERE name LIKE 'cave_%' OR name LIKE 'idx_cave_%'`
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
          'Back up the database, then open it with a normal cave command to migrate it.')]
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
    return {
      configuration: { ...configuration, claims },
      checks: [
        check('store.database', 'pass', `CAVE schema ${version} is compatible (${claims} claim(s))`),
        check('store.integrity', 'pass', 'SQLite integrity and foreign-key checks passed')
      ]
    }
  } catch {
    return {
      configuration: observed,
      checks: [check('store.database', 'fail', 'The configured database is unreadable or has an incompatible schema',
        'Check file permissions, restore a verified backup, or pass --db for another store.')]
    }
  } finally {
    db?.close()
  }
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
        'Create a JSON object of hook names to shell command strings, or omit --hooks.')
    }
  }
  try {
    const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'))
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) throw new Error('invalid')
    const entries = Object.entries(parsed)
    if (entries.some(([name, command]) => name.trim() === '' || typeof command !== 'string')) {
      throw new Error('invalid')
    }
    return {
      configuration: { ...configuration, entries: entries.length },
      check: check('config.hooks', 'pass', `Hooks configuration is valid (${entries.length} entr${entries.length === 1 ? 'y' : 'ies'})`)
    }
  } catch {
    return {
      configuration,
      check: check('config.hooks', 'fail', 'The configured hooks file is unreadable or malformed',
        'Use a JSON object whose values are shell command strings.')
    }
  }
}

export const diagnose = (options: { readonly db?: string, readonly hooks?: string } = {}): DoctorReport => {
  const databasePath = options.db ?? defaultDbPath()
  const databaseSource: DatabaseConfiguration['source'] = options.db !== undefined ? 'flag' :
    process.env['CAVE_DB'] !== undefined ? 'environment' : 'default'
  const database = inspectDatabase(databasePath, databaseSource)
  const hooks = inspectHooks(options.hooks)
  const checks = [
    nodeCheck(),
    sqliteCheck(),
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
