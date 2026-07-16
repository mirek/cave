import { open } from '@cavelang/store'
import { readFileSync } from 'node:fs'

const [path, state, clock, wait] = process.argv.slice(2)
if (path === undefined || state === undefined || clock === undefined) {
  throw new Error('usage: multi-process-writer.ts <db> <state> <clock-ms> [wait]')
}

Date.now = () => Number(clock)
const store = open(path)
if (wait === 'hold') {
  store.transaction(() => {
    store.ingest(`service HAS state: ${state}`)
    process.stdout.write('locked\n')
    readFileSync(0, 'utf8')
  })
} else {
  if (wait === 'wait') {
    process.stdout.write('ready\n')
    await new Promise<void>(resolve => process.stdin.once('data', () => resolve()))
  }
  store.ingest(`service HAS state: ${state}`)
}
store.close()
