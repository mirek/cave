#!/usr/bin/env node
/** `cave` binary entry point — see `cli.ts` for the command implementations. */

import { cave } from './cli.ts'

const { code, out, err } = cave(process.argv.slice(2))
if (out !== '') {
  process.stdout.write(out)
}
if (err !== '') {
  process.stderr.write(err)
}
process.exitCode = code
