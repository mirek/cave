import { Row, type Store } from '@cavelang/store'

/** Current positive attribute declarations, preserving oldest-first ordering. */
export const currentDeclarations = (store: Store, attribute: string): Row.t[] =>
  store.db.prepare(`SELECT c.* FROM cave_claim c
    WHERE c.verb = 'HAS' AND c.attribute = ? AND c.negated = 0 AND c.conf > 0
      AND c.tx = (SELECT MAX(latest.tx) FROM cave_claim latest WHERE latest.claim_key = c.claim_key)
    ORDER BY c.tx`).all(attribute) as unknown as Row.t[]

/** Decode stored rule text with a claim-specific storage diagnostic. */
export const declarationText = (row: Row.t): string => {
  if (typeof row.value_text !== 'string') {
    throw new TypeError(`stored rule field ${JSON.stringify(row.attribute)} value_text must be text (claim ${JSON.stringify(row.id)})`)
  }
  return Row.parseValue(row.value_text).raw
}
