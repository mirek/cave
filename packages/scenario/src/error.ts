export type Code =
  | 'invalid-definition'
  | 'invalid-overlay'
  | 'missing-input'
  | 'ambiguous-input'
  | 'contested-input'
  | 'retracted-input'
  | 'unresolved-input'
  | 'invalid-value'
  | 'incompatible-unit'

export class ScenarioInputError extends Error {
  readonly code: Code
  readonly bindingId?: string

  constructor(code: Code, message: string, bindingId?: string) {
    super(bindingId === undefined ? message : `scenario input ${JSON.stringify(bindingId)}: ${message}`)
    this.name = 'ScenarioInputError'
    this.code = code
    this.bindingId = bindingId
  }
}
