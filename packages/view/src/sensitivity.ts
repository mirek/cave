import { Sensitivity } from '@cavelang/store'

/** Validate a caller-selected ceiling before projection or listener work. */
export const maximumSensitivity = (value: unknown): Sensitivity.Level => {
  if (value === undefined) return Sensitivity.defaultMaximum
  if (typeof value !== 'string' || Sensitivity.parse(value) === undefined) {
    throw new TypeError(`maxSensitivity must be one of: ${Sensitivity.levels.join(', ')}`)
  }
  return value as Sensitivity.Level
}
