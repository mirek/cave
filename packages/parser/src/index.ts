/**
 * `@cavelang/parser` — CAVE text → AST (spec §3, §4, §8, §16).
 *
 * Line-oriented parser for the normative CAVE language, built on
 * `@prelude/parser` combinators. Produces pure syntax: inverse verbs,
 * continuations and `UNLESS` are resolved later by `@cavelang/canonical`
 * (spec §13.4).
 *
 * ```ts
 * import { parseDocument } from '@cavelang/parser'
 *
 * const { lines, diagnostics } = parseDocument('auth/middleware USES jwt @ 90%')
 * ```
 */

export * as Ast from './ast.ts'
export * as Line from './line.ts'
export * as Token from './token.ts'
export { parseDocument, parse } from './document.ts'
