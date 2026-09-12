import type { Result } from './adapter.ts'
import { clone } from './clone.ts'
import { resultMetadata, unknownReason } from './validate.ts'

/** Capture the reported outcome before checking the adapter's proof contract. */
export const captureResult = (input: Result): Result => {
  const result = clone(input)
  if (result === null || typeof result !== 'object' || Array.isArray(result)) {
    throw new TypeError('solver result must be an object')
  }
  switch (result.status) {
    case 'optimal':
      if (result.optimalityProved !== true) throw new TypeError('optimal solver result requires optimalityProved: true')
      break
    case 'unsatisfied':
      if (result.infeasibilityProved !== true) throw new TypeError('unsatisfied solver result requires infeasibilityProved: true')
      break
    case 'satisfied':
      break
    case 'unknown':
      unknownReason(result.reason)
      break
    default:
      throw new TypeError('solver result status must be satisfied, optimal, unsatisfied or unknown')
  }
  resultMetadata(result)
  return result
}
