import { errorMessage } from './error-message.ts'

/**
 * The binding's finalizers call this instance's low-level API directly, outside
 * its async mutex. Native AST deletion must not race a pthread solver check.
 * Guard the two async native operations CAVE uses; normal synchronous releases
 * remain immediate, and queued releases drain before a check returns to CAVE.
 */
export const guardCleanup = (api: object): void => {
  const functions = api as Record<string, unknown>
  const pending: (() => void)[] = []
  let checking = 0
  for (const [name, value] of Object.entries(functions)) {
    if (typeof value !== 'function') continue
    if (name === 'dec_ref' || name.endsWith('_dec_ref') || name === 'del_context') {
      functions[name] = (...args: unknown[]) => {
        const release = () => { value.apply(api, args) }
        if (checking > 0) pending.push(release)
        else release()
      }
    }
  }
  for (const name of ['solver_check_assumptions', 'optimize_check']) {
    const check = functions[name]
    if (typeof check !== 'function') throw new TypeError(`Z3 is missing ${name}`)
    functions[name] = async (...args: unknown[]) => {
      checking++
      let checkFailed = false
      let checkError: unknown
      try {
        return await check.apply(api, args)
      } catch (error) {
        checkFailed = true
        checkError = error
        throw error
      } finally {
        checking--
        if (checking === 0) {
          const releases = pending.splice(0)
          const failures: unknown[] = []
          for (const release of releases) {
            try { release() } catch (error) { failures.push(error) }
          }
          if (failures.length > 0) {
            if (!checkFailed && failures.length === 1) throw failures[0]
            const errors = checkFailed ? [checkError, ...failures] : failures
            throw new AggregateError(errors,
              `Z3 native cleanup failed: ${errors.map(errorMessage).join('; ')}`,
              checkFailed ? { cause: checkError } : undefined)
          }
        }
      }
    }
  }
}
