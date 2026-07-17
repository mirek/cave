/** Portable, bounded external-process execution for CAVE integrations. */

import { spawn, spawnSync, type ChildProcess } from 'node:child_process'
import { fileURLToPath } from 'node:url'

export type ProcessCommand = {
  readonly executable: string
  readonly args: readonly string[]
}

export type ShellSyntax = 'posix' | 'powershell'

export type ProcessResult = {
  readonly code: number | null
  readonly signal: NodeJS.Signals | null
  readonly stdout: string
  readonly stderr: string
}

export type ProcessFailureKind = 'spawn' | 'timeout' | 'aborted' | 'stdout-limit' | 'stderr-limit'

export type ProcessFailureRecord = {
  readonly kind: ProcessFailureKind
  readonly message: string
  readonly result: ProcessResult
  readonly limit?: number
  readonly errorCode?: string
}

/** Typed, command-redacted failure for resource and lifecycle errors. */
export class ProcessFailure extends Error {
  override readonly name = 'ProcessFailure'
  readonly kind: ProcessFailureKind
  readonly result: ProcessResult
  readonly limit?: number
  readonly errorCode?: string

  constructor(record: ProcessFailureRecord) {
    super(record.message)
    this.kind = record.kind
    this.result = record.result
    this.limit = record.limit
    this.errorCode = record.errorCode
  }

  toJSON(): ProcessFailureRecord {
    return {
      kind: this.kind,
      message: this.message,
      result: this.result,
      ...this.limit === undefined ? {} : { limit: this.limit },
      ...this.errorCode === undefined ? {} : { errorCode: this.errorCode }
    }
  }
}

export type ProcessOptions = {
  readonly cwd?: string
  readonly input?: string
  readonly env?: NodeJS.ProcessEnv
  readonly timeoutMs?: number
  readonly signal?: AbortSignal
  readonly maxStdoutBytes?: number
  readonly maxStderrBytes?: number
}

export type SyncProcessOptions = Omit<ProcessOptions, 'signal'>

export const defaultMaxStdoutBytes = 8 * 1024 * 1024
export const defaultMaxStderrBytes = 1024 * 1024

export const directCommand = (executable: string, args: readonly string[] = []): ProcessCommand =>
  ({ executable, args })

export const shellSyntaxFor = (platform: NodeJS.Platform = process.platform): ShellSyntax =>
  platform === 'win32' ? 'powershell' : 'posix'

/** Quote one value as one argument for the selected intentional shell. */
export const quoteShellArgument = (value: string, syntax: ShellSyntax = shellSyntaxFor()): string =>
  syntax === 'powershell' ? `'${value.replaceAll("'", "''")}'` : `'${value.replaceAll("'", `'\\''`)}'`

/** Substitute known placeholders once; unknown placeholders remain literal. */
export const substituteShell = (
  template: string,
  substitutions: Readonly<Record<string, string>>,
  syntax: ShellSyntax = shellSyntaxFor()
): string => template.replace(/\{([A-Za-z][A-Za-z0-9_-]*)\}/g, (whole, name: string) =>
  Object.hasOwn(substitutions, name) ? quoteShellArgument(substitutions[name]!, syntax) : whole)

/**
 * Make an intentional shell command explicit. POSIX uses `/bin/sh`; Windows
 * uses PowerShell 7. The shell itself is still spawned with `shell:false`.
 */
export const shellCommand = (
  template: string,
  substitutions: Readonly<Record<string, string>> = {},
  platform: NodeJS.Platform = process.platform
): ProcessCommand => {
  const syntax = shellSyntaxFor(platform)
  const command = substituteShell(template, substitutions, syntax)
  // EncodedCommand transports the exact UTF-16LE script without a native argv
  // reparse. PowerShell 7 is required for standard native argument passing;
  // Windows PowerShell 5.1 corrupts embedded quotes passed to executables.
  return platform === 'win32' ?
    directCommand('pwsh.exe', [
      '-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
      '-EncodedCommand', Buffer.from(command, 'utf16le').toString('base64')
    ]) :
    directCommand('/bin/sh', ['-c', command])
}

const emptyResult = (): ProcessResult => ({ code: null, signal: null, stdout: '', stderr: '' })

const positiveLimit = (value: number | undefined, fallback: number, name: string): number => {
  const result = value ?? fallback
  if (!Number.isSafeInteger(result) || result < 0) {
    throw new TypeError(`${name} must be a non-negative safe integer`)
  }
  return result
}

const killTree = (child: ChildProcess): Promise<void> => {
  const pid = child.pid
  if (pid === undefined) return Promise.resolve()
  if (process.platform !== 'win32') {
    try {
      process.kill(-pid, 'SIGKILL')
    } catch {
      try { child.kill('SIGKILL') } catch { /* already gone */ }
    }
    return Promise.resolve()
  }
  return new Promise(resolve => {
    const killer = spawn('taskkill.exe', ['/pid', String(pid), '/t', '/f'], {
      shell: false,
      stdio: 'ignore',
      windowsHide: true
    })
    killer.once('error', () => {
      try { child.kill('SIGKILL') } catch { /* already gone */ }
      resolve()
    })
    killer.once('close', () => resolve())
  })
}

const failureMessage = (kind: ProcessFailureKind, timeoutMs: number, limit?: number): string => {
  switch (kind) {
    case 'spawn': return 'process failed to start'
    case 'timeout': return `process timed out after ${timeoutMs}ms`
    case 'aborted': return 'process was cancelled'
    case 'stdout-limit': return `process stdout exceeded ${limit} bytes`
    case 'stderr-limit': return `process stderr exceeded ${limit} bytes`
  }
}

/** Run an executable plus argument array with bounded output and tree cleanup. */
export const runProcess = (
  command: ProcessCommand,
  options: ProcessOptions = {}
): Promise<ProcessResult> => {
  const stdoutLimit = positiveLimit(options.maxStdoutBytes, defaultMaxStdoutBytes, 'maxStdoutBytes')
  const stderrLimit = positiveLimit(options.maxStderrBytes, defaultMaxStderrBytes, 'maxStderrBytes')
  const timeoutMs = positiveLimit(options.timeoutMs, 0, 'timeoutMs')
  if (options.signal?.aborted === true) {
    return Promise.reject(new ProcessFailure({
      kind: 'aborted', message: failureMessage('aborted', timeoutMs), result: emptyResult()
    }))
  }

  return new Promise((resolve, reject) => {
    const stdout: Buffer[] = []
    const stderr: Buffer[] = []
    let stdoutBytes = 0
    let stderrBytes = 0
    let code: number | null = null
    let exitSignal: NodeJS.Signals | null = null
    let settled = false
    let terminating = false
    let timer: NodeJS.Timeout | undefined
    let spawnErrorCode: string | undefined

    const child = spawn(command.executable, [...command.args], {
      shell: false,
      detached: process.platform !== 'win32',
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
      ...options.cwd === undefined ? {} : { cwd: options.cwd },
      ...options.env === undefined ? {} : { env: options.env }
    })

    const result = (): ProcessResult => ({
      code,
      signal: exitSignal,
      stdout: Buffer.concat(stdout).toString('utf8'),
      stderr: Buffer.concat(stderr).toString('utf8')
    })
    const cleanup = (): void => {
      if (timer !== undefined) clearTimeout(timer)
      options.signal?.removeEventListener('abort', abort)
    }
    const finish = (failure?: ProcessFailure): void => {
      if (settled) return
      settled = true
      cleanup()
      child.stdin?.destroy()
      child.stdout?.destroy()
      child.stderr?.destroy()
      if (failure === undefined) resolve(result())
      else reject(failure)
    }
    const terminate = (kind: Exclude<ProcessFailureKind, 'spawn'>, limit?: number): void => {
      if (settled || terminating) return
      terminating = true
      void killTree(child).finally(() => finish(new ProcessFailure({
        kind,
        message: failureMessage(kind, timeoutMs, limit),
        result: result(),
        ...limit === undefined ? {} : { limit }
      })))
    }
    const abort = (): void => terminate('aborted')
    const collect = (stream: 'stdout' | 'stderr', chunk: Buffer | string): void => {
      if (terminating || settled) return
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
      const limit = stream === 'stdout' ? stdoutLimit : stderrLimit
      const used = stream === 'stdout' ? stdoutBytes : stderrBytes
      const remaining = Math.max(0, limit - used)
      if (remaining > 0) (stream === 'stdout' ? stdout : stderr).push(bytes.subarray(0, remaining))
      if (stream === 'stdout') stdoutBytes += Math.min(bytes.length, remaining)
      else stderrBytes += Math.min(bytes.length, remaining)
      if (bytes.length > remaining) terminate(stream === 'stdout' ? 'stdout-limit' : 'stderr-limit', limit)
    }

    child.stdout?.on('data', chunk => collect('stdout', chunk as Buffer))
    child.stderr?.on('data', chunk => collect('stderr', chunk as Buffer))
    child.on('error', (error: NodeJS.ErrnoException) => {
      if (terminating) return
      spawnErrorCode = error.code
      finish(new ProcessFailure({
        kind: 'spawn',
        message: failureMessage('spawn', timeoutMs),
        result: result(),
        ...spawnErrorCode === undefined ? {} : { errorCode: spawnErrorCode }
      }))
    })
    child.on('exit', (observedCode, observedSignal) => {
      code = observedCode
      exitSignal = observedSignal
    })
    child.on('close', (observedCode, observedSignal) => {
      code = observedCode
      exitSignal = observedSignal
      if (!terminating) finish()
    })
    child.stdin?.on('error', () => { /* early child exits may close stdin */ })
    if (options.input !== undefined) child.stdin?.end(options.input)
    else child.stdin?.end()
    if (timeoutMs > 0) timer = setTimeout(() => terminate('timeout'), timeoutMs)
    options.signal?.addEventListener('abort', abort, { once: true })
    // Close the check/listener race if cancellation landed during spawn setup.
    if (options.signal?.aborted === true) abort()
  })
}

type WorkerResponse =
  | { readonly ok: true, readonly result: ProcessResult }
  | { readonly ok: false, readonly failure: ProcessFailureRecord }

/**
 * Synchronous bridge for compatibility-sensitive APIs. A short-lived Node
 * worker owns the asynchronous tree cleanup, then returns one bounded result.
 */
export const runProcessSync = (command: ProcessCommand, options: SyncProcessOptions = {}): ProcessResult => {
  const stdoutLimit = positiveLimit(options.maxStdoutBytes, defaultMaxStdoutBytes, 'maxStdoutBytes')
  const stderrLimit = positiveLimit(options.maxStderrBytes, defaultMaxStderrBytes, 'maxStderrBytes')
  const timeoutMs = positiveLimit(options.timeoutMs, 0, 'timeoutMs')
  const extension = import.meta.url.endsWith('.ts') ? 'ts' : 'js'
  const worker = fileURLToPath(new URL(`./process-worker.${extension}`, import.meta.url))
  const result = spawnSync(process.execPath, ['--disable-warning=ExperimentalWarning', worker], {
    shell: false,
    windowsHide: true,
    encoding: 'utf8',
    input: JSON.stringify({ command, options: { ...options, maxStdoutBytes: stdoutLimit, maxStderrBytes: stderrLimit } }),
    // JSON can expand a captured control byte to a six-byte `\\u00xx` escape.
    maxBuffer: Math.max(1024 * 1024, (stdoutLimit + stderrLimit) * 7 + 1024 * 1024),
    timeout: timeoutMs > 0 ? timeoutMs + 5_000 : undefined
  })
  if (result.status !== 0 || result.error !== undefined) {
    const errorCode = (result.error as NodeJS.ErrnoException | undefined)?.code
    throw new ProcessFailure({
      kind: errorCode === 'ETIMEDOUT' ? 'timeout' : 'spawn',
      message: failureMessage(errorCode === 'ETIMEDOUT' ? 'timeout' : 'spawn', timeoutMs),
      result: emptyResult(),
      ...errorCode === undefined ? {} : { errorCode }
    })
  }
  let response: WorkerResponse
  try {
    response = JSON.parse(result.stdout) as WorkerResponse
  } catch {
    throw new ProcessFailure({ kind: 'spawn', message: failureMessage('spawn', timeoutMs), result: emptyResult() })
  }
  if (!response.ok) throw new ProcessFailure(response.failure)
  return response.result
}
