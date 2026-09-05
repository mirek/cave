/**
 * Record sources (spec §23) — CSV/TSV files, JSON documents, JSONL streams,
 * SQLite databases (read-only), and http(s) URLs serving JSON or CSV. Every
 * source loads to the same shape: an array of flat-ish records the template
 * layer resolves fields from (`fieldOf` handles nested JSON by dot path).
 */

import { readFileSync } from 'node:fs'
import { basename, extname } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import type { LineSpan } from '@cavelang/core'
import { fieldOf } from './template.ts'

export type Format = 'csv' | 'tsv' | 'json' | 'jsonl' | 'sqlite'

/** Every record format, in `--format` order. */
export const formats: readonly Format[] = ['csv', 'tsv', 'json', 'jsonl', 'sqlite']

/** Injection point for tests; the built-in fetch otherwise. */
export type FetchLike = (url: string, init: RequestInit) => Promise<Response>

export type Options = {
  /** Explicit format; inferred from the extension when omitted. */
  readonly format?: Format
  /** CSV delimiter (default `,`; `\t` for tsv). */
  readonly delimiter?: string
  /**
   * SQLite table to read (`SELECT *`); for any other format, the name of
   * the temporary table `sql` runs against (default `records`).
   */
  readonly table?: string
  /**
   * SQLite query — the alternative to `table`. For any other format the
   * parsed records are loaded into a temporary in-memory SQLite table,
   * values exactly as parsed (CSV cells are text; cast for arithmetic),
   * and the query's rows become the records (spec §23.1): one mechanism
   * for projecting, filtering, and reshaping, no expression language.
   */
  readonly sql?: string
  /** Dot path to the record array inside a JSON document. */
  readonly records?: string
  /** URL fetch timeout in seconds (default 60). */
  readonly timeoutSeconds?: number
  /** Injection point for tests; the built-in fetch otherwise. */
  readonly fetchImpl?: FetchLike
}

export type Loaded = {
  readonly records: readonly Record<string, unknown>[]
  readonly format: Format
  /** Record-aligned source line spans when the format has stable lines. */
  readonly spans?: readonly LineSpan[]
  /** The source's own column order when it declares one (a CSV header), records or none. */
  readonly columns?: readonly string[]
}

export const isUrl = (source: string): boolean =>
  /^https?:\/\//i.test(source)

const extensionFormats: Record<string, Format> = {
  '.csv': 'csv',
  '.tsv': 'tsv',
  '.json': 'json',
  '.jsonl': 'jsonl',
  '.ndjson': 'jsonl',
  '.db': 'sqlite',
  '.sqlite': 'sqlite',
  '.sqlite3': 'sqlite'
}

/** Infers the source format from an explicit option or the file/URL extension. */
export const formatOf = (source: string, options: Options = {}): Format => {
  if (options.format !== undefined) {
    return options.format
  }
  const path = isUrl(source) ? new URL(source).pathname : source
  const format = extensionFormats[extname(path).toLowerCase()]
  if (format === undefined) {
    throw new Error(`cannot infer format of ${JSON.stringify(source)} — pass --format csv|tsv|json|jsonl|sqlite`)
  }
  return format
}

/**
 * Default source name for record identity (spec §23.2): the file/URL
 * basename without extension, whitespace and path noise normalized to `-`.
 */
export const nameOf = (source: string): string => {
  const path = isUrl(source) ?
    new URL(source).hostname + decodeURIComponent(new URL(source).pathname) :
    source
  const base = basename(path, extname(path))
  const name = base.replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '')
  return name === '' ? 'source' : name
}

/**
 * RFC 4180 CSV: quoted fields (with `""` escapes) may contain delimiters and
 * newlines; records split on LF or CRLF. The first row names the fields.
 */
const parseCsvLocated = (text: string, delimiter = ','): { records: Record<string, string>[], spans: LineSpan[], columns: string[] } => {
  const rows: { cells: string[], span: LineSpan }[] = []
  let row: string[] = []
  let field = ''
  let quoted = false
  let line = 1
  let rowStart = 1
  const body = text.startsWith('\uFEFF') ? text.slice(1) : text
  const endField = (): void => {
    row.push(field)
    field = ''
  }
  const endRow = (): void => {
    endField()
    rows.push({ cells: row, span: { startLine: rowStart, endLine: line } })
    row = []
    rowStart = line + 1
  }
  for (let i = 0; i < body.length; i++) {
    const char = body[i]!
    if (quoted) {
      if (char === '"') {
        if (body[i + 1] === '"') {
          field += '"'
          i += 1
        } else {
          quoted = false
        }
      } else if (char === '\r' && body[i + 1] === '\n') {
        // CRLF normalizes to LF inside quoted fields too.
      } else {
        field += char
      }
    } else if (char === '"' && field === '') {
      quoted = true
    } else if (char === delimiter) {
      endField()
    } else if (char === '\n') {
      endRow()
    } else if (char !== '\r' || body[i + 1] !== '\n') {
      field += char
    }
    if (char === '\n') {
      line += 1
    }
  }
  if (field !== '' || row.length > 0) {
    endRow()
  }
  const [headerRow, ...dataRows] = rows
  const header = headerRow?.cells
  if (header === undefined) {
    return { records: [], spans: [], columns: [] }
  }
  const present = dataRows.filter(row_ => row_.cells.length > 1 || row_.cells[0] !== '')
  return {
    columns: header.map(cell => cell.trim()),
    records: present.map(row_ => Object.fromEntries(
      header.map((name, at) => [name.trim(), row_.cells[at] ?? ''])
    )),
    spans: present.map(row_ => row_.span)
  }
}

export const parseCsv = (text: string, delimiter = ','): Record<string, string>[] =>
  parseCsvLocated(text, delimiter).records

const asRecords = (value: unknown, source: string): Record<string, unknown>[] => {
  if (!Array.isArray(value)) {
    throw new Error(`${source}: expected an array of records${value !== null && typeof value === 'object' ? ' — pass --records <dot.path> to the array' : ''}`)
  }
  return value.map((item, at) => {
    if (item === null || typeof item !== 'object' || Array.isArray(item)) {
      throw new Error(`${source}: record ${at + 1} is not an object`)
    }
    return item as Record<string, unknown>
  })
}

const parseJson = (text: string, source: string, options: Options): Record<string, unknown>[] => {
  const parsed: unknown = JSON.parse(text)
  const picked = options.records === undefined ? parsed : fieldOf(parsed, options.records)
  if (options.records !== undefined && picked === undefined) {
    throw new Error(`${source}: --records ${JSON.stringify(options.records)} not found`)
  }
  return asRecords(picked, source)
}

const parseJsonlLocated = (text: string, source: string): { records: Record<string, unknown>[], spans: LineSpan[] } => {
  const located = text.split(/\r?\n/)
    .map((line, at) => ({ line, lineNo: at + 1 }))
    .filter(entry => entry.line.trim() !== '')
  return {
    records: located.map(entry => {
      const parsed: unknown = JSON.parse(entry.line)
      if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new Error(`${source}: line ${entry.lineNo} is not a JSON object`)
      }
      return parsed as Record<string, unknown>
    }),
    spans: located.map(entry => ({ startLine: entry.lineNo, endLine: entry.lineNo }))
  }
}

/** node:sqlite values → template-substitutable values. */
const sqliteValue = (value: unknown): unknown =>
  typeof value === 'bigint' ?
    (Number.isSafeInteger(Number(value)) ? Number(value) : value.toString()) :
    value

/** The SQLite representation of a record field: scalars as they are (bigints exact), booleans as 0/1, anything structured as JSON text. */
const sqlValue = (value: unknown): null | number | bigint | string =>
  value === undefined || value === null ? null :
    typeof value === 'number' || typeof value === 'string' || typeof value === 'bigint' ? value :
      typeof value === 'boolean' ? (value ? 1 : 0) :
        JSON.stringify(value)

/**
 * Runs `sql` over the records loaded from a text format: the records
 * become one temporary in-memory table (`records`, or `table`), one column
 * per field in first-seen order, and the query's rows are the records
 * that reach the mapping (spec §23.1). Line spans do not survive a query.
 */
export const queryRecords = (
  records: readonly Record<string, unknown>[],
  sql: string,
  table = 'records',
  schema?: readonly string[]
): Record<string, unknown>[] => {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(table)) {
    throw new Error(`--table ${JSON.stringify(table)} is not a plain identifier`)
  }
  // The source's own columns first (a CSV header survives an empty file;
  // a repeated header is one column, as it is one record field), then any
  // field the records add.
  const columns: string[] = [...new Set(schema ?? [])]
  const known = new Set<string>(columns)
  for (const record of records) {
    for (const key of Object.keys(record)) {
      if (!known.has(key)) {
        known.add(key)
        columns.push(key)
      }
    }
  }
  // SQLite column names are case-insensitive — for ASCII letters only, as
  // its own folding is — so two fields that differ only in ASCII case
  // cannot both be staged, and merging them would lose data.
  const fold = (name: string): string => name.replace(/[A-Z]/g, letter => letter.toLowerCase())
  const folded = new Map<string, string>()
  for (const column of columns) {
    const other = folded.get(fold(column))
    if (other !== undefined) {
      throw new Error(`fields ${JSON.stringify(other)} and ${JSON.stringify(column)} differ only in case, which SQLite cannot tell apart — rename one in the source before --sql`)
    }
    folded.set(fold(column), column)
  }
  const quoted = (name: string): string => `"${name.replaceAll('"', '""')}"`
  const stage = (): Record<string, unknown>[] => {
    const db = new DatabaseSync(':memory:')
    try {
      // No affinity: a value is exactly what the source gave — a CSV cell is
      // text ("00123" stays "00123"), a JSON number is a number — and a query
      // casts when it wants arithmetic (CAST(kg AS REAL) > 10).
      db.exec(`CREATE TABLE ${quoted(table)} (${columns.length === 0 ? 'value' : columns.map(quoted).join(', ')})`)
      if (columns.length > 0) {
        const insert = db.prepare(`INSERT INTO ${quoted(table)} (${columns.map(quoted).join(', ')}) VALUES (${columns.map(() => '?').join(', ')})`)
        for (const record of records) {
          insert.run(...columns.map(column => sqlValue(record[column])))
        }
      } else {
        // Records without any field are still records: one row each, so a
        // count or a constant projection sees them.
        const insert = db.prepare(`INSERT INTO ${quoted(table)} DEFAULT VALUES`)
        for (let i = 0; i < records.length; i += 1) insert.run()
      }
      const statement = db.prepare(sql)
      // Integers beyond the safe range arrive as bigints and become text in
      // `sqliteValue`, instead of throwing out of range.
      statement.setReadBigInts(true)
      const rows = statement.all() as Record<string, unknown>[]
      return rows.map(row => Object.fromEntries(Object.entries(row).map(([key, value]) => [key, sqliteValue(value)])))
    } finally {
      db.close()
    }
  }
  // A schemaless source (JSON, JSONL) that became empty has no columns to
  // offer, yet the query names the ones it expects: for an empty input
  // only, learn them from SQLite's own complaint and retry, so the query
  // answers with zero rows exactly as it would over a header-only CSV.
  for (let attempt = 0; ; attempt += 1) {
    try {
      return stage()
    } catch (error) {
      const missing = records.length === 0 && attempt < 64 ?
        /no such column: (.+?)(?: - should this be .*)?$/.exec(error instanceof Error ? error.message : '') :
        null
      // The reference as SQLite spells it: possibly qualified by the table
      // or an alias, possibly quoted; the column is its last bare segment.
      const name = missing?.[1]?.trim().split('.').at(-1)?.replace(/^["`[](.*)["`\]]$/, '$1')
      if (name === undefined || name === '' || known.has(name)) {
        throw error
      }
      known.add(name)
      columns.push(name)
    }
  }
}

const readSqlite = (path: string, options: Options): Record<string, unknown>[] => {
  if ((options.table === undefined) === (options.sql === undefined)) {
    throw new Error(`${path}: a SQLite source needs exactly one of --table or --sql`)
  }
  const sql = options.sql ?? `SELECT * FROM "${options.table!.replaceAll('"', '""')}"`
  const db = new DatabaseSync(path, { readOnly: true })
  try {
    const rows = db.prepare(sql).all() as Record<string, unknown>[]
    return rows.map(row => Object.fromEntries(Object.entries(row).map(([key, value]) => [key, sqliteValue(value)])))
  } finally {
    db.close()
  }
}

/** Fetches a URL's body; the transport is injectable for tests. */
export const fetchText = async (url: string, options: Options): Promise<{ text: string, contentType: string }> => {
  const response = await (options.fetchImpl ?? fetch)(url, {
    headers: {
      'user-agent': 'cave-connect',
      accept: 'application/json, text/csv;q=0.9, */*;q=0.8'
    },
    redirect: 'follow',
    signal: AbortSignal.timeout((options.timeoutSeconds ?? 60) * 1000)
  })
  if (!response.ok) {
    throw new Error(`${url}: HTTP ${response.status}`)
  }
  return { text: await response.text(), contentType: response.headers.get('content-type') ?? '' }
}

/**
 * Loads a local source synchronously — what assembling a text store needs
 * (spec §23.4); a URL source is refused, since fetching it cannot be
 * synchronous: `cave connect` follows URLs.
 */
export const loadSync = (source: string, options: Options = {}): Loaded => {
  if (isUrl(source)) {
    throw new Error(`${source}: URL sources are followed by cave connect, not when assembling a text store`)
  }
  const format = formatOf(source, options)
  if (format === 'sqlite') {
    return { records: readSqlite(source, options), format }
  }
  return { ...queried(parseLocated(format, readFileSync(source, 'utf8'), source, options), options), format }
}

/** Applies `sql`, when given, to records of a text format — the spans no longer align, so they go. */
const queried = (
  parsed: { records: Record<string, unknown>[], spans?: LineSpan[], columns?: string[] },
  options: Options
): { records: Record<string, unknown>[], spans?: LineSpan[], columns?: string[] } =>
  options.sql === undefined ? parsed : { records: queryRecords(parsed.records, options.sql, options.table, parsed.columns) }

/** Loads a source to records. Local files read synchronously; URLs fetch. */
export const load = async (source: string, options: Options = {}): Promise<Loaded> => {
  if (isUrl(source)) {
    const { text, contentType } = await fetchText(source, options)
    const format = options.format ??
      (contentType.includes('json') ? 'json' :
        contentType.includes('csv') ? 'csv' :
          formatOf(source, options))
    if (format === 'sqlite') {
      throw new Error(`${source}: SQLite sources must be local files`)
    }
    return { ...queried(parseLocated(format, text, source, options), options), format }
  }
  return loadSync(source, options)
}

const parseLocated = (
  format: Exclude<Format, 'sqlite'>,
  text: string,
  source: string,
  options: Options
): { records: Record<string, unknown>[], spans?: LineSpan[], columns?: string[] } => {
  switch (format) {
    case 'csv':
      return parseCsvLocated(text, options.delimiter ?? ',')
    case 'tsv':
      return parseCsvLocated(text, options.delimiter ?? '\t')
    case 'json':
      return { records: parseJson(text, source, options) }
    case 'jsonl':
      return parseJsonlLocated(text, source)
  }
}
