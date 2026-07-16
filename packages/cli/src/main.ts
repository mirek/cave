#!/usr/bin/env node
/** `cave` binary entry point — one lifecycle for every command. */

import { runCli } from './dispatch.ts'

process.exitCode = await runCli(process.argv.slice(2))
