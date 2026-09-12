import { diagnosticText } from './diagnostic-text.ts'
import { mergeLimits } from './validate.ts'
import type { Options } from './adapter.ts'

/** Validate option names and capture supplied fields before applying defaults. */
export const validateOptions = (options: Options): Options => {
  if (options === null || typeof options !== 'object' || Array.isArray(options)) {
    throw new TypeError('solver options must be an object')
  }
  for (const key of Object.keys(options)) {
    if (key !== 'limits' && key !== 'unsatCore') throw new TypeError(`unknown solver option ${diagnosticText(key)}`)
  }
  const unsatCore = options.unsatCore
  if (unsatCore !== undefined && typeof unsatCore !== 'boolean') {
    throw new TypeError('solver option unsatCore must be a Boolean')
  }
  return { unsatCore, limits: mergeLimits(options.limits) }
}
