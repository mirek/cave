/** Internal synchronous-bridge worker for process.ts. */

import { readFileSync } from 'node:fs'
import {
  ProcessFailure,
  runProcess,
  type ProcessCommand,
  type SyncProcessOptions
} from './process.ts'

type Request = {
  readonly command: ProcessCommand
  readonly options: SyncProcessOptions
}

const request = JSON.parse(readFileSync(0, 'utf8')) as Request
const controller = new AbortController()
const abort = (): void => controller.abort()
process.once('SIGINT', abort)
process.once('SIGTERM', abort)
try {
  const result = await runProcess(request.command, { ...request.options, signal: controller.signal })
  process.stdout.write(JSON.stringify({ ok: true, result }))
} catch (error) {
  if (error instanceof ProcessFailure) {
    process.stdout.write(JSON.stringify({ ok: false, failure: error.toJSON() }))
  } else {
    process.stdout.write(JSON.stringify({
      ok: false,
      failure: {
        kind: 'spawn',
        message: 'process failed to start',
        result: { code: null, signal: null, stdout: '', stderr: '' }
      }
    }))
  }
} finally {
  process.removeListener('SIGINT', abort)
  process.removeListener('SIGTERM', abort)
}
