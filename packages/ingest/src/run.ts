/**
 * The ingestion orchestrator.
 *
 * `cave ingest` walks a source list (file globs and http(s) URLs — see
 * `web.ts`), skips sources whose content is already ingested (digest
 * provenance claims), batches the rest, composes one prompt per batch,
 * and drives an *agent* over it:
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

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import * as Canonical from '@cavelang/canonical'
import { Registry } from '@cavelang/canonical'
import { open, type Store } from '@cavelang/store'
import { syncDb, syncText } from '@cavelang/sync'
import { ProcessFailure, runProcess, shellCommand } from '@cavelang/loop'
import * as Files from './files.ts'
import * as Web from './web.ts'
import * as Context from './context.ts'
import * as Prompt from './prompt.ts'

/** Shell command template or an in-process SDK adapter. */
export type Agent =
  | string
  | ((prompt: string, files: readonly string[], context: AgentContext) => Promise<string>)

export type AgentContext = {
  /** Database selected for this run; strict mode points at an isolated stage. */
  readonly db: string
  /** Generated MCP client configuration when the run requested one. */
  readonly mcpConfig?: string
}

export type Policy = 'strict' | 'lenient'

export type Options = {
  readonly db: string
  /** Source patterns — file globs and http(s) URLs. */
  readonly patterns: readonly string[]
  /**
   * Literal file paths (relative to `cwd`), selected as-is with no glob
   * expansion — for discovered names, which may contain `[]?*`. Unlike an
   * unmatched pattern, a missing literal path is an error.
   */
  readonly files?: readonly string[]
  /** Path to an instructions markdown file. */
  readonly instructions?: string
  readonly agent?: Agent
  readonly mode?: Prompt.Mode
  readonly batchSize?: number
  /** Inline file contents into prompts (for agents without file access). */
  readonly embed?: boolean
  readonly force?: boolean
  /** Open generated MCP servers without the standard prelude registry. */
  readonly noPrelude?: boolean
  readonly timeoutSeconds?: number
  /** Cancel an active shell-agent process tree. */
  readonly signal?: AbortSignal
  readonly cwd?: string
  /** Injection point for URL fetching in tests. */
  readonly fetchImpl?: Web.FetchLike
  readonly store: Store
  /** Strict stages the whole run and commits once; lenient commits accepted work batch by batch. */
  readonly policy?: Policy
}

export type BatchReport = {
  readonly files: readonly string[]
  readonly ok: boolean
  /** Claims produced by this batch; strict failures may discard this staged delta. */
  readonly added: number
  readonly problems: readonly string[]
  /** Agent's final output line (mcp mode) or a failure note. */
  readonly note?: string
}

export type SourceStatus = 'accepted' | 'rejected' | 'skipped' | 'not-run'

export type SourceReport = {
  readonly path: string
  readonly status: SourceStatus
  readonly batch?: number
  readonly problems: readonly string[]
  readonly note?: string
  /** Fetch classification for rejected URL sources. */
  readonly failure?: Web.FailureKind
  readonly retryable?: boolean
  readonly httpStatus?: number
}

export type Report = {
  readonly policy: Policy
  /** Whether this run's accepted changes were applied to the requested store. */
  readonly applied: boolean
  readonly matched: number
  readonly skipped: readonly string[]
  readonly batches: readonly BatchReport[]
  /** Complete manifest: one entry for every matched source. */
  readonly sources: readonly SourceReport[]
  /** Claims committed to the requested store (digest bookkeeping excluded). */
  readonly added: number
  readonly failed: number
}

export type Batch = {
  readonly files: readonly Files.Selected[]
  readonly prompt: string
}

/** Writes an MCP client configuration pointing at `cave mcp --db <db>`. */
export const writeMcpConfig = (
  db: string,
  options: { noPrelude?: boolean, dir?: string } = {}
): string => {
  const dir = options.dir ?? mkdtempSync(join(tmpdir(), 'cave-ingest-'))
  const server = fileURLToPath(import.meta.resolve('@cavelang/mcp/bin'))
  const path = join(dir, 'cave-mcp.json')
  writeFileSync(path, `${JSON.stringify({
    mcpServers: {
      cave: {
        command: process.execPath,
        args: [server, '--db', resolve(db), ...options.noPrelude === true ? ['--no-prelude'] : []]
      }
    }
  }, undefined, 2)}\n`)
  return path
}

const promptFiles = (files: readonly Files.Selected[], embed: boolean, cwd: string) =>
  files.map(file => ({
    path: file.path,
    // URL sources carry their extracted text and are always embedded —
    // the agent has no other way to read them readability-cleaned.
    ...file.content !== undefined ? { content: file.content } :
      embed ? { content: readFileSync(resolve(cwd, file.path), 'utf8') } : {}
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

/** Selects and batches the sources to process — file globs, literal paths and URLs. */
export const selectBatches = async (
  store: Store,
  options: Options
): Promise<{ selection: Files.Selection & { failures: readonly Web.Failure[] }, batches: Files.Selected[][] }> => {
  const urls = options.patterns.filter(Web.isUrl)
  const expanded = Files.expand(options.patterns.filter(pattern => !Web.isUrl(pattern)), options.cwd)
  const paths = [...new Set([...expanded, ...options.files ?? []])].sort()
  const local = Files.select(store, paths, {
    force: options.force === true,
    ...options.cwd === undefined ? {} : { cwd: options.cwd }
  })
  const remote = await Web.select(store, urls, {
    force: options.force === true,
    ...options.fetchImpl === undefined ? {} : { fetchImpl: options.fetchImpl }
  })
  const selection = {
    files: [...local.files, ...remote.files],
    skipped: [...local.skipped, ...remote.skipped],
    failures: remote.failures
  }
  return { selection, batches: Files.batch(selection.files, options.batchSize ?? 8) }
}

const claimCount = (store: Store): number =>
  (store.db.prepare('SELECT COUNT(*) AS n FROM cave_claim').get() as { n: number }).n

export type ShellAgentProcessOptions = {
  readonly signal?: AbortSignal
  readonly maxStdoutBytes?: number
  readonly maxStderrBytes?: number
}

/**
 * Runs one shell agent invocation: `{name}` placeholders substituted into
 * the template — each value shell-quoted, so paths with spaces or shell
 * metacharacters stay single arguments — the prompt piped to stdin,
 * stdout captured. Shared with `@cavelang/eval`, whose agents and judges
 * follow the same contract.
 */
export const runShellAgent = (
  template: string,
  prompt: string,
  substitutions: Readonly<Record<string, string>>,
  timeoutSeconds: number,
  cwd: string,
  processOptions: ShellAgentProcessOptions = {}
): Promise<{ code: number | null, stdout: string, error?: string }> => {
  return runProcess(shellCommand(template, substitutions), {
    cwd,
    input: prompt,
    timeoutMs: timeoutSeconds * 1000,
    ...processOptions.signal === undefined ? {} : { signal: processOptions.signal },
    ...processOptions.maxStdoutBytes === undefined ? {} : { maxStdoutBytes: processOptions.maxStdoutBytes },
    ...processOptions.maxStderrBytes === undefined ? {} : { maxStderrBytes: processOptions.maxStderrBytes }
  }).then(result => ({ code: result.code, stdout: result.stdout })).catch((error: unknown) => {
    if (error instanceof ProcessFailure) {
      return { code: null, stdout: error.result.stdout, error: error.message }
    }
    return { code: null, stdout: '', error: 'process failed to start' }
  })
}

/** Extracts CAVE text from stdout-mode agent output (```cave fences win). */
export const caveTextOf = (output: string): string => {
  const fences = [...output.matchAll(/```(?:cave)?\n([\s\S]*?)```/g)].map(match => match[1]!)
  return fences.length > 0 ? fences.join('\n') : output
}

/** Runs batches against one mutable store. Strict callers provide a stage. */
const runMutable = async (options: Options & { policy: Policy }): Promise<Report> => {
  const store = options.store
  const cwd = options.cwd ?? process.cwd()
  const mode = options.mode ?? 'mcp'
  const policy = options.policy
  const timeoutSeconds = options.timeoutSeconds ?? 600
  const { selection, batches } = await selectBatches(store, options)
  const reports: BatchReport[] = []
  const mcpConfig = typeof options.agent === 'string' && options.agent.includes('{mcp-config}') ?
    writeMcpConfig(options.db, { noPrelude: options.noPrelude === true }) :
    undefined
  const promptDir = mkdtempSync(join(tmpdir(), 'cave-prompt-'))
  try {
    // Strict input validation is fail-fast before the first paid call. The
    // complete source manifest below still marks healthy selected inputs as
    // not-run and each failed URL as rejected.
    if (policy === 'strict' && selection.failures.length > 0) {
      return {
        policy,
        applied: false,
        matched: selection.files.length + selection.skipped.length + selection.failures.length,
        skipped: selection.skipped,
        batches: [],
        sources: [
          ...selection.skipped.map(path => ({ path, status: 'skipped' as const, problems: [] })),
          ...selection.files.map(file => ({ path: file.path, status: 'not-run' as const, problems: [] })),
          ...selection.failures.map(failure => ({
            path: failure.path,
            status: 'rejected' as const,
            problems: [failure.message],
            failure: failure.kind,
            retryable: failure.retryable,
            ...failure.status === undefined ? {} : { httpStatus: failure.status }
          }))
        ],
        added: 0,
        failed: selection.failures.length
      }
    }
    for (const [index, files] of batches.entries()) {
      const prompt = promptFor(store, files, { ...options, mode })
      const paths = files.map(file => file.path)
      if (options.agent === undefined) {
        reports.push({ files: paths, ok: false, added: 0, problems: [], note: 'no agent configured' })
        if (policy === 'strict') break
        continue
      }
      const before = claimCount(store)
      let ok: boolean
      let output: string
      if (typeof options.agent === 'function') {
        try {
          output = await options.agent(prompt, paths, {
            db: options.db,
            ...mcpConfig === undefined ? {} : { mcpConfig }
          })
          ok = true
        } catch (error) {
          output = ''
          ok = false
          reports.push({
            files: paths, ok, added: claimCount(store) - before, problems: [],
            note: error instanceof Error ? error.message : String(error)
          })
          if (policy === 'strict') break
          continue
        }
      } else {
        const promptFile = join(promptDir, `batch-${index + 1}.md`)
        writeFileSync(promptFile, prompt)
        const result = await runShellAgent(options.agent, prompt, {
          'prompt-file': promptFile,
          ...mcpConfig === undefined ? {} : { 'mcp-config': mcpConfig },
          db: resolve(options.db)
        }, timeoutSeconds, cwd, {
          ...options.signal === undefined ? {} : { signal: options.signal }
        })
        ok = result.code === 0
        output = result.stdout
        if (!ok) {
          reports.push({
            files: paths, ok, added: claimCount(store) - before, problems: [],
            note: result.error ?? `agent exited with ${result.code}`
          })
          if (policy === 'strict') break
          continue
        }
      }
      if (mode === 'stdout') {
        // Actor provenance (spec §9.5): mcp-mode appends are stamped by the
        // MCP server; here the orchestrator appends, so it stamps — with the
        // stable ingestion-surface identity, like `src:cli` and
        // `src:agent/<client>`. A content- or batch-derived identity would
        // fork the claim key (§9.2) on every source revision, leaving the
        // old and the re-extracted belief both current.
        const canonical = Canonical.canonicalizeText(caveTextOf(output), store.registry())
        const problems = canonical.problems.map(problem => `line ${problem.line}: ${problem.message}`)
        if (policy === 'strict' && problems.length > 0) {
          reports.push({ files: paths, ok: false, added: 0, problems })
          break
        }
        const ingested = store.insertResult(canonical, { source: 'ingest' })
        reports.push({
          files: paths,
          ok: problems.length === 0,
          added: ingested.ids.length,
          problems
        })
        if (problems.length > 0) {
          // A partially invalid extraction may be incomplete — withhold the
          // digests so these sources stay eligible for the next run.
          continue
        }
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
  } finally {
    rmSync(promptDir, { recursive: true, force: true })
    if (mcpConfig !== undefined) {
      rmSync(dirname(mcpConfig), { recursive: true, force: true })
    }
  }
  const sources: SourceReport[] = [
    ...selection.skipped.map(path => ({ path, status: 'skipped' as const, problems: [] })),
    ...selection.files.map(file => {
      const batch = reports.findIndex(report => report.files.includes(file.path))
      if (batch < 0) return { path: file.path, status: 'not-run' as const, problems: [] }
      const report = reports[batch]!
      return {
        path: file.path,
        status: report.ok ? 'accepted' as const : 'rejected' as const,
        batch: batch + 1,
        problems: report.problems,
        ...report.note === undefined ? {} : { note: report.note }
      }
    }),
    ...selection.failures.map(failure => ({
      path: failure.path,
      status: 'rejected' as const,
      problems: [failure.message],
      failure: failure.kind,
      retryable: failure.retryable,
      ...failure.status === undefined ? {} : { httpStatus: failure.status }
    }))
  ]
  return {
    policy,
    applied: true,
    matched: selection.files.length + selection.skipped.length + selection.failures.length,
    skipped: selection.skipped,
    batches: reports,
    sources,
    added: reports.reduce((sum, report) => sum + report.added, 0),
    failed: reports.filter(report => !report.ok).length + selection.failures.length
  }
}

/**
 * Runs the full ingestion. Strict is the default: the target is copied into
 * an isolated staging store, every generated MCP configuration and `{db}`
 * substitution points there, and one identity-preserving merge applies the
 * complete run only after every batch succeeds. A fatal batch stops further
 * agent calls and discards all staged claims and digests.
 *
 * Lenient mode writes accepted work batch by batch, continues after failures,
 * and withholds digests for rejected sources so the next invocation retries
 * them. The returned source manifest accounts for every matched input.
 */
export const run = async (options: Options): Promise<Report> => {
  const policy = options.policy ?? 'strict'
  if (policy === 'lenient') return runMutable({ ...options, policy })

  const stageDir = mkdtempSync(join(tmpdir(), 'cave-ingest-stage-'))
  const stageDb = join(stageDir, 'stage.db')
  let staged: Report | undefined
  try {
    const stage = open(stageDb, options.noPrelude === true ? { registry: Registry.empty } : {})
    try {
      const seeded = syncText(stage, options.store.exportText({ tx: true, maxSensitivity: 'restricted' }), {
        record: false
      })
      if (seeded.problems.length > 0) {
        throw new Error(`could not stage the current store: ${seeded.problems.map(problem =>
          `line ${problem.line}: ${problem.message}`).join('; ')}`)
      }
      staged = await runMutable({ ...options, db: stageDb, store: stage, policy })
    } finally {
      stage.close()
    }

    if (staged.failed > 0 || staged.sources.some(source => source.status === 'not-run')) {
      return { ...staged, applied: false, added: 0 }
    }
    syncDb(options.store, stageDb, { record: false })
    return staged
  } finally {
    rmSync(stageDir, { recursive: true, force: true })
  }
}
