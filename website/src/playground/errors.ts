/** Diagnostics must not replace the failure they describe. */
export const errorMessage = (value: unknown): string => {
  try {
    return value instanceof Error ? String(value.message) : String(value)
  } catch {
    return '[unprintable thrown value]'
  }
}

export class SqliteInitializationError extends Error {}

/** Cleanup failure leaves database ownership uncertain; retire the worker. */
export class DatabaseCleanupError extends AggregateError {
  constructor(error: unknown, cleanupErrors: readonly unknown[] = []) {
    const errors = [error, ...cleanupErrors]
    super(errors, `Playground database cleanup failed: ${errors.map(errorMessage).join('; ')}`, { cause: error })
    this.name = 'DatabaseCleanupError'
  }
}

export const describeWorkerError = (error: unknown): { error: string, fatal: boolean } => {
  let fatal = false
  try {
    fatal = error instanceof SqliteInitializationError || error instanceof DatabaseCleanupError
  } catch {
    // A revoked Proxy can throw even during instanceof. Retire this runtime
    // because its failure cannot be classified reliably.
    fatal = true
  }
  return { error: errorMessage(error), fatal }
}
