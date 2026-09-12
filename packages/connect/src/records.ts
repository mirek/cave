/** Validate and capture array entries without reading their fields. */
export const captureRecords = (records: readonly Record<string, unknown>[]): Record<string, unknown>[] => {
  if (!Array.isArray(records)) throw new TypeError('cave connect: records must be an array')
  const captured: Record<string, unknown>[] = []
  const recordCount = records.length
  if (!Number.isInteger(recordCount) || recordCount < 0 || recordCount > 0xffffffff) {
    throw new TypeError('cave connect: records length must be a valid array length')
  }
  for (let index = 0; index < recordCount; index++) {
    if (!Object.hasOwn(records, index)) throw new TypeError(`cave connect: record ${index + 1} must be an object`)
    const record = records[index]
    if (record === null || typeof record !== 'object' || Array.isArray(record)) {
      throw new TypeError(`cave connect: record ${index + 1} must be an object`)
    }
    captured.push(record)
  }
  return captured
}
