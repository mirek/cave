# CAVE — Implementation

A pnpm TypeScript monorepo implementing the [CAVE v3 specification](README.md).
Functional style throughout (immutable values, namespace modules in the
`@prelude` convention, no classes), built bottom-up — each package fully
documented and tested before the next one starts.

## Packages

Dependency order, bottom to top:

| Package | Spec | Purpose |
|---|---|---|
| [`@cave/core`](packages/core) | §2, §6, §7, §9 | Domain model: claims, values/units/multipliers, uncertainty, confidence, tags, contexts, claim keys, monotonic UUIDv7 |
| [`@cave/parser`](packages/parser) | §3, §4, §8, §16 | CAVE text → AST on [`@prelude/parser`](https://www.npmjs.com/package/@prelude/parser) combinators; never throws, lints |
| [`@cave/canonical`](packages/canonical) | §5, §8, §13.4 | Verb registry (`REVERSE`, extensions), inverse resolution, continuation expansion, qualifier edges, canonical emitter |
| [`@cave/store`](packages/store) | §13 | Persistence on the **Node.js builtin `node:sqlite`** — exact spec schema, append-only belief series, inverse-aware reads, FTS5 |
| [`@cave/query`](packages/query) | §12 | CAVE-Q patterns compiled to SQL: variables, wildcards, inverse verbs, `VERB+` transitive CTEs, `WHERE` filters |
| [`@cave/fusion`](packages/fusion) | §10 | Bayesian fusion, noisy-AND, hypothesis helpers — pure math |
| [`@cave/loop`](packages/loop) | §18 | cave-loop: injectable store/policy, heuristic policy, LLM sketch, multi-hop recovery demo |
| [`@cave/cli`](packages/cli) | — | `cave parse / add / query / export / demo` |

## Toolchain

- **No build step.** Node ≥ 22.18 runs `.ts` directly (type stripping);
  workspace packages export `./src/index.ts` and resolve through pnpm
  symlinks. `tsc --noEmit` (strict, `erasableSyntaxOnly`) typechecks.
- **Builtin test runner** — `node --test`, zero test dependencies.
- **SQLite is `node:sqlite`** — no native modules. (The original request
  said "builtin mssql"; Node has no builtin MSSQL driver and the spec's
  storage model is SQLite/FTS5, so `node:sqlite` is the interpretation.)
- External runtime dependency: `@prelude/parser` (plus its radix-trie),
  used by the tokenizer.

```sh
pnpm install
pnpm test          # all packages, bottom-up
pnpm typecheck
pnpm --filter @cave/loop demo
```

## Cross-package design decisions

Package READMEs document local decisions; these are the global ones:

- **Claim keys** are JSON arrays of `[subject, verb, negated, payloadPart,
  sortedContexts]` — readable in the DB, collision-free, computed on the
  canonical (primary-direction) form so forward and inverse writes share a
  belief series (§5.5, §9.2).
- **Payload classification**: `attr: value` → attribute; numeric/date
  value → metric; nothing (`EXISTS`) → none; otherwise relation. The
  object-less `none` payload is an extension the grammar needs for bare
  existence claims.
- **Qualifier conditions are claims** (§8.1): bare entities become
  `x EXISTS`, comparisons become `left EXCEEDS value` (metric payload),
  `UNLESS` becomes `WHEN` + negation. Grouped full claims link with the
  `QUALIFIES` edge role from §13.2's role list.
- **Terms are stored formatted** (literals keep their delimiters) so
  `` `<=` `` the code literal never collides with an entity spelled the
  same, while entity queries from §13.5 work verbatim.
- **Traversal defaults**: graph reads (store, query, loop) skip negated
  and `@ 0%` rows; contradictions still coexist as data (§9.4).
- **The standard prelude is opt-out, not baked in**: no verb is born with
  an inverse (§5.5), but `@cave/store` and the CLI default to the shared
  §5.5 prelude registry (`--no-prelude` / `Registry.empty` to opt out).

## Status vs the spec

- **Normative v3**: implemented, including legacy v0.1 acceptance
  (colonless attributes parse, emitters always produce the colon form).
- **Draft layer (§17)** — variables in core grammar, reification `[S V O]`,
  rules `=>`, temporal values: *not implemented*, as speced ("commitment is
  gated on the parser implementation"). CAVE-Q's `?x` layer (§12) is
  implemented.
- **Non-normative agent layer (§18)**: implemented as `@cave/loop`.
