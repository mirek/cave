/**
 * The eval orchestrator (roadmap item 9).
 *
 * For every case, N times: open a fresh throwaway store, drive the agent
 * over the case's source through `@cavelang/ingest` (same prompts, same
 * mcp/stdout protocols, same shell/function agent contract as
 * `cave ingest`), then score what landed against the golden and run the
 * case's query expectations. Fresh stores keep runs independent — no
 * digest skipping, no cross-case naming leakage — and make N runs measure
 * extraction *variance*, not accumulation.
 *
 * Before any agent money is spent, each fixture is self-checked: the
 * golden must parse cleanly, contain claims, and satisfy its own queries
 * in a scratch store. A fixture that fails is reported and skipped — a
 * broken ruler measures nothing.
 *
 * Agent runs that fail (non-zero exit, timeout, thrown function) score
 * nothing and are excluded from means; they surface in `failed` instead.
 */

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { Registry, standardRegistry } from '@cavelang/canonical'
import * as Ingest from '@cavelang/ingest'
import { open } from '@cavelang/store'
import type { Store } from '@cavelang/store'
import * as Suite from './suite.ts'
import * as Score from './score.ts'
import * as Queries from './queries.ts'
import { judgePrompt, parsePairs } from './judge.ts'

/**
 * Extraction agent: a shell template (the `cave ingest` contract —
 * prompt on stdin, `{prompt-file}`/`{mcp-config}`/`{db}` substituted) or
 * a function. Functions additionally receive the run's throwaway store,
 * so SDK scripts can write to it directly in `mcp` mode.
 */
export type Agent =
  | string
  | ((prompt: string, files: readonly string[], context: { db: string, store: Store }) => Promise<string>)

/** Judge agent: shell template (prompt on stdin, `{prompt-file}`) or function. */
export type Judge =
  | string
  | ((prompt: string) => Promise<string>)

export type Options = {
  /** Suite directories (searched for `*.golden.cave`) or single golden files. */
  readonly suites: readonly string[]
  readonly agent: Agent
  /** Optional judge upgrading strict misses to semantic matches. */
  readonly judge?: Judge
  /** Agent runs per case (default 1). */
  readonly runs?: number
  /** Agent protocol, as in `cave ingest` (default `mcp`). */
  readonly mode?: Ingest.Mode
  /** Inline source contents into prompts (default `true` — fixtures are self-contained). */
  readonly embed?: boolean
  /** Instructions markdown overriding the per-case/per-suite resolution. */
  readonly instructions?: string
  /** Relative numeric value tolerance in [0, 1] (default 0 — exact). */
  readonly tolerance?: number
  /** Resolve query expectations through the alias closure (spec §13.6). */
  readonly aliases?: boolean
  readonly timeoutSeconds?: number
  /** Open throwaway stores without the standard §5.5 registry. */
  readonly noPrelude?: boolean
  /** Keep the per-run databases (reported as `root`) instead of deleting them. */
  readonly keep?: boolean
  readonly cwd?: string
}

/** One agent run of one case. */
export type RunReport = {
  readonly ok: boolean
  /** Failure note or the agent's final line. */
  readonly note?: string
  /** Ingest problems (stdout-mode lint) — the run still scores. */
  readonly problems: readonly string[]
  readonly golden: number
  readonly produced: number
  readonly matched: number
  readonly valueOff: number
  /** Judge-paired misses (0 without a judge). */
  readonly judged: number
  readonly judgeError?: string
  /** Canonical lines of unmatched golden claims (judged pairs excluded). */
  readonly misses: readonly string[]
  /** Canonical lines of unmatched produced claims (judged pairs excluded). */
  readonly extras: readonly string[]
  readonly precision: number
  readonly recall: number
  readonly f1: number
  readonly judgedPrecision?: number
  readonly judgedRecall?: number
  readonly judgedF1?: number
  readonly queries: readonly Queries.Outcome[]
  readonly queriesPassed: number
  /** The run's database, when `keep` is set. */
  readonly db?: string
}

export type Mean = {
  readonly precision: number
  readonly recall: number
  readonly f1: number
  readonly judgedF1?: number
  /** Query expectations passed / checked, over ok runs — absent without queries. */
  readonly queryRate?: number
}

export type CaseReport = {
  readonly name: string
  /** Source file name, for the report. */
  readonly source: string
  /** Fixture problems; a non-empty list means the case ran nothing. */
  readonly fixture: readonly string[]
  readonly golden: number
  readonly queryCount: number
  readonly runs: readonly RunReport[]
  /** Means over this case's ok runs — absent when none succeeded. */
  readonly mean?: Mean
}

export type Report = {
  readonly cases: readonly CaseReport[]
  /** Requested runs per case. */
  readonly runs: number
  readonly okRuns: number
  readonly failedRuns: number
  /** Suite-level discovery problems — goldens that never became cases; per-case problems live on their `CaseReport`. */
  readonly fixture: readonly string[]
  /** Means over all ok runs of all cases — absent when none succeeded. */
  readonly mean?: Mean
  /** Directory holding the per-run databases, when `keep` is set. */
  readonly root?: string
}

const readText = (path: string): string =>
  readFileSync(path, 'utf8')

const mean = (values: readonly number[]): number =>
  values.length === 0 ? 0 : values.reduce((sum, value) => sum + value, 0) / values.length

const meanOf = (runs: readonly RunReport[], judged: boolean): undefined | Mean => {
  const ok = runs.filter(run => run.ok)
  if (ok.length === 0) {
    return undefined
  }
  const checked = ok.reduce((sum, run) => sum + run.queries.length, 0)
  return {
    precision: mean(ok.map(run => run.precision)),
    recall: mean(ok.map(run => run.recall)),
    f1: mean(ok.map(run => run.f1)),
    ...judged ? { judgedF1: mean(ok.map(run => run.judgedF1 ?? run.f1)) } : {},
    ...checked > 0 ? { queryRate: ok.reduce((sum, run) => sum + run.queriesPassed, 0) / checked } : {}
  }
}

/** Self-checks one fixture; returns its problems and parsed pieces. */
const fixtureOf = (
  kase: Suite.Case,
  registry: Registry.t,
  aliases: boolean
): { problems: string[], facts: readonly Score.Fact[], queries: readonly Queries.Query[] } => {
  const problems: string[] = []
  const goldenText = readText(kase.golden)
  const { facts, problems: goldenProblems } = Score.goldenFacts(goldenText, registry)
  problems.push(...goldenProblems)
  if (facts.length === 0) {
    problems.push('golden has no claims')
  }
  let queries: readonly Queries.Query[] = []
  if (kase.queries !== undefined) {
    const parsed = Queries.parseQueries(readText(kase.queries))
    problems.push(...parsed.problems)
    queries = parsed.queries
  }
  if (problems.length === 0 && queries.length > 0) {
    // The golden itself must satisfy the queries — otherwise the
    // expectations measure the fixture, not the agent.
    const scratch = open(':memory:', { registry })
    try {
      scratch.ingest(goldenText)
      for (const q of queries) {
        const outcome = Queries.checkQuery(scratch, q, { aliases })
        if (!outcome.pass) {
          const detail = outcome.error ??
            [
              ...outcome.missing.map(solution => `missing ${Queries.formatSolution(solution)}`),
              ...outcome.unexpected.map(record => `unexpected ${Queries.formatSolution(record)}`)
            ].join(', ')
          problems.push(`queries line ${q.line}: the golden does not satisfy '${q.pattern.split('\n')[0]}' (${detail})`)
        }
      }
    } finally {
      scratch.close()
    }
  }
  return { problems, facts, queries }
}

const runJudge = async (
  judge: Judge,
  comparison: Score.Comparison,
  timeoutSeconds: number,
  cwd: string
): Promise<{ pairs: [number, number][], error?: string }> => {
  if (comparison.misses.length === 0 || comparison.extras.length === 0) {
    return { pairs: [] }
  }
  const prompt = judgePrompt(comparison.misses, comparison.extras)
  let output: string
  if (typeof judge === 'function') {
    try {
      output = await judge(prompt)
    } catch (error) {
      return { pairs: [], error: error instanceof Error ? error.message : String(error) }
    }
  } else {
    const promptDir = mkdtempSync(join(tmpdir(), 'cave-judge-'))
    try {
      const promptFile = join(promptDir, 'judge.md')
      writeFileSync(promptFile, prompt)
      const result = await Ingest.runShellAgent(judge, prompt, { 'prompt-file': promptFile }, timeoutSeconds, cwd)
      if (result.code !== 0) {
        return { pairs: [], error: result.error ?? `judge exited with ${result.code}` }
      }
      output = result.stdout
    } finally {
      rmSync(promptDir, { recursive: true, force: true })
    }
  }
  return { pairs: parsePairs(output, comparison.misses.length, comparison.extras.length) }
}

/** Runs the full eval. */
export const run = async (options: Options): Promise<Report> => {
  const cwd = options.cwd ?? process.cwd()
  const runs = options.runs ?? 1
  const mode = options.mode ?? 'mcp'
  const timeoutSeconds = options.timeoutSeconds ?? 600
  const registry = options.noPrelude === true ? Registry.empty : standardRegistry
  const suite = Suite.discover(options.suites, {
    cwd,
    ...options.instructions === undefined ? {} : { instructions: options.instructions }
  })
  const root = mkdtempSync(join(tmpdir(), 'cave-eval-'))
  const cases: CaseReport[] = []
  try {
    for (const [caseIndex, kase] of suite.cases.entries()) {
      const fixture = fixtureOf(kase, registry, options.aliases === true)
      if (fixture.problems.length > 0) {
        cases.push({
          name: kase.name,
          source: basename(kase.source),
          fixture: fixture.problems,
          golden: fixture.facts.length,
          queryCount: fixture.queries.length,
          runs: []
        })
        continue
      }
      const caseRuns: RunReport[] = []
      for (let runNo = 1; runNo <= runs; runNo += 1) {
        caseRuns.push(await runOnce(kase, fixture, caseIndex, runNo, root, registry, {
          ...options, mode, timeoutSeconds, cwd
        }))
      }
      const caseMean = meanOf(caseRuns, options.judge !== undefined)
      cases.push({
        name: kase.name,
        source: basename(kase.source),
        fixture: [],
        golden: fixture.facts.length,
        queryCount: fixture.queries.length,
        runs: caseRuns,
        ...caseMean === undefined ? {} : { mean: caseMean }
      })
    }
  } finally {
    if (options.keep !== true) {
      rmSync(root, { recursive: true, force: true })
    }
  }
  const allRuns = cases.flatMap(kase => kase.runs)
  const overall = meanOf(allRuns, options.judge !== undefined)
  return {
    cases,
    runs,
    okRuns: allRuns.filter(run => run.ok).length,
    failedRuns: allRuns.filter(run => !run.ok).length,
    fixture: suite.problems,
    ...overall === undefined ? {} : { mean: overall },
    ...options.keep === true ? { root } : {}
  }
}

/** @returns the total fixture problems — suite discovery plus per-case. */
export const fixtureCount = (report: Report): number =>
  report.fixture.length + report.cases.reduce((sum, kase) => sum + kase.fixture.length, 0)

const failedRun = (golden: number, note: string): RunReport => ({
  ok: false,
  note,
  problems: [],
  golden,
  produced: 0,
  matched: 0,
  valueOff: 0,
  judged: 0,
  misses: [],
  extras: [],
  precision: 0,
  recall: 0,
  f1: 0,
  queries: [],
  queriesPassed: 0
})

const runOnce = async (
  kase: Suite.Case,
  fixture: { facts: readonly Score.Fact[], queries: readonly Queries.Query[] },
  caseIndex: number,
  runNo: number,
  root: string,
  registry: Registry.t,
  options: Options & { mode: Ingest.Mode, timeoutSeconds: number, cwd: string }
): Promise<RunReport> => {
  const db = join(root, `case-${caseIndex + 1}-run-${runNo}.db`)
  const store = open(db, { registry })
  try {
    const evalAgent = options.agent
    const agent: Ingest.Agent = typeof evalAgent === 'function' ?
      (prompt, files) => evalAgent(prompt, files, { db, store }) :
      evalAgent
    const report = await Ingest.run({
      db,
      store,
      patterns: [basename(kase.source)],
      cwd: dirname(kase.source),
      mode: options.mode,
      agent,
      embed: options.embed !== false,
      timeoutSeconds: options.timeoutSeconds,
      noPrelude: options.noPrelude === true,
      ...kase.instructions === undefined ? {} : { instructions: kase.instructions }
    })
    const batch = report.batches[0]
    if (batch === undefined || !batch.ok) {
      return failedRun(fixture.facts.length, batch?.note ?? 'agent produced no batch')
    }
    const produced = Score.producedFacts(store)
    const comparison = Score.compare(fixture.facts, produced, {
      ...options.tolerance === undefined ? {} : { tolerance: options.tolerance }
    })
    let judged = 0
    let judgeError: undefined | string
    let misses = comparison.misses
    let extras = comparison.extras
    if (options.judge !== undefined) {
      const outcome = await runJudge(options.judge, comparison, options.timeoutSeconds, dirname(kase.source))
      judged = outcome.pairs.length
      judgeError = outcome.error
      const judgedMisses = new Set(outcome.pairs.map(([miss]) => miss))
      const judgedExtras = new Set(outcome.pairs.map(([, extra]) => extra))
      misses = comparison.misses.filter((_, index) => !judgedMisses.has(index))
      extras = comparison.extras.filter((_, index) => !judgedExtras.has(index))
    }
    const outcomes = fixture.queries.map(q => Queries.checkQuery(store, q, { aliases: options.aliases === true }))
    const judgedPrecision = comparison.produced === 0 ? 0 : (comparison.matched + judged) / comparison.produced
    const judgedRecall = comparison.golden === 0 ? 0 : (comparison.matched + judged) / comparison.golden
    return {
      ok: true,
      ...batch.note === undefined ? {} : { note: batch.note },
      problems: batch.problems,
      golden: comparison.golden,
      produced: comparison.produced,
      matched: comparison.matched,
      valueOff: comparison.valueOff,
      judged,
      ...judgeError === undefined ? {} : { judgeError },
      misses: misses.map(Score.lineOf),
      extras: extras.map(Score.lineOf),
      precision: comparison.precision,
      recall: comparison.recall,
      f1: comparison.f1,
      ...options.judge === undefined ? {} : {
        judgedPrecision,
        judgedRecall,
        judgedF1: Score.f1Of(judgedPrecision, judgedRecall)
      },
      queries: outcomes,
      queriesPassed: outcomes.filter(outcome => outcome.pass).length,
      ...options.keep === true ? { db } : {}
    }
  } catch (error) {
    return failedRun(fixture.facts.length, error instanceof Error ? error.message : String(error))
  } finally {
    store.close()
  }
}
