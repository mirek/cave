/**
 * `cave eval` entry — argument parsing and report rendering around
 * `run.ts`. See the package README for the fixture layout and agent
 * recipes.
 */

import { parseArgs } from 'node:util'
import type { Mode } from '@cavelang/ingest'
import { fixtureCount, run } from './run.ts'
import type { Mean, Report, RunReport } from './run.ts'
import { formatSolution } from './queries.ts'
import type { Outcome } from './queries.ts'

const usage = `cave eval — golden-fixture extraction, query and reconstruction evals
(ROADMAP items 9 and 10)

Usage:
  cave eval <suite-dir|golden-file...> --agent '<command>' [options]

A case is a golden file plus its source: for family-history.golden.cave
the source is the single sibling family-history.<ext>; an optional
family-history.queries.cave holds CAVE-Q patterns with expected bindings,
and instructions resolve from family-history.instructions.md, the case
directory's instructions.md, then the suite root's. The agent extracts
each source into a fresh throwaway store; the result is scored against
the golden by claim key (actor stamps ignored, spec §9.5) and value, and
the store must answer the query expectations.

A <stem>.loop.cave sibling makes the case a reconstruction (spec §18)
eval instead: the source is the knowledge, the loop file declares seeds
('loop SEEDS <entity>') and optional 'loop HAS query|steps|claims: …',
and the golden is what the loop should collect. Without --agent the
deterministic heuristic policy runs — the baseline; with --agent the LLM
policy asks the agent to pick each expansion (prompt on stdin, reply on
stdout), and the queries are answered by the reconstruction alone.

Options:
  --agent <template>     shell command run once per case run (extraction; the
                         prompt is piped to stdin and {prompt-file},
                         {mcp-config}, {db} are substituted — the cave ingest
                         contract) or once per loop step (reconstruction);
                         optional when every case is a reconstruction
  --judge <template>     LLM judge pairing semantically equivalent leftovers
                         after strict scoring; prompt on stdin/{prompt-file},
                         replies a JSON array of [golden, produced] pairs
  --runs <n>             agent runs per case (default 1) — measures variance
  --stdout               agent prints CAVE text instead of using MCP tools
  --instructions <md>    instructions markdown overriding the suite's own
  --no-embed             do not inline source contents into prompts
  --tolerance <t>        relative numeric value tolerance, 0..1 or N% (default 0)
  --aliases              query expectations resolve through ALIAS closure
  --timeout <seconds>    per-run agent timeout (default 600)
  --min <p>              exit 1 unless mean F1 (judged when --judge) and the
                         query pass rate reach p (0..1 or N%)
  --keep                 keep the per-run databases and print their directory
  --json                 emit the full report as JSON
  --no-prelude           open throwaway stores without the standard §5.5 registry

Exit status: 1 on fixture problems, failed agent runs, or an unmet --min.

Examples:
  cave eval suite/ --agent 'claude -p --mcp-config {mcp-config} --allowedTools "mcp__cave__*"'
  cave eval suite/ --stdout --agent 'llm -m your-model' --runs 3
  cave eval suite/family-history.golden.cave --stdout --agent 'cat {prompt-file} | your-agent'
  cave eval suite/ --stdout --agent your-agent --judge 'claude -p' --min 80%
  cave eval loop-suite/                        # reconstruction baseline (heuristic)
  cave eval loop-suite/ --agent 'claude -p' --runs 3   # the LLM policy vs that baseline`

const percent = (value: number): string =>
  `${Math.round(value * 100)}%`

/** Parses `0.85` or `85%` into a ratio in [0, 1]. */
const parseRatio = (text: string): undefined | number => {
  const value = text.endsWith('%') ? Number(text.slice(0, -1)) / 100 : Number(text)
  return Number.isFinite(value) && value >= 0 && value <= 1 ? value : undefined
}

const listCap = 10

const renderList = (label: string, lines: readonly string[]): string[] => [
  ...lines.slice(0, listCap).map(line => `    ${label}: ${line}`),
  ...lines.length > listCap ? [`    ${label}: … and ${lines.length - listCap} more`] : []
]

const renderQuery = (outcome: Outcome): string[] => {
  if (outcome.pass) {
    return []
  }
  const head = outcome.pattern.split('\n')[0]!
  if (outcome.error !== undefined) {
    return [`    query failed: ${head} — ${outcome.error}`]
  }
  return [
    `    query failed: ${head}`,
    ...outcome.missing.map(solution => `      missing ${formatSolution(solution)}`),
    ...outcome.unexpected.map(record => `      unexpected ${formatSolution(record)}`)
  ]
}

const renderScore = (run_: RunReport): string => {
  const judged = run_.judgedF1 === undefined ? '' : `, judged F1 ${percent(run_.judgedF1)}`
  return `P ${percent(run_.precision)} R ${percent(run_.recall)} F1 ${percent(run_.f1)}${judged}`
}

const renderRun = (run_: RunReport, runNo: number, total: number, queryCount: number): string[] => {
  const head = `  run ${runNo}/${total}: `
  if (!run_.ok) {
    return [`${head}FAILED${run_.note === undefined ? '' : ` — ${run_.note}`}`]
  }
  const counts = `${run_.produced} claim(s) — ${run_.matched} matched` +
    (run_.judged > 0 ? ` (+${run_.judged} judged)` : '') +
    (run_.valueOff > 0 ? `, ${run_.valueOff} value-off` : '')
  const queries = queryCount === 0 ? '' : `; queries ${run_.queriesPassed}/${queryCount}`
  return [
    `${head}${counts}; ${renderScore(run_)}${queries}`,
    ...run_.problems.map(problem => `    problem: ${problem}`),
    ...run_.judgeError === undefined ? [] : [`    judge: ${run_.judgeError}`],
    ...renderList('miss', run_.misses),
    ...renderList('extra', run_.extras),
    ...run_.queries.flatMap(renderQuery)
  ]
}

const renderMean = (mean: Mean): string => {
  const judged = mean.judgedF1 === undefined ? '' : `, judged F1 ${percent(mean.judgedF1)}`
  const queries = mean.queryRate === undefined ? '' : `; queries ${percent(mean.queryRate)}`
  return `P ${percent(mean.precision)} R ${percent(mean.recall)} F1 ${percent(mean.f1)}${judged}${queries}`
}

/** Text rendering of the report. */
export const render = (report: Report): string => {
  const lines: string[] = [
    `eval: ${report.cases.length} case(s), ${report.runs} run(s) each`,
    ...report.fixture.map(problem => `fixture: ${problem}`)
  ]
  for (const kase of report.cases) {
    if (kase.fixture.length > 0) {
      lines.push(`${kase.name}: fixture problem(s) — skipped`)
      lines.push(...kase.fixture.map(problem => `  ${problem}`))
      continue
    }
    const queries = kase.queryCount === 0 ? '' : `, ${kase.queryCount} query(ies)`
    const source = kase.kind === 'loop' ? `reconstruction over ${kase.source}` : `source ${kase.source}`
    lines.push(`${kase.name}: ${kase.golden} golden claim(s)${queries}, ${source}`)
    kase.runs.forEach((run_, index) => {
      lines.push(...renderRun(run_, index + 1, kase.runs.length, kase.queryCount))
    })
    if (kase.mean !== undefined && kase.runs.length > 1) {
      lines.push(`  case mean (${kase.runs.filter(run_ => run_.ok).length} ok run(s)): ${renderMean(kase.mean)}`)
    }
  }
  const failed = report.failedRuns > 0 ? `; ${report.failedRuns} failed run(s)` : ''
  const problems = fixtureCount(report)
  const fixture = problems > 0 ? `; ${problems} fixture problem(s)` : ''
  lines.push(report.mean === undefined ?
    `suite: no scored runs${failed}${fixture}` :
    `suite: ${renderMean(report.mean)}${failed}${fixture}`)
  if (report.root !== undefined) {
    lines.push(`kept run databases: ${report.root}`)
  }
  return `${lines.join('\n')}\n`
}

/** @returns whether the report clears the `--min` gate. */
export const meetsMin = (report: Report, min: number): boolean => {
  if (report.mean === undefined) {
    return false
  }
  const f1 = report.mean.judgedF1 ?? report.mean.f1
  return f1 >= min && (report.mean.queryRate === undefined || report.mean.queryRate >= min)
}

export const runEval = async (argv: readonly string[]): Promise<number> => {
  const { values, positionals } = parseArgs({
    args: [...argv],
    options: {
      agent: { type: 'string' },
      judge: { type: 'string' },
      runs: { type: 'string' },
      stdout: { type: 'boolean' },
      instructions: { type: 'string' },
      'no-embed': { type: 'boolean' },
      tolerance: { type: 'string' },
      aliases: { type: 'boolean' },
      timeout: { type: 'string' },
      min: { type: 'string' },
      keep: { type: 'boolean' },
      json: { type: 'boolean' },
      'no-prelude': { type: 'boolean' },
      help: { type: 'boolean', short: 'h' }
    },
    allowPositionals: true
  })
  if (values.help === true) {
    process.stdout.write(`${usage}\n`)
    return 0
  }
  if (positionals.length === 0) {
    process.stderr.write(`cave eval: suite directories (or golden files) are required\n\n${usage}\n`)
    return 1
  }
  const runs = values.runs === undefined ? undefined : Number(values.runs)
  if (runs !== undefined && (!Number.isInteger(runs) || runs < 1)) {
    process.stderr.write(`cave eval: --runs must be a positive integer, got '${values.runs}'\n`)
    return 1
  }
  const tolerance = values.tolerance === undefined ? undefined : parseRatio(values.tolerance)
  if (values.tolerance !== undefined && tolerance === undefined) {
    process.stderr.write(`cave eval: --tolerance expects 0..1 or N%, got '${values.tolerance}'\n`)
    return 1
  }
  const min = values.min === undefined ? undefined : parseRatio(values.min)
  if (values.min !== undefined && min === undefined) {
    process.stderr.write(`cave eval: --min expects 0..1 or N%, got '${values.min}'\n`)
    return 1
  }
  const timeoutSeconds = values.timeout === undefined ? undefined : Number(values.timeout)
  if (timeoutSeconds !== undefined && (!Number.isFinite(timeoutSeconds) || timeoutSeconds <= 0)) {
    process.stderr.write(`cave eval: --timeout must be a positive number of seconds, got '${values.timeout}'\n`)
    return 1
  }
  const mode: Mode = values.stdout === true ? 'stdout' : 'mcp'
  const report = await run({
    suites: positionals,
    ...values.agent === undefined ? {} : { agent: values.agent },
    mode,
    embed: values['no-embed'] !== true,
    aliases: values.aliases === true,
    noPrelude: values['no-prelude'] === true,
    keep: values.keep === true,
    ...values.judge === undefined ? {} : { judge: values.judge },
    ...runs === undefined ? {} : { runs },
    ...values.instructions === undefined ? {} : { instructions: values.instructions },
    ...tolerance === undefined ? {} : { tolerance },
    ...timeoutSeconds === undefined ? {} : { timeoutSeconds }
  })
  process.stdout.write(values.json === true ? `${JSON.stringify(report, undefined, 2)}\n` : render(report))
  if (fixtureCount(report) > 0 || report.failedRuns > 0) {
    return 1
  }
  if (min !== undefined && !meetsMin(report, min)) {
    if (values.json !== true) {
      process.stderr.write(`cave eval: below --min ${values.min}\n`)
    }
    return 1
  }
  return 0
}
