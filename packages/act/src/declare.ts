/**
 * Action lifecycle (spec §25.1) — declaring actions from a CAVE document,
 * resolving and listing what a store currently believes its actions are,
 * and retracting a declaration.
 *
 * An action file is an ordinary CAVE document: top-level
 * `action/<name> HAS action: `…`` claims are the declarations; everything
 * else — parameter docs (`action/<name>/<param> IS param`), hook
 * references (`HAS hook:`), verb declarations, comments — is prelude,
 * ingested first. Declaring is idempotent: an unchanged declaration (or
 * prelude) appends nothing.
 *
 * Unlike rules, an action's identity is its *name*: the declaration
 * evolves as one belief series per subject, and because a declaration may
 * also be appended by other surfaces (`cave add`, an agent's `cave_add`),
 * whose §9.5 stamps fork the series per actor, resolution takes the
 * newest current row across every series of the subject — latest belief
 * wins, whoever appended it.
 */

import { Claim, Key, Value } from '@cavelang/core'
import { parseDocument } from '@cavelang/parser'
import { Rule } from '@cavelang/rules'
import { Row, type Store } from '@cavelang/store'
import * as Action from './action.ts'

/** Source context stamped on declarations and bookkeeping (spec §9.5). */
export const provenanceContext = 'src:cave-act'

/** Subject of the prelude digest bookkeeping claim. */
const preludeSubject = 'act/prelude'

const preludeDigestAttribute = 'act-digest'

const declarationKey = (subject: string, attribute: string): string =>
  Key.of(Claim.of({
    subject: Claim.entity(subject),
    verb: 'HAS',
    payload: Claim.attribute(attribute, Value.parse('x')),
    contexts: [provenanceContext]
  }))

/**
 * The newest current row of `attribute` on `subject`, across every
 * belief series (§9.5 stamps make one series per appending actor).
 * @returns the winner even when it is retracted or negated — callers
 * decide whether a disabled declaration matters.
 */
export const currentAttribute = (store: Store, subject: string, attribute: string): undefined | Row.t => {
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

/** Current positive action declaration rows, newest series winner per subject. */
const currentActionRows = (store: Store): Row.t[] => {
  const bySubject = new Map<string, Row.t>()
  for (const row of store.currentBeliefs()) {
    if (row.verb !== 'HAS' || row.attribute !== Action.actionAttribute ||
        Action.actionName(row.subject) === undefined) {
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
  readonly action: Action.t
  /** The declaration row — target of effect rows' `VIA` edges (§25.2). */
  readonly row: Row.t
  /** Declaration comment — the action's description. */
  readonly description?: string
}

/**
 * Resolves one action by name (or full subject) to its current
 * declaration. @returns `undefined` when unknown, retracted, or negated;
 * problems when the stored body does not parse.
 */
export const loadAction = (store: Store, name: string): undefined | { loaded?: Loaded, problems: readonly string[] } => {
  const subject = Action.actionSubject(name)
  const row = currentAttribute(store, subject, Action.actionAttribute)
  if (!enabled(row)) {
    return undefined
  }
  const parsed = Action.parse(subject, Row.parseValue(row.value_text!).raw)
  if (!parsed.ok) {
    return { problems: parsed.problems }
  }
  return {
    loaded: {
      action: parsed.action,
      row,
      ...row.comment === null ? {} : { description: row.comment }
    },
    problems: []
  }
}

/** The hook name the action currently references, if any (§25.4). */
export const currentHook = (store: Store, subject: string): undefined | string => {
  const row = currentAttribute(store, subject, Action.hookAttribute)
  return enabled(row) ? Row.parseValue(row.value_text!).raw : undefined
}

/** Parameter doc — the comment of `action/<name>/<param> IS param` (§25.1). */
const paramDoc = (store: Store, subject: string, param: string): undefined | string => {
  let winner: undefined | Row.t
  for (const row of store.currentBeliefs()) {
    if (row.subject === `${subject}/${param}` && row.verb === 'IS' && row.object === 'param' &&
        row.negated === 0 && row.conf > 0 && (winner === undefined || winner.tx < row.tx)) {
      winner = row
    }
  }
  return winner?.comment ?? undefined
}

export type ListedParam = {
  readonly name: string
  readonly doc?: string
}

export type ListedAction = {
  /** Declaration subject, `action/<name>`. */
  readonly subject: string
  readonly name: string
  readonly text: string
  readonly description?: string
  readonly params: readonly ListedParam[]
  readonly hook?: string
  readonly ok: boolean
  readonly problems: readonly string[]
}

/** Current positive actions of a store, in declaration order. */
export const listActions = (store: Store): ListedAction[] =>
  currentActionRows(store).map(row => {
    const text = Row.parseValue(row.value_text!).raw
    const parsed = Action.parse(row.subject, text)
    const params = parsed.ok ?
      parsed.action.params.map(name => {
        const doc = paramDoc(store, row.subject, name)
        return { name, ...doc === undefined ? {} : { doc } }
      }) :
      []
    const hook = currentHook(store, row.subject)
    return {
      subject: row.subject,
      name: Action.actionName(row.subject)!,
      text,
      ...row.comment === null ? {} : { description: row.comment },
      params,
      ...hook === undefined ? {} : { hook },
      ok: parsed.ok,
      problems: parsed.ok ? [] : parsed.problems
    }
  })

export type Declaration = {
  /** Actions newly declared (or re-declared after a change/retraction). */
  readonly declared: number
  /** Actions whose declaration is already current — nothing appended. */
  readonly unchanged: number
  /** Claims appended by the file's prelude (0 when unchanged). */
  readonly prelude: number
  readonly actions: readonly Action.t[]
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
 * Reads one top-level line as an action declaration claim —
 * `action/<name> HAS action: `…``. @returns `undefined` when the line is
 * anything else (prelude).
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
      claim.payload.attribute !== Action.actionAttribute ||
      claim.subject.kind !== 'entity' || Action.actionName(claim.subject.text) === undefined) {
    return undefined
  }
  return {
    subject: claim.subject.text,
    body: claim.payload.value.raw,
    ...claim.meta.comment === undefined ? {} : { comment: claim.meta.comment }
  }
}

/**
 * Declares the actions of a CAVE document into the store — prelude
 * first, then one normalized `action/<name> HAS action: …` claim per
 * declaration (§25.1), each skipped when already current. Declarations
 * re-emit in the normalized form; metadata beyond the description
 * comment is not preserved — append exotic declarations with `cave add`.
 */
export const declareActions = (store: Store, text: string): Declaration => {
  const problems: { line: number, message: string }[] = []
  const actions: Action.t[] = []
  const preludeLines: string[] = []
  const declarations: { declaration: DeclarationLine, at: number }[] = []

  // Top-level blocks: a structural unindented line plus what follows it.
  // A declaration's structural children would silently re-attach to the
  // preceding prelude line if the declaration were extracted alone, so a
  // declaration block with children is rejected whole.
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
      problems.push({ line: block.at, message: 'action declarations take no qualifier children (spec §25.1)' })
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
      const known = store.currentBelief(declarationKey(preludeSubject, preludeDigestAttribute))
      if (known === undefined || known.conf <= 0 || known.value_text !== digest) {
        const result = store.ingest(preludeText, { source: 'cave-act' })
        problems.push(...result.problems)
        prelude = result.ids.length
        store.ingest(`${preludeSubject} HAS ${preludeDigestAttribute}: ${digest} @${provenanceContext}`)
      }
    }

    let declared = 0
    let unchanged = 0
    for (const { declaration, at } of declarations) {
      const parsed = Action.parse(declaration.subject, declaration.body)
      if (!parsed.ok) {
        problems.push(...parsed.problems.map(message => ({ line: at, message })))
        continue
      }
      const action = parsed.action
      actions.push(action)
      const literal =
        !action.text.includes('`') ? `\`${action.text}\`` :
        !action.text.includes('"') ? `"${action.text}"` :
        undefined
      if (literal === undefined) {
        problems.push({ line: at, message: 'action body contains both " and ` — cannot be stored as a literal' })
        continue
      }
      const known = currentAttribute(store, action.subject, Action.actionAttribute)
      if (enabled(known) && known.value_text === literal &&
          (known.comment ?? undefined) === declaration.comment) {
        unchanged += 1
        continue
      }
      const description = declaration.comment === undefined ? '' : ` ; ${declaration.comment}`
      store.ingest(`${action.subject} HAS ${Action.actionAttribute}: ${literal} @${provenanceContext}${description}`)
      declared += 1
    }
    return { declared, unchanged, prelude, actions, problems }
  })
}

export type Retraction =
  | { readonly ok: true, readonly subject: string, readonly retracted: number }
  | { readonly ok: false, readonly error: string }

/**
 * Retracts an action's declaration — by name or subject — disabling it.
 * Every current positive series of the declaration is retracted (§9.5
 * stamps fork one per appending actor). Effects of past executions are
 * recorded knowledge and stay untouched (spec §25.1; contrast §24.5).
 */
export const retractAction = (store: Store, ref: string): Retraction => {
  const subject = Action.actionSubject(ref)
  const rows = store.currentBeliefs().filter(row =>
    row.subject === subject && row.verb === 'HAS' && row.attribute === Action.actionAttribute &&
    row.negated === 0 && row.conf > 0)
  if (rows.length === 0) {
    return { ok: false, error: `no current action matches ${JSON.stringify(ref)}` }
  }
  return store.transaction(() => {
    for (const row of rows) {
      store.insertResult({
        claims: [{ claim: { ...store.toClaim(row), conf: 0, raw: '', comment: 'retracted: cave act --retract' }, line: 0 }],
        edges: [],
        registry: store.registry(),
        problems: []
      })
    }
    return { ok: true, subject, retracted: rows.length }
  })
}
