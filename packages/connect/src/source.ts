/**
 * Record sources (spec §23) — CSV/TSV files, JSON documents, JSONL streams,
 * SQLite databases (read-only), and http(s) URLs serving JSON, JSONL, CSV or TSV. Every
 * source loads to the same shape: an array of flat-ish records the template
 * layer resolves fields from (`fieldOf` handles nested JSON by dot path).
 */

import { captureRecords } from './records.ts'
import { rethrowFetchFailure } from './fetch-failure.ts'
import { decodeText, readText } from './utf8.ts'
import { basename, extname } from 'node:path'
import { DatabaseSync, type StatementSync } from 'node:sqlite'
import type { LineSpan } from '@cavelang/core'
import { fieldOf } from './template.ts'


/** Close an owned source connection once without replacing a query failure. */
const withSourceDatabase = <T>(db: DatabaseSync, read: () => T): T => {
  let result: T
  try {
    result = read()
  } catch (error) {
    try { db.close() } catch (closeError) {
      throw new AggregateError([error, closeError],
        'CAVE source SQL failed and database close also failed', { cause: error })
    }
    throw error
  }
  db.close()
  return result
}

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
  /** Cancel source loading and pending URL body reads. */
  readonly signal?: AbortSignal
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

const explicitFormat = (value: unknown): Format | undefined => {
  switch (value) {
    case undefined:
    case 'csv': case 'tsv': case 'json': case 'jsonl': case 'sqlite':
      return value
    default:
      throw new TypeError('format must be csv, tsv, json, jsonl or sqlite')
  }
}

const captureOptions = (options: Options): Options => {
  const signal = options.signal
  signal?.throwIfAborted()
  return {
    signal, format: explicitFormat(options.format), delimiter: options.delimiter,
    table: options.table, sql: options.sql, records: options.records,
    timeoutSeconds: options.timeoutSeconds, fetchImpl: options.fetchImpl
  }
}

const fetchTimeoutMs = (seconds: number): number => {
  const milliseconds = typeof seconds === 'number' ? seconds * 1000 : NaN
  const rounded = Math.round(milliseconds)
  const tolerance = Number.EPSILON * Math.max(1, Math.abs(milliseconds))
  if (!Number.isFinite(milliseconds) || seconds < 0 ||
      rounded < (seconds === 0 ? 0 : 1) || rounded > 2147483647 ||
      Math.abs(milliseconds - rounded) > tolerance) {
    throw new TypeError('timeoutSeconds must resolve to whole milliseconds in 0..2147483647')
  }
  return rounded
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
  const supplied = explicitFormat(options.format)
  if (supplied !== undefined) {
    return supplied
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
  if (typeof delimiter !== 'string' || delimiter.length !== 1 || /["\r\n]/.test(delimiter)) {
    throw new Error('CSV delimiter must be a single character other than a double quote or line break')
  }
  const rows: { cells: string[], span: LineSpan, hasQuotedField: boolean }[] = []
  let row: string[] = []
  let field = ''
  let quoted = false
  let hasQuotedField = false
  let quoteStart = 1
  let line = 1
  let rowStart = 1
  const body = text.startsWith('\uFEFF') ? text.slice(1) : text
  const endField = (): void => {
    row.push(field)
    field = ''
  }
  const endRow = (): void => {
    endField()
    rows.push({ cells: row, span: { startLine: rowStart, endLine: line }, hasQuotedField })
    row = []
    hasQuotedField = false
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
          const next = body[i + 1]
          if (next !== undefined && next !== delimiter && next !== '\n' &&
              !(next === '\r' && body[i + 2] === '\n')) {
            throw new Error(`CSV line ${line}: unexpected character after closing quote`)
          }
        }
      } else if (char === '\r' && body[i + 1] === '\n') {
        // CRLF normalizes to LF inside quoted fields too.
      } else {
        field += char
      }
    } else if (char === '"') {
      if (field !== '') throw new Error(`CSV line ${line}: unexpected quote in unquoted field`)
      quoted = true
      hasQuotedField = true
      quoteStart = line
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
  if (quoted) {
    throw new Error(`CSV line ${quoteStart}: unterminated quoted field`)
  }
  if (field !== '' || row.length > 0 || hasQuotedField) {
    endRow()
  }
  const [headerRow, ...dataRows] = rows
  const header = headerRow?.cells
  if (header === undefined) {
    return { records: [], spans: [], columns: [] }
  }
  const columns = header.map(cell => cell.trim())
  const names = new Set<string>()
  for (const name of columns) {
    if (names.has(name)) throw new Error(`CSV line ${headerRow!.span.startLine}: duplicate column name ${JSON.stringify(name)}`)
    names.add(name)
  }
  const present = dataRows.filter(row_ => row_.hasQuotedField || row_.cells.length > 1 || row_.cells[0] !== '')
  return {
    columns,
    records: present.map(row_ => {
      if (row_.cells.length > columns.length) {
        throw new Error(`CSV line ${row_.span.startLine}: ${row_.cells.length} cells exceed ${columns.length} header columns`)
      }
      return Object.fromEntries(columns.map((name, at) => [name, row_.cells[at] ?? '']))
    }),
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
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch (error) {
    throw new SyntaxError(`${source}: invalid JSON — ${error instanceof Error ? error.message : String(error)}`, { cause: error })
  }
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
      let parsed: unknown
      try {
        parsed = JSON.parse(entry.line)
      } catch (error) {
        throw new Error(`${source}: line ${entry.lineNo}: invalid JSON — ${error instanceof Error ? error.message : String(error)}`, { cause: error })
      }
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

/** Require a record projection before execution; object rows also need unique names. */
const uniqueResultColumns = (statement: StatementSync): void => {
  const columns = statement.columns()
  if (columns.length === 0) {
    throw new Error('SQL source query must return columns — use SELECT to project records')
  }
  const names = new Set<string>()
  for (const { name } of columns) {
    if (names.has(name)) {
      throw new Error(`duplicate SQL result column ${JSON.stringify(name)} — use distinct AS aliases`)
    }
    names.add(name)
  }
}

/**
 * The columns a missing-column diagnostic may refer to. SQLite strips
 * backticks and brackets before reporting, keeps the double quotes of a
 * plain quoted identifier, and drops them from a qualified reference, so
 * `r."last.name"` arrives as `r.last.name`, which could be column
 * `last.name` of `r` or column `r.last.name` of the table, and `"x"`
 * could be the column `x` or a field literally named `"x"`. Over an empty
 * table an extra column costs nothing, so every reading is staged and the
 * query resolves whichever it meant.
 */
const inferColumns = (reference: string): string[] => {
  const quoted = /^"([^]*)"$/.exec(reference)
  if (quoted !== null) {
    return [reference, quoted[1]!]
  }
  const segments = reference.split('.')
  return segments.map((_, at) => segments.slice(at).join('.'))
}

/**
 * The column a SQLite diagnostic says is missing, or `undefined` for any
 * other error. The hint SQLite appends to a double-quoted identifier is a
 * fixed phrase and appears only after a leading quote, so it is stripped
 * exactly and only there — a bare name that happens to end in the phrase
 * is the name. A `JOIN … USING` column arrives with its own fixed suffix.
 */
const missingColumn = (message: string): string | undefined => {
  const hint = ' - should this be a string literal in single-quotes?'
  // A quoted name may span lines, so the capture does too.
  const column = /no such column: ([^]+)$/.exec(message)?.[1]
  if (column !== undefined) {
    return column.startsWith('"') && column.endsWith(hint) ? column.slice(0, -hint.length) : column
  }
  return /cannot join using column ([^]+) - column not present in both tables$/.exec(message)?.[1]
}

/** Only readable string diagnostics can justify retrying an empty source. */
const missingColumnOf = (error: unknown): string | undefined => {
  try {
    if (!(error instanceof Error)) return undefined
    const message = error.message
    return typeof message === 'string' ? missingColumn(message) : undefined
  } catch {
    return undefined
  }
}

/**
 * The SQLite representation of a record field: scalars as they are
 * (a bigint exact while SQLite's signed 64-bit integer holds it, its
 * decimal text beyond), booleans as 0/1, anything structured as JSON text.
 */
const finiteValue = (value: unknown): unknown => {
  if (typeof value === 'number' && !Number.isFinite(value)) {
    throw new Error('non-finite numeric field cannot be staged for --sql')
  }
  return value
}

const sqlValue = (value: unknown): null | number | bigint | string => {
  finiteValue(value)
  return value === undefined || value === null ? null :
    typeof value === 'number' || typeof value === 'string' ? value :
      typeof value === 'bigint' ? (value >= -(2n ** 63n) && value < 2n ** 63n ? value : value.toString()) :
        typeof value === 'boolean' ? (value ? 1 : 0) :
          JSON.stringify(value, (_key, nested) => finiteValue(nested))
}

/** Capture the declared header once; an invalid header is not a schemaless source. */
const captureSchema = (schema: readonly string[] | undefined): string[] | undefined => {
  if (schema === undefined) return undefined
  const invalid = (): never => { throw new TypeError('SQL source schema must be a dense array of strings') }
  if (!Array.isArray(schema)) return invalid()
  const length = schema.length
  if (!Number.isInteger(length) || length < 0 || length > 0xffffffff) return invalid()
  const columns: string[] = []
  for (let index = 0; index < length; index++) {
    if (!Object.hasOwn(schema, index)) return invalid()
    const column = schema[index]
    if (typeof column !== 'string') return invalid()
    columns.push(column)
  }
  return columns
}

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
  records = captureRecords(records)
  schema = captureSchema(schema)
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
    return withSourceDatabase(db, () => {
      // No affinity: a value is exactly what the source gave — a CSV cell is
      // text ("00123" stays "00123"), a JSON number is a number — and a query
      // casts when it wants arithmetic (CAST(kg AS REAL) > 10).
      db.exec(`CREATE TABLE ${quoted(table)} (${columns.length === 0 ? 'value' : columns.map(quoted).join(', ')})`)
      if (columns.length > 0) {
        const insert = db.prepare(`INSERT INTO ${quoted(table)} (${columns.map(quoted).join(', ')}) VALUES (${columns.map(() => '?').join(', ')})`)
        for (const record of records) {
          insert.run(...columns.map(column => sqlValue(Object.hasOwn(record, column) ? record[column] : undefined)))
        }
      } else {
        // Records without any field are still records: one row each, so a
        // count or a constant projection sees them.
        const insert = db.prepare(`INSERT INTO ${quoted(table)} DEFAULT VALUES`)
        for (let i = 0; i < records.length; i += 1) insert.run()
      }
      const statement = db.prepare(sql)
      uniqueResultColumns(statement)
      // Integers beyond the safe range arrive as bigints and become text in
      // `sqliteValue`, instead of throwing out of range.
      statement.setReadBigInts(true)
      const rows = statement.all() as Record<string, unknown>[]
      return rows.map(row => Object.fromEntries(Object.entries(row).map(([key, value]) => [key, sqliteValue(value)])))
    })
  }
  // A schemaless source (JSON, JSONL) that became empty has no columns to
  // offer, yet the query names the ones it expects: for an empty input
  // only, learn them from SQLite's own complaint and retry, so the query
  // answers with zero rows exactly as it would over a header-only CSV.
  // A CSV cleared to nothing has no header either: an empty schema is no
  // schema, not a header of zero columns.
  const schemaless = schema === undefined || schema.length === 0
  // Every retry stages at least one column it did not know, so the loop
  // ends when SQLite stops naming new ones — however wide the query.
  for (;;) {
    try {
      return stage()
    } catch (error) {
      // Only a schemaless, empty input infers: a header-bearing source keeps
      // SQLite's own validation, so a typo stays a typo. A column named in
      // `JOIN … USING` gets its own diagnostic.
      // The name arrives exactly as SQLite parsed it, edge spaces included:
      // `\` first \`` is the field " first ".
      const reference = records.length === 0 && schemaless ? missingColumnOf(error) : undefined
      // The empty name is a column too: SQLite accepts `""`.
      const names = reference === undefined ? [] : inferColumns(reference).filter(name => !known.has(name))
      if (names.length === 0) {
        throw error
      }
      for (const name of names) {
        known.add(name)
        columns.push(name)
      }
    }
  }
}

const readSqlite = (path: string, options: Options): Record<string, unknown>[] => {
  if ((options.table === undefined) === (options.sql === undefined)) {
    throw new Error(`${path}: a SQLite source needs exactly one of --table or --sql`)
  }
  const sql = options.sql ?? `SELECT * FROM "${options.table!.replaceAll('"', '""')}"`
  const db = new DatabaseSync(path, { readOnly: true })
  return withSourceDatabase(db, () => {
    const statement = db.prepare(sql)
    uniqueResultColumns(statement)
    statement.setReadBigInts(true)
    const rows = statement.all() as Record<string, unknown>[]
    return rows.map(row => Object.fromEntries(Object.entries(row).map(([key, value]) => [key, sqliteValue(value)])))
  })
}

/** Fetches a URL's body; the transport is injectable for tests. */
export const fetchText = async (url: string, options: Options): Promise<{ text: string, contentType: string }> => {
  const signal = options.signal
  signal?.throwIfAborted()
  if (/[\uD800-\uDFFF]/u.test(url)) throw new TypeError('URL must contain well-formed Unicode')
  const timeoutSeconds = options.timeoutSeconds
  const timeout = AbortSignal.timeout(fetchTimeoutMs(timeoutSeconds === undefined ? 60 : timeoutSeconds))
  const fetchImpl = options.fetchImpl ?? fetch
  try {
    const response = await fetchImpl(url, {
      headers: {
        'user-agent': 'cave-connect',
        accept: 'application/json, text/csv;q=0.9, */*;q=0.8'
      },
      redirect: 'follow',
      signal: signal === undefined ? timeout : AbortSignal.any([signal, timeout])
    })
    if (signal?.aborted) {
      await response.body?.cancel().catch(() => undefined)
      signal.throwIfAborted()
    }
    if (!response.ok) {
      // Error bodies are not source data. Release the unread stream while keeping
      // the HTTP status as the diagnostic even if transport cleanup fails.
      await response.body?.cancel().catch(() => undefined)
      throw new Error(`${url}: HTTP ${response.status}`)
    }
    const bytes = new Uint8Array(await response.arrayBuffer())
    signal?.throwIfAborted()
    const text = decodeText(bytes, url, false)
    return { text, contentType: response.headers.get('content-type') ?? '' }
  } catch (error) {
    return rethrowFetchFailure(signal, error)
  }
}

/**
 * Loads a local source synchronously — what assembling a text store needs
 * (spec §23.4); a URL source is refused, since fetching it cannot be
 * synchronous: `cave connect` follows URLs.
 */
export const loadSync = (source: string, options: Options = {}): Loaded => {
  options = captureOptions(options)
  if (isUrl(source)) {
    throw new Error(`${source}: URL sources are followed by cave connect, not when assembling a text store`)
  }
  const format = formatOf(source, options)
  if (format === 'sqlite') {
    return { records: readSqlite(source, options), format }
  }
  return { ...queried(parseLocated(format, readText(source), source, options), options), format }
}

/** Applies `sql`, when given, to records of a text format — the spans no longer align, so they go. */
const queried = (
  parsed: { records: Record<string, unknown>[], spans?: LineSpan[], columns?: string[] },
  options: Options
): { records: Record<string, unknown>[], spans?: LineSpan[], columns?: string[] } =>
  options.sql === undefined ? parsed : { records: queryRecords(parsed.records, options.sql, options.table, parsed.columns) }

/** Loads a source to records. Local files read synchronously; URLs fetch. */
export const load = async (source: string, options: Options = {}): Promise<Loaded> => {
  options = captureOptions(options)
  if (isUrl(source)) {
    const { text, contentType } = await fetchText(source, options)
    const mediaType = contentType.split(';', 1)[0]!.trim().toLowerCase()
    const format = options.format ??
      (mediaType.includes('ndjson') || mediaType.includes('jsonl') ? 'jsonl' :
        mediaType.includes('json') ? 'json' :
        mediaType.includes('csv') ? 'csv' :
          mediaType === 'text/tab-separated-values' ? 'tsv' :
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
      return parseCsvLocated(text, options.delimiter === undefined ? ',' : options.delimiter)
    case 'tsv':
      return parseCsvLocated(text, options.delimiter === undefined ? '\t' : options.delimiter)
    case 'json':
      return { records: parseJson(text, source, options) }
    case 'jsonl':
      return parseJsonlLocated(text, source)
  }
}
