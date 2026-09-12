/** Query strings must survive SQLite's UTF-8 encoding without replacement. */
export const assertQueryUnicode = (value: unknown, line?: number): void => {
  if (typeof value === 'string' && /[\uD800-\uDFFF]/u.test(value)) {
    throw new Error(`CAVE-Q${line === undefined ? '' : ` line ${line}`}: unpaired UTF-16 surrogate cannot be queried as UTF-8`)
  }
}
