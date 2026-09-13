#!/usr/bin/env node
/** `cave` binary entry point — one lifecycle for every command. */

// Keep runtime warnings out of normal CLI output; debug mode retains Node's
// warning diagnostics. Install before loading SQLite and delegated commands.
if (process.env['CAVE_DEBUG'] !== '1') {
  // Node exposes its default printer as an ordinary listener. Its name alone
  // is ambiguous: preload scripts can register their own `onWarning`. Match
  // the printer's internal formatting call too, and preserve every subscriber
  // if Node changes this implementation (covered on each supported runtime).
  const printer = process.listeners('warning').find(listener =>
    listener.name === 'onWarning' &&
    Function.prototype.toString.call(listener).includes('ErrorPrototypeToString(warning)'))
  if (printer !== undefined) process.removeListener('warning', printer)
}

const { runCli } = await import('./dispatch.ts')

process.exitCode = await runCli(process.argv.slice(2))
