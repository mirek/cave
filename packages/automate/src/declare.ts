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
  let winner: undefined | Row.t
  for (const row of store.currentBeliefs()) {
    if (row.subject === subject && row.verb === 'HAS' && row.attribute === attribute &&
        (winner === undefined || winner.tx < row.tx)) {
      winner = row
    }
  }
  return winner
}

const enabled = (row: undefined | Row.t): row is Row.t =>
  row !== undefined && row.conf > 0 && row.negated === 0 && row.value_text !== null

/** Current positive automation declaration rows, newest series winner per subject. */
const currentAutomationRows = (store: Store): Row.t[] => {
  const bySubject = new Map<string, Row.t>()
  for (const row of store.currentBeliefs()) {
    if (row.verb !== 'HAS' || row.attribute !== Automation.automationAttribute ||
        Automation.automationName(row.subject) === undefined) {
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
    const parsed = Automation.parse(row.subject, Row.parseValue(row.value_text!).raw)
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
    const text = Row.parseValue(row.value_text!).raw
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
  const declarations: { declaration: DeclarationLine, at: number }[] = []

  // Top-level blocks: a structural unindented line plus what follows it —
  // §25.1's rule: a declaration block with structural children is rejected
  // whole rather than silently re-attaching them to the prelude.
  const blocks: { lines: string[], at: number }[] = []
  text.split(/\r?\n/).forEach((line, index) => {
    if (isStructural(line) && indentOf(line) === 0) {
      blocks.push({ lines: [line], at: index + 1 })
    } else if (blocks.length === 0) {
      preludeLines.push(line)
    } else {
      blocks[blocks.length - 1]!.lines.push(line)
    }
  })
  for (const block of blocks) {
    const declaration = asDeclaration(block.lines[0]!)
    if (declaration === undefined) {
      preludeLines.push(...block.lines)
      continue
    }
    if (block.lines.slice(1).some(isStructural)) {
      problems.push({ line: block.at, message: 'automation declarations take no qualifier children (spec §29.1)' })
      continue
    }
    declarations.push({ declaration, at: block.at })
    preludeLines.push(...block.lines.slice(1))
  }

  return store.transaction(() => {
    let prelude = 0
    const preludeText = preludeLines.join('\n')
    if (preludeText.trim() !== '') {
      const digest = Rule.digestOf(preludeText)
      const known = store.currentBelief(bookkeepingKey(preludeSubject, preludeDigestAttribute))
      if (known === undefined || known.conf <= 0 || known.value_text !== digest) {
        const result = store.ingest(preludeText, { source: 'cave-automate' })
        problems.push(...result.problems)
        prelude = result.ids.length
        store.ingest(`${preludeSubject} HAS ${preludeDigestAttribute}: ${digest} @${provenanceContext}`)
      }
    }

    let declared = 0
    let unchanged = 0
    for (const { declaration, at } of declarations) {
      const parsed = Automation.parse(declaration.subject, declaration.body)
      if (!parsed.ok) {
        problems.push(...parsed.problems.map(message => ({ line: at, message })))
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
  const rows = store.currentBeliefs().filter(row =>
    row.subject === subject && row.verb === 'HAS' && row.attribute === Automation.automationAttribute &&
    row.negated === 0 && row.conf > 0)
  if (rows.length === 0) {
    return { ok: false, error: `no current automation matches ${JSON.stringify(ref)}` }
  }
  return store.transaction(() => {
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
