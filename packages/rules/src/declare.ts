/**
 * Rule lifecycle (spec §24.1) — declaring rules from a rule file,
 * listing what a store believes its rules are, and retracting a rule
 * together with everything it derived.
 *
 * A rule file is an ordinary CAVE document in which structural lines with
 * a top-level `=>` are rules; everything else — verb declarations the
 * rules need, comments, blanks — is prelude, ingested first so the rules
 * fire against the vocabulary they assume. Declaring is idempotent: rule
 * identity is the normalized-text digest, and an unchanged rule (or
 * prelude) appends nothing.
 */

import { Claim, Key, Value } from '@cavelang/core'
import { Row, type Store } from '@cavelang/store'
import * as Rule from './rule.ts'
import { provenanceContext, ruleAttribute, ruleSubject } from './engine.ts'

/** Subject of the prelude digest bookkeeping claim. */
const preludeSubject = 'derive/prelude'

const preludeDigestAttribute = 'derive-digest'

const bookkeepingContexts = [provenanceContext]

const declarationKey = (subject: string, attribute: string): string =>
  Key.of(Claim.of({
    subject: Claim.entity(subject),
    verb: 'HAS',
    payload: Claim.attribute(attribute, Value.parse('x')),
    contexts: bookkeepingContexts
  }))

export type Declaration = {
  /** Rules newly declared (or re-declared after retraction). */
  readonly declared: number
  /** Rules whose declaration is already current — nothing appended. */
  readonly unchanged: number
  /** Claims appended by the file's prelude (0 when unchanged). */
  readonly prelude: number
  readonly rules: readonly Rule.t[]
  readonly problems: readonly { line: number, message: string }[]
}

/**
 * Declares the rules of a rule file into the store — prelude first, then
 * one `rule/<digest> HAS rule: …` claim per rule (§24.1), each skipped
 * when already current.
 */
export const declareRules = (store: Store, text: string): Declaration => {
  const problems: { line: number, message: string }[] = []
  const rules: Rule.t[] = []
  const preludeLines: string[] = []
  const ruleLines: { line: string, at: number }[] = []
  text.split(/\r?\n/).forEach((line, index) => {
    if (Rule.isRuleLine(line)) {
      ruleLines.push({ line, at: index + 1 })
    } else {
      preludeLines.push(line)
    }
  })

  return store.transaction(() => {
    let prelude = 0
    const preludeText = preludeLines.join('\n')
    if (preludeText.trim() !== '') {
      const digest = Rule.digestOf(preludeText)
      const known = store.currentBelief(declarationKey(preludeSubject, preludeDigestAttribute))
      if (known === undefined || known.conf <= 0 || known.value_text !== digest) {
        const result = store.ingest(preludeText, { source: 'cave-derive' })
        problems.push(...result.problems)
        prelude = result.ids.length
        store.ingest(`${preludeSubject} HAS ${preludeDigestAttribute}: ${digest} @${provenanceContext}`)
      }
    }

    let declared = 0
    let unchanged = 0
    for (const { line, at } of ruleLines) {
      const parsed = Rule.parse(line)
      if (!parsed.ok) {
        problems.push(...parsed.problems.map(message => ({ line: at, message })))
        continue
      }
      const rule = parsed.rule
      rules.push(rule)
      const literal =
        !rule.text.includes('`') ? `\`${rule.text}\`` :
        !rule.text.includes('"') ? `"${rule.text}"` :
        undefined
      if (literal === undefined) {
        problems.push({ line: at, message: 'rule text contains both " and ` — cannot be stored as a literal' })
        continue
      }
      const known = store.currentBelief(declarationKey(ruleSubject(rule.digest), ruleAttribute))
      if (known !== undefined && known.conf > 0 && known.value_text === literal) {
        unchanged += 1
        continue
      }
      const label = rule.label === undefined ? '' : ` ; ${rule.label}`
      store.ingest(`${ruleSubject(rule.digest)} HAS ${ruleAttribute}: ${literal} @${provenanceContext}${label}`)
      declared += 1
    }
    return { declared, unchanged, prelude, rules, problems }
  })
}

export type ListedRule = {
  /** Declaration subject, conventionally `rule/<digest>`. */
  readonly subject: string
  readonly text: string
  readonly label?: string
  readonly ok: boolean
  readonly problems: readonly string[]
}

/** Current positive rules of a store, in declaration order. */
export const listRules = (store: Store): ListedRule[] =>
  store.currentBeliefs()
    .filter(row => row.verb === 'HAS' && row.attribute === ruleAttribute && row.negated === 0 && row.conf > 0 && row.value_text !== null)
    .map(row => {
      const text = Row.parseValue(row.value_text!).raw
      const parsed = Rule.parse(text)
      const label = (parsed.ok ? parsed.rule.label : undefined) ?? row.comment ?? undefined
      return {
        subject: row.subject,
        text,
        ...label === undefined ? {} : { label },
        ok: parsed.ok,
        problems: parsed.ok ? [] : parsed.problems
      }
    })

export type Retraction =
  | { readonly ok: true, readonly subjects: readonly string[], readonly derived: number }
  | { readonly ok: false, readonly error: string }

/**
 * Retracts a rule — by declaration subject, digest, or unambiguous digest
 * prefix — together with every claim it derived (§24.5): a derivation's
 * justification does not outlive its rule.
 */
export const retractRule = (store: Store, ref: string): Retraction => {
  const declarations = store.currentBeliefs().filter(row =>
    row.verb === 'HAS' && row.attribute === ruleAttribute && row.negated === 0 && row.conf > 0)
  const matches = declarations.filter(row =>
    row.subject === ref || row.subject === ruleSubject(ref) ||
    (ref.length >= 4 && row.subject.startsWith(ruleSubject(ref))))
  const subjects = [...new Set(matches.map(row => row.subject))]
  if (subjects.length === 0) {
    return { ok: false, error: `no current rule matches ${JSON.stringify(ref)}` }
  }
  if (subjects.length > 1) {
    return { ok: false, error: `${JSON.stringify(ref)} is ambiguous — matches ${subjects.join(', ')}` }
  }
  return store.transaction(() => {
    let derived = 0
    for (const declaration of matches) {
      store.insertResult({
        claims: [{ claim: { ...store.toClaim(declaration), conf: 0, raw: '', comment: 'retracted: cave derive --retract' }, line: 0 }],
        edges: [],
        registry: store.registry(),
        problems: []
      })
      const rows = store.byProvenance('run', declaration.subject)
      const latest = new Map<string, Row.t>()
      for (const row of rows) {
        const seen = latest.get(row.claim_key)
        if (seen === undefined || seen.tx < row.tx) {
          latest.set(row.claim_key, row)
        }
      }
      for (const row of latest.values()) {
        if (row.conf <= 0 || (row.verb === 'REVERSE' || row.verb === 'RENAMED-TO' ||
            (row.verb === 'IS' && row.object === 'verb'))) {
          continue
        }
        store.insertResult({
          claims: [{ claim: { ...store.toClaim(row), conf: 0, raw: '', comment: 'retracted: rule retracted' }, line: 0 }],
          edges: [],
          registry: store.registry(),
          problems: []
        })
        derived += 1
      }
    }
    return { ok: true, subjects, derived }
  })
}
