/**
 * `cave automate` entry (spec §29.5) — argument parsing, the declare /
 * list / retract lifecycle, one settle cycle under `--once`, and the
 * long-running loop: a cheap `MAX(tx)` poll, a cycle whenever it moves.
 */

import { errorMessage } from './error-message.ts'
import { readFileSync } from 'node:fs'
import { parseArgs } from 'node:util'
import { setImmediate as yieldToLoop } from 'node:timers/promises'
import { Registry } from '@cavelang/canonical'
import { shellComplete } from '@cavelang/loop'
import { defaultDbPath, openAt } from '@cavelang/store'
import { assemble } from '@cavelang/connect'
import type { Store } from '@cavelang/store'
import { declareAutomations, listAutomations, retractAutomation } from './declare.ts'
import { defaultAgentTimeoutSeconds, defaultMaxPasses, settle, settled } from './engine.ts'
import type { SettleOptions, SettleReport } from './engine.ts'
import { captureSettleOptions } from './options.ts'

const usage = `cave automate — the event-driven loop (spec §29)

Usage:
  cave automate [--db <path>] [options]        watch the store; settle on change
  cave automate [--db <path>] --once [--json]  one settle cycle, then exit
  cave automate [--db <path>] --declare [file...]
  cave automate [--db <path>] --list [--json]
  cave automate [--db <path>] --retract <name>

Options:
  --db <path>          database file (default: $CAVE_DB, or cave.db)
  --once               run one settle cycle and exit — cron replaces the
                       daemon; the exit code carries step failures
  --interval <s>       poll interval in seconds (default 2)
  --declare            declare the automations of CAVE documents (stdin
                       when no file); other lines are prelude
  --list               print the store's current automations and exit
  --retract <n>        retract an automation's declaration and exit
  --hooks <file>       JSON file of out-of-band hook command templates,
                       name → shell template (spec §25.4), shared with
                       action steps; default: $CAVE_HOOKS
  --agent <template>   shell agent for prompt steps — the cave ingest/eval
                       contract: prompt on stdin and {prompt-file}
                       (substituted shell-quoted), CAVE reply on stdout
                       (appended, spec §29.3); /bin/sh on POSIX and Windows
                       PowerShell 7 (pwsh) on Windows
  --timeout <seconds>  per-prompt agent timeout (default ${defaultAgentTimeoutSeconds})
  --aliases            triggers match through the alias closure (spec §13.6)
  --no-derive          do not fire the store's rules each pass (spec §29.4)
  --no-check           skip the shape gate on action steps (spec §25.3)
  --max-passes <n>     settle guard per cycle (default ${defaultMaxPasses})
  --json               with --once/--list: emit the report as JSON
  --no-prelude         open the store without the standard verb registry

An automation pairs a trigger with steps, declared in-band (spec §29.1):

  automation/page-on-spike HAS automation: \`?svc IS service,
    ?svc HAS error-rate: ?r, ?r > 0.05 =>
    action/open-incident, hook/page, "investigate the spike on ?svc"\`

New claims matching the trigger fire the steps — a §25 action (parameters
bound from same-named trigger variables), an out-of-band hook (trigger
claims on stdin), or an agent prompt whose CAVE reply is recorded. Rules
(spec §24) fire incrementally each pass. An automation is armed at its
declaration and never wakes itself; chains across automations converge
because every write path is idempotent.

Examples:
  cave automate --db k.db --declare automations.cave
  cave automate --db k.db --once
  cave automate --db k.db --hooks hooks.json --agent 'claude -p'
  cave automate --db k.db --once --json | jq '.automations'`

type Values = {
  db?: string
  once?: boolean
  interval?: string
  declare?: boolean
  list?: boolean
  retract?: string
  hooks?: string
  agent?: string
  timeout?: string
  aliases?: boolean
  'no-derive'?: boolean
  'no-check'?: boolean
  'max-passes'?: string
  json?: boolean
  'no-prelude'?: boolean
  help?: boolean
}

export type RunContext = {
  readonly stdin?: NodeJS.ReadableStream
  readonly stdout?: NodeJS.WritableStream
  readonly stderr?: NodeJS.WritableStream
  readonly signal?: AbortSignal
}

type IO = {
  readonly stdin: NodeJS.ReadableStream
  readonly stdout: NodeJS.WritableStream
  readonly stderr: NodeJS.WritableStream
  readonly signal?: AbortSignal
}

/** Loads a §25.4 hooks configuration file: name → shell command template. */
const readHooks = (path: string): Record<string, string> => {
  const bytes = readFileSync(path)
  let text: string
  try {
    text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes)
  } catch (cause) {
    throw new TypeError(`${path}: invalid UTF-8 hooks configuration`, { cause })
  }
  const parsed: unknown = JSON.parse(text)
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed) ||
      Object.entries(parsed).some(([name, command]) => name.trim() === '' || typeof command !== 'string')) {
    throw new Error(`${path}: hooks must be a JSON object of nonblank names to shell template strings`)
  }
  const hooks = parsed as Record<string, string>
  if (Object.entries(hooks).some(([name, command]) => /[\uD800-\uDFFF]/u.test(name) || /[\uD800-\uDFFF]/u.test(command))) {
    throw new Error(`${path}: hook names and commands must contain well-formed Unicode`)
  }
  return hooks
}

const inputDecoder = (source: string) => {
  const decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true })
  return (bytes?: Uint8Array, stream = false): string => {
    try {
      return decoder.decode(bytes, { stream })
    } catch (cause) {
      throw new TypeError(`${source}: invalid UTF-8 automation input`, { cause })
    }
  }
}

const readInput = async (files: readonly string[], input: NodeJS.ReadableStream, signal?: AbortSignal): Promise<string> => {
  signal?.throwIfAborted()
  if (files.length > 0 && !(files.length === 1 && files[0] === '-')) {
    return files.map(file => inputDecoder(file)(readFileSync(file))).join('\n')
  }
  return new Promise<string>((resolve, reject) => {
    let text = ''
    const decode = inputDecoder('stdin')
    let finished = false
    const finish = (errors: unknown[], result?: string): void => {
      if (finished) return
      finished = true
      for (const cleanup of [
        () => input.pause(),
        () => input.off('data', onData),
        () => input.off('end', onEnd),
        () => input.off('error', onError),
        () => input.off('close', onClose),
        () => signal?.removeEventListener('abort', onAbort)
      ]) {
        try { cleanup() } catch (error) { errors.push(error) }
      }
      if (errors.length === 0) resolve(result!)
      else if (errors.length === 1) reject(errors[0])
      else reject(new AggregateError(errors,
        `automation input failed: ${errors.map(errorMessage).join('; ')}`,
        { cause: errors[0] }))
    }
    const onError = (error: unknown) => finish([error])
    const onAbort = () => onError(signal!.reason)
    const onClose = () => onError(new Error('stdin closed before declaration input ended'))
    const onData = (chunk: string | Buffer) => {
      if (finished) return
      try {
        // Binary chunks can split a code point. Already-decoded string chunks
        // remain strings so malformed UTF-16 still reaches store validation.
        text += typeof chunk === 'string' ? decode() + chunk : decode(chunk, true)
      } catch (error) { onError(error) }
    }
    const onEnd = () => {
      if (finished) return
      try { finish([], text + decode()) } catch (error) { onError(error) }
    }
    if ((input as { readableEnded?: boolean }).readableEnded === true) {
      resolve('')
      return
    }
    if (input.readable === false) {
      reject(new Error('stdin is not readable'))
      return
    }
    try {
      input.on('end', onEnd)
      input.on('error', onError)
      input.on('close', onClose)
      signal?.addEventListener('abort', onAbort, { once: true })
      input.on('data', onData)
      if (signal?.aborted === true) onAbort()
      else if (!finished) input.resume()
    } catch (error) { onError(error) }
  })
}

/** Text rendering of one cycle — only what fired, plus problems and notes. */
const renderReport = (report: SettleReport): string[] => {
  const lines: string[] = []
  for (const problem of report.problems) {
    lines.push(`${problem.subject}: ${problem.problems.join('; ')}`)
  }
  for (const automation of report.automations) {
    if (automation.fired === 0) {
      continue
    }
    lines.push(`${automation.subject}: fired ${automation.fired} solution(s)` +
      (automation.description === undefined ? '' : ` ; ${automation.description}`))
    for (const firing of automation.firings) {
      const bindings = Object.entries(firing.bindings)
        .map(([name, value]) => `?${name} = ${value}`)
        .join('  ')
      if (bindings !== '') {
        lines.push(`  ${bindings}`)
      }
      for (const step of firing.steps) {
        lines.push(`    ${step.step}: ${step.outcome}${step.detail === undefined ? '' : ` (${step.detail})`}`)
      }
    }
  }
  lines.push(...report.notes.map(note => `note: ${note}`))
  const fired = report.automations.reduce((sum, automation) => sum + automation.fired, 0)
  const derived = report.derive === undefined ?
    '' :
    `; derived +${report.derive.appended} appended, ${report.derive.updated} updated, ${report.derive.retracted} retracted`
  lines.push(`${report.complete ? 'settled' : 'incomplete'}: ${fired} firing(s) over ${report.passes} pass(es)${derived}`)
  return lines
}

const settleOptions = (values: Values, signal?: AbortSignal): SettleOptions => {
  const hooksPath = values.hooks ?? process.env['CAVE_HOOKS']
  const timeoutSeconds = values.timeout === undefined ? defaultAgentTimeoutSeconds : Number(values.timeout)
  return {
    ...signal === undefined ? {} : { signal },
    aliases: values.aliases === true,
    derive: values['no-derive'] !== true,
    check: values['no-check'] !== true,
    ...values['max-passes'] === undefined ? {} : { maxPasses: Number(values['max-passes']) },
    ...hooksPath === undefined ? {} : { hooks: readHooks(hooksPath) },
    ...values.agent === undefined ? {} : {
      complete: shellComplete(values.agent, { timeoutSeconds, ...signal === undefined ? {} : { signal } })
    }
  }
}

const maxTxOf = (store: Store): null | string =>
  (store.db.prepare('SELECT MAX(tx) AS t FROM cave_claim').get() as { t: null | string }).t

/**
 * One watch cycle (spec §29.5): settle, report, and return the tx
 * boundary the poll may treat as seen. The boundary is captured *before*
 * each settle, and the cycle re-settles until `MAX(tx)` is unchanged
 * across one — a write landing while a settle runs (or while its report
 * renders) re-enters the loop instead of being marked seen unprocessed
 * (BUGS.md watch-watermark-race). Settle's own appends move `MAX(tx)`
 * too, so a cycle that fired ends with one confirming settle; quiescent
 * write paths (§29.4) are what make the loop terminate.
 */
export const watchCycle = async (
  store: Store,
  options: SettleOptions,
  onReport: (report: SettleReport) => void
): Promise<null | string> => {
  options = captureSettleOptions(options)
  for (;;) {
    options.signal?.throwIfAborted()
    const boundary = maxTxOf(store)
    onReport(await settle(store, options))
    options.signal?.throwIfAborted()
    if (maxTxOf(store) === boundary) {
      return boundary
    }
    await yieldToLoop()
  }
}

/** The daemon (spec §29.5): settle at startup, then settle when MAX(tx) moves. */
const runWatch = async (store: Store, options: SettleOptions, intervalSeconds: number, io: IO): Promise<number> => {
  let seen: null | string = null
  let running = false
  let stopped = false
  const reportFailure = (error: unknown, prefix: string): void => {
    try { io.stderr.write(`${prefix}: ${errorMessage(error)}\n`) }
    catch (outputError) {
      const messages = [error, outputError].map(errorMessage)
      throw new AggregateError([error, outputError], `${messages[0]}; diagnostic output also failed: ${messages[1]}`, { cause: error })
    }
  }
  const onReport = (report: SettleReport): void => {
    const fired = report.automations.some(automation => automation.fired > 0)
    if (fired || report.problems.length > 0 || report.notes.length > 0) {
      io.stdout.write(`${renderReport(report).join('\n')}\n`)
    }
  }
  const cycle = async (): Promise<void> => {
    running = true
    try {
      seen = await watchCycle(store, options, onReport)
    } catch (error) {
      if (io.signal?.aborted) {
        if (error !== io.signal.reason) throw error
      } else {
        reportFailure(error, 'cave automate')
      }
      // `seen` stays put: the next tick retries the pending events —
      // settling is idempotent (§29.3) — instead of stalling them
      // behind an unrelated later append.
    } finally { running = false }
  }
  let active: undefined | Promise<void> = cycle()
  await active
  if (io.signal?.aborted) return 0
  io.stdout.write(`watching (poll every ${intervalSeconds}s, ctrl-c to stop)\n`)
  const failures: unknown[] = []
  let wake!: () => void
  const done = new Promise<void>(resolve => { wake = resolve })
  const fail = (error: unknown): void => {
    failures.push(error)
    stopped = true
    wake()
  }
  const timer = setInterval(() => {
    if (stopped || running || io.signal?.aborted) return
    try {
      if (maxTxOf(store) !== seen) {
        active = cycle()
        void active.catch(fail)
      }
    } catch (error) {
      // A boundary read can retry; a broken diagnostic sink ends the watch.
      try { reportFailure(error, 'cave automate poll') } catch (outputError) { fail(outputError) }
    }
  }, Math.round(intervalSeconds * 1000))
  io.signal?.addEventListener('abort', wake, { once: true })
  if (io.signal?.aborted) wake()
  await done
  stopped = true
  io.signal?.removeEventListener('abort', wake)
  try { clearInterval(timer) } catch (error) { failures.push(error) }
  try { await active } catch (error) {
    if (!failures.includes(error)) failures.push(error)
  }
  if (failures.length === 1) throw failures[0]
  if (failures.length > 1) {
    throw new AggregateError(failures,
      `automation watch failed: ${failures.map(errorMessage).join('; ')}`,
      { cause: failures[0] })
  }
  return 0
}

export const runAutomate = async (argv: readonly string[], context: RunContext = {}): Promise<number> => {
  const signal = context.signal
  const io: IO = {
    stdin: context.stdin ?? process.stdin,
    stdout: context.stdout ?? process.stdout,
    stderr: context.stderr ?? process.stderr,
    ...signal === undefined ? {} : { signal }
  }
  // Avoid narrowing this live signal property across the awaits below.
  if (Boolean(io.signal?.aborted)) return 0
  const { values, positionals } = parseArgs({
    args: [...argv],
    options: {
      db: { type: 'string' },
      once: { type: 'boolean' },
      interval: { type: 'string' },
      declare: { type: 'boolean' },
      list: { type: 'boolean' },
      retract: { type: 'string' },
      hooks: { type: 'string' },
      agent: { type: 'string' },
      timeout: { type: 'string' },
      aliases: { type: 'boolean' },
      'no-derive': { type: 'boolean' },
      'no-check': { type: 'boolean' },
      'max-passes': { type: 'string' },
      json: { type: 'boolean' },
      'no-prelude': { type: 'boolean' },
      help: { type: 'boolean', short: 'h' }
    },
    allowPositionals: true
  }) as { values: Values, positionals: string[] }
  if (values.help === true) {
    io.stdout.write(`${usage}\n`)
    return 0
  }
  const intervalSeconds = values.interval === undefined ? 2 : Number(values.interval)
  const intervalMs = intervalSeconds * 1000
  const roundedIntervalMs = Math.round(intervalMs)
  const intervalTolerance = Number.EPSILON * Math.max(1, Math.abs(intervalMs))
  if (!Number.isFinite(intervalSeconds) || roundedIntervalMs < 1 || roundedIntervalMs > 2147483647 ||
      Math.abs(intervalMs - roundedIntervalMs) > intervalTolerance) {
    io.stderr.write(`cave automate: --interval must resolve to whole milliseconds in 0.001..2147483.647 seconds, got '${values.interval}'\n`)
    return 1
  }
  const maxPasses = values['max-passes'] === undefined ? undefined : Number(values['max-passes'])
  if (maxPasses !== undefined && (!Number.isSafeInteger(maxPasses) || maxPasses < 1)) {
    io.stderr.write(`cave automate: --max-passes expects a positive safe integer, got '${values['max-passes']}'\n`)
    return 1
  }
  const timeoutSeconds = values.timeout === undefined ? undefined : Number(values.timeout)
  if (timeoutSeconds !== undefined) {
    const milliseconds = timeoutSeconds * 1000
    const rounded = Math.round(milliseconds)
    const tolerance = Number.EPSILON * Math.max(1, Math.abs(milliseconds))
    if (!Number.isFinite(timeoutSeconds) || rounded < 1 || rounded > 2147483647 ||
        Math.abs(milliseconds - rounded) > tolerance) {
      io.stderr.write(`cave automate: --timeout must resolve to whole milliseconds in 0.001..2147483.647 seconds, got '${values.timeout}'\n`)
      return 1
    }
  }
  // The intent follows the branch order below: declaring writes before
  // listing is considered.
  const store = openAt(values.db ?? defaultDbPath(), {
    intent: values.declare === true ? 'write' : values.list === true ? 'read' : 'write',
    assemble,
    ...values['no-prelude'] === true ? { registry: Registry.empty } : {}
  })
  const execute = async (): Promise<number> => {
    if (values.declare === true) {
      const text = await readInput(positionals, io.stdin, io.signal)
      io.signal?.throwIfAborted()
      const declaration = declareAutomations(store, text)
      for (const problem of declaration.problems) {
        io.stderr.write(`line ${problem.line}: ${problem.message}\n`)
      }
      io.stdout.write(`declared ${declaration.declared} automation(s)` +
        (declaration.unchanged > 0 ? `, ${declaration.unchanged} unchanged` : '') +
        (declaration.prelude > 0 ? `, +${declaration.prelude} prelude claim(s)` : '') + '\n')
      return declaration.problems.length > 0 ? 1 : 0
    }
    if (values.list === true) {
      const automations = listAutomations(store)
      if (values.json === true) {
        io.stdout.write(`${JSON.stringify(automations, undefined, 2)}\n`)
        return 0
      }
      if (automations.length === 0) {
        io.stdout.write('no automations\n')
        return 0
      }
      for (const automation of automations) {
        io.stdout.write(`${automation.subject} \`${automation.text}\`` +
          `${automation.description === undefined ? '' : ` ; ${automation.description}`}\n`)
        if (!automation.ok) {
          io.stdout.write(`  problems: ${automation.problems.join('; ')}\n`)
        }
      }
      return 0
    }
    if (values.retract !== undefined) {
      const outcome = retractAutomation(store, values.retract)
      if (!outcome.ok) {
        io.stderr.write(`cave automate: ${outcome.error}\n`)
        return 1
      }
      io.stdout.write(`retracted ${outcome.subject} — what past firings recorded stays recorded (spec §29.1)\n`)
      return 0
    }
    if (positionals.length > 0) {
      io.stderr.write(`cave automate: unexpected argument ${JSON.stringify(positionals[0])} — files go with --declare\n`)
      return 1
    }

    const options = settleOptions(values, io.signal)
    if (values.once === true) {
      const report = await settle(store, options)
      if (values.json === true) {
        io.stdout.write(`${JSON.stringify(report, undefined, 2)}\n`)
      } else {
        io.stdout.write(`${renderReport(report).join('\n')}\n`)
      }
      return settled(report) ? 0 : 1
    }
    return await runWatch(store, options, intervalSeconds, io)
  }
  let code = 1
  const errors: unknown[] = []
  try { code = await execute() } catch (error) { errors.push(error) }
  let closeFailed = false
  try { store.close() } catch (error) {
    closeFailed = true
    errors.push(error)
  }
  if (errors.length === 0) return code
  if (io.signal?.aborted === true && !closeFailed && errors.every(error => error === io.signal!.reason)) return 0
  const diagnostic = errors.map(errorMessage).join('; store close also failed: ')
  try { io.stderr.write(`cave automate: ${diagnostic}\n`) }
  catch (outputError) {
    throw new AggregateError([...errors, outputError],
      `${diagnostic}; diagnostic output also failed: ${errorMessage(outputError)}`,
      { cause: errors[0] })
  }
  return 1
}
