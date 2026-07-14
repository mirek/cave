/**
 * Record sources (spec §23) — CSV/TSV files, JSON documents, JSONL streams,
 * SQLite databases (read-only), and http(s) URLs serving JSON or CSV. Every
 * source loads to the same shape: an array of flat-ish records the template
 * layer resolves fields from (`fieldOf` handles nested JSON by dot path).
 */

import { readFileSync } from 'node:fs'
import { basename, extname } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { fieldOf } from './template.ts'

export type Format = 'csv' | 'tsv' | 'json' | 'jsonl' | 'sqlite'

/** Injection point for tests; the built-in fetch otherwise. */
export type FetchLike = (url: string, init: RequestInit) => Promise<Response>

export type Options = {
  /** Explicit format; inferred from the extension when omitted. */
  readonly format?: Format
  /** CSV delimiter (default `,`; `\t` for tsv). */
  readonly delimiter?: string
  /** SQLite table to read (`SELECT *`). */
  readonly table?: string
  /** SQLite query — the alternative to `table`. */
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
export const parseCsv = (text: string, delimiter = ','): Record<string, string>[] => {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let quoted = false
  const body = text.startsWith('\uFEFF') ? text.slice(1) : text
  const endField = (): void => {
    row.push(field)
    field = ''
  }
  const endRow = (): void => {
    endField()
    rows.push(row)
    row = []
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
  }
  if (field !== '' || row.length > 0) {
    endRow()
  }
  const [header, ...dataRows] = rows
  if (header === undefined) {
    return []
  }
  return dataRows
    .filter(cells => cells.length > 1 || cells[0] !== '')
    .map(cells => Object.fromEntries(header.map((name, at) => [name.trim(), cells[at] ?? ''])))
}

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

const parseJsonl = (text: string, source: string): Record<string, unknown>[] =>
  text
    .split(/\r?\n/)
    .filter(line => line.trim() !== '')
    .map((line, at) => {
      const parsed: unknown = JSON.parse(line)
      if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new Error(`${source}: line ${at + 1} is not a JSON object`)
      }
      return parsed as Record<string, unknown>
    })

/** node:sqlite values → template-substitutable values. */
const sqliteValue = (value: unknown): unknown =>
  typeof value === 'bigint' ?
    (Number.isSafeInteger(Number(value)) ? Number(value) : value.toString()) :
    value

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

const fetchText = async (url: string, options: Options): Promise<{ text: string, contentType: string }> => {
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
    return { records: parseByFormat(format, text, source, options), format }
  }
  const format = formatOf(source, options)
  if (format === 'sqlite') {
    return { records: readSqlite(source, options), format }
  }
  return { records: parseByFormat(format, readFileSync(source, 'utf8'), source, options), format }
}

const parseByFormat = (
  format: Exclude<Format, 'sqlite'>,
  text: string,
  source: string,
  options: Options
): Record<string, unknown>[] => {
  switch (format) {
    case 'csv':
      return parseCsv(text, options.delimiter ?? ',')
    case 'tsv':
      return parseCsv(text, options.delimiter ?? '\t')
    case 'json':
      return parseJson(text, source, options)
    case 'jsonl':
      return parseJsonl(text, source)
  }
}
