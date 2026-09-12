import { errorMessage } from './error-message.ts'
type Worker = { terminate: () => Promise<unknown> }
type Pool = {
  readonly runningWorkers: readonly Worker[]
  readonly unusedWorkers: readonly Worker[]
  terminateAllThreads: () => void
}

/** Keep Emscripten's message handlers until Node confirms each worker has exited. */
export const closeWorkers = async (pool: Pool | undefined): Promise<void> => {
  if (pool === undefined) return
  const stopped = new Set<Worker>()
  while (true) {
    const workers = [...new Set([...pool.runningWorkers, ...pool.unusedWorkers])]
      .filter(worker => !stopped.has(worker))
    if (workers.length === 0) break
    for (const worker of workers) stopped.add(worker)
    // A throwing termination must not prevent attempts on the remaining workers.
    // Keep handlers alive until every attempted termination has settled.
    const results = await Promise.allSettled(workers.map(async worker => worker.terminate()))
    const failures = results.flatMap(result => result.status === 'rejected' ? [result.reason] : [])
    if (failures.length === 1) throw failures[0]
    if (failures.length > 1) throw new AggregateError(failures, `Z3 worker termination failed: ${failures.map(errorMessage).join('; ')}`)
  }
  // The binding replaces handlers with warnings when it clears the pool.
  // Worker exit acknowledgments ensure pending cleanup messages came first.
  pool.terminateAllThreads()
}
