/**
 * The ingestion orchestrator.
 *
 * `cave ingest` walks a file list (globs supported), skips files whose
 * content is already ingested (digest provenance claims), batches the
 * rest, composes one prompt per batch, and drives an *agent* over it:
 *
 * - a shell command template (`--agent 'claude -p --mcp-config {mcp-config} …'`)
 *   for headless Claude Code / Copilot CLI runs — the prompt is piped to
 *   stdin and written to `{prompt-file}`;
 * - a JavaScript function (`agent: async (prompt, files) => text`) for
 *   Claude/Copilot SDK scripts using the library API;
 * - or no agent at all — `--plan` emits the batches as NDJSON for a
 *   fully external driver.
 *
 * API access for the agent is the MCP server (`{mcp-config}` points at a
 * generated client configuration for `cave mcp --db …`); `--stdout` mode
 * instead treats the agent's stdout as CAVE text and stores it here.
 * Prompts are built lazily per batch, so the injected knowledge context
 * reflects what earlier batches recorded.
 */

import { spawn } from 'node:child_process'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Store } from '@cave/store'
import * as Files from './files.ts'
import * as Context from './context.ts'
import * as Prompt from './prompt.ts'

/** Shell command template or an in-process SDK adapter. */
export type Agent =
  | string
  | ((prompt: string, files: readonly string[]) => Promise<string>)

export type Options = {
  readonly db: string
  readonly patterns: readonly string[]
  /** Path to an instructions markdown file. */
  readonly instructions?: string
  readonly agent?: Agent
  readonly mode?: Prompt.Mode
  readonly batchSize?: number
  /** Inline file contents into prompts (for agents without file access). */
  readonly embed?: boolean
  readonly force?: boolean
  readonly timeoutSeconds?: number
  readonly cwd?: string
  readonly store: Store
}

export type BatchReport = {
  readonly files: readonly string[]
  readonly ok: boolean
  /** Claims added during this batch (db delta in mcp mode, ingest count in stdout mode). */
  readonly added: number
  readonly problems: readonly string[]
  /** Agent's final output line (mcp mode) or a failure note. */
  readonly note?: string
}

export type Report = {
  readonly matched: number
  readonly skipped: readonly string[]
  readonly batches: readonly BatchReport[]
  readonly added: number
  readonly failed: number
}

export type Batch = {
  readonly files: readonly Files.Selected[]
  readonly prompt: string
}

/** Writes an MCP client configuration pointing at `cave mcp --db <db>`. */
export const writeMcpConfig = (db: string, dir: string = mkdtempSync(join(tmpdir(), 'cave-ingest-'))): string => {
  const server = fileURLToPath(import.meta.resolve('@cave/mcp/bin'))
  const path = join(dir, 'cave-mcp.json')
  writeFileSync(path, `${JSON.stringify({
    mcpServers: {
      cave: { command: process.execPath, args: [server, '--db', resolve(db)] }
    }
  }, undefined, 2)}\n`)
  return path
}

const promptFiles = (files: readonly Files.Selected[], embed: boolean, cwd: string) =>
  files.map(file => ({
    path: file.path,
    ...embed ? { content: readFileSync(resolve(cwd, file.path), 'utf8') } : {}
  }))

/** Builds the prompt for one batch against the store's *current* state. */
export const promptFor = (
  store: Store,
  files: readonly Files.Selected[],
  options: Pick<Options, 'instructions' | 'embed' | 'mode' | 'cwd'>
): string => {
  const cwd = options.cwd ?? process.cwd()
  const context = Context.contextFor(store, files.map(file => file.path))
  return Prompt.buildPrompt({
    files: promptFiles(files, options.embed === true, cwd),
    ...options.instructions === undefined ? {} : { instructions: Prompt.readInstructions(options.instructions)! },
    ...context === undefined ? {} : { context },
    mode: options.mode ?? 'mcp'
  })
}

/** Selects and batches the files to process. */
export const selectBatches = (store: Store, options: Options): { selection: Files.Selection, batches: Files.Selected[][] } => {
  const paths = Files.expand(options.patterns, options.cwd)
  const selection = Files.select(store, paths, {
    force: options.force === true,
    ...options.cwd === undefined ? {} : { cwd: options.cwd }
  })
  return { selection, batches: Files.batch(selection.files, options.batchSize ?? 8) }
}

const claimCount = (store: Store): number =>
  (store.db.prepare('SELECT COUNT(*) AS n FROM cave_claim').get() as { n: number }).n

const runShellAgent = (
  template: string,
  prompt: string,
  substitutions: Readonly<Record<string, string>>,
  timeoutSeconds: number,
  cwd: string
): Promise<{ code: number | null, stdout: string }> => {
  const command = Object.entries(substitutions)
    .reduce((acc, [name, value]) => acc.replaceAll(`{${name}}`, value), template)
  return new Promise(resolvePromise => {
    const child = spawn(command, {
      shell: true,
      cwd,
      timeout: timeoutSeconds * 1000,
      stdio: ['pipe', 'pipe', 'inherit']
    })
    let stdout = ''
    child.stdout.on('data', chunk => {
      stdout += String(chunk)
    })
    child.on('close', code => resolvePromise({ code, stdout }))
    child.stdin.write(prompt)
    child.stdin.end()
  })
}

/** Extracts CAVE text from stdout-mode agent output (```cave fences win). */
export const caveTextOf = (output: string): string => {
  const fences = [...output.matchAll(/```(?:cave)?\n([\s\S]*?)```/g)].map(match => match[1]!)
  return fences.length > 0 ? fences.join('\n') : output
}

/**
 * Runs the full ingestion. The store stays open across batches; digests
 * are recorded only for batches whose agent run succeeded, so failed
 * batches are retried by the next invocation.
 */
export const run = async (options: Options): Promise<Report> => {
  const store = options.store
  const cwd = options.cwd ?? process.cwd()
  const mode = options.mode ?? 'mcp'
  const timeoutSeconds = options.timeoutSeconds ?? 600
  const { selection, batches } = selectBatches(store, options)
  const reports: BatchReport[] = []
  const mcpConfig = typeof options.agent === 'string' && options.agent.includes('{mcp-config}') ?
    writeMcpConfig(options.db) :
    undefined
  const promptDir = mkdtempSync(join(tmpdir(), 'cave-prompt-'))
  for (const [index, files] of batches.entries()) {
    const prompt = promptFor(store, files, { ...options, mode })
    const paths = files.map(file => file.path)
    if (options.agent === undefined) {
      reports.push({ files: paths, ok: false, added: 0, problems: [], note: 'no agent configured' })
      continue
    }
    const before = claimCount(store)
    let ok: boolean
    let output: string
    if (typeof options.agent === 'function') {
      try {
        output = await options.agent(prompt, paths)
        ok = true
      } catch (error) {
        output = ''
        ok = false
        reports.push({
          files: paths, ok, added: 0, problems: [],
          note: error instanceof Error ? error.message : String(error)
        })
        continue
      }
    } else {
      const promptFile = join(promptDir, `batch-${index + 1}.md`)
      writeFileSync(promptFile, prompt)
      const result = await runShellAgent(options.agent, prompt, {
        'prompt-file': promptFile,
        ...mcpConfig === undefined ? {} : { 'mcp-config': mcpConfig },
        db: resolve(options.db)
      }, timeoutSeconds, cwd)
      ok = result.code === 0
      output = result.stdout
      if (!ok) {
        reports.push({ files: paths, ok, added: 0, problems: [], note: `agent exited with ${result.code}` })
        continue
      }
    }
    if (mode === 'stdout') {
      const ingested = store.ingest(caveTextOf(output))
      reports.push({
        files: paths,
        ok: true,
        added: ingested.ids.length,
        problems: ingested.problems.map(problem => `line ${problem.line}: ${problem.message}`)
      })
    } else {
      const note = output.trim().split('\n').at(-1) ?? ''
      reports.push({
        files: paths,
        ok: true,
        added: claimCount(store) - before,
        problems: [],
        ...note === '' ? {} : { note }
      })
    }
    Files.recordDigests(store, files)
  }
  const succeeded = reports.filter(report => report.ok)
  return {
    matched: selection.files.length + selection.skipped.length,
    skipped: selection.skipped,
    batches: reports,
    added: succeeded.reduce((sum, report) => sum + report.added, 0),
    failed: reports.length - succeeded.length
  }
}
