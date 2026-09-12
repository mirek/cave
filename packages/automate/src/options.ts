import type { SettleOptions } from './engine.ts'

/** Capture one invocation without resolving individual hook command getters. */
export const captureSettleOptions = (options: SettleOptions): SettleOptions => {
  const signal = options.signal
  signal?.throwIfAborted()
  return {
    signal,
    aliases: options.aliases,
    derive: options.derive,
    check: options.check,
    hooks: options.hooks,
    complete: options.complete,
    maxPasses: options.maxPasses,
    cwd: options.cwd,
    hookTimeoutSeconds: options.hookTimeoutSeconds,
    hookMaxStdoutBytes: options.hookMaxStdoutBytes,
    hookMaxStderrBytes: options.hookMaxStderrBytes
  }
}

