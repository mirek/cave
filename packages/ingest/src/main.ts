/**
 * `cave ingest` entry — argument parsing and report rendering around
 * `run.ts`. See the package README for agent recipes (Claude Code,
 * Copilot CLI, SDK scripts).
 */

import { parseArgs } from 'node:util'
import { Registry } from '@cave/canonical'
import { open } from '@cave/store'
import { promptFor, run, selectBatches, writeMcpConfig } from './run.ts'

const usage = `cave ingest <files/globs...> --db <path> --agent '<command>' [options]

Options:
  --db <path>            knowledge database (required)
  --agent <template>     shell command run once per batch; the prompt is piped
                         to stdin and {prompt-file}, {mcp-config}, {db} are
                         substituted
  --instructions <md>    markdown file with domain instructions for the agent
  --stdout               agent prints CAVE text instead of using MCP tools
  --batch <n>            files per agent run (default 8)
  --embed                inline file contents into prompts (agents without
                         file access, e.g. bare SDK loops)
  --force                re-ingest files whose content digest is unchanged
  --timeout <seconds>    per-batch agent timeout (default 600)
  --plan                 print batches as NDJSON and exit (drive with an SDK)
  --dry-run              print the plan and the first prompt, run nothing
  --no-prelude           open the store without the standard §5.5 registry

Examples:
  cave ingest 'src/**/*.ts' README.md --db k.db \\
    --agent 'claude -p --mcp-config {mcp-config} --allowedTools "mcp__cave__*"'
  cave ingest 'docs/**/*.md' --db k.db --stdout --agent 'copilot -p "$(cat {prompt-file})"'
  cave ingest 'packages/*/README.md' --db k.db --plan > plan.ndjson`

export const runIngest = async (argv: readonly string[]): Promise<number> => {
  const { values, positionals } = parseArgs({
    args: [...argv],
    options: {
      db: { type: 'string' },
      agent: { type: 'string' },
      instructions: { type: 'string' },
      stdout: { type: 'boolean' },
      batch: { type: 'string' },
      embed: { type: 'boolean' },
      force: { type: 'boolean' },
      timeout: { type: 'string' },
      plan: { type: 'boolean' },
      'dry-run': { type: 'boolean' },
      'no-prelude': { type: 'boolean' },
      help: { type: 'boolean' }
    },
    allowPositionals: true
  })
  if (values.help === true) {
    process.stdout.write(`${usage}\n`)
    return 0
  }
  if (values.db === undefined || positionals.length === 0) {
    process.stderr.write(`cave ingest: file patterns and --db are required\n\n${usage}\n`)
    return 1
  }
  const planning = values.plan === true || values['dry-run'] === true
  if (values.agent === undefined && !planning) {
    process.stderr.write('cave ingest: --agent is required (or use --plan / --dry-run)\n')
    return 1
  }
  const batchSize = values.batch === undefined ? undefined : Number(values.batch)
  if (batchSize !== undefined && (!Number.isInteger(batchSize) || batchSize < 1)) {
    process.stderr.write(`cave ingest: --batch must be a positive integer, got '${values.batch}'\n`)
    return 1
  }
  const timeoutSeconds = values.timeout === undefined ? undefined : Number(values.timeout)
  if (timeoutSeconds !== undefined && (!Number.isFinite(timeoutSeconds) || timeoutSeconds <= 0)) {
    process.stderr.write(`cave ingest: --timeout must be a positive number of seconds, got '${values.timeout}'\n`)
    return 1
  }
  const noPrelude = values['no-prelude'] === true
  const store = open(values.db, noPrelude ? { registry: Registry.empty } : {})
  try {
    const options = {
      db: values.db,
      patterns: positionals,
      store,
      mode: values.stdout === true ? 'stdout' as const : 'mcp' as const,
      ...values.agent === undefined ? {} : { agent: values.agent },
      ...values.instructions === undefined ? {} : { instructions: values.instructions },
      ...batchSize === undefined ? {} : { batchSize },
      ...timeoutSeconds === undefined ? {} : { timeoutSeconds },
      embed: values.embed === true,
      force: values.force === true,
      noPrelude
    }
    if (planning) {
      const { selection, batches } = selectBatches(store, options)
      if (values.plan === true) {
        const mcpConfig = writeMcpConfig(values.db, { noPrelude })
        for (const files of batches) {
          const prompt = promptFor(store, files, options)
          process.stdout.write(`${JSON.stringify({ files: files.map(file => file.path), prompt, mcpConfig, db: values.db })}\n`)
        }
        return 0
      }
      process.stdout.write([
        `ingest plan: ${selection.files.length} file(s) in ${batches.length} batch(es), ${selection.skipped.length} skipped (unchanged)`,
        ...selection.skipped.map(path => `  skip ${path}`),
        ...batches.map((files, index) => `  batch ${index + 1}: ${files.map(file => file.path).join(', ')}`),
        ...batches.length > 0 ? ['', '--- prompt for batch 1 ---', promptFor(store, batches[0]!, options)] : []
      ].join('\n') + '\n')
      return 0
    }
    const report = await run(options)
    const lines = [
      `ingest: ${report.matched} file(s) matched, ${report.skipped.length} skipped (unchanged), ${report.batches.length} batch(es)`
    ]
    report.batches.forEach((batch, index) => {
      const status = batch.ok ? `+${batch.added} claim(s)` : `FAILED${batch.note === undefined ? '' : ` — ${batch.note}`}`
      lines.push(`batch ${index + 1}/${report.batches.length} (${batch.files.length} file(s)): ${status}`)
      for (const problem of batch.problems) {
        lines.push(`  ${problem}`)
      }
      if (batch.ok && batch.note !== undefined) {
        lines.push(`  agent: ${batch.note}`)
      }
    })
    lines.push(`done: +${report.added} claim(s)${report.failed > 0 ? `, ${report.failed} failed batch(es)` : ''}`)
    process.stdout.write(`${lines.join('\n')}\n`)
    return report.failed > 0 ? 1 : 0
  } finally {
    store.close()
  }
}
