#!/usr/bin/env node
// Replays every runnable example in the CAVE book against the real `cave`
// CLI and compares the recorded output with what the CLI prints today.
//
//   node scripts/book-examples.mjs            check every chapter (exit 1 on drift)
//   node scripts/book-examples.mjs --update   rewrite recorded output in place
//   node scripts/book-examples.mjs --only 07  restrict to chapters whose file
//                                             name contains the given text
//
// Conventions in book/chapters/*.typ (documented in book/README.md):
//
// - A ```sh raw block is a session. Lines starting with `$ ` are commands
//   (a trailing `\` continues the command on the next line); the lines that
//   follow, up to the next command, are the recorded output. Commands run in
//   order, in one scratch directory per chapter, with `cave` on the path. A
//   command that exits with a nonzero status has `[exit N]` as the last line
//   of its recorded output, so exit statuses are both shown and checked.
// - Recorded output may use `<date>`, `<time>`, `<uuid>`, `<hex>`, `<n>`,
//   `<path>`, `<token>`, and `<any>` as placeholders, and a line consisting of
//   `…` (or `...`) for "any lines here".
// - `#file("name")` on the line before a raw block writes that block to the
//   named file before the sessions that follow it run. When
//   book/fixtures/<name> exists, the block must be identical to it — the
//   fixtures directory is the copy readers can `cd` into.
// - A `// no-test` comment on the line before a ```sh block excludes it (used
//   for commands that need an LLM agent, a browser, or a long-running server).
// - Every other ```cave block must lint clean under `cave parse`, as must
//   every `.cave` file block except eval query fixtures (`*.queries.cave`).

import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync, chmodSync, cpSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const chaptersDir = join(root, 'book', 'chapters')
const fixturesDir = join(root, 'book', 'fixtures')
const main = join(root, 'packages', 'cli', 'src', 'main.ts')

const args = process.argv.slice(2)
const update = args.includes('--update')
const onlyIndex = args.indexOf('--only')
const only = onlyIndex === -1 ? null : args[onlyIndex + 1] ?? null

// ---------------------------------------------------------------------------
// Parsing the Typst source

/**
 * @typedef {{ kind: 'file', name: string, body: string, line: number }
 *   | { kind: 'session', commands: Command[], line: number, start: number, end: number }
 *   | { kind: 'cave', body: string, line: number }} Block
 * @typedef {{ command: string, expected: string, outputStart: number, outputEnd: number }} Command
 */

/** @param {string} source */
export const parseChapter = (source) => {
  const lines = source.split('\n')
  /** @type {Block[]} */
  const blocks = []
  let i = 0
  while (i < lines.length) {
    const line = lines[i]
    const fence = /^(`{3,})(\S*)\s*$/.exec(line)
    if (fence === null) { i += 1; continue }
    const language = fence[2]
    const start = i
    let end = i + 1
    while (end < lines.length && lines[end] !== fence[1]) end += 1
    if (end >= lines.length) throw new Error(`unterminated raw block at line ${start + 1}`)
    const body = lines.slice(start + 1, end).join('\n')
    const previous = lines[start - 1] ?? ''
    const fileMarker = /^#file\("([^"]+)"\)\s*$/.exec(previous)
    if (fileMarker !== null) {
      blocks.push({ kind: 'file', name: fileMarker[1], body, line: start + 1 })
    } else if (language === 'sh' && !/^\/\/\s*no-test\b/.test(previous)) {
      blocks.push({ kind: 'session', commands: parseSession(lines, start + 1, end), line: start + 1, start, end })
    } else if (language === 'cave') {
      blocks.push({ kind: 'cave', body, line: start + 1 })
    }
    i = end + 1
  }
  return blocks
}

/**
 * @param {string[]} lines
 * @param {number} from first content line (inclusive)
 * @param {number} to closing fence line (exclusive)
 */
const parseSession = (lines, from, to) => {
  /** @type {Command[]} */
  const commands = []
  let i = from
  while (i < to) {
    const line = lines[i]
    if (!line.startsWith('$ ')) {
      if (line.trim() === '') { i += 1; continue }
      throw new Error(`line ${i + 1}: output before any command: ${line}`)
    }
    let command = line.slice(2)
    i += 1
    while (command.endsWith('\\') && i < to) {
      command += '\n' + lines[i]
      i += 1
    }
    const outputStart = i
    while (i < to && !lines[i].startsWith('$ ')) i += 1
    let outputEnd = i
    while (outputEnd > outputStart && lines[outputEnd - 1].trim() === '') outputEnd -= 1
    commands.push({ command, expected: lines.slice(outputStart, outputEnd).join('\n'), outputStart, outputEnd })
  }
  return commands
}

// ---------------------------------------------------------------------------
// Matching recorded output

const placeholders = {
  '<date>': '\\d{4}-\\d{2}-\\d{2}',
  '<time>': '\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(?:\\.\\d+)?Z',
  '<uuid>': '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}',
  '<hex>': '[0-9a-f]+',
  '<n>': '-?\\d+(?:\\.\\d+)?',
  '<path>': '\\S+',
  '<token>': '\\S+',
  '<any>': '[^\\n]*',
}

// The recorded output as a regular expression over the actual output plus a
// trailing newline: every recorded line must end exactly where the actual
// line ends, and a `…` line stands for any number of whole lines.
/** @param {string} expected */
const expectedPattern = (expected) => {
  const parts = expected.split('\n').map(line => {
    if (line === '…' || line === '...') return '(?:[^\\n]*\\n)*?'
    let out = ''
    const re = /<date>|<time>|<uuid>|<hex>|<n>|<path>|<token>|<any>/g
    let last = 0
    for (const match of line.matchAll(re)) {
      out += escape(line.slice(last, match.index)) + placeholders[match[0]]
      last = match.index + match[0].length
    }
    out += escape(line.slice(last))
    return out + '\\n'
  })
  return new RegExp('^' + parts.join('') + '$')
}

/** @param {string} text */
const escape = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** @param {string} expected @param {string} actual */
export const matches = (expected, actual) => {
  const trimmed = actual.replace(/\n+$/, '')
  return expectedPattern(expected).test(trimmed + '\n')
}

// ---------------------------------------------------------------------------
// Running

const makeBin = (dir) => {
  const bin = join(dir, 'bin')
  mkdirSync(bin)
  const wrapper = join(bin, 'cave')
  writeFileSync(wrapper, `#!/bin/sh\nexec "${process.execPath}" --disable-warning=ExperimentalWarning "${main}" "$@"\n`)
  chmodSync(wrapper, 0o755)
  return bin
}

/** @param {string} bin */
const sessionEnv = (bin) => {
  const env = { ...process.env, PATH: `${bin}:${process.env.PATH ?? ''}`, NO_COLOR: '1', TZ: 'UTC' }
  delete env.CAVE_DB
  delete env.CAVE_HOOKS
  return env
}

/** @param {string} command @param {string} cwd @param {string} bin */
const run = (command, cwd, bin) => {
  const result = spawnSync('sh', ['-c', command], {
    cwd,
    encoding: 'utf8',
    timeout: 120_000,
    env: sessionEnv(bin),
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  if (result.error !== undefined) throw result.error
  const status = result.status ?? `signal ${result.signal}`
  return (result.stdout ?? '') + (result.stderr ?? '') + (status === 0 ? '' : `[exit ${status}]\n`)
}

/** @param {string} body @param {string} bin */
const lint = (body, bin) => {
  const result = spawnSync(join(bin, 'cave'), ['parse'], { input: body + '\n', encoding: 'utf8' })
  return result.status === 0 ? null : (result.stderr || result.stdout).trim()
}

/**
 * @param {string} file
 * @returns {{ problems: string[], updated: boolean }}
 */
const checkChapter = (file, bin) => {
  const source = readFileSync(file, 'utf8')
  const lines = source.split('\n')
  const blocks = parseChapter(source)
  const problems = []
  const scratch = mkdtempSync(join(tmpdir(), 'cave-book-'))
  if (existsSync(fixturesDir)) cpSync(fixturesDir, scratch, { recursive: true })
  /** @type {{ from: number, to: number, text: string }[]} */
  const edits = []
  const label = basename(file)
  try {
    for (const block of blocks) {
      if (block.kind === 'file') {
        const target = join(scratch, block.name)
        mkdirSync(dirname(target), { recursive: true })
        writeFileSync(target, block.body + '\n')
        const fixture = join(fixturesDir, block.name)
        if (existsSync(fixture)) {
          const recorded = readFileSync(fixture, 'utf8')
          if (recorded !== block.body + '\n') {
            if (update) writeFileSync(fixture, block.body + '\n')
            else problems.push(`${label}:${block.line}: #file("${block.name}") differs from book/fixtures/${block.name}`)
          }
        }
        if (block.name.endsWith('.cave') && !block.name.endsWith('.queries.cave')) {
          const diagnostics = lint(block.body, bin)
          if (diagnostics !== null) problems.push(`${label}:${block.line}: ${block.name} does not lint:\n${diagnostics}`)
        }
      } else if (block.kind === 'cave') {
        const diagnostics = lint(block.body, bin)
        if (diagnostics !== null) problems.push(`${label}:${block.line}: cave block does not lint:\n${diagnostics}`)
      } else {
        for (const command of block.commands) {
          const actual = run(command.command, scratch, bin)
          if (matches(command.expected, actual)) continue
          const trimmed = actual.replace(/\n+$/, '')
          if (update) {
            edits.push({ from: command.outputStart, to: command.outputEnd, text: trimmed })
          } else {
            problems.push([
              `${label}:${command.outputStart}: output of \`${command.command.split('\n')[0]}\` drifted`,
              '--- recorded', command.expected, '--- actual', trimmed, '---',
            ].join('\n'))
          }
        }
      }
    }
  } finally {
    rmSync(scratch, { recursive: true, force: true })
  }
  if (edits.length === 0) return { problems, updated: false }
  for (const edit of edits.sort((a, b) => b.from - a.from)) {
    lines.splice(edit.from, edit.to - edit.from, ...(edit.text === '' ? [] : edit.text.split('\n')))
  }
  writeFileSync(file, lines.join('\n'))
  return { problems, updated: true }
}

const isMain = process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (isMain) {
  const chapters = readdirSync(chaptersDir)
    .filter(name => name.endsWith('.typ') && (only === null || name.includes(only)))
    .sort()
  const dir = mkdtempSync(join(tmpdir(), 'cave-book-bin-'))
  const bin = makeBin(dir)
  let failed = false
  try {
    for (const name of chapters) {
      const started = Date.now()
      const { problems, updated } = checkChapter(join(chaptersDir, name), bin)
      const seconds = ((Date.now() - started) / 1000).toFixed(1)
      if (problems.length > 0) {
        failed = true
        console.log(`${name}: ${problems.length} problem(s) (${seconds}s)`)
        for (const problem of problems) console.log(problem)
      } else {
        console.log(`${name}: ok${updated ? ' (updated)' : ''} (${seconds}s)`)
      }
    }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
  process.exit(failed ? 1 : 0)
}
