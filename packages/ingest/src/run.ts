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

import { cleanup, throwIfCancelled } from './cleanup.ts'
import { errorMessage } from './error-message.ts'
import { booleanOption, sourceList, sourcePath } from './options.ts'

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { decodeText, digestBytes, sourceLabel, withSourceError } from './content.ts'
import { tmpdir } from 'node:os'
import { extname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import * as Canonical from '@cavelang/canonical'
import { Registry } from '@cavelang/canonical'
import { backup, open, type Store } from '@cavelang/store'
import { syncDb } from '@cavelang/sync'
import { ProcessFailure, runProcess, shellCommand } from '@cavelang/loop'
import * as Files from './files.ts'
import { agentTimeoutMs } from './timeout.ts'
import * as Web from './web.ts'
import * as Context from './context.ts'
import * as Prompt from './prompt.ts'

/** Shell command template or an in-process SDK adapter. */
export type Agent =
  | string
  | ((prompt: string, files: readonly string[], context: AgentContext) => Promise<string>)

export type AgentContext = {
  /** Cooperative cancellation for an in-process agent. */
  readonly signal?: AbortSignal
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
  /** Shell-agent limit in whole milliseconds: 0.001..2147483.647 seconds. */
  readonly timeoutSeconds?: number
  /** Cancel source fetching, agent work and publication of pending results. */
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
  /** Valid stdout claims were accepted despite parse problems in lenient mode. */
  readonly partial?: boolean
  /** Claims produced by this batch; strict failures may discard this staged delta. */
  readonly added: number
  readonly problems: readonly string[]
  /** Agent's final output line (mcp mode) or a failure note. */
  readonly note?: string
}

export type SourceStatus = 'accepted' | 'rejected' | 'skipped' | 'not-run'

export type SourceReport = {
  readonly path: string
  /** Batch outcome; accepted strict-stage work is committed only when Report.applied is true. */
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
  /** Unsuccessful batches plus failed URL selections, not the number of rejected sources. */
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
  const noPrelude = booleanOption(options.noPrelude, 'noPrelude')
  const suppliedDir = options.dir
  const dir = suppliedDir ?? mkdtempSync(join(tmpdir(), 'cave-ingest-'))
  try {
    // The consolidated CLI exports the MCP module; its executable is a sibling.
    const mcpEntry = import.meta.resolve('@cavelang/mcp')
    const server = fileURLToPath(new URL(`./bin${extname(mcpEntry)}`, mcpEntry))
    const path = join(dir, 'cave-mcp.json')
    writeFileSync(path, `${JSON.stringify({
      mcpServers: {
        cave: {
          command: process.execPath,
          args: [server, '--db', resolve(db), ...noPrelude ? ['--no-prelude'] : []]
        }
      }
    }, undefined, 2)}\n`)
    return path
  } catch (error) {
    if (suppliedDir === undefined || suppliedDir === null) cleanup([error], () => rmSync(dir, { recursive: true, force: true }))
    throw error
  }
}

/** Path-reading agents must not certify a visibly changed selection. */
const sourceProblems = (files: readonly Files.Selected[], cwd: string): string[] =>
  files.flatMap(file => {
    if (file.content !== undefined) return []
    try {
      const current = digestBytes(readFileSync(resolve(cwd, file.path)))
      return current === file.digest ? [] : [`${sourceLabel(file.path)}: source changed since selection; retry ingestion`]
    } catch (error) {
      const message = errorMessage(error)
      return [`${sourceLabel(file.path)}: cannot read selected source: ${sourceLabel(message)}`]
    }
  })

const promptFiles = (files: readonly Pick<Files.Selected, 'path' | 'content'>[], embed: boolean, cwd: string) =>
  files.map(file => ({
    path: file.path,
    // Selected URL/embedded-file content must match the recorded digest.
    // URL text is always embedded because agents cannot read its cleaned form.
    ...file.content !== undefined ? { content: file.content } :
      embed ? { content: decodeText(withSourceError(file.path, 'read source', () => readFileSync(resolve(cwd, file.path))), file.path) } : {}
  }))

/** Builds the prompt for one batch against the store's *current* state. */
export const promptFor = (
  store: Store,
  files: readonly Files.Selected[],
  options: Pick<Options, 'instructions' | 'embed' | 'mode' | 'cwd'>
): string => {
  const { cwd: inputCwd, instructions, embed, mode } = options
  const cwd = inputCwd ?? process.cwd()
  const selected = files.map(({ path, content }) => ({ path, content }))
  const context = Context.contextFor(store, selected.map(file => file.path))
  return Prompt.buildPrompt({
    files: promptFiles(selected, embed === true, cwd),
    ...instructions === undefined ? {} : { instructions: Prompt.readInstructions(instructions)! },
    ...context === undefined ? {} : { context },
    mode: mode ?? 'mcp'
  })
}

/** Selects and batches the sources to process — file globs, literal paths and URLs. */
export const selectBatches = async (
  store: Store,
  options: Options
): Promise<{ selection: Files.Selection & { failures: readonly Web.Failure[] }, batches: Files.Selected[][] }> => {
  const signal = options.signal
  signal?.throwIfAborted()
  const timeoutSeconds = options.timeoutSeconds
  agentTimeoutMs(timeoutSeconds === undefined ? 600 : timeoutSeconds)
  const suppliedBatchSize = options.batchSize
  const batchSize = suppliedBatchSize === undefined ? 8 : suppliedBatchSize
  // Validate with the shared batching contract before reading any sources.
  Files.batch([], batchSize)
  const patterns = sourceList(options.patterns, 'patterns')
  const suppliedFiles = options.files
  const files = suppliedFiles === undefined ? [] : sourceList(suppliedFiles, 'files')
  const { cwd, force, embed, fetchImpl } = options
  const forceSelected = booleanOption(force, 'force')
  const embedContent = booleanOption(embed, 'embed')
  const urls = patterns.filter(Web.isUrl)
  const expanded = Files.expand(patterns.filter(pattern => !Web.isUrl(pattern)), cwd)
  const paths = [...new Set([...expanded, ...files])].sort()
  const local = Files.select(store, paths, {
    force: forceSelected,
    embed: embedContent,
    ...cwd === undefined ? {} : { cwd }
  })
  const remote = await Web.select(store, urls, {
    force: forceSelected,
    ...signal === undefined ? {} : { signal },
    ...fetchImpl === undefined ? {} : { fetchImpl }
  })
  signal?.throwIfAborted()
  const selection = {
    files: [...local.files, ...remote.files],
    skipped: [...local.skipped, ...remote.skipped],
    failures: remote.failures
  }
  return { selection, batches: Files.batch(selection.files, batchSize) }
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
  if (/[\uD800-\uDFFF]/u.test(prompt)) {
    return Promise.resolve({ code: null, stdout: '', error: 'agent prompt must contain well-formed Unicode' })
  }
  const { signal, maxStdoutBytes, maxStderrBytes } = processOptions
  return runProcess(shellCommand(template, substitutions), {
    cwd,
    input: prompt,
    strictStdoutUtf8: true,
    timeoutMs: agentTimeoutMs(timeoutSeconds, true),
    ...signal === undefined ? {} : { signal },
    ...maxStdoutBytes === undefined ? {} : { maxStdoutBytes },
    ...maxStderrBytes === undefined ? {} : { maxStderrBytes }
  }).then(result => ({ code: result.code, stdout: result.stdout })).catch((error: unknown) => {
    if (error instanceof ProcessFailure) {
      return { code: null, stdout: error.result.stdout, error: error.message }
    }
    return { code: null, stdout: '', error: 'process failed to start' }
  })
}

/** Extracts complete CAVE or unlabelled fenced blocks, falling back to raw output. */
export const caveTextOf = (output: string): string => {
  const blocks: string[] = []
  let open: { marker: string, start: number, selected: boolean } | undefined
  for (const line of output.matchAll(/[^\r\n]*(?:\r\n|\r|\n|$)/g)) {
    const text = line[0].replace(/(?:\r\n|\r|\n)$/, '')
    const fence = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(text)
    if (fence === null) continue
    const marker = fence[1]!, info = fence[2]!
    if (open !== undefined) {
      if (marker[0] === open.marker[0] && marker.length >= open.marker.length && /^[ \t]*$/.test(info)) {
        if (open.selected) blocks.push(output.slice(open.start, line.index))
        open = undefined
      }
    } else if (marker[0] !== '`' || !info.includes('`')) {
      open = { marker, start: line.index + line[0].length, selected: info.trim() === '' || info.trim() === 'cave' }
    }
  }
  return blocks.length > 0 ? blocks.join('\n') : output
}

/** Runs batches against one mutable store. Strict callers provide a stage. */
const runMutable = async (options: Options & { policy: Policy }): Promise<Report> => {
  const store = options.store
  const cwd = options.cwd ?? process.cwd()
  const mode = options.mode ?? 'mcp'
  const policy = options.policy
  const timeoutSeconds = options.timeoutSeconds === undefined ? 600 : options.timeoutSeconds
  const { selection, batches } = await selectBatches(store, options)
  const reports: BatchReport[] = []
  const promptDir = mkdtempSync(join(tmpdir(), 'cave-prompt-'))
  const promptFailures: unknown[] = []
  try {
    const mcpConfig = typeof options.agent === 'string' && options.agent.includes('{mcp-config}') ?
      writeMcpConfig(options.db, { noPrelude: options.noPrelude === true, dir: promptDir }) :
      undefined
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
      options.signal?.throwIfAborted()
      const paths = files.map(file => file.path)
      const inputProblems = sourceProblems(files, cwd)
      if (inputProblems.length > 0) {
        reports.push({ files: paths, ok: false, added: 0, problems: inputProblems })
        if (policy === 'strict') break
        continue
      }
      const prompt = promptFor(store, files, { ...options, mode })
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
          output = await options.agent(prompt, [...paths], {
            db: options.db,
            ...options.signal === undefined ? {} : { signal: options.signal },
            ...mcpConfig === undefined ? {} : { mcpConfig }
          })
          options.signal?.throwIfAborted()
          ok = true
        } catch (error) {
          throwIfCancelled(options.signal, error)
          output = ''
          ok = false
          reports.push({
            files: paths, ok, added: claimCount(store) - before, problems: [],
            note: errorMessage(error)
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
        options.signal?.throwIfAborted()
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
      const changedSources = sourceProblems(files, cwd)
      if (changedSources.length > 0) {
        reports.push({ files: paths, ok: false, added: claimCount(store) - before, problems: changedSources })
        if (policy === 'strict') break
        continue
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
          reports.push({ files: paths, ok: false, added: claimCount(store) - before, problems })
          break
        }
        const ingested = store.insertResult(canonical, { source: 'ingest' })
        reports.push({
          files: paths,
          ok: problems.length === 0,
          ...problems.length > 0 && ingested.ids.length > 0 ? { partial: true } : {},
          added: claimCount(store) - before,
          problems
        })
        if (problems.length > 0) {
          // A partially invalid extraction may be incomplete — withhold the
          // digests so these sources stay eligible for the next run.
          continue
        }
      } else {
        const note = output.trim().split(/\r\n|\r|\n/).at(-1) ?? ''
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
  } catch (error) {
    promptFailures.push(error)
    throw error
  } finally {
    cleanup(promptFailures, () => rmSync(promptDir, { recursive: true, force: true }))
  }
  const batchByPath = new Map<string, number>()
  for (const [index, report] of reports.entries()) {
    for (const path of report.files) {
      if (!batchByPath.has(path)) batchByPath.set(path, index)
    }
  }
  const sources: SourceReport[] = [
    ...selection.skipped.map(path => ({ path, status: 'skipped' as const, problems: [] })),
    ...selection.files.map(file => {
      const batch = batchByPath.get(file.path)
      if (batch === undefined) return { path: file.path, status: 'not-run' as const, problems: [] }
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
  const signal = options.signal
  signal?.throwIfAborted()
  const patterns = options.patterns
  const files = options.files
  options = {
    signal,
    db: options.db,
    store: options.store,
    patterns: sourceList(patterns, 'patterns'),
    files: files === undefined ? undefined : sourceList(files, 'files'),
    instructions: options.instructions,
    agent: options.agent,
    mode: options.mode,
    batchSize: options.batchSize,
    embed: options.embed,
    force: options.force,
    noPrelude: options.noPrelude,
    timeoutSeconds: options.timeoutSeconds,
    cwd: options.cwd,
    fetchImpl: options.fetchImpl,
    policy: options.policy
  }
  if (options.cwd !== undefined) sourcePath(options.cwd, 'cwd')
  for (const key of ['force', 'embed', 'noPrelude'] as const) booleanOption(options[key], key)
  agentTimeoutMs(options.timeoutSeconds === undefined ? 600 : options.timeoutSeconds)
  Files.batch([], options.batchSize === undefined ? 8 : options.batchSize)
  const policy = options.policy === undefined ? 'strict' : options.policy
  if (policy !== 'strict' && policy !== 'lenient') {
    throw new TypeError('policy must be strict or lenient')
  }
  const mode = options.mode === undefined ? 'mcp' : options.mode
  if (mode !== 'mcp' && mode !== 'stdout') {
    throw new TypeError('mode must be mcp or stdout')
  }
  if (policy === 'lenient') return runMutable({ ...options, policy })

  const stageDir = mkdtempSync(join(tmpdir(), 'cave-ingest-stage-'))
  const stageDb = join(stageDir, 'stage.db')
  let staged: Report | undefined
  const directoryFailures: unknown[] = []
  try {
    backup(options.store, stageDb)
    const stage = open(stageDb, options.noPrelude === true ? { registry: Registry.empty } : {})
    const stageFailures: unknown[] = []
    try {
      staged = await runMutable({ ...options, db: stageDb, store: stage, policy })
    } catch (error) {
      stageFailures.push(error)
      throw error
    } finally {
      cleanup(stageFailures, () => stage.close())
    }

    options.signal?.throwIfAborted()
    if (staged.failed > 0 || staged.sources.some(source => source.status === 'not-run')) {
      return { ...staged, applied: false, added: 0 }
    }
    const merged = syncDb(options.store, stageDb, { record: false })
    if (merged.problems.length > 0) {
      throw new Error(`could not commit the staged ingestion: ${merged.problems.map(problem => problem.message).join('; ')}`)
    }
    return staged
  } catch (error) {
    directoryFailures.push(error)
    throw error
  } finally {
    cleanup(directoryFailures, () => rmSync(stageDir, { recursive: true, force: true }))
  }
}
