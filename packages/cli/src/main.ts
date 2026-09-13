#!/usr/bin/env node
/** `cave` binary entry point — one lifecycle for every command. */

// Keep runtime warnings out of normal CLI output; debug mode retains Node's
// warning diagnostics. Install before loading SQLite and delegated commands.
if (process.env['CAVE_DEBUG'] !== '1') process.removeAllListeners('warning')

const { runCli } = await import('./dispatch.ts')

process.exitCode = await runCli(process.argv.slice(2))
