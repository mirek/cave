# @cavelang/core

The CAVE domain model — the dependency-free foundation every other package in
this monorepo builds on. Implements the model layer of the
[CAVE specification](../../README.md#the-specification): canonical claims (§2), metadata
semantics (§6), values/units/uncertainty (§7), claim keys and append-only
belief evolution primitives (§9).

Modules follow the `@prelude` convention — import a module as a namespace,
its principal type is `t`:

```ts
import { Claim, Key, Value, Confidence, Uuidv7 } from '@cavelang/core'

const claim: Claim.t = Claim.of({
  subject: Claim.entity('auth/middleware'),
  verb: 'USES',
  payload: Claim.relation(Claim.entity('jwt'))
})

Key.of(claim)   // '["e:auth/middleware","USES",0,"r:e:jwt",[]]'
Uuidv7.next()   // '01977b6e-…' — monotonic transaction id
```

## Modules

| Module | Spec | Purpose |
|---|---|---|
| `Claim` | §2.1, §3.1 | Canonical claim shape: subject/verb/payload/negated + metadata. Payloads: `relation`, `attribute`, `metric`. Terms: `entity`, `text` (double-quoted), `code` (backticked). |
| `Key` | §9.2 | Stable claim keys computed on the canonical form. Values excluded; contexts as a sorted set; negation included. |
| `Value` | §7.1 | Value parsing: numbers, glued units (`30ms`), multipliers (`20B` → 2×10¹⁰), compound units (`USD/yr`), `~` approximation, date-likes (`2026-H2`), atoms. Raw text always preserved. |
| `Uncertainty` | §7.2 | Aleatory `+/- Δ (kσ)` semantics: σ = Δ/k, default 2σ. |
| `Confidence` | §6.3 | Epistemic `@ N%` in [0, 1]; omitted means 1. |
| `Tag` | §6.2 | Flat `#tag` and scoped `#key:value`; flat ≡ value `undefined`. |
| `Context` | §6.1 | `@ctx` contexts and the recommended `src:`/`time:`/`loc:`/`scope:` prefixes. |
| `SourceSpan` | §9.8 | Percent-escaped `@src:<source>#Lx-Ly` formatting/parsing, decoded source identity, inclusive line ranges, and HTTP(S) links. |
| `Entity` | §4.1 | Name normalization (whitespace → `-`, casing preserved) and advisory checks. |
| `Verb` | §5 | Standard vocabulary, qualifier verbs, `REVERSE`, `RENAMED-TO`, lexical shape of verbs. |
| `Multiplier` | §7.1 | `T`/`B`/`M`/`K` scale factors. |
| `Uuidv7` | §9.1 | Monotonic UUIDv7 transaction ids — lexicographic order ⇒ transaction order, so `MAX(tx)` resolves current belief; `withStatePreserved` isolates synchronous speculative work. |
| `Time` | §32 | Date-like instant/range parsing, valid-time coverage, and exact trajectory interpolation helpers. |

## Design decisions

Decisions this package pins down where the spec leaves latitude:

- **Key format** is a JSON array string —
  `[subject, verb, negated, payloadPart, sortedContexts]` — deterministic,
  collision-free (JSON escaping), and human-readable in the database.
  `payloadPart` is `r:<object>` / `a:<attribute>` / `m` / `n`, and *every*
  term is kind-prefixed (`e:` entity, `code:`, `text:`) so the three term
  encodings occupy disjoint namespaces — even an entity literally named
  `code:<=` cannot collide with the code literal `` `<=` ``.
- **Negation is a key component for all payload kinds.** §9.2 lists it for
  relational claims; we extend it to attribute/metric claims so
  `x HAS NOT a: v` and `x HAS a: v` evolve as separate facts, mirroring the
  relational rule.
- **Metric claims key on the subject alone** (`m` payload part): `latency IS
  30ms` and `latency IS 800ms` are one fact whose value evolves, matching the
  attribute rule "the value may change over time; the key stays about the
  same property".
- **Claim classification** (relation vs metric) is the parser's job; core
  only defines the shapes. A numeric, date-like, or trajectory value after
  any verb is a metric payload; other objects are relations.
- **Comparison condition verbs** are ordinary standard verbs after
  canonicalization: `EXCEEDS`, `IS-BELOW`, `IS-AT-LEAST`, `IS-AT-MOST`,
  `EQUALS`, and `DIFFERS-FROM`. Symbolic operators remain qualifier input
  syntax and CAVE-Q filter syntax.
- **`Value.parse` never fails** — unparseable text degrades to an `atom`
  value with raw text preserved, honoring the LLM-friendliness goal (§1.6).
- **UUIDv7 monotonicity**: same-millisecond calls increment a 12-bit
  sequence in `rand_a`; a backwards clock reuses the last timestamp. Strictly
  increasing ids within a process, random `rand_b` across processes.

## Tests

```
pnpm --filter @cavelang/core test
```

Every table and example in spec §6–§7 that concerns the model layer appears
as a test case (`test/*.test.ts`).
