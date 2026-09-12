# @cavelang/shape

## 0.36.3

### Patch Changes

- Align the @cavelang/shape workspace with the CAVE 0.36.3 release identity.

## 0.36.2

### Patch Changes

- Align the @cavelang/shape workspace with the CAVE 0.36.2 release identity.

## 0.36.1

### Patch Changes

- Align the @cavelang/shape workspace with the CAVE 0.36.1 release identity.

## 0.36.0

### Patch Changes

- b3f5de7: Score alias candidate pairs in their first shared group to avoid retaining an all-pairs deduplication set while preserving suggestions and ranking.
- b3f5de7: Anchor generated-client test fixtures to the test module rather than the process working directory, preserving workspace import resolution when running the shape suite from either the repository root or package directory.
- b3f5de7: Parse complete alias-judge JSON arrays so nested arrays and quoted bracketed numbers cannot accidentally confirm and write aliases.
- b3f5de7: Batch generated-client constraint tags by declaration and append grouped fields without repeated copies, preserving deterministic output while reducing large-schema query counts.
- b3f5de7: Bound alias edit-distance work by the existing similarity threshold, preserving exact qualifying scores and verifying against a full-matrix reference.
- b3f5de7: Retain only the requested best alias suggestions during limited discovery, preserving the exact ranking of an unlimited run followed by slicing.
- b3f5de7: Precompute alias candidate name features once per discovery call and add a deterministic benchmark that verifies unchanged suggestions as unrelated candidate groups grow.
- b3f5de7: Report generated interface collisions with Store and CaveValue as naming problems instead of returning uncompilable client code.
- b3f5de7: Preserve distinct generated-client fields when type or property names contain the separator previously used for conflict detection.
- b3f5de7: Compute health coverage counters and mean confidence in one current-belief aggregate, preserving negative, retracted, and empty-store semantics.
- b3f5de7: Add a repeatable shape-fact SQL comparison with ordered-result and retraction checks, and document why a blanket grouped-query replacement is not adopted.
- b3f5de7: Preserve complete text and code literal neighbors in alias suggestion explanations and emitted evidence comments instead of truncating them at spaces.
- b3f5de7: Read all current-claim evidence for an alias judge prompt from one snapshot so concurrent updates cannot manufacture contradictory evidence.
- b3f5de7: Generate client declarations and relation mappings from one read snapshot, preserving cleanup on errors and caller transaction rollback.
- b3f5de7: Assemble every health-report section within one read snapshot, preserving read-only access, caller transactions, and cleanup after errors.
- b3f5de7: Read shape declarations, constraint tags, and qualifier edges in one snapshot so concurrent metadata changes cannot hide a current expectation.
- b3f5de7: Keep standalone shape declaration and fact reads in one read snapshot so concurrent revocation cannot produce a false violation from mixed database states.
- b3f5de7: Read shape declarations without loading unrelated facts when listing expectations or generating clients, and reuse constraint tags from the same snapshot.
- b3f5de7: Add a dense matching benchmark to compare full alias discovery with bounded result retention using counts, prefix digests, timing and documented memory measurements.
- b3f5de7: Preserve structured context boundaries in alias disagreement grouping so a context containing a separator cannot collide with a different context set.
- b3f5de7: Encode shape violation identities as JSON tuples so separator characters in names cannot hide new violations behind existing ones during checked ingestion or action execution.
- b3f5de7: Avoid full shape snapshots when no EXPECTS rows exist, rechecking each evaluation so newly introduced declarations retain transactional enforcement.
- b3f5de7: Index rare-value alias evidence by entity pair and append candidate buckets without repeated array copies, preserving scoring and the two-signal limit.
- b3f5de7: Add a larger alias-discovery benchmark mode and document constrained-heap reproduction with complete suggestion-output checks.
- b3f5de7: Build alias disagreement buckets without repeated array copies and detect differing values or polarities in linear time, preserving cross-name conflict semantics and every reported actor row.
- b3f5de7: Build taxonomy-child and per-type expectation groups with local appends instead of repeatedly copying growing arrays.
- b3f5de7: Omit redundant confidence and negation columns from shape fact projections after SQL has filtered them, and remove duplicate index checks. Preserve historical latest-row selection and complete shape declarations while reducing repeated gate evaluation work.
- b3f5de7: Materialize only target/value fields for ordinary shape facts while retaining complete declaration rows for provenance, reducing repeated gated-action snapshot costs.
- b3f5de7: Spell NUL key separators as explicit escapes in shape sources so text search and code review remain usable without changing runtime keys.
- b3f5de7: Emit computed property names in generated readers so fields such as __proto__ remain own data properties instead of changing the result object's prototype.
- b3f5de7: Restrict shape constraint-tag and qualifier-edge reads to current declaration IDs, preserving exclusions and avoiding unrelated side-table materialization.
- b3f5de7: Build shape observed-value indexes only for active expectations' attributes and relation directions. Retain taxonomy targeting, explicit taxonomy relation checks, inverse direction handling and fresh evaluation state while reducing unused indexing work.
- b3f5de7: Reuse the shared latest-claim SQL in shape reports and document dependencies required for a future incremental gate.
- b3f5de7: Share one current-belief read for entity and typed-entity health coverage while preserving literal, polarity, and actor-series semantics.
- b3f5de7: Skip shape fact snapshots when no active expectations remain after declaration and qualifier checks, while observing reactivation on every evaluation.
- b3f5de7: Restrict shape fact snapshots to taxonomy, typings, and active expected slots while preserving current-version and inverse-relation semantics.
- b3f5de7: Typecheck a generated client in the test suite, covering special property names, value/type namespace coexistence, units, cardinality and inverse relations.
- b3f5de7: Verify stable sorted unit diagnostics across later shape evaluations and document an allocation experiment that showed no material automation speedup and was reverted.
- b3f5de7: Verify and document that shape-gate rollback failures preserve the original rejection and cleanup error, with recovery through caller rollback or closing/reopening the store and no persisted rejected history or vocabulary.

## 0.29.0

### Minor Changes

- e5ea4df: Add in-band exact-one cardinality and exact-unit constraints to `EXPECTS`,
  with actionable health reports and transactional gate enforcement.
- b899294: Generate deterministic, versioned TypeScript interfaces and store readers from
  in-band shape expectations.

### Patch Changes

- a7aded1: Let leading-character typos reach alias edit-similarity scoring.
- 37ddc5b: Evaluate shape expectations from one indexed current-belief snapshot so SQL
  query count no longer scales with instances multiplied by expectations.

## 0.28.1

### Patch Changes

- Updated dependencies [16344ea]
  - @cavelang/core@0.28.1
  - @cavelang/canonical@0.28.1
  - @cavelang/store@0.28.1

## 0.28.0

### Patch Changes

- Updated dependencies [e2a4fd7]
- Updated dependencies [a0a4dd1]
  - @cavelang/core@0.28.0
  - @cavelang/canonical@0.28.0
  - @cavelang/store@0.28.0
