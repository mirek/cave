/**
 * Runnable demo (spec §18): the multi-hop recovery pattern central to the
 * active-reconstruction thesis (spec §11.3).
 *
 * Starting from the single cue `reject-valid-tokens` — the *symptom* — the
 * loop must travel edges that only exist as inverse reads:
 *
 * 1. `reject-valid-tokens` ← CAUSED-BY — `token-expiry` (inverse CAUSE)
 * 2. `token-expiry` ← PART-OF — `topic/auth-hardening` (inverse CONTAINS)
 * 3. topic expansion → `auth/middleware`, and with it the bug, the broken
 *    check and the fix.
 *
 * ```
 * pnpm --filter @cave/loop demo
 * ```
 */

import { emitClaim } from '@cave/canonical'
import { memoryStoreOfText } from './store.ts'
import { heuristicPolicy, reconstruct } from './reconstruct.ts'

export const knowledge = `
auth/middleware HAS bug: token-expiry #security #topic:auth-hardening
token-expiry CAUSE reject-valid-tokens
expiry-check USES \`<\`
expiry-check NEEDS \`<=\`
\`<=\` FIX token-expiry @auth.ts:42
auth/middleware NEEDS test: boundary-cases @ 70%
topic/auth-hardening CONTAINS token-expiry
topic/auth-hardening CONTAINS auth/middleware
topic/auth-hardening CONTAINS expiry-check
deploy VIA github-actions
unrelated/service USES postgres
`

export const run = (): { lines: string[] } => {
  const store = memoryStoreOfText(knowledge)
  const { claims, trace } = reconstruct(store, heuristicPolicy({ maxSteps: 12 }), ['reject-valid-tokens'])
  const lines: string[] = []
  lines.push('cave-loop demo — multi-hop recovery from the symptom cue')
  lines.push('')
  lines.push('trace:')
  for (const step of trace) {
    const edges = step.edges
      .map(edge => `${edge.rel ?? `${edge.verb}(un-named reverse)`} → ${edge.to}`)
      .join(', ')
    lines.push(`  ${step.step}. expand ${step.cue.entity} (score ${step.cue.score.toFixed(2)})` +
      `${edges === '' ? '' : ` — ${edges}`}`)
  }
  lines.push('')
  lines.push('reconstructed claims:')
  for (const claim of claims) {
    lines.push(`  ${emitClaim(claim)}`)
  }
  return { lines }
}

const invokedDirectly = process.argv[1] !== undefined && import.meta.url.endsWith(process.argv[1].split('/').pop()!)
if (invokedDirectly) {
  console.log(run().lines.join('\n'))
}
