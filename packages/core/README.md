# @cavelang/core

The CAVE domain model — the dependency-free foundation every other package in
this monorepo builds on. Implements the model layer of the
[CAVE specification](../../README.md#the-specification): canonical claims (§2), metadata
semantics (§6), values/units/uncertainty (§7), claim keys and append-only
belief evolution primitives (§9).

Trajectory interpolation returns the declared endpoints exactly at clamped
range boundaries. Opposite-sign endpoints use a weighted sum to avoid an
overflowing difference between otherwise finite numbers.
If four-significant-digit display rounding would overflow, trajectory text
retains the finite unscaled value instead.
Interpolation requires exactly one range context, and that range must be
closed. An additional open range makes the trajectory ambiguous too; point
and opaque contexts do not count as additional ranges.

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
| `Value` | §7.1 | Value parsing: numbers, glued units (`30ms`), multipliers (`20B` → 2×10¹⁰), compound units (`USD/yr`), `~` approximation, calendar-valid date-likes (`2026-H2`), atoms. Raw text always preserved. |
| `Uncertainty` | §7.2 | Aleatory `+/- Δ (kσ)` semantics: σ = Δ/k, default 2σ. |
| `Confidence` | §6.3 | Epistemic `@ N%` in [0, 1]; omitted means 1. `formatExact` preserves the stored number in canonical text; `format` rounds presentation percentages to two decimals. |
| `Tag` | §6.2 | Flat `#tag` and scoped `#key:value`; flat ≡ value `undefined`. |
| `Context` | §6.1 | `@ctx` contexts and the recommended `src:`/`time:`/`loc:`/`scope:` prefixes. |
| `SourceSpan` | §9.8 | Percent-escaped `@src:<source>#Lx-Ly` formatting/parsing, decoded source identity, inclusive line ranges, and HTTP(S) links. Decoding rejects malformed percent escapes and unpaired UTF-16 surrogates; parsing returns `undefined`, and reference lists skip the invalid entry while retaining valid neighbors. Valid Unicode, including supplementary characters and embedded NUL, remains intact. Line endpoints must be positive safe integers; formatting throws and parsing returns `undefined` for out-of-range anchors rather than rounding them. Context construction captures both endpoints once, so validation, emitted anchors and diagnostics use the same values even with changing getters. Invalid programmatic endpoints that cannot be serialized retain the source-span validation diagnostic with an `[unprintable span]` description. Generated links preserve existing URL percent escapes and IPv6 host brackets while encoding raw spaces, Unicode and brackets outside the host. An unspanned HTTP(S) source retains its existing URL fragment in the link. A source fragment combined with a separate line span remains unlinked because both cannot occupy the URL fragment. An HTTP(S)-prefixed identity exposes a link only when the encoded URL parses successfully; otherwise its source identity and span remain available without `href`. |
| `Entity` | §4.1 | Name normalization (whitespace → `-`, casing preserved) and advisory checks. |
| `Verb` | §5 | Standard vocabulary, qualifier verbs, `REVERSE`, `RENAMED-TO`, lexical shape of verbs. |
| `Multiplier` | §7.1 | `T`/`B`/`M`/`K` scale factors. |
| `Uuidv7` | §9.1 | Monotonic UUIDv7 transaction ids — lexicographic order ⇒ transaction order, so `MAX(tx)` resolves current belief; `withStatePreserved` isolates synchronous speculative work. |
| `Time` | §32 | Shared UTC query-boundary and date-like range parsing, valid-time coverage, and exact trajectory interpolation helpers. Offset-less timestamps mean UTC. |

`Claim.of` captures top-level initializer fields before validation and applying
defaults. Supplied `negated` and `importance` must be booleans; only omitted
or `undefined` flags default to `false`. Supplied `contexts` and `tags` must be
arrays; omitted or `undefined` collections default to empty arrays. Changing confidence or sigma-level getters cannot replace a validated
value during the call. It retains references to the supplied subject, payload, tags and
uncertainty value; contexts are deduplicated into a new array. The returned
TypeScript model is read-only, but the factory does not deep-copy or freeze
nested objects. Keep those objects immutable after construction, and use stable
data properties for nested values: changing a numeric getter later does not
revalidate an already constructed claim. See the [store reference](../store)
for the separate capture rules at insertion boundaries.

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
  Numeric normalization must be finite, including multiplier expansion and
  both trajectory endpoints. Overflowing literals retain their text as atoms
  rather than exposing infinity to storage, queries, or JSON consumers.
  Multipliers apply to decimal text before floating-point conversion, so
  `1.001K` agrees with `1001` and tiny significands can become representable
  after scaling. Nonzero magnitudes that still round to zero remain atoms;
  authored zero and representable subnormal values remain numeric.
- **`Claim.of` validates supplied numbers** — confidence must be finite and
  within `[0, 1]`; numeric scalar/trajectory fields in metric and attribute
  payloads must be finite. Invalid programmatic values throw `RangeError`
  instead of surviving until serialization or database insertion.
- **Uncertainty is positive and finite** — `+/-` deltas, `(Nσ)` levels, and
  directly supplied σ values share `Uncertainty` validation. Unprintable invalid
  input still produces `InvalidUncertaintyError`, retaining its field and original
  value while using `[unprintable value]` in the message. `Claim.of`
  enforces the invariant for programmatic callers as well as parsed text.
  `Uncertainty.interval(mean, delta)` also validates its half-width and throws
  `InvalidUncertaintyError` for zero, negative, or nonfinite deltas. Positive
  subnormal widths remain valid; endpoint arithmetic uses JavaScript numbers.
- **Date classification uses `Time.parsePeriod`** — leap days, month lengths,
  ISO week-years, quarters, halves, and partial periods have one shared
  structural and calendar validator. Invalid date-shaped values stay atoms.
  Calendar years are four digits, `0000` through `9999`, using Gregorian leap
  rules. Years below `0100` retain their written year; they are not shifted into
  the twentieth century. A period's exclusive end can fall in year `10000`.
- **UUIDv7 monotonicity**: same-millisecond calls increment a 12-bit
  sequence in `rand_a`; a backwards clock reuses the last timestamp. Strictly
  increasing ids within a process, random `rand_b` across processes.
  Clock callbacks must return integer milliseconds in the unsigned 48-bit
  range. Invalid clocks, timestamp exhaustion and randomness failures throw
  without changing the generator's last successful ordering boundary.
  UUID validation rejects trailing line terminators, including Unicode line
  separators. Observing such malformed IDs does not advance the generator.

## Tests

```
pnpm --filter @cavelang/core test
```

Every table and example in spec §6–§7 that concerns the model layer appears
as a test case (`test/*.test.ts`).

For an independent temporal check, run `node scripts/time-boundary-oracle.mjs`
from the repository root with Python 3 available. It compares timestamp,
instant and one-second boundary results against Python `datetime`, covering
early/late four-digit years, signed offsets, fractional seconds and zoneless
UTC input. It also rejects malformed calendar, clock and offset fields and
terminal whitespace. The [recorded audit](../../benchmarks/time-boundary-oracle-review.json)
passes 5,274 assertions on each supported Node major in different process
timezones. This is an optional verification tool, not a runtime dependency or
an exhaustive proof of every temporal query.

`Verb.isVerbToken` requires the entire string to be an uppercase atom: an
uppercase letter followed by uppercase letters or hyphens. A trailing hyphen
is allowed; a terminal LF, CR, CRLF or Unicode line separator is not part of
a verb. Normal CRLF document endings remain handled by document parsing.

`Claim.sigmaOf` reads a claim's delta and numeric magnitude once before deriving
sigma. A getter-backed delta therefore uses the same magnitude for the numeric
presence check and uncertainty validation. Missing numeric uncertainty still
returns `undefined`; invalid numeric uncertainty retains its typed error.
