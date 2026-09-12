/**
 * Automation lifecycle (spec §29.1) — declaring automations from a CAVE
 * document, resolving and listing what a store currently believes its
 * automations are, and retracting a declaration. The exact §25.1 moves:
 * name identity, one evolving declaration series per subject, resolution
 * by the newest current row across actor series.
 *
 * An automation file is an ordinary CAVE document: top-level
 * `automation/<name> HAS automation: `…`` claims are the declarations;
 * everything else — verb declarations the triggers need, comments — is
 * prelude, ingested first. Declaring is idempotent: an unchanged
 * declaration (or prelude) appends nothing.
 */

import { Claim, Key, Value } from '@cavelang/core'
import { canonicalizeText } from '@cavelang/canonical'
import { parseDocument } from '@cavelang/parser'
import { Rule } from '@cavelang/rules'
import { Row, type Store } from '@cavelang/store'
import * as Automation from './automation.ts'

/** Source context stamped on declarations and bookkeeping (spec §9.5, §29.2). */
export const provenanceContext = 'src:cave-automate'

/** Subject of the prelude digest bookkeeping claim. */
const preludeSubject = 'automate/prelude'

const preludeDigestAttribute = 'automate-digest'

/** Claim key of a `subject HAS <attribute>: … @src:cave-automate` bookkeeping claim. */
export const bookkeepingKey = (subject: string, attribute: string): string =>
  Key.of(Claim.of({
    subject: Claim.entity(subject),
    verb: 'HAS',
    payload: Claim.attribute(attribute, Value.parse('x')),
    contexts: [provenanceContext]
  }))

/**
 * The newest current row of `attribute` on `subject`, across every
 * belief series (§9.5 stamps make one series per appending actor —
 * §25.1's resolution rule).
 */
const currentAttribute = (store: Store, subject: string, attribute: string): undefined | Row.t => {
  // The newest row across all series is also current in its own series.
  // Disabled rows still win: filtering them would revive older declarations.
  return store.db.prepare(`SELECT * FROM cave_claim
    WHERE subject = ? AND verb = 'HAS' AND attribute = ?
    ORDER BY tx DESC LIMIT 1`).get(subject, attribute) as unknown as undefined | Row.t
}

const enabled = (row: undefined | Row.t): row is Row.t =>
  row !== undefined && row.conf > 0 && row.negated === 0 && row.value_text !== null

/** Decode enabled declaration text without leaking parser-internal type errors. */
const storedText = (row: Row.t): string => {
  if (typeof row.value_text !== 'string') {
    throw new TypeError(`stored automation field ${JSON.stringify(row.attribute)} value_text must be text (claim ${JSON.stringify(row.id)})`)
  }
  return Row.parseValue(row.value_text).raw
}

/** Current declaration series, including disabled rows needed for winner selection. */
const declarationRows = (store: Store, subject?: string): Row.t[] =>
  store.db.prepare(`SELECT c.* FROM cave_claim c
    WHERE c.verb = 'HAS' AND c.attribute = ?${subject === undefined ? '' : ' AND c.subject = ?'}
      AND c.tx = (SELECT MAX(latest.tx) FROM cave_claim latest WHERE latest.claim_key = c.claim_key)
    ORDER BY c.tx`).all(Automation.automationAttribute, ...subject === undefined ? [] : [subject]) as unknown as Row.t[]

/** Current positive automation declaration rows, newest series winner per subject. */
const currentAutomationRows = (store: Store): Row.t[] => {
  const bySubject = new Map<string, Row.t>()
  for (const row of declarationRows(store)) {
    if (Automation.automationName(row.subject) === undefined) {
      continue
    }
    const seen = bySubject.get(row.subject)
    if (seen === undefined || seen.tx < row.tx) {
      bySubject.set(row.subject, row)
    }
  }
  return [...bySubject.values()].filter(enabled)
}

export type Loaded = {
  readonly automation: Automation.t
  /** The declaration row — its tx is the arming point (spec §29.2). */
  readonly row: Row.t
  /** Declaration comment — the automation's description. */
  readonly description?: string
}

export type LoadProblem = {
  readonly subject: string
  readonly problems: readonly string[]
}

/**
 * Loads every current positive automation declaration, parsing each body;
 * declarations that fail to parse are reported and skipped (spec §29.1).
 */
export const loadAutomations = (store: Store): { loaded: Loaded[], problems: LoadProblem[] } => {
  const loaded: Loaded[] = []
  const problems: LoadProblem[] = []
  for (const row of currentAutomationRows(store)) {
    const parsed = Automation.parse(row.subject, storedText(row))
    if (!parsed.ok) {
      problems.push({ subject: row.subject, problems: parsed.problems })
      continue
    }
    loaded.push({
      automation: parsed.automation,
      row,
      ...row.comment === null ? {} : { description: row.comment }
    })
  }
  return { loaded, problems }
}

export type ListedAutomation = {
  /** Declaration subject, `automation/<name>`. */
  readonly subject: string
  readonly name: string
  readonly text: string
  readonly description?: string
  readonly ok: boolean
  readonly problems: readonly string[]
}

/** Current positive automations of a store, in declaration order. */
export const listAutomations = (store: Store): ListedAutomation[] =>
  currentAutomationRows(store).map(row => {
    const text = storedText(row)
    const parsed = Automation.parse(row.subject, text)
    return {
      subject: row.subject,
      name: Automation.automationName(row.subject)!,
      text,
      ...row.comment === null ? {} : { description: row.comment },
      ok: parsed.ok,
      problems: parsed.ok ? [] : parsed.problems
    }
  })

export type Declaration = {
  /** Automations newly declared (or re-declared after a change/retraction). */
  readonly declared: number
  /** Automations whose declaration is already current — nothing appended. */
  readonly unchanged: number
  /** Claims appended by the file's prelude (0 when unchanged). */
  readonly prelude: number
  readonly automations: readonly Automation.t[]
  readonly problems: readonly { line: number, message: string }[]
}

const indentOf = (line: string): number =>
  line.length - line.trimStart().length

const isStructural = (line: string): boolean => {
  const body = line.trim()
  return body !== '' && !body.startsWith(';')
}

type DeclarationLine = {
  readonly subject: string
  readonly body: string
  readonly comment?: string
}

/**
 * Reads one top-level line as an automation declaration claim —
 * `automation/<name> HAS automation: `…``. @returns `undefined` when the
 * line is anything else (prelude).
 */
const asDeclaration = (line: string): undefined | DeclarationLine => {
  const document = parseDocument(line)
  if (document.diagnostics.length > 0) {
    return undefined
  }
  const entry = document.lines.find(candidate => candidate.kind === 'claim')
  if (entry === undefined || entry.kind !== 'claim') {
    return undefined
  }
  const claim = entry.claim
  if (claim.verb !== 'HAS' || claim.negated || claim.payload.kind !== 'attribute' ||
      claim.payload.attribute !== Automation.automationAttribute ||
      claim.subject.kind !== 'entity' || Automation.automationName(claim.subject.text) === undefined) {
    return undefined
  }
  return {
    subject: claim.subject.text,
    body: claim.payload.value.raw,
    ...claim.meta.comment === undefined ? {} : { comment: claim.meta.comment }
  }
}

/**
 * Declares the automations of a CAVE document into the store — prelude
 * first, then one normalized `automation/<name> HAS automation: …` claim
 * per declaration (§29.1), each skipped when already current.
 */
export const declareAutomations = (store: Store, text: string): Declaration => {
  const problems: { line: number, message: string }[] = []
  const automations: Automation.t[] = []
  const preludeLines: string[] = []
  const preludeSourceLines: number[] = []
  const addPrelude = (lines: readonly string[], at: number): void => {
    lines.forEach((line, index) => {
      preludeLines.push(line)
      preludeSourceLines.push(at + index)
    })
  }
  const declarations: { declaration: DeclarationLine, at: number }[] = []

  // Top-level blocks: a structural unindented line plus what follows it —
  // §25.1's rule: a declaration block with structural children is rejected
  // whole rather than silently re-attaching them to the prelude.
  const blocks: { lines: string[], at: number }[] = []
  text.split(/\r?\n/).forEach((line, index) => {
    if (isStructural(line) && indentOf(line) === 0) {
      blocks.push({ lines: [line], at: index + 1 })
    } else if (blocks.length === 0) {
      addPrelude([line], index + 1)
    } else {
      blocks[blocks.length - 1]!.lines.push(line)
    }
  })
  for (const block of blocks) {
    const declaration = asDeclaration(block.lines[0]!)
    if (declaration === undefined) {
      addPrelude(block.lines, block.at)
      continue
    }
    if (block.lines.slice(1).some(isStructural)) {
      problems.push({ line: block.at, message: 'automation declarations take no qualifier children (spec §29.1)' })
      continue
    }
    declarations.push({ declaration, at: block.at })
    addPrelude(block.lines.slice(1), block.at + 1)
  }

  return store.transaction(() => {
    store.registry()
    let prelude = 0
    const preludeText = preludeLines.join('\n')
    if (preludeText.trim() !== '') {
      // Validate even cached input: older versions cached failed preludes too.
      const canonical = canonicalizeText(preludeText, store.registry())
      if (canonical.problems.length > 0) {
        for (const problem of canonical.problems) problems.push({
          ...problem, line: preludeSourceLines[problem.line - 1] ?? problem.line
        })
        return { declared: 0, unchanged: 0, prelude: 0, automations, problems }
      }
      const digest = Rule.digestOf(preludeText)
      const known = store.currentBelief(bookkeepingKey(preludeSubject, preludeDigestAttribute))
      if (known === undefined || known.conf <= 0 || known.value_text !== digest) {
        const result = store.insertResult(canonical, { source: 'cave-automate' })
        prelude = result.ids.length
        store.ingest(`${preludeSubject} HAS ${preludeDigestAttribute}: ${digest} @${provenanceContext}`)
      }
    }

    let declared = 0
    let unchanged = 0
    for (const { declaration, at } of declarations) {
      const parsed = Automation.parse(declaration.subject, declaration.body)
      if (!parsed.ok) {
        for (const message of parsed.problems) problems.push({ line: at, message })
        continue
      }
      const automation = parsed.automation
      automations.push(automation)
      const literal =
        !automation.text.includes('`') ? `\`${automation.text}\`` :
        !automation.text.includes('"') ? `"${automation.text}"` :
        undefined
      if (literal === undefined) {
        problems.push({ line: at, message: 'automation body contains both " and ` — cannot be stored as a literal' })
        continue
      }
      const known = currentAttribute(store, automation.subject, Automation.automationAttribute)
      if (enabled(known) && known.value_text === literal &&
          (known.comment ?? undefined) === declaration.comment) {
        unchanged += 1
        continue
      }
      const description = declaration.comment === undefined ? '' : ` ; ${declaration.comment}`
      store.ingest(`${automation.subject} HAS ${Automation.automationAttribute}: ${literal} @${provenanceContext}${description}`)
      declared += 1
    }
    return { declared, unchanged, prelude, automations, problems }
  })
}

export type Retraction =
  | { readonly ok: true, readonly subject: string, readonly retracted: number }
  | { readonly ok: false, readonly error: string }

/**
 * Retracts an automation's declaration — by name or subject — disabling
 * it. Every current positive series of the declaration is retracted (§9.5
 * stamps fork one per appending actor). What past firings recorded stays
 * recorded (spec §25.1's rule; contrast §24.5).
 */
export const retractAutomation = (store: Store, ref: string): Retraction => {
  const subject = Automation.automationSubject(ref)
  return store.transaction(() => {
    const rows = declarationRows(store, subject).filter(row => row.negated === 0 && row.conf > 0)
    if (rows.length === 0) {
      return { ok: false, error: `no current automation matches ${JSON.stringify(ref)}` }
    }
    for (const row of rows) {
      store.insertResult({
        claims: [{ claim: { ...store.toClaim(row), conf: 0, raw: '', comment: 'retracted: cave automate --retract' }, line: 0 }],
        edges: [],
        registry: store.registry(),
        problems: []
      })
    }
    return { ok: true, subject, retracted: rows.length }
  })
}
