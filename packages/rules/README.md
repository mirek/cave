# @cavelang/rules

The CAVE rules engine (spec §24): forward-chaining `premises =>
conclusion` rules over current beliefs — CAVE's transform layer, with
derivation lineage and incrementality falling out of the storage model.
This is the Draft §17.4 grammar proven out and committed.

```cave
?x NEEDS ?y, ?y NEEDS ?z => ?x NEEDS ?z
?x HAS age: ?a, ?a < 18 => ?x NEEDS guardian
?x PRECEDES ?event, ?x CONTAINS ?change => ?change CAUSE ?event @ 50%
```

Premises are ordinary CAVE-Q patterns (§12.1) — inverse verbs,
transitive `VERB+` hops, `NOT`, `@ctx`/`#tag` filters all work — plus
`?var op value` constraints. The conclusion is an ordinary claim line;
its `@ N%` is the rule's confidence factor.

```ts
import { declareRules, derive } from '@cavelang/cli/rules'

declareRules(store, '?x NEEDS ?y, ?y NEEDS ?z => ?x NEEDS ?z')
derive(store)
// → appends `a NEEDS c @src:rule/4a0bb974f43c @ 72.00000000000001%`, linked BECAUSE to
//   the two premise rows and VIA to the rule's declaration row
```

`derive` accepts `minConf` as a finite confidence in 0..1 (default 0.05)
and `maxPasses` as a positive safe integer (default 20). Only omission selects
the defaults; explicit null is invalid. Supplied `full`, `dryRun` and `aliases`
must be booleans. Omission means false; string flags such as `"true"` fail
instead of silently selecting a write or matching mode. Each call captures these
validated limits and its full, dry-run and alias options before entering the
write transaction. Getter-backed options cannot substitute a different threshold
or pass limit after validation. A later call captures its own settings.
Invalid values throw before opening the derivation transaction, leaving conclusions and watermarks
untouched. The CLI applies the same bounds to `--min-conf` and `--max-passes`;
confidence also accepts percentage notation there.

Derived confidence retains the noisy-AND floating-point result through the
confidence floor and canonical emission. It is not rounded for display before
storage, and even small representable confidence revisions update the conclusion.
For example, `0.8 * 0.9` is stored as `0.7200000000000001`; ordinary floating-point
rounding and underflow still apply to multiplication. Persisted evaluation
fingerprints use version `v3`, so stores with older rounded-confidence watermarks
re-evaluate on the next `derive` call even without new matching premises.
With `minConf: 0`, a zero-confidence conclusion is eligible, including a result
that underflows to zero. Re-evaluation recognizes an identical stored zero as
unchanged, so even a conclusion matching its premise pattern settles without
duplicate retraction rows. A later positive result can reactivate that same
rule-owned belief series; ordinary positive premise filtering is unchanged.

Or from the CLI:

```sh
cave derive --db k.db rules.cave     # declare the file's rules, then fire
cave derive --db k.db                # fire what the store already knows
cave derive --db k.db --list
cave derive --db k.db --retract 4a0bb974f43c
```

Retraction selects current declarations and checks digest-prefix ambiguity
inside its write transaction, then retracts all matching declaration contexts
and their derived claims. A declaration committed before the reservation
cannot be missed; an ambiguous prefix leaves every rule untouched.
Listing and retraction share derivation's indexed declaration lookup, preserving
the order of current declaration versions without loading unrelated beliefs.

Listing and derivation reject an enabled rule whose stored `value_text` is not
text with a `TypeError` identifying the field and claim ID. This storage failure
is distinct from a textual rule that fails parsing and is reported as a rule
problem. Failed derivation rolls back its transaction, preserving earlier
conclusions, lineage and watermarks. After repairing the stored body, a fresh
derivation can process pending premises without duplicating earlier conclusions.

Declaration calls validate the whole prelude before using its digest cache,
including digests stored by older versions. Prelude diagnostics retain original
file line numbers even when rule lines precede them, for LF and CRLF input.
Diagnostics append iteratively; large invalid preludes return their problems
without exceeding JavaScript's function-argument limit. Input and diagnostics
still reside in memory.
An invalid prelude appends nothing
and declares no rules; corrected input can be retried, and successful unchanged
preludes remain idempotent. With a valid prelude, invalid rule bodies are
reported while other valid rules are declared. `cave derive` exits nonzero for
declaration errors in text and JSON modes; it still derives already-stored rules.
Derivation text appends notes and per-rule problems iteratively, so large
duplicate-declaration sets retain their diagnostics without exceeding
JavaScript's function-argument limit. Equivalent declarations still execute
as one rule; notes and output remain in memory.
Correcting a rejected rule body declares only the missing rule: the successful
prelude and previously accepted rules remain idempotent. Rejecting a later
prelude preserves the complete prior history, including conclusions and
watermarks. After repair, newly declared rules can derive alongside settled
ones without duplicating those earlier conclusions.

## Replacing a rule atomically

Changing a rule body changes its digest. Declaring the edited text adds a rule;
it does not retire the previous body. To replace one rule and reconcile its
conclusions as a single operation, use a synchronous caller transaction:

```ts
store.transaction(() => {
  const removed = retractRule(store, oldDigest)
  if (!removed.ok) throw new Error('Old rule not found or reference ambiguous')

  const replacement = declareRules(store, replacementText)
  if (replacement.rules.length !== 1 || replacement.problems.length > 0) {
    throw new Error('Exactly one valid replacement rule is required')
  }
  const result = derive(store)
  if (!result.complete || result.problems.length > 0) {
    throw new Error('Replacement derivation did not complete successfully')
  }
})
```

Use the declaration and derivation reports as checks: reported problems do not
automatically throw. Let failures escape the transaction callback so the old
rule, conclusions and watermarks are restored. After correcting the replacement,
retry the transaction. Successful replacement retains historical rows and
lineage while retiring the old current conclusions. Separate CLI commands are
separate transactions; they do not provide this combined rollback boundary.

## What firing means (§24.2–§24.5)

- **Rules are in-band claims** — `rule/<digest> HAS rule: `…``, digest =
  SHA-256/12 of the normalized text — so declaring, listing, retracting
  and *pointing lineage at* rules is ordinary belief evolution.
- **Forward chaining to fixpoint** over current, positive, non-retracted
  beliefs; each join step specializes the next pattern with the bindings
  so far and runs it through the ordinary CAVE-Q compiler.
  Only own binding properties specialize a variable; names such as `__proto__`
  and `constructor` remain unbound until matched by a premise.
- **One write reservation** covers rule selection, watermarks, premise
  matching, and derived writes. Each run refreshes the vocabulary registry
  inside that transaction, including declarations committed by another writer.
  Derivation discovers rules through the attribute index, checking the latest
  row of each claim key before firing; it does not materialize unrelated
  current beliefs just to find declarations. Retracted rules remain disabled.
- **Confidence is noisy-AND** (`@cavelang/fusion`, the independence
  assumption explicit): rule conf × Π premise-row confs; several
  derivations of one conclusion keep the strongest.
- **Lineage on `cave_edge`**: derived rows point `BECAUSE` at their
  specific premise rows and `VIA` at the rule — `cave export` renders
  the whole derivation tree, and import replays it.
  If replacement premise rows yield the same conclusion key, value and
  confidence, the existing conclusion and its original edges are retained.
  Those edges explain the historical append; they are not a continuously
  refreshed proof. Support reconciliation still queries current premises and
  retracts the conclusion when no eligible derivation remains.
- **Idempotent and incremental**: unchanged conclusions append nothing;
  per-rule `derive-watermark` claims let a run skip rules no new row
  could affect (`--full` overrides). A watermark predating the rule's
  current declaration row is stale — a re-declared rule fires from
  scratch.
  In both premise matching and change detection, up to 16 context requirements
  use direct indexed predicates; larger lists use a single JSON parameter, so
  large lists do not expand SQL expression depth or parameter count.
  A 1,500-context regression checks initial support,
  incremental wake-up, incomplete-context exclusion and retraction.
  Change detection keeps attribute/metric values and tags out of its
  restrictions because they can change within one claim series. Equivalent
  numeric spellings can enable a match; replacing a value or removing a tag
  can invalidate one. Either change re-evaluates the complete premise and
  retracts conclusions that lost support, without requiring `--full`.
  New vocabulary rows (`IS verb`, `REVERSE` and `RENAMED-TO`) also
  wake settled rules: a mapping can make an older fact match even though no
  new row of that premise's verb was appended. The next quiet run skips again.
  Each rule also records `derive-vocabulary`, a SHA-256 fingerprint of the
  active registry's sorted contents and the effective alias-matching and
  minimum-confidence settings. Changing either setting re-evaluates existing
  premises and reconciles their conclusions without requiring `--full`.
  Vocabulary changes caused by qualifier
  edges or a different configured registry therefore invalidate old support
  without requiring new claim rows. Missing or stale vocabulary marks cause
  one conservative re-evaluation, as do older registry-only fingerprints;
  equivalent registries and settings after reopen remain
  quiet. A vocabulary change during evaluation restarts support calculation
  within the same pass budget. Both marks advance only after a complete run;
  dry runs and incomplete runs leave them unchanged.
  Bookkeeping writes share the derivation transaction: if a watermark or
  vocabulary-fingerprint write throws, the run's conclusions and lineage also
  roll back. After resolving the write failure, retry derivation normally;
  a completed retry restores incremental no-op behavior.
  This includes cascading retractions: a failed run retains the prior derived
  chain and its historical lineage until a complete retry reconciles lost
  support and replacement conclusions together.
- **Support is well-founded**: premises retracted → dependents retracted,
  cascading across rules within the run; mutually-supporting derivation
  cycles cannot keep each other alive.
- **Pass exhaustion is non-destructive and resumable**: reports expose
  `complete: false`, the CLI exits nonzero and labels its final text summary
  `derived (incomplete)`, suspended conclusions are not
  reconciled, and watermarks do not advance until a later run reaches a
  fixpoint. Reconciliation runs in a savepoint: if the budget expires after
  retractions have begun, those retractions and subsequent writes roll back
  together. Additions made before reconciliation remain available for the next
  run; report write counts exclude rolled-back reconciliation. This also keeps
  dry-run reports consistent with the writes a real bounded run would retain.
- `--dry-run` computes the full report inside a rolled-back transaction.

Interpret report fields according to what they count:

| Fields | Meaning when a run is incomplete |
|---|---|
| `appended`, `updated`, `retracted` | Writes retained from the run; exclude all writes rolled back with incomplete reconciliation. In a dry run, these are the writes the corresponding real run would retain. |
| `passes`, per-rule `evaluations` | Work attempted, including evaluation inside reconciliation that later rolled back. |
| Per-rule `solutions` | Matches from that rule's final attempted evaluation; not a count of retained claims. |
| `unchanged` | Attempted idempotent skips, including those inside rolled-back reconciliation. A claim may be skipped in several passes. |

The report is not a partition of distinct claims: multiple solutions can yield
one conclusion, and repeated evaluations can revisit it. Use `complete` to
check whether support settled, and query the store for the retained beliefs.
A dry run leaves the store unchanged regardless of its report counts.

Derived vocabulary declarations (`IS verb`, `REVERSE`, `RENAMED-TO`) are
additive: losing their premises or explicitly retracting their producing rule
does not retract them. A derived inverse can enable downstream rules in the
same run and remains available after reopening. Dry runs roll back both the
new declaration and its registry effect.

Each generated declaration extends the current registry at insertion time through
the canonicalizer. This preserves first-declaration-wins behavior when multiple
conclusions propose conflicting inverses, without replaying unrelated vocabulary.
Lineage changes that exclude old declarations still trigger the store's rebuild.
Run `node scripts/derived-vocabulary-bench.mjs` alone from the repository root
for fresh derivations with 100, 1,000 and 3,000 unrelated declared verbs. With
3,000, five-sample medians for deriving one inverse improved from 34.40 to
5.15 ms on Node 24.16.0 and from 29.13 to 5.07 ms on Node 26.5.0. Setup and
result assertions are outside timing. These figures include the complete derive
call for this fixture, not arbitrary joins, conclusion counts or lineage changes.

Derived claims are stamped `@src:rule/<digest>` (§9.5), so a rule's
output keeps its own belief series per conclusion — a hand-written claim
about the same fact coexists (§9.4) and is never silently overridden.

## Quiet-run benchmark

Run `pnpm bench:rule-watermarks` from the repository root, without concurrent
builds or tests. It settles one attribute rule per input series, measures five
quiet runs, and verifies that all rules remain present, every run completes,
and the complete annotated export remains unchanged. A separate phase measures
1,000 policy fingerprint hashes without database work.

An isolated Node 26.5.0 / SQLite 3.53.3 run on macOS arm64 measured:

| Settled rules | Before skipping unused head reads | After skipping unused head reads | Writes |
|---|---:|---:|---:|
| 100 | 11.4 ms | 8.3 ms | 0 |
| 500 | 102.6 ms | 39.0 ms | 0 |
| 1,000 | 333.2 ms | 79.5 ms | 0 |

The isolated policy-hash phase took about 0.95 ms per 1,000 hashes, so another
hash cache would address little of the measured cost. SQL instrumentation then
attributed about 253 ms of a 338 ms quiet run to 1,000 repeated `MAX(tx)` reads.
The engine now reads that boundary only after deciding a rule must fire;
skipped rules do not use it. Firing rules still capture a fresh boundary before
evaluation inside the existing write transaction. This removes redundant reads
without caching a transaction head or changing incremental semantics.
These are workload measurements, not latency guarantees or timing test gates.

Declaration entry points refresh peer vocabulary through the store's version-aware
cache inside their write reservation. They retain inverse and rename resolution
without rebuilding unchanged history on every repeated declaration. Shared
idle derivation, settling and declaration measurements are recorded in
[the architecture guide](../../ARCHITECTURE.md#write-path).

See the spec's §24 (`.claude/skills/cave-storage-query`) for the
normative semantics, and `test/` for executable examples.
