import { clone } from './clone.ts'
import type { Limits } from './adapter.ts'
import type { Model } from './model.ts'
import { mergeLimits, model as validate } from './validate.ts'
import { digestOwned, serializeOwned } from './canonical-owned.ts'

/** Canonical semantic JSON. Descriptions and evidence links are deliberately not identity. */
export const serialize = (input: Model, limits: Partial<Limits> = {}): string => {
  const resolved = mergeLimits(limits)
  validate(input, resolved)
  return serializeOwned(clone(input), resolved)
}

export const digest = (input: Model, limits: Partial<Limits> = {}): string => {
  const resolved = mergeLimits(limits)
  validate(input, resolved)
  return digestOwned(clone(input), resolved)
}
