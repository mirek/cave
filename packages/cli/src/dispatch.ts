/** One promise-based command dispatcher and process lifecycle for every command. */

import { cave, highlightCommand, reconstructCommand, suggestAliasCommand } from './cli.ts'
import { delegatedCommandNames } from './commands.ts'
import type { Output } from './cli.ts'

export type CommandRuntime = {
  readonly stdin: NodeJS.ReadableStream
  readonly stdout: NodeJS.WritableStream
  readonly stderr: NodeJS.WritableStream
  readonly signal?: AbortSignal
  /** Include stack traces for unexpected exceptions. */
  readonly debug?: boolean
}

const processRuntime = (): CommandRuntime => ({
  stdin: process.stdin,
  stdout: process.stdout,
  stderr: process.stderr,
  debug: process.env['CAVE_DEBUG'] === '1'
})

const delegatedHelp = new Set<string>(delegatedCommandNames)

const normalizedArgs = (raw: readonly string[]): readonly string[] =>
  raw[0] === 'help' && raw[1] !== undefined && delegatedHelp.has(raw[1]) ? [raw[1], '--help'] : raw

const write = (runtime: CommandRuntime, output: Output): number => {
  if (output.out !== '') runtime.stdout.write(output.out)
  if (output.err !== '') runtime.stderr.write(output.err)
  return output.code
}

const runOutput = async (
  runtime: CommandRuntime,
  argv: readonly string[],
  handler: (args: readonly string[]) => Output | Promise<Output>
): Promise<number> => {
  runtime.signal?.throwIfAborted()
  const output = await handler(argv.slice(1))
  runtime.signal?.throwIfAborted()
  return write(runtime, output)
}

const execute = async (raw: readonly string[], runtime: CommandRuntime): Promise<number> => {
  const argv = normalizedArgs(raw)
  const [command, ...rest] = argv
  const context = {
    stdin: runtime.stdin,
    stdout: runtime.stdout,
    stderr: runtime.stderr,
    ...runtime.signal === undefined ? {} : { signal: runtime.signal }
  }
  switch (command) {
    case 'mcp': {
      const { runMcp } = await import('@cavelang/mcp')
      return await runMcp(rest, context)
    }
    case 'ingest': {
      const { runIngest } = await import('@cavelang/ingest')
      return await runIngest(rest, context)
    }
    case 'eval': {
      const { runEval } = await import('@cavelang/eval')
      return await runEval(rest, context)
    }
    case 'connect': {
      const { runConnect } = await import('@cavelang/connect')
      return await runConnect(rest, context)
    }
    case 'automate': {
      const { runAutomate } = await import('@cavelang/automate')
      return await runAutomate(rest, context)
    }
    case 'serve': {
      const { runServe } = await import('@cavelang/view')
      return await runServe(rest, context)
    }
    case 'reconstruct':
      return await runOutput(runtime, argv, reconstructCommand)
    case 'suggest-alias':
      return await runOutput(runtime, argv, suggestAliasCommand)
    case 'highlight':
      if (!rest.includes('--help') && !rest.includes('-h')) {
        return await runOutput(runtime, argv, highlightCommand)
      }
      break
  }

  runtime.signal?.throwIfAborted()
  const output = await Promise.resolve(cave(argv))
  runtime.signal?.throwIfAborted()
  const colorize = output.code === 0 && command === 'export' && !rest.includes('--out') &&
    output.out !== '' && runtime.stdout === process.stdout && process.stdout.isTTY === true &&
    process.env['NO_COLOR'] === undefined
  if (!colorize) return write(runtime, output)
  const { highlighter } = await import('@cavelang/highlight')
  return write(runtime, { ...output, out: (await highlighter()).ansi(output.out) })
}

/** Dispatch one invocation through the shared argument, I/O, error, and exit path. */
export const dispatch = async (
  argv: readonly string[],
  runtime: CommandRuntime = processRuntime()
): Promise<number> => {
  try {
    return await execute(argv, runtime)
  } catch (error) {
    if (runtime.signal?.aborted === true) return 0
    const command = argv[0] === 'q' ? 'query' : argv[0]
    const message = runtime.debug === true && error instanceof Error && error.stack !== undefined ?
      error.stack : error instanceof Error ? error.message : String(error)
    runtime.stderr.write(`cave${command === undefined || command.startsWith('-') ? '' : ` ${command}`}: ${message}\n`)
    return 1
  }
}

const signalExitCode = { SIGINT: 130, SIGTERM: 143 } as const

/** Run the process lifecycle, aborting handlers and awaiting their cleanup on signals. */
export const runCli = async (
  argv: readonly string[],
  runtime: CommandRuntime = processRuntime()
): Promise<number> => {
  const controller = new AbortController()
  let received: keyof typeof signalExitCode | undefined
  const handlers = {
    SIGINT: (): void => { received = 'SIGINT'; controller.abort() },
    SIGTERM: (): void => { received = 'SIGTERM'; controller.abort() }
  }
  process.once('SIGINT', handlers.SIGINT)
  process.once('SIGTERM', handlers.SIGTERM)
  const signal = runtime.signal === undefined ? controller.signal : AbortSignal.any([runtime.signal, controller.signal])
  try {
    const code = await dispatch(argv, { ...runtime, signal })
    return received === undefined ? code : signalExitCode[received]
  } finally {
    process.removeListener('SIGINT', handlers.SIGINT)
    process.removeListener('SIGTERM', handlers.SIGTERM)
  }
}
