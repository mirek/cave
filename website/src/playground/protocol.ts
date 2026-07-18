export type OpenResult = {
  readonly claims: number
  readonly edges: number
  readonly currentBeliefs: number
}

export type QueryResult = {
  readonly matches: number
  readonly output: string
}

export type PlaygroundRequest =
  | { readonly id: number, readonly operation: 'open', readonly source: string, readonly sourceName: string }
  | { readonly id: number, readonly operation: 'append', readonly source: string }
  | { readonly id: number, readonly operation: 'query', readonly pattern: string }

export type PlaygroundResponse =
  | { readonly id: number, readonly ok: true, readonly result: OpenResult | QueryResult }
  | { readonly id: number, readonly ok: false, readonly error: string }
