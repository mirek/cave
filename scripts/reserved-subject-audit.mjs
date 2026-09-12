/** Audit context-sensitive subject spellings without mutating a store. */
import { Claim, Key } from '../packages/core/src/index.ts'
import { canonicalizeText, emit } from '../packages/canonical/src/index.ts'

const names = ['WHEN', 'VIA', 'BECAUSE', 'UNLESS', 'EXISTS', 'IS', 'HAS', 'NOT', 'REVERSE', 'RENAMED-TO', 'WITH', 'WHERE', 'SELECT', 'AND', 'OR', '42', '2026-01-01']
const edgeIdentity = edges => edges.map(edge => [edge.parent, edge.role, edge.child])
const failures = []
let checked = 0
for (const name of names) for (const role of [undefined, 'WHEN', 'VIA', 'BECAUSE', 'QUALIFIES']) {
  for (const verb of ['EXISTS', 'IS', 'NOT']) for (const negated of [false, true]) {
    const parent = Claim.of({ subject: Claim.entity('parent'), verb: 'EXISTS', payload: Claim.none })
    const child = Claim.of({ subject: Claim.entity(name), verb, negated, payload: verb === 'EXISTS' ? Claim.none : Claim.relation(Claim.entity('ready')) })
    const claims = role === undefined ? [child] : [parent, child]
    const edges = role === undefined ? [] : [{ parent: 0, child: 1, role }]
    const expectedKeys = claims.map(Key.of)
    checked++
    try {
      const source = emit({ claims: claims.map(claim => ({ line: 0, claim })), edges })
      const parsed = canonicalizeText(source)
      const actualKeys = parsed.claims.map(entry => Key.of(entry.claim))
      if (parsed.problems.length > 0 || JSON.stringify(actualKeys) !== JSON.stringify(expectedKeys) || JSON.stringify(edgeIdentity(parsed.edges)) !== JSON.stringify(edgeIdentity(edges))) {
        failures.push({ name, placement: role ?? 'root', verb, negated, source, problems: parsed.problems, expectedKeys, actualKeys, expectedEdges: edges, actualEdges: parsed.edges })
      }
    } catch (error) {
      failures.push({ name, placement: role ?? 'root', verb, negated, error: error instanceof Error ? error.message : String(error) })
    }
  }
}
const byPlacement = Object.fromEntries(['root', 'WHEN', 'VIA', 'BECAUSE', 'QUALIFIES'].map(placement => [placement, failures.filter(failure => failure.placement === placement).length]))
console.log(JSON.stringify({ node: process.version, checked, passed: checked - failures.length, failed: failures.length, byPlacement, failures }, null, 2))
process.exitCode = failures.length > 0 ? 1 : 0
