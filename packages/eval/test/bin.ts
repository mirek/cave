/** Test shim: `node test/bin.ts <argv...>` runs `cave eval`'s entry directly. */

import { runEval } from '@cavelang/eval'

process.exitCode = await runEval(process.argv.slice(2))
