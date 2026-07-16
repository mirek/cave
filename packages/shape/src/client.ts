/** Deterministic TypeScript client generation from §20 EXPECTS claims (spec §20.4). */

import { createHash } from 'node:crypto'
import { Registry } from '@cavelang/canonical'
import type { Store } from '@cavelang/store'
import { expectations } from './check.ts'
import type { Expectation } from './check.ts'

export const clientFormatVersion = 1 as const

export type ClientField = {
  readonly type: string
  readonly typeName: string
  readonly kind: 'attribute' | 'relation'
  readonly name: string
  readonly cardinality: 'some' | 'one'
  readonly unit?: string
  /** Physical verb used by store traversal. */
  readonly primary?: string
  /** Whether the authored relation reads from the physical object side. */
  readonly inverse?: boolean
}

export type GeneratedClient = {
  readonly ok: true
  readonly version: typeof clientFormatVersion
  readonly digest: string
  readonly fields: readonly ClientField[]
  readonly code: string
}

export type ClientGenerationFailure = {
  readonly ok: false
  readonly problems: readonly string[]
}

export type ClientGeneration = GeneratedClient | ClientGenerationFailure

const identifierOf = (type: string): undefined | string => {
  const words = type.split(/[^A-Za-z0-9]+/).filter(Boolean)
  if (words.length === 0) {
    return undefined
  }
  const name = words.map(word => word[0]!.toUpperCase() + word.slice(1)).join('')
  return /^[0-9]/.test(name) ? `_${name}` : name
}

const compare = (a: string, b: string): number => a < b ? -1 : a > b ? 1 : 0

const tagsOf = (store: Store, expectation: Expectation): { key: string, value: null | string }[] =>
  store.db.prepare('SELECT key, value FROM cave_tag WHERE claim_id = ? ORDER BY rowid')
    .all(expectation.row.id) as { key: string, value: null | string }[]

const normalizedFields = (store: Store): { fields: ClientField[], problems: string[] } => {
  const problems: string[] = []
  const typeNames = new Map<string, string>()
  const fields = new Map<string, ClientField>()
  const declarations = [...expectations(store)].sort((a, b) =>
    compare(a.type, b.type) || compare(a.kind, b.kind) || compare(a.name, b.name) ||
    compare(a.row.claim_key, b.row.claim_key))

  for (const expectation of declarations) {
    const typeName = identifierOf(expectation.type)
    if (typeName === undefined) {
      problems.push(`${expectation.type} cannot become a TypeScript type name`)
      continue
    }
    const priorType = typeNames.get(typeName)
    if (priorType !== undefined && priorType !== expectation.type) {
      problems.push(`types ${JSON.stringify(priorType)} and ${JSON.stringify(expectation.type)} both generate ${typeName}`)
      continue
    }
    typeNames.set(typeName, expectation.type)

    const tags = tagsOf(store, expectation)
    const cardinalities = tags.filter(tag => tag.key === 'cardinality').map(tag => tag.value)
    const units = tags.filter(tag => tag.key === 'unit').map(tag => tag.value)
    if (cardinalities.length > 1 || cardinalities.some(value => value !== 'one' && value !== 'some')) {
      problems.push(`${expectation.type} EXPECTS ${expectation.name}: cardinality must be one or some, at most once`)
      continue
    }
    if (units.length > 1 || units.some(value => value === null || value === '')) {
      problems.push(`${expectation.type} EXPECTS ${expectation.name}: unit must have one non-empty value`)
      continue
    }
    if (expectation.kind === 'relation' && units.length > 0) {
      problems.push(`${expectation.type} EXPECTS ${expectation.name}: relation expectations cannot declare #unit`)
      continue
    }

    const relation = expectation.kind === 'relation' ?
      Registry.primaryOf(store.registry(), expectation.name) : undefined
    const field: ClientField = {
      type: expectation.type,
      typeName,
      kind: expectation.kind,
      name: expectation.name,
      cardinality: cardinalities[0] === 'one' ? 'one' : 'some',
      ...units[0] === undefined || units[0] === null ? {} : { unit: units[0] },
      ...relation === undefined ? {} : { primary: relation.primary, inverse: relation.isInverse }
    }
    const key = `${field.type}\0${field.kind}\0${field.name}`
    const prior = fields.get(key)
    if (prior !== undefined && JSON.stringify(prior) !== JSON.stringify(field)) {
      problems.push(`${expectation.type} EXPECTS ${expectation.name}: conflicting current declarations`)
      continue
    }
    fields.set(key, field)
  }
  return { fields: [...fields.values()], problems: [...new Set(problems)].sort() }
}

const q = (text: string): string => JSON.stringify(text)

const valueType = (field: ClientField): string =>
  `CaveValue<${field.unit === undefined ? 'undefined' : q(field.unit)}>`

const propertyType = (field: ClientField): string => {
  const value = field.kind === 'attribute' ? valueType(field) : 'string'
  return field.cardinality === 'one' ? value : `readonly ${value}[]`
}

const expression = (field: ClientField): string => {
  const values = field.kind === 'attribute' ?
    `attributeValues<${field.unit === undefined ? 'undefined' : q(field.unit)}>(store, entity, ${q(field.name)}, ` +
      `${field.unit === undefined ? 'undefined' : q(field.unit)})` :
    `relationValues(store, entity, ${q(field.primary!)}, ${field.inverse === true})`
  return field.cardinality === 'one' ?
    `one(${values}, ${q(`${field.type}.${field.name}`)})` : values
}

const emit = (fields: readonly ClientField[], digest: string): string => {
  const groups = new Map<string, ClientField[]>()
  for (const field of fields) {
    groups.set(field.type, [...groups.get(field.type) ?? [], field])
  }
  const types = [...groups.entries()].sort(([a], [b]) => compare(a, b))
  const declarations = types.flatMap(([type, typeFields]) => {
    const typeName = typeFields[0]!.typeName
    return [
      `export interface ${typeName} {`,
      ...typeFields.map(field => `  readonly ${q(field.name)}: ${propertyType(field)}`),
      '}',
      '',
      `export const read${typeName} = (store: Store, entity: string): ${typeName} => ({`,
      ...typeFields.map(field => `  ${q(field.name)}: ${expression(field)},`),
      '})',
      ''
    ]
  })
  return [
    `// Generated by CAVE typed-client/v${clientFormatVersion}; do not edit.`,
    `// Schema SHA-256: ${digest}`,
    `import type { Store } from '@cavelang/store'`,
    '',
    `export const caveClientFormatVersion = ${clientFormatVersion} as const`,
    `export const caveSchemaDigest = ${q(digest)} as const`,
    `export const caveSchema = ${JSON.stringify(fields, undefined, 2)} as const`,
    '',
    'export type CaveValue<Unit extends string | undefined = undefined> = {',
    '  readonly text: string',
    '  readonly number: number | null',
    '  readonly unit: Unit extends string ? Unit : string | null',
    '}',
    '',
    'const currentSql = `',
    'SELECT c.* FROM cave_claim c',
    'JOIN (SELECT claim_key, MAX(tx) AS max_tx FROM cave_claim GROUP BY claim_key) latest',
    '  ON c.claim_key = latest.claim_key AND c.tx = latest.max_tx',
    '`',
    '',
    'const attributeValues = <Unit extends string | undefined>(',
    '  store: Store, entity: string, attribute: string, expectedUnit: Unit',
    '): CaveValue<Unit>[] => {',
    '  const values = store.db.prepare(`',
    '  SELECT c.value_text AS text, c.value_num AS number, c.value_unit AS unit',
    '  FROM (${currentSql}) c',
    "  WHERE c.subject = ? AND c.verb = 'HAS' AND c.attribute = ?",
    '    AND c.negated = 0 AND c.conf > 0 ORDER BY c.tx',
    '  `).all(entity, attribute) as unknown as CaveValue<Unit>[]',
    '  if (expectedUnit !== undefined && values.some(value => value.unit !== expectedUnit)) {',
    '    throw new Error(`CAVE generated client: ${entity}.${attribute} expected unit ${expectedUnit}`)',
    '  }',
    '  return values',
    '}',
    '',
    'const relationValues = (store: Store, entity: string, primary: string, inverse: boolean): string[] =>',
    '  inverse ?',
    '    store.reverse(entity).filter(fact => fact.verb === primary).map(fact => fact.source) :',
    '    store.forward(entity).filter(fact => fact.verb === primary).map(fact => fact.target)',
    '',
    'const one = <T>(values: readonly T[], field: string): T => {',
    '  if (values.length !== 1) {',
    '    throw new Error(`CAVE generated client: ${field} expected exactly one value, got ${values.length}`)',
    '  }',
    '  return values[0]!',
    '}',
    '',
    ...declarations
  ].join('\n')
}

export const generateClient = (
  store: Store,
  options: { version?: number } = {}
): ClientGeneration => {
  const version = options.version ?? clientFormatVersion
  if (version !== clientFormatVersion) {
    return { ok: false, problems: [`unsupported typed-client format version ${version}; supported: ${clientFormatVersion}`] }
  }
  const normalized = normalizedFields(store)
  if (normalized.problems.length > 0) {
    return { ok: false, problems: normalized.problems }
  }
  const schema = JSON.stringify({ version, fields: normalized.fields })
  const digest = createHash('sha256').update(schema).digest('hex')
  return {
    ok: true,
    version: clientFormatVersion,
    digest,
    fields: normalized.fields,
    code: emit(normalized.fields, digest)
  }
}
