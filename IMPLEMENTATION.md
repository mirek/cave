# CAVE — Implementation

A pnpm TypeScript monorepo implementing the CAVE specification
(split across the skills in [`.claude/skills/`](.claude/skills) — see the
[README's section index](README.md#the-specification) for which skill holds
which § sections).
Domain APIs use immutable values and namespace modules in the `@prelude`
convention. Classes also support typed errors, runtime ownership and React error
boundaries. Packages are built bottom-up and documented and tested alongside
their public behavior.

## Packages

These are source and test boundaries, not a one-to-one list of npm artifacts.
Kernel libraries and independently consumed tooling publish directly;
implementation-only workflow packages are private and ship through stable
`@cavelang/cli/<feature>` subpaths. See
[PACKAGE_SURFACES.md](PACKAGE_SURFACES.md) for the enforced classification,
stability promises, and 0.28 import migration.

Dependency order, bottom to top:

| Package | Spec | Purpose |
|---|---|---|
| [`@cavelang/core`](packages/core) | §2, §6, §7, §9, §32 | Domain model: claims, values/units/multipliers (incl. `A -> B` trajectories), uncertainty, confidence, tags, contexts, percent-escaped source spans (`SourceSpan`), valid-time periods/ranges (`Time`), claim keys, monotonic UUIDv7 |
| [`@cavelang/parser`](packages/parser) | §3, §4, §8, §16 | CAVE text → AST on [`@prelude/parser`](https://www.npmjs.com/package/@prelude/parser) combinators; never throws, lints |
| [`@cavelang/canonical`](packages/canonical) | §5, §8, §13.4 | Verb registry (`REVERSE`, `RENAMED-TO`, extensions), inverse and lifecycle resolution, continuation expansion, qualifier edges, canonical emitter |
| [`@cavelang/store`](packages/store) | §9.5, §13, §26 | Persistence on the **Node.js builtin `node:sqlite`** — append-only belief series, explicit actor/source/run/domain provenance, versioned migrations, exact verified snapshot backup/restore, inverse-aware reads, FTS5, contradiction resolution |
| [`@cavelang/query`](packages/query) | §12, §26, §32 | CAVE-Q patterns compiled to SQL: variables, wildcards, inverse and lifecycle verb resolution, `VERB+` transitive CTEs, `WHERE` filters, `resolve` winners-only matching, `at` valid-time filtering + trajectory interpolation |
| [`@cavelang/shape`](packages/shape) | §20, §27 | Shape expectations (`EXPECTS` through `EXTENDS`, exact-one and exact-unit tags), health report, write gating, deterministic versioned TypeScript client generation with strict ambiguity checks; alias discovery (`suggestAliases`, optional judge contract) |
| [`@cavelang/connect`](packages/connect) | §9.8, §23 | Deterministic structured ingestion — CSV/TSV/JSON/JSONL/SQLite/URL records mapped through CAVE templates with `?field` variables; physical source identity, CSV/TSV/JSONL record spans, per-record digest incrementality, watch mode, query-time overlay; declared `source/<name>` sources and the text-store assembler the CLI, MCP, serve, automate, and ingest surfaces hand to `openAt` |
| [`@cavelang/fusion`](packages/fusion) | §10 | Bayesian fusion, noisy-AND, hypothesis helpers — pure math |
| [`@cavelang/solver`](packages/solver) | — | Dependency-free formal-reasoning boundary: immutable Boolean/integer/exact-real/finite-enum models, hard and weighted-soft constraints, lexicographic objectives, validation and resource limits, capability negotiation, canonical digests, result unions, bounded feasibility/optimization/counterexample/sensitivity workflows, deterministic tie-breaking, linear-subset recognition, and versioned JSON/human explanations mapped to model declarations, evidence rows, and scenario inputs; concrete solver adapters remain optional |
| [`@cavelang/solver-z3`](packages/solver-z3) | — | Optional Node.js adapter for official Z3 Wasm: lazy one-time initialization, exact portable-model compilation, tracked unsat cores, lexicographic and weighted-soft optimization, queued checks, bounded execution, explicit worker shutdown, and a separate allowlisted architecture-workflow CLI fixture |
| [`@cavelang/scenario`](packages/scenario) | — | Typed, replayable evaluator inputs: explicit CAVE-Q snapshots, rolled-back hypothetical overlays, exact numeric/unit conversion, cardinality and conflict policies, durable row evidence, stable scenario evidence IDs, and a solver-explanation metadata bridge; async evaluators run only after rollback. Explicit atomic/idempotent result recording uses separate versioned result, recommendation, decision, action-audit, and external-effect-audit artifacts with compatibility-aware replay |
| [`@cavelang/rules`](packages/rules) | §24 | Rules engine — `premises => conclusion` forward chaining over current beliefs; in-band rule claims, `BECAUSE`/`VIA` derivation lineage, noisy-AND confidence, tx-watermark incrementality, well-founded support |
| [`@cavelang/act`](packages/act) | §25 | Action templates — named, parameterized governed writes: in-band declarations, CAVE-Q preconditions validated against current belief, atomic effects with `BECAUSE`/`VIA` lineage, §20.3 gate by default, out-of-band side-effect hooks |
| [`@cavelang/sync`](packages/sync) | §28 | Store merge — append-only stores union by row identity (idempotent, transitive, conflict-free under §9.4 coexistence): store files through SQL `ATTACH`, `;@` transaction-annotated canonical text through the ordinary pipeline; in-band `SYNCED-INTO` merge records, the §28.2 tx receive rule, re-statement replay and the §28.6 branching convention (text under git, checkout/land by sync, union merge driver) |
| [`@cavelang/loop`](packages/loop) | §18 | cave-loop: injectable store/policy (sync + async), in-memory store and SQLite adapter, heuristic policy (the eval baseline), LLM policy over shell-agent templates (one completion per step decides select/stop), shared bounded external-process lifecycle, multi-hop recovery demo |
| [`@cavelang/automate`](packages/automate) | §29 | Automations — the event-driven loop: in-band `automation/<name>` declarations pair §24.1 trigger premises with steps (§25 actions, §25.4 hooks, agent prompts); solutions fire on rows newer than the automation's watermark, armed at declaration, deaf to their own echo; settle cycles interleave incremental derivation with trigger evaluation until quiescent |
| [`@cavelang/view`](packages/view) | §9.7, §30, §31 | Sensitivity-scoped human publication — `cave serve`: one static HTML page over an audience-filtered store (entity 360, history, lineage, health, search) behind read-only GET endpoints; `cave report`: audience-filtered markdown templates with claim-key citations; all counts and graph walks derive from the visible snapshot |
| [`@cavelang/mcp`](packages/mcp) | — | The engine as an MCP server (stdio JSON-RPC): version-matched help plus add/query/fuse/search/about/neighbors/reconstruct/derive/export/lint tools and one generated `act_<name>` tool per declared action (§25.5); `cave_fuse`/`cave_derive` expose named §10.1 fusion and §24 derivation; serving scopes distinguish read, ephemeral evaluation, durable recording, and effect-capable action permissions, with `--read-only` and exact tool allowlists as further intersections |
| [`@cavelang/ingest`](packages/ingest) | — | LLM-driven ingestion: batch files and web pages (fetch + Readability) through any headless agent (Claude Code, Copilot CLI, SDK scripts) with hybrid knowledge context |
| [`@cavelang/eval`](packages/eval) | — | Extraction and reconstruction eval harness: golden-fixture suites as plain files, N fresh-store runs against any agent via `ingest`, claim-key scoring with §9.5 actor-stamp normalization and value tolerance, CAVE-Q expectations, optional LLM judge, `--min` CI gate; reconstruction cases (`<stem>.loop.cave`) score §18 loop policies against the heuristic baseline |
| [`@cavelang/tree-sitter-cave`](packages/tree-sitter-cave) | §16 | Tree-sitter grammar (line-oriented, no external scanner) + `queries/highlights.scm` — the single grammar source behind terminal and editor highlighting; parser and WASM are generated on demand, never committed |
| [`@cavelang/highlight`](packages/highlight) | — | web-tree-sitter over the grammar WASM, rendering `highlights.scm` captures as ANSI for terminals |
| [`@cavelang/cli`](packages/cli) | — | `cave parse / highlight / add / import / query / resolve / derive / act / automate / check / backup / restore / generate / suggest-alias / sync / export / report / serve / mcp / ingest / eval / connect / reconstruct / demo`; one promise-based dispatcher owns errors, I/O, signals, awaited cleanup, and exit codes |

Outside the npm dependency graph, [`editors/vscode`](editors/vscode)
packages the same grammar WASM and highlight query as a VSCode extension
(semantic tokens — deliberately no TextMate grammar to drift out of sync).
Activation owns the parser and compiled query. Its disposable unregisters the
provider before freeing both; failed setup frees partial allocations. Document
trees are released after each request even when capture generation fails.
Node's shared highlighter and the website's page-wide loader cache in-flight
and successful initialization, but clear rejected loads so a later request can
retry. The website keeps plain source visible on failure; mounting another code
block or editing source triggers a new attempt, without a background retry loop.
Explicit core/browser factories return `OwnedHighlighter`, whose idempotent
`close()` releases the parser and query and prevents further highlighting.
The Node singleton exposes only the shared interface; the website cache lives
for the page lifetime. Closing an owned instance does not unload the language or
WASM runtime.
The public ANSI renderer validates custom spans as ordered, non-overlapping
UTF-16 ranges inside the source and rejects invalid ranges with `TypeError`.
Theme lookup considers only own properties, so prototype entries cannot become
escape-sequence parameters for unknown captures.

Solver capability negotiation follows expression result semantics as well as
declared variable and literal sorts. In particular, every division requires
`rationals` because portable division returns an exact real even for integer
operands; unsupported backends are rejected before execution.
The solve boundary copies and deeply freezes the validated model before adapter
execution, with a frozen set of resolved limits. Explanation runs also copy
their context and check its replay digest before execution, so edits to caller
objects during an asynchronous solve cannot change the submitted identity or
its evidence. Caller objects themselves remain editable.
Portable model/context records and arrays are copied iteratively with an
identity map before freezing or workflow execution. Shared references and
ordinary data keys remain intact; native structured cloning handles values
outside portable containers. Copying deep portable inputs no longer consumes
the native clone call stack.
Copy preflight inspects property descriptors and detects proxies without
evaluating accessors. Accessors, proxies, and nonportable containers use one
native clone of the complete input graph, preserving getter order/count and
native rejection behavior; iterative copying is reserved for data properties.
Workflow entry points capture model, options, and context for the whole
operation. Sensitivity captures its request as well, preserving sample bindings
and limits across successive backend calls. Replay identity is checked before
backend execution in every workflow.
Workflow scope theories use the same capability analysis as solver preflight,
covering arithmetic expressions and rational soft weights as well as variable
sorts. Domains remain the bounds of declared variables; no synthetic domain is
invented for constant expressions.
Solver and workflow entry points validate options before applying defaults:
unknown option/limit names, malformed limit containers, and non-Boolean
`unsatCore` values fail with `TypeError`. Sensitivity rejects unknown operation
names with `WorkflowValidationError`, rather than treating them as optimization.
Canonical serialization and hashing accept explicit validation limits, and
solve/workflow explanations use their resolved limits for identity and replay
checks. Limits do not enter canonical content: raising a bound permits larger
models without changing the identity of an already accepted model.
Canonical expression conversion and JSON token rendering are iterative. Prepared expressions are
reused by object identity across constraints and objectives within one captured
model; validation still charges every occurrence and each operation starts with
a fresh cache. Operand
ordering compares token streams lazily using the same lexical ordering as
complete canonical strings, preserving format/digests while avoiding recursive
stack growth and eager subtree rendering during comparisons.
Digest-only operations hash batches from that same canonical token stream,
avoiding a second full-model string allocation. Batches flush after reaching
65,536 UTF-16 code units; a single larger token is kept intact. This preserves
UTF-8 digest identity, including escaped and supplementary characters, but does
not cap individual tokens or canonical model preparation. Public serialization
joins these same batches to return the complete string, avoiding an array entry
for every token. It still retains the output and canonical model; public hashing
retains validation before and after model capture.
Explanation evaluation uses an explicit stack of suspended expression
evaluations. Boolean operators and conditionals request only the children they
need, retaining short-circuit semantics. Deep valid constraints no longer hide
call-stack exhaustion as `indeterminate`; selected undefined arithmetic and
missing assignments retain that evaluation state.
Each report has one local arithmetic budget shared by hard and soft constraint
evaluation. `maxExplanationBits` checks conservative integer-size estimates
before numeric parsing and guarded fraction arithmetic; `maxExplanationWork`
charges the largest estimate at each successful size check against a cumulative
allowance. Size checks run first. A refused work charge leaves the remaining
allowance available for cheaper later evaluations. Exhaustion records a local
`indeterminate` reason without changing the backend status or assignment.
Resolved limits are recorded with new reports; reading or replaying historical
reports preserves their original limit fields.

The report also caches completed predicate evaluations by ordered syntax,
including literal representation, enum domain and operand order. It uses this
identity rather than canonical model identity because reordering operands can
change short-circuit behavior or the first local failure. Identical hard/soft
predicates reuse their result while retaining each declaration's metadata.
Variable names, enum domains and enum values are interned in a table shared by
that report's evaluation keys, so repeated long strings use compact references
without conflating distinct IDs, domains, values or literal sorts.
Canonical serialization and public names remain unchanged.
Assignments, evaluation results and the allowance belong to one report, so a
new assignment or larger limit cannot reuse a previous report's local failure.
Distinct constraints compete for the shared allowance in evaluation order.

These guards account for selected arithmetic, not all work performed by a
report. Model/result capture, validation, syntax-key construction, unguarded
traversal, formatting (including soft-weight normalization), standalone `Exact`
helpers, linear classification and backend execution remain outside that
counter. Neither arithmetic limit establishes a wall-clock or process-memory
ceiling. Defaults, calibration and exact accounting are documented in the
[solver validation and resource-limit guide](packages/solver/README.md#validation-and-identity).

Text explanations retain normalized and authored input values plus sorted
evidence-row and scenario-claim references. Missing inputs use an explicit
`(no value)` marker, distinct from JSON null, rather than printing JavaScript
`undefined` and losing the authored source text.
Explanation report construction and solve/workflow preflight share binding
validation: unique nonempty input IDs, string queries, and dense nonempty-string
source-reference lists. Ambiguous bindings and malformed lists fail with
`TypeError` before backend execution. External source IDs remain opaque.
Input payload validation walks iteratively with active/completed object sets,
rejecting cycles while allowing shared subobjects. Finite JSON primitives,
dense arrays and plain records are accepted; non-finite numbers, non-JSON
objects and custom serializers fail before cloning can erase their structure.
Optional undefined object properties remain supported, unlike undefined array
members that would serialize as null.
Text rendering also uses an iterative token stack for these payloads. Node 22's
native `JSON.stringify` overflows on validated 20,000-level values even though
Node 26 accepts them. Both nested records and arrays retain ordinary JSON
ordering, escaping, and optional-property omission across supported runtimes.
Explanation metadata preflight checks snapshot policy enums, finite confidence
within `[0, 1]`, transaction-time string/null, optional valid-time strings, and
nonempty scenario identity/digest strings. External labels remain opaque; their
shape does not establish that the referenced snapshot exists or is current.
The text projection includes supplied snapshot policies and confidence threshold
alongside time labels, and labels both scenario input and overlay digests.
Omitted policies stay omitted, while an explicit zero threshold remains visible.
Linear-subset recognition evaluates constant divisors with exact rational
arithmetic. Computed zero and undefined constant divisors are outside LP/MIP,
even when the general SMT model remains valid; nonzero constants are not
classified using floating-point approximations.
`Linear.model` accepts explicit validation limits, just like canonical identity
generation, so larger validated models can be classified without reverting to
default size bounds. Limits govern acceptance rather than linearity.
Affine classification and constant evaluation use explicit stacks with per-model
caches. Shared factors reuse their classification while each occurrence still
counts toward the product's variable-bearing factor limit.
The Z3 adapter guards its instance's native reference-decrement and context
deletion calls during asynchronous solver and optimizer checks. The binding's
finalizers bypass its check mutex; deleting ASTs while a pthread check runs
can corrupt later results or crash in native reference cleanup. Releases are
queued only while a native check is active and drained when its promise
settles, including rejection, before control returns to CAVE. This leaves
synchronous cleanup immediate and avoids retaining every compiled expression
for the runtime's lifetime. The runtime CI matrix runs both solver suites and
the large forced-GC diagnostic on each configured runtime/OS entry. A
five-minute step timeout bounds a native hang. The large memory diagnostic
verifies the original
75,000-variable sequence and subsequent exact optimization under forced GC.

The Z3 adapter also compiles expressions with an explicit traversal stack and
per-model expression cache. Deep accepted models reach the backend without
recursive JavaScript compilation, while shared terms retain every operand
occurrence and never reuse expressions from another request.
Boolean conjunctions and disjunctions compile through groups of at most 1,024
operands. Grouping preserves their meaning while bounding argument lists;
passing an AstVector alone would still encounter internal argument spreading
in the current Z3 binding.
Generated domain bounds enter both Solver and Optimize in batches of at most
1,024 assertions, retaining all bounds under raised variable limits without
an unbounded spread call.
Unsat-core trackers use fresh Z3 Boolean symbols, mapped back to portable
constraint IDs. Deriving tracker names directly from those IDs could collide
with user variables and incorrectly turn a satisfiable model into an
infeasibility result when core extraction was requested.
Optimization checks every explicit objective's lower and upper bounds against
the value attained by the returned model using exact rational comparison.
Z3's successful optimization check alone does not establish a finite attained
optimum: unbounded objectives and strict unattained bounds return portable
`unknown/indeterminate` rather than `optimalityProved: true`.
Z3 runtime creation waits for a pending shutdown before initializing a shared
replacement. Each runtime retains one close promise, so concurrent closes
drain accepted work once and later closes cannot clear a newer singleton.
Exact integer parsing accepts only primitive safe numbers and full integer
strings; numeric strings cannot hide final line terminators behind a regex end
anchor. Exact decimal zero is normalized before power-of-ten expansion, while
retaining exponent validation, avoiding unnecessary huge allocations or errors.
Solver declaration identifiers likewise require complete primitive-string
matches, preventing final line terminators or coerced objects from entering
variable, enum-domain, constraint, or objective identity maps.
Model and expression containers are checked before traversal; declaration lists
must be dense arrays of objects. Provenance locations and reference lists receive
field-specific model diagnostics for malformed runtime types or sparse entries.
Variable, combined hard/soft constraint, and objective counts are checked before
declaration entries are read. Enum-value counts accumulate by domain and reject
an oversized domain before its members are inspected. These count checks precede
semantic validation inside the oversized declarations.
Enum-domain validation requires dense arrays of distinct primitive strings,
ensuring backend assignments retain the portable enum-value type. Empty and
Unicode strings remain valid members; members are not declaration identifiers.
Model validation explicitly rejects unknown variable/literal sorts and requires
Boolean literals to contain Boolean values. An unknown literal sort cannot fall
through to variable-reference inference or enter an adapter as valid data.
Expression node and depth budgets are enforced at traversal entry, before an
over-budget node is inspected. This bounds default validation of deeply nested
or cyclic expressions and reports the first exceeded boundary rather than
attempting a complete traversal before rejection.
Validation uses an explicit post-order traversal stack and infers each parent
from its completed children. Raised depth limits therefore do not consume the
JavaScript call stack. Children are visited lazily, and shared expression
objects still count at every occurrence with their own diagnostic paths.
Capability discovery uses iterative traversal with active/completed node sets
and computes variable dependence bottom-up once per node within each expression
root. It rejects cycles, avoids repeated nonlinear-arithmetic subtree scans,
and counts repeated variable-bearing factors separately when classifying a
product. Validation occurrence counts remain independent of this graph reuse.

## Toolchain

Hook-file validation currently has three owning readers:

| Entry points | Reader | Regression coverage |
|---|---|---|
| Action CLI and doctor | `packages/cli/src/hooks-config.ts` | `packages/cli/test/cli.test.ts` |
| Automation CLI | `packages/automate/src/main.ts` | `packages/automate/test/main.test.ts` |
| MCP startup | `packages/mcp/src/main.ts` | `packages/mcp/test/stdio.test.ts` |

Keep their file contract aligned: fatal UTF-8 decoding, a JSON object with
nonblank names and string commands, and well-formed Unicode in both names and
commands. Validation precedes action execution, automation settlement, or MCP
startup; doctor uses the action reader with redacted diagnostics. Regression
coverage checks rejected writes/startup and corrected retries at each boundary.

Sharing these readers across private packages requires a packaging decision.
`packages/cli/scripts/consolidate.mjs` copies private command modules into the
CLI and rewrites `@cavelang/<package>` imports to `@cavelang/cli/<package>`.
A new private-package subpath therefore also needs a resolvable published CLI
subpath or a change to that rewrite strategy. Moving a helper between packages
alone is insufficient. Keep any such refactor paired with packed smoke and the
reviewed public API check; source tests do not prove installed resolution.


- **Consolidation verifies runtime dependency declarations.** The CLI's build
  checks literal ESM imports/re-exports, dynamic imports and CommonJS loads in
  `dist/src` and `dist/internal` against its production, optional and peer
  dependencies. `scripts/check-runtime-dependencies.mjs` uses TypeScript's
  syntax tree, so comments, ordinary strings and unrelated methods named
  `require` are not imports. Literal `require.resolve` lookups are checked too.
  Published self imports, builtins, relative/absolute paths, URL specifiers and
  package-local aliases do not require an external package declaration.
  Excluded compiled tests may use development dependencies. This is an early
  manifest check; computed import names, alias/export resolution and installed
  availability remain the responsibility of packed smoke checks.
- **The aggregate CI gate includes release metadata.** The `test` job waits for
  source, runtime, browser, packed-artifact, VSIX and changeset checks. Changeset
  failure or cancellation fails the aggregate; a skipped changeset job is accepted
  only on pushes. Every PR runs the job. Its new-changeset requirement is waived
  only for the exact `changeset-release/main` head in the same repository targeting
  `main`; the step succeeds explicitly for that version PR. Forks, prefix matches,
  case variants and other base branches retain normal validation. Workflow
  regression checks execute the aggregate shell gate for these result states.
  A successful aggregate reports workflow results; enforcing it before merge
  requires a required-status-check rule in GitHub. The live `main` ruleset audit
  on 2026-09-07 found pull-request/squash, deletion and force-push protections,
  but no required status checks. Contributor review and green-CI obligations
  remain in `CLAUDE.md`; the workflow alone does not enforce those merge settings.
  The changeset job passes its base ref through an environment variable and reads
  Git's NUL-delimited added paths into a quoted Bash array. Spaces, quotes,
  newlines, Unicode and glob characters in filenames do not split or expand into
  other paths; shell syntax in a branch name stays data. Failed Git comparisons
  fail the job explicitly instead of being treated as an empty changeset list.
  `scripts/check-changesets.mjs` validates added files using the same
  `scripts/changeset-metadata.mjs` parser and package/severity checks as release
  preflight: malformed entries, empty summaries, duplicate or unknown packages,
  private-only releases and insufficient bundled CLI severity fail in CI.
  Documentation-only empty frontmatter remains supported. This working-tree
  check does not replace release preflight's committed-state, version and tag
  validation.
- **Publication reporting follows verified release success.** The pnpm release
  script calls `scripts/release-output.mjs` after registry visibility checks and
  validated tag handling. When `CHANGESETS_OUTPUT` is set, the helper appends
  JSON-line `git-tag` events (`tag`, `packageName`) for the initially missing
  packages. A fully published tag-recovery run creates an empty output file;
  no new package publication is reported. Publication, verification and tag-push
  failures stop before reporting. Without the environment variable the helper
  does nothing. It never publishes or creates tags itself. Changesets action
  2.1.1 consumes this interface with both GitHub release creation and action-level
  tag pushing disabled; `ensure_tag` owns the single lockstep tag.
- **Changesets CLI 3.0.2 and action 2.1.1 move together.** The workflow uses
  the v2 script inputs and default token input. `version-packages` intentionally
  fails when no changesets remain; the action selects versioning only while
  changesets are pending. Private-package opt-in does not version the root.
  After Changesets, the synchronizer aligns all package manifests, the root,
  extension and grammar metadata, leaving the ignored website unchanged. It
  adds alignment changelog entries for workspaces it advances so the action
  can summarize every changed package, preserving existing release entries.
  Each alignment changelog is written before its manifest version advances.
  A changelog failure therefore leaves that workspace eligible for a retry,
  with the original release severity; successful earlier workspace writes may
  remain. After fixing the filesystem error, rerun `node scripts/sync-versions.mjs`
  directly, since the preceding Changesets stage may already have consumed its
  input files. This is retryable ordering, not a transaction across all files.
  An isolated test runs the installed CLI against CAVE's workspace manifests
  and verifies both stages and the empty second run. Hosted workflow and
  actual publication verification remain in the migration task.
  To preview pending changes without consuming them, run
  `pnpm exec changeset status --output /tmp/cave-release-plan.json` from the
  repository root. This reports Changesets' raw plan: private workspaces may
  show a lower bump and the ignored extension may show no change. The CAVE
  synchronizer subsequently aligns those version sources with the public fixed
  group; the ignored website stays separate. Status does not run that stage,
  generate changelogs, or establish release readiness. The release preflight
  validates committed inputs and rejects modified release files, so a worktree
  status preview is not a substitute for that committed-checkout gate.
  The working-tree changeset checker also validates complete fixed-group
  membership against current public manifests, catching omitted, duplicate,
  private or unknown members in the PR changeset check before release preflight.
  It rejects missing or duplicate workspace names before building release-owner
  maps, preventing a private manifest from shadowing the public CLI's bundled
  exports and bypassing their required CLI release severity.
- **Runtime support is explicit.** The supported Node.js lines are 24 and 26, starting at
  24.16.0 and 26.1.0 respectively; 24.21.0 Active LTS is recommended, and
  26.8.1 Current is also tested. Ubuntu 24.04, macOS 15, and Windows Server 2022
  are the CI representatives for the supported Linux, macOS, and Windows
  families. The full suite stays on the recommended Linux runtime; a focused
  matrix covers the minimum, Node 26, and platform-specific process,
  filesystem, native grammar, SQLite, solver/adapter and forced-GC cleanup, and
  consolidated-package behavior.
  Packed shell-agent adapter checks exercise strict reply decoding, malformed
  prompt rejection, and valid Unicode round-trips through the installed loop
  and ingestion entry points. They complement the generic process-runner flag
  checks by verifying that structured adapters opt in correctly.
  Installed solver checks exercise missing own slots in all five declaration
  lists: inherited getters remain uncalled, errors retain indexed field paths,
  and defining valid own entries permits retry on the same arrays.
  Installed Z3 checks preserve empty, prototype-like and distinct Unicode enum
  members across reversed/extended domain arrays, verify exact assignments and
  unchanged inputs, and close the runtime after the checks.
  Package packing in the smoke workflow captures stdout and stderr per package.
  A failed pack prints the package manifest path and complete captured output,
  then preserves its exit status, so compiler diagnostics are visible in CI.
  The packed API renderer emits lines through an iterative namespace traversal.
  A 17,000-export fixture verifies all 136,000 report lines without expanding
  them into function arguments. Namespace re-export cycles produce a reference
  to the ancestor namespace; sibling aliases still render their full contents.
  TypeScript declarations and the final snapshot remain in memory, so this is
  not a general compilation or report-size budget.
  Packed CLI and HTTP smoke checks consume complete output before deciding
  whether expected content is present. An early-exiting `grep -q` can otherwise
  give a producer a broken pipe under `pipefail` despite matching output.
  Consuming the stream preserves both producer failures and missing-match
  failures; it does not weaken the smoke result to the consumer's status alone.
  Installed connector checks reject duplicate SQL result names for populated
  and header-only sources under `--prune`, require status 1 and a diagnostic
  without stdout, and compare complete annotated history before and after.
  Restoring the source and correcting the projection must succeed without
  changing that history.
  The same installed workflow rejects a non-projecting DELETE over a header-only
  source before pruning, and verifies normalized source/destination labels in a
  sync merge record when caller labels contain colons.
  Installed sync API checks preserve complete annotated target history during
  database and text previews with inherited or non-enumerable options. They
  also verify one read of a changing text-sync dry-run getter, then require a
  real merge to succeed and a repeated merge to add nothing.
  Malformed UTF-8 in an annotated text comment must fail in both preview and
  commit modes without changing target history. Restoring valid bytes must allow
  a successful preview on the same target before the eventual real merge.
  Installed solver checks capture model and option getters once, retain inherited
  and non-enumerable timeout overrides through solving and workflows, and reject
  invalid inherited limits before adapter execution. Completed explanations stay
  unchanged when original backend metadata and diagnostics are later mutated.
  Conversely, mutating a returned report from direct explanation or solving
  cannot change caller model/result/context data or a later report. The installed
  checks cover metadata, diagnostics, limits, inputs, assignments and provenance,
  including shared references inside the captured graphs.
  Installed enum checks refresh membership after domain mutation, recover the
  original digest after repair, retain duplicate/count rejection and charge every
  shared literal occurrence. Empty, special-key and distinct Unicode strings
  retain exact membership. Custom array iterators cannot substitute members or
  hide duplicates; installed checks verify zero iterator calls and corrected
  indexed-entry retries.
  Installed text diagnostics preserve full short messages through 160 UTF-16
  code units and bound longer previews, retaining both ends, original lengths
  and JSON escaping without modifying caller input. Unknown option/limit names
  and large primitive limit values also stay bounded; invalid options suppress
  adapter calls and corrected requests succeed.
  Installed declaration and operand checks cannot be skipped by overridden
  array methods: malformed models reject, valid arrays remain accepted and
  caller methods stay uncalled.
  Installed provenance checks reject duplicate and sparse reference lists using
  their own entries, without custom iterator or inherited getter calls, and
  accept the same lists after repair.
  Installed validation rejects inherited operand slots without reading getters
  and accepts the same array after dense repair. Referenced malformed variable
  sorts retain classified errors without invoking object coercion.
  Installed validation also retains classified errors for BigInt/cyclic fields
  without invoking JSON hooks, rejects invalid objective directions before digest
  generation and adapter execution with corrected retries in both directions,
  and rejects callable rationals in normalization and
  zero checks before reading their fields, retains zero-denominator rejection,
  enforces digit budgets on corrected pairs, and permits corrected solve
  requests after rejection before adapter execution.
  Installed scenario checks capture changing artifact and predecessor getters
  once, return the persisted JSON snapshot despite later caller mutations, and
  retain idempotent recording. Corrupt base64url and UTF-8 payloads reject without
  changing history; unrelated valid records and corrected payloads remain readable.
  Packed fusion checks retain identical subnormal means under unequal weights,
  a representable contribution whose initial root weight underflows, and a small
  residual after cancellation. These execute the installed JavaScript export,
  complementing the source-level numeric regressions and public type snapshot.
  Installed store/query checks reject both lone surrogate halves without a
  partial append or a false query match, preserve complete annotated history,
  and round-trip explicit replacement characters, accented text and emoji.
  A paginated history query uses a changing option getter and follows its cursor
  with plain options, verifying that the emitted implementation captures options
  once and returns both historical values.
  The same installed query check verifies a changing transaction-boundary getter
  and structured term getter retain their first values. Direct store search also
  rejects malformed Unicode. The installed HTTP server rejects malformed UTF-8
  and percent escapes with matching GET/HEAD status and cache headers, then serves
  a valid entity request in the same process.
  Installed MCP API checks submit two discovery requests before serving starts
  and require both replies before normal EOF shutdown. Already-ended input and
  already-finished output, plus closed streams on either side, must settle
  without fallback cancellation or retained transport and abort listeners.
  The installed viewer API rejects invalid port, host and sensitivity options
  before invoking a listener. A corrected public-only server serves visible
  content, supports concurrent and repeated close calls, and leaves the caller's
  complete annotated store history unchanged.
  Installed viewer model checks reject invalid dashboard caps, preserve zero
  caps, capture search sensitivity once, and retain repeated lineage branches.
  A later evidence append appears in the next lineage response while the earlier
  completed response keeps its original values; public views exclude the
  restricted evidence and its link counts.
  Installed read-snapshot checks use separate WAL writer and read-only reader
  connections. Commits between dashboard sections or between search matches and
  evidence projection leave the current response consistent; the next response
  sees the new data. Failed searches release their read snapshot, and calls
  inside a writer transaction preserve the caller's subsequent rollback.
  Installed reports capture getter-backed query options once across different
  template queries. Historical alias queries retain both historical values and
  citations; a new render with current options sees later values. Rendering
  preserves the complete annotated store history.
  Installed action checks change getter-backed dry-run options in both
  directions. Preview execution preserves history and skips command lookup;
  normal execution retains committed effects and reports a deferred hook lookup
  failure. Execution mode and hook mapping are each captured once.
  Installed automation checks replace caller signal fields during an agent
  completion and a watch report callback. Both calls preserve the original
  cancellation reason. The cancelled reply is discarded, its committed firing
  watermark remains, and the next settle call does not replay the claimed batch.
  Installed preparation checks raise cancellation during premise projection,
  both alone and alongside independent or already-wrapped projection failures.
  They retain original diagnostics and unchanged history, then verify that a
  fresh settle fires once and a subsequent settle does not repeat it.
  The installed automation command also captures an already-aborted context
  signal once: retraction returns quietly without changing declaration history
  even when a later getter read would have returned no signal.
  Installed rule and automation declaration checks reject empty and nonempty
  binary bodies with field/claim diagnostics, preserve claims and lineage, then
  retry after repair without repeating completed work. The rule cases also check
  failure propagation through automation settling with derivation enabled.
  Installed rules retain the confidence threshold and pass limit accepted by
  validation when options have changing getters. A later lower-threshold call
  reevaluates normally, while invalid limits leave complete history unchanged.
  Installed ingestion checks replace the target option during an awaited agent
  call and still require publication to the original store, leaving the other
  store's history unchanged. A changing batch size during URL selection cannot
  alter the validated batch plan; selection itself leaves history unchanged.
  Installed shell-agent checks retain an already-aborted signal and one-byte
  stdout/stderr limits when their getters change, exercising actual process
  forwarding through the bundled ingestion adapter.
  Installed direct URL selection checks retain both forced refresh and
  unchanged-source skipping when caller policy changes during fetching.
  Replacing the caller's signal cannot hide cancellation, and all these
  selection calls preserve complete annotated store history.
  Installed ingestion preflight rejects misspelled and null commit policies
  and output modes without agent calls or history changes. A subsequent valid
  run of the same source still publishes normally.
  Installed evaluation checks reject invalid modes and timeout values before
  fixture discovery and accept supported millisecond boundaries. Two repeated
  runs retain the original agent when its first awaited call replaces the
  caller's agent option, preserving the expected perfect fixture score.
  Direct installed comparisons also retain one validated tolerance across all
  facts when a getter changes; a subsequent exact comparison scores separately.
  Installed reconstruction policies reject invalid step and claim budgets
  before model work. Zero budgets prevent all expansions and completions;
  the documented unlimited claim budget still traverses normally.
  A two-completion reconstruction also retains its original query, guidance and
  offered-cue limit after an awaited callback changes the caller's settings.
  Invalid cue limits reject in both installed prompt rendering and policy
  creation before a completion can run, including with an empty frontier.
  Installed scoring preflight rejects nonfinite and negative factors and
  floors, while zero decay, finite amplification and above-seed pruning retain
  their traversal behavior.
  Repeated installed reconstruction seeds retain first-seen frontier order
  and expose both distinct seeds under a two-cue prompt limit without changing
  the caller's list.
  A deadline-bounded subprocess verifies that empty cue names cannot stall
  installed reply parsing or reconstruction with an unrecognized model reply;
  exact empty-name replies and explicit stopping retain their behavior.
  Installed reply checks also distinguish standalone cues and stop words from
  substrings next to Unicode letters, combining marks, numbers and path
  separators, including astral letters and emoji punctuation.
  Installed shell completions retain a getter-backed output limit across
  repeated calls and their original cancellation signal after caller options
  change; a new adapter can use a different limit normally.
  Shell completion and web-fetch adapters accept 1.001-second deadlines as
  1001 milliseconds. Invalid fractional or out-of-range limits reject before
  adapter creation or fetch work instead of failing as process/network errors.
  Installed web-source selection rejects malformed UTF-8 response bytes before
  text extraction or digesting, keeps healthy Unicode sources selectable,
  leaves target history unchanged and accepts a corrected response on retry.
  Malformed Unicode URL paths reject before the installed fetch callback runs;
  source tests additionally verify valid accented and emoji paths over HTTP.
  Installed structured connectors likewise reject malformed URLs and invalid
  deadlines before fetch, accept whole-millisecond decimal deadlines, and
  retain record parsing settings and cancellation across callback mutation.
  Retained states in synchronous and asynchronous installed reconstructions
  also keep the claim counts and evidence from their original expansion step.
  The installed SQLite adapter preserves current entity evidence in transaction
  order, including retractions and self-relations, leaves history unchanged on
  reads and observes later updates without recreating the adapter.
  It rejects unpaired Unicode surrogates before SQLite binding. Current-claim
  selection runs in SQLite so superseded entity revisions stay out of the
  adapter's JavaScript result arrays.
  A revised equal-score graph also produces the same bounded traversal and
  collected evidence through the installed memory and SQLite adapters.
  Mixed incoming and outgoing evidence also has matching transaction order,
  and modifying a returned memory-adapter array leaves subsequent reads intact.
  Installed connector prefix reads match literal prefix filtering for empty,
  astral and Unicode-boundary prefixes, reject malformed surrogates and leave
  complete store history unchanged.
  A changing installed connector prune getter is read once and cannot retract
  records when initially false; a later explicit pruning pass still succeeds.
  Installed declared discovery retains its first cancellation signal across a
  URL fetch, propagates that abort reason and preserves complete origin history.
  Installed source preparation also retains the fetched declaration's name and
  path after caller mutation, applying its content with the original declaration
  digest and source stamp.
  The installed connector command reads an already-aborted signal once and
  exits quietly without creating its database, even when a later getter read
  would have returned no signal.
  The installed process API checks strict stdout decoding in both asynchronous
  and synchronous runners, including the packaged bridge worker. A changing
  getter is read once, malformed bytes yield the typed encoding failure, and
  valid replacement characters, accented text and emoji succeed afterward.
  The installed health-report smoke checks 100 alias conflict slots with
  independently attributed production evidence and separate staging claims.
  It validates the returned claim records and actor provenance, excludes staging
  rows from production conflicts, and compares complete annotated history before
  and after the CLI read. This exercises the shape code bundled into the CLI.
  The installed generator also emits a TypeScript module into the scratch
  application, which imports it against installed store packages. A WAL writer
  updates both fields between field reads; the generated reader must return one
  consistent snapshot, see the update on its next call, and recover after an
  exact-one cardinality failure.
  Installed alias discovery rejects shared numeric trajectories as identity
  evidence while retaining quoted identifiers, captures a changing result-limit
  getter once, and preserves complete history while reading. A rejection
  committed after discovery prevents the retained suggestion from being written.
  Installed rule, action and automation declaration commands report malformed
  prelude lines at their original CRLF file locations, preserve complete history
  after those failures, and accept corrected files with idempotent replay.
  The installed CLI snapshot smoke creates a backup, independently hashes its
  file bytes, verifies that digest, rejects an incorrect digest, restores the
  snapshot byte-for-byte, and compares restricted-scope exports with transaction
  annotations against the original store's complete history. It also exercises a
  version-1 fixture through the installed verify/restore commands, checks exact
  restored bytes, checks read-only export refuses migration, and upgrades
  only the restored copy with an empty add while retaining history and the
  original snapshot's checksum and version.
  Installed report checks render a cited query and reject invalid `--at` and
  `--as-of` options for a static template. They verify exit status 1, an option
  diagnostic, empty stdout and byte-for-byte preservation of an existing output.
  The installed highlighter check loads the browser factory and its grammar/query
  assets from tarballs, highlights a real claim, closes twice, and verifies that
  both highlighting methods reject further use.
- **Tool versions and generated output are deterministic.** `make bootstrap`
  reads the exact pnpm version from the root `packageManager` field, preferring
  an already matching binary, then Corepack, then an exact ephemeral npm
  package. `pnpm clean` removes compiler output, website and VS Code bundles,
  packaged extensions, build metadata, and legal files staged by package hooks.
  Committed grammar sources and Wasm remain in place; the release grammar
  build regenerates them with the pinned toolchain. CI and release workflows pin third-party
  actions to reviewed commit revisions while retaining major-version comments
  for update tooling.
- **Publication uses the committed version identity.** Release validation
  requires each changeset touching a bundled private module to name the CLI
  at the same or higher severity. Bundled modules are derived from committed
  CLI export targets under `dist/internal`, so naming an unrelated public
  package cannot conceal the CLI release impact.
  The publish entrypoint
  fixes `CAVE_RELEASE_ROOT` to its own checkout for every child command.
  It rejects all positional arguments and flags before preflight; in particular,
  `--dry-run` is not a supported publishing mode and cannot be silently ignored.
  Standalone validator calls retain the explicit-root facility for fixtures
  and manual tag validation; it cannot redirect the publisher to another tree.
  Publish preflight
  rejects tracked edits and non-ignored untracked files, while allowing ignored
  build outputs. Release preparation runs `pnpm clean` before grammar generation
  and compilation, removing altered or obsolete ignored outputs that an
  incremental build could otherwise retain. The script validates again after
  build/tests/smoke and before
  npm publication, so preparation cannot silently change source inputs under
  an unchanged release identity. Final tagging revalidates that identity.
  Before publishing missing package versions, the script also requires its
  version to match the freshly fetched `origin/main` manifest. Superseded
  versions may recover tags when already fully published, but cannot publish
  missing packages through the automatic `latest` path. This guard belongs to
  CAVE: [pnpm publishes natively and defaults to updating `latest`](https://pnpm.io/cli/publish),
  so a separately installed npm CLI's publish checks are not the contract.
  Registry probes distinguish matching identity, an unambiguous npm `E404`
  error-code record, and probe failure. Missing-package recognition reads the
  explicit code line, never prose or URL substrings; conflicting code records
  fail closed. Probes explicitly disable color and JSON output and select the
  error log level, so inherited npm formatting cannot change that contract. Unexpected successful output and transport errors
  halt publication; an npm exit code cannot stand in for the missing-package
  sentinel. `CAVE_NPM_VIEW_ATTEMPTS` and `CAVE_NPM_VISIBILITY_ATTEMPTS` must be
  positive safe integers (defaults 4 and 8). Their corresponding
  `CAVE_NPM_VIEW_RETRY_DELAY_SECONDS` and
  `CAVE_NPM_VISIBILITY_RETRY_DELAY_SECONDS` must be integer seconds in 0..60
  (defaults 2 and 5); exponential backoff caps at 60 seconds. Invalid settings
  fail before the first registry request. Visibility retries also tolerate
  temporary missing responses after publication.
- **Published artifacts have a separate audit.** Run `pnpm release:audit`
  from the checkout whose declared versions you want to inspect. It installs
  every public package at its exact manifest version into an OS temporary
  directory, disables lifecycle scripts, lists the installed package set,
  and runs [`npm audit signatures`](https://docs.npmjs.com/verifying-registry-signatures/).
  The audit removes its temporary installation after success or failure. If
  both auditing and removal fail, it preserves both errors and reports both
  diagnostics; removal cannot replace the original audit failure.
  npm verifies registry signatures and available attestations for the installed
  dependency tree. The command uses npm's user/environment registry settings;
  the checkout's project `.npmrc` is not copied into the temporary directory.
  Any install, dependency-list, or verification failure fails the command;
  its temporary installation is removed on success or a handled failure.
  npm may populate its ordinary cache, but repository files are untouched.
  Unpublished manifest versions fail installation, so this is a post-publication
  audit, not a prerequisite for creating a new version.
  Recovery's name/version probes establish presence only. Neither those probes
  nor a successful signature audit proves byte equality with a local rebuild.
  `gitHead` is optional registry metadata and cannot serve as a required identity
  check. Available provenance is verified, but the command does not require
  provenance for every dependency: local first-publication bootstrap remains
  supported before npm trusted publishing can be configured.
- **The VS Code extension is a separately delivered product with shared
  identity.** The automated version PR stamps its private manifest from the
  same lockstep version as the npm packages. CI creates and inspects the real
  VSIX archive, then retains it as a short-lived artifact. Archive validation
  checks both runtime and grammar WASM payloads for binary validity, in addition
  to required nonempty files, strict UTF-8 JSON objects for the package manifest
  and language configuration, identity and entry points; editor-host behavior
  remains a separate check. Marketplace
  publication follows the npm release through the chained Publish workflow
  job; an explicit dispatch against an existing `v<version>` tag supports
  republication. Both paths rerun release validation, build the VSIX, and obtain
  their token from the protected `vscode-marketplace` environment. The manual
  path runs the workflow commit's validator against the selected tag checkout:
  `CAVE_RELEASE_TAG` must resolve to that checkout and match its release version.
  This dispatch-only target replaces the workflow-SHA equality check; normal
  push releases still require it.
- **Build-free development, emitted releases.** Supported Node releases can run the
  workspace `.ts` sources directly through type stripping and pnpm symlinks.
  `pnpm build` is the canonical composite `tsc -b` operation: it typechecks
  and emits package `dist/` trees. `pnpm typecheck` is a compatibility alias
  for that same emitting build, not a check-only command. CI starts from clean
  outputs, builds once, verifies a second incremental build would compile no
  project, then tests. `pnpm build:verify` always selects the repository project
  graph, even when its script is invoked from another directory. It launches
  the fixed pnpm command through `cmd.exe` on Windows and reports process-start
  failures separately from compiler diagnostics or pending rebuilds.
  A successful exit alone is insufficient: the verifier requires an explicit
  up-to-date compiler result for every project referenced by the root config.
  Empty output, version banners and incomplete project results fail the gate.
  Compiler path parsing preserves spaces and embedded apostrophes; an isolated
  real-compiler regression checks both a completed build and removed build outputs
  in such a checkout.
  The gate follows TypeScript's incremental decisions; it does not inspect the
  completeness of emitted artifacts. The clean build remains the check that
  regenerates all outputs.
  TypeScript does not remove old outputs when a source file is deleted or moved;
  clean the output directories before checking artifact completeness after such
  changes. Shape client tests place temporary generated consumers outside their
  project's include globs and verify that exclusion with the real compiler, so
  an overlapping build cannot turn those fixtures into orphaned test outputs.
  The CLI package build covers only its TypeScript dependency graph, not
  every root project: solver, solver-z3 and scenario have separate root
  references. Use the root `pnpm build` when validating repository-wide
  changes; a successful CLI build does not typecheck tests in those packages.
  Source tests run through type stripping, so their passing runtime assertions
  do not replace this compiler check.
  Package `prepack` scripts emit the JavaScript and
  declarations published to npm.
  The CLI package build then consolidates private modules and rewrites their
  imports to public CLI subpaths. A forced root TypeScript build can restore
  workspace imports in `packages/cli/dist/src`; run `pnpm --dir packages/cli build`
  to restore the consolidated package layout. When comparing compiler outputs
  with previously packed output, apply the same consolidation step on both
  sides. An up-to-date incremental result alone does not verify this packaging
  transformation or installed module resolution.
- **Builtin test runner** — `node --test`, zero test dependencies.
  Process-cancellation regressions wait for descendant readiness and trigger
  survival probes after CLI exit; startup deadlines cannot establish whether
  a descendant survived cancellation under a loaded runner.
- **SQLite has an explicit adapter boundary.** Node uses builtin
  `node:sqlite` with no native modules; the browser playground injects SQL.js
  WASM. Transactions, full-text mode, extension loading, and snapshot support
  are declared capabilities instead of build-time module aliases. (The
  original request said "builtin mssql"; Node has no builtin MSSQL driver and
  the spec's storage model is SQLite/FTS5, so SQLite is the interpretation.)
- **SQLite schema changes are ordered migrations** (§13.2.1): version 0 is
  the legacy unversioned baseline and version 2 is current. Each forward step
  performs DDL, data backfill, structural validation, and `user_version`
  advancement in one immediate transaction. Open and database sync reject
  newer formats; rollback is restoration of a closed pre-upgrade copy, never
  a down migration.
- **Query SQL semantics are shared.** `@cavelang/store` exports composable
  `QuerySql` fragments for current belief, alias closure, and transaction-time
  boundaries. Store, query, shape, generated clients, and view consume them;
  cross-package conformance tests pin retraction, alias, and as-of results.
- **External claim records are versioned.** Storage rows stay inside
  storage-oriented APIs; `cave.claim/v1` carries transaction identity,
  semantic claims, canonical text, and provenance. CLI/federated query JSON
  composes it as `cave.query-match/v1`; MCP and export remain canonical CAVE
  text. Checked-in fixtures and strict decoders preserve old versions.
- **Scenarios separate evaluation from authority.** Rolled-back overlays feed
  versioned typed inputs to solver or ordinary deterministic evaluators.
  Evaluation results, recommendations, human decisions, action audits, and
  external-effect audits are explicit predecessor-checked artifact series;
  recording one never executes policy or mutates the hypothetical inputs.
- **Exact backup uses verified SQLite snapshots** (§13.2.2): `VACUUM INTO`
  captures a consistent online WAL-aware snapshot in a temporary sibling;
  integrity, foreign keys, current schema, fsync, and SHA-256 gate atomic
  publication. Restore verifies the source and temporary copy, rejects stale
  WAL/SHM sidecars, and atomically publishes identical snapshot bytes.
  Verification also rejects source sidecars: metadata must describe the same
  standalone bytes being hashed and copied, never additional WAL-only rows.
  Live stores first pass through the online backup operation. Verification and
  restore accept versioned schemas 1 through the current version, validating
  their recorded structure without migration. Restored older bytes upgrade only
  on a later writable open; the retained snapshot and checksum remain unchanged.
  Backup and restore publication both require destinations without sidecars,
  even with force, and cannot target a sidecar belonging to their source.
- **Runtime dependencies stay at feature boundaries.** The parser uses
  `@prelude/parser`; highlighting uses `web-tree-sitter`; web ingestion uses
  `@mozilla/readability` and `linkedom`; report code-block, inline-span and literal HTML boundaries use
  `mdast-util-from-markdown` with `mdast-util-gfm-footnote` and
  `micromark-extension-gfm-footnote` (also production dependencies of the CLI
  that packages the view module); and the opt-in `solver-z3` adapter
  alone depends on the official threaded `z3-solver` Wasm distribution.
  Website-only dependencies include React, Markdown rendering, `sql.js`, and
  Tree-sitter. The domain and solver-neutral model packages remain
  dependency-free.

```sh
pnpm install
pnpm test          # all packages, bottom-up
pnpm build          # typecheck + emit; pnpm typecheck is an alias
pnpm --filter @cavelang/loop demo
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
  `x EXISTS`, comparisons become metric claims with canonical verbs
  (`EXCEEDS`, `IS-BELOW`, `IS-AT-LEAST`, `IS-AT-MOST`, `EQUALS`, or
  `DIFFERS-FROM`),
  `UNLESS` becomes `WHEN` + negation. Grouped full claims link with the
  `QUALIFIES` edge role from §13.2's role list.
- **Terms are stored formatted** (literals keep their delimiters) so
  `` `<=` `` the code literal never collides with an entity spelled the
  same, while entity queries from §13.5 work verbatim.
- **Traversal defaults**: graph reads (store, query, loop) skip negated
  and `@ 0%` rows; contradictions still coexist as data (§9.4).
- **Alias closure is union-of-rows** (§13.6):
  opt-in `aliases` on store traversal and CAVE-Q widens matching through
  current positive `ALIAS` claims (undirected recursive CTE), but stored
  rows, claim keys and bindings are never rewritten to a canonical name —
  aliased entities keep separate belief series, and disagreements surface
  side by side instead of merging silently.
- **Actor provenance stamps in the store, surfaces choose the actor**
  (§9.5): `store.ingest`/`insertResult` take `{ source }` and stamp
  `@src:<source>` on claims without a `src:` context *before* keying, so
  the same fact from different actors keeps separate belief series
  (§9.4). `cave add` passes `cli`, the MCP server `agent/<client-name>`
  (from the initialize handshake; `--src`/`--no-src` override), stdout
  ingest `ingest` (stable across batches and source revisions so updates do
  not fork claim keys) — and `cave import` passes nothing, because interchange
  replay must preserve exported claim keys.
- **Retention is permanent** (§9.6): retraction is an append-only belief
  update, not erasure; store, export/import, and sync expose no selective
  redact path. Accidental sensitive-data recovery is whole-copy quarantine
  and reviewed rebuild, outside the claim model.
- **Publication is sensitivity-scoped** (§9.7): rows are ordered by
  `#sensitivity:public|internal|confidential|restricted`; unlabeled is
  `internal`, malformed/unknown fails closed to `restricted`, and export,
  report, and serve default to an `internal` ceiling. Current belief resolves
  before filtering, hidden edge endpoints are pruned, and view summaries run
  over a scoped snapshot so counts, aliases, history, search, and lineage do
  not leak excluded rows. Complete text history requires an explicit
  `restricted` ceiling; exact SQLite backup is unfiltered and preserves all
  labels.
- **Source spans retain both anchor and identity** (§9.8):
  `SourceSpan` formats/parses `src:<escaped-source>#Lx-Ly`; the exact context
  survives interchange while §26 source policy ignores the line fragment.
  Embedded local ingest text is retained when its digest is selected, so later
  batches use that same source version even if files change. Store context still
  refreshes between batches using current, non-retracted beliefs, so later
  prompts see staged updates without superseded values. Related-claim search
  retrieves at most five current matches per path token, filtering historical
  rows before the limit so revision history cannot crowd out current knowledge.
  Non-embedded batches recheck file digests before
  and after agent calls; changed/unreadable inputs reject the batch and withhold
  digests. Strict discards staging; lenient retains already committed direct
  agent writes while continuing. Ingest prompts line-number embedded text, connect carries CSV/TSV/JSONL
  record ranges, and view/report outputs share the parsed location/link shape.
- **Provenance dimensions are explicit** (§9.5.1): `cave_provenance`
  separates actor, physical source, lifecycle run, and domain while compact
  contexts and claim keys remain unchanged. Store appends classify dimensions
  before compatibility stamping; connect/rules/actions/automations own rows by
  `run`, resolution reads actor/source, sync preserves the side table, and open
  conservatively backfills old stores.
- **Typed clients are versioned schema projections** (§20.4): current
  expectations normalize in code-point order, hash with SHA-256, and emit
  interfaces plus store-backed readers. Exact-one fields check runtime shape;
  inverse relations reuse registry traversal. Invalid tags, conflicting
  declarations, name collisions, and unsupported format versions fail before
  output; generation never writes the store.
- **Checking is a read; gating is a transaction** (§20):
  `@cavelang/shape` evaluates in-band `EXPECTS` declarations with SQL
  over current beliefs and never writes; `cave add --check` wraps
  ingest + re-evaluation in the store's savepoint-based (nestable)
  `transaction` and rolls back appends that introduce new violations —
  in-memory registry declarations included, so rolled-back claims can't
  leave vocabulary behind.
- **Connect maps exactly and diffs by provenance** (§23):
  `@cavelang/connect` substitutes record fields into CAVE-Q-style `?field`
  slots textually and pushes the result through the ordinary
  parse → canonicalize → append pipeline; each record's claims carry
  `@src:connect/<name>/<key>` (so a changed record retracts what it no
  longer yields), and `connect-digest` claims — computed over the
  *instantiated* text — make re-runs row-level incremental. `--query` runs
  a CAVE-Q pattern over the store + mapped claims inside a rolled-back
  transaction: query-time federation without persisting. Direct and declared
  URL loads combine caller cancellation with the fetch timeout. Preparation and
  discovery check aborts before applying loaded data; discovery disposes its
  snapshot, and watch shutdown suppresses queued passes and closes subscriptions.
  Ordinary declared passes retain only sources committed before cancellation;
  dry-run/query discovery publishes no cancelled result.
- **Rules are claims; derivations are appends** (§24): `@cavelang/rules`
  stores each rule as `rule/<digest> HAS rule: `…`` (digest over
  normalized text), joins premises by specializing CAVE-Q patterns per
  binding, and appends conclusions stamped `@src:rule/<digest>` with
  `BECAUSE` edges to the exact premise rows and a `VIA` edge to the rule.
  Confidence is `@cavelang/fusion` noisy-AND (max across derivations of
  one key); per-rule `derive-watermark` claims make re-runs skip rules no
  new row could affect only when the companion vocabulary/evaluation-policy
  fingerprint also matches. Changes to alias matching or the confidence floor
  re-evaluate support without `--full`. Idempotency makes re-fires append nothing, and
  support is recomputed per firing so retracting a premise retracts the
  dependent chain — mutually-supporting cycles included.
- **Actions are named rules the caller fires; hooks stay out-of-band**
  (§25): `@cavelang/act` reuses the §24.1 line shape under
  `action/<name> HAS action: `…`` — bare `?param` segments declare
  caller-supplied bindings, premises gate (no solution → nothing appends,
  no noisy-AND — an action is the caller's assertion), effects append
  atomically with `@src:action/<name>` stamps and `BECAUSE`/`VIA`
  lineage, inside the §20.3 shape gate by default. Identity is the
  *name*: one evolving declaration series per subject, resolved
  newest-across-actor-series. Executable side effects never enter the
  store — the claim names a hook, the shell template lives in config
  (`--hooks`), runs strictly after commit with shell-quoted placeholders
  and the appended claims on stdin, and its failure is reported, never
  rolled back. `cave mcp` generates one `act_<name>` tool per current
  action, recomputed per `tools/list`.
- **Evals score normalized keys against self-checked fixtures**:
  `@cavelang/eval` runs each case in a fresh throwaway
  store through `@cavelang/ingest` (one agent contract everywhere), then
  canonicalizes both golden and produced claims, strips §9.5 actor
  stamps (`src:cli`, `src:agent/*`, `src:ingest`) before re-keying —
  which surface wrote a claim must not move its key, while
  fixture-authored content sources stay identity — and matches on
  key + value (relative `--tolerance`, unit-strict). Query expectations
  are exact solution sets written as `cave query` prints them; fixtures
  self-check against their own goldens before any agent run, and the
  optional judge only ever adds a parallel judged score.
- **The LLM loop policy spends the model on select/stop only**
  (spec §18): `llmPolicy` sends one completion per
  step — the query, the collected claims as canonical CAVE, the scored
  frontier — and the reply is the next cue or `STOP` (stop rides on
  select; the `done` budget check costs nothing). Edge scoring stays the
  heuristic arithmetic, so prompt scores mean the same under both
  policies; lenient reply parsing degrades to the strongest cue while
  agent *errors* propagate as failures. The model stays out-of-band
  (§19.5) behind `shellComplete` — the `cave ingest`/`cave eval`
  `--agent` shell-template contract. Every external-command integration uses
  the same bounded runner: ordinary executable/argument arrays never enter a
  shell; intentional templates select `/bin/sh` or PowerShell 7 and
  quote placeholders for that platform; timeout, cancellation, and output
  limits terminate the complete process tree with typed, command-redacted
  diagnostics. The heuristic baseline is
  runnable machinery: eval reconstruction cases (`<stem>.loop.cave`,
  ordinary CAVE lines about the entity `loop`) score either policy's
  reconstruction by claim key, answering queries from the reconstruction
  alone.
- **Suggestions are questions, not merges** (§27): `@cavelang/shape`
  proposes same-entity pairs from deterministic, explainable signals —
  string similarity and exactly-two-carriers textual attribute values
  generate, shared relation neighbors only boost (siblings share
  parents) — and emits `dupe ALIAS canonical #suggested` at `score/2`
  confidence clamped to the §20.2 review band (0.3–0.5). Text out by
  default (review is a pipe into `cave add`); `--write` stamps
  `@src:suggest/alias`. Any recorded `ALIAS` history between a pair —
  merged, negated or retracted — excludes it, so review decisions stick
  and written re-runs append nothing; the optional judge is the
  ingest/eval shell-agent contract (§19.5), filtering candidates without
  ever raising a confidence or writing.
- **Resolution is a read mode; the policy is knowledge** (§26): contested
  facts — one fact asserted by several §9.5-forked series, or opposite
  polarity — group by claim key modulo `src:` contexts and negation
  (computed in SQL from the stored key's JSON, so `resolve` composes with
  `asOf` and the alias closure mechanically), and one window ranks
  candidates by precedence class (max over sources), reliability-weighted
  confidence (min over sources), then tx. Precedence and reliability are
  in-band `source/<name> HAS …` claims matched by longest segment prefix
  over a built-in ladder (cli > agent/action > root > rule); the policy
  claims themselves resolve under the built-ins alone, so ingested text
  cannot self-elevate. Winners are stored rows returned verbatim —
  nothing is rewritten, and unresolved reads keep §9.4 coexistence.
- **The id is the row; the store is the monotonic authority** (§28):
  every append mints one UUIDv7 serving as both `id` and `tx`, and
  `@cavelang/sync` merges by that identity — absent rows copy verbatim
  (claim key, raw line, side tables), present rows skip, so re-syncs are
  idempotent, chains are transitive, and the same fact recorded on two
  machines lands as two rows in one belief series (asserted twice, §9.4).
  The generator applies the Lamport receive rule (`Uuidv7.observe`): a
  store's `MAX(tx)` is observed at open and after merge. Before minting,
  each outer write reserves SQLite's write lock and observes `MAX(tx)`
  again, so concurrent processes allocate in commit order despite clock
  skew. Every append therefore outsorts everything already stored — local
  knowledge always wins locally, whatever the origin clocks read. Merge events append in-band
  `store/<from> SYNCED-INTO store/<into> @src:sync` records (only when
  effective); text interchange carries identity through `;@ <tx>` comment
  lines (`cave export --tx`), transparent to the grammar, strict on
  replay (`cave sync`), and gracefully ordinary under plain `cave import`.
  Edges form a graph and text a tree, reconciled by *re-statements*: the
  emitter renders a row's children once and re-states the claim line
  alone (same annotation) under each further citing parent — shared
  premises, a rule's `VIA` row, §24.5 support cycles — and replay unions
  identical re-statements back into one row while conflicting repeats
  reject whole. The §28.6 branching convention rides on this with no new
  surface: the committed `--tx` export is the store, working stores
  rebuild by `--no-record` sync (a checkout is plumbing, landing is a
  recorded merge), review is the export diff, and text-level git
  conflicts re-export as the union (documented merge driver).
- **Automations fire on events, never on state** (§29):
  `@cavelang/automate` evaluates triggers with the same §24.2 join rules
  and actions use, but a solution fires only when it cites a row newer
  than the automation's in-band `automate-watermark` — absent one, the
  declaration row's tx, so declaring arms the watcher and pre-existing
  matches stay state. A transitive (`VERB+`) premise cites its
  supporting edge rows (CAVE-Q's opt-in `support` option), so a new
  edge fires exactly the solutions whose connection it backs and the
  supporting path rides into hooks and prompts. Rows stamped by engine bookkeeping
  (`src:cave-automate`/`cave-derive`/`cave-act`) or by the automation's
  own steps (`src:automation/<name>`, its actions' `src:action/<x>`)
  are never events for it — no self-wakes, while cross-automation
  chains work and converge on the idempotent write paths (§24.4, §25.2,
  and the agent-reply guard, which skips reply claims equal to current
  belief). The watermark appends *before* steps execute, so a crash
  drops outside-world steps rather than replaying them — §25.4's
  never-re-notify stance — and quiescent cycles append nothing. Step
  execution reuses the §25 machinery wholesale: `action/` steps call
  `act()` (gate, lineage, hooks included), `hook/` steps read the same
  `--hooks` configuration, prompt steps ride the `shellComplete` agent
  contract (§19.5 — commands stay out-of-band; the store names hooks
  and phrases prompts).
- **The read surface reads, structurally** (§30): `@cavelang/view`'s
  view models are plain functions over a store — nothing in the package
  writes — and the server refuses every non-GET method, so read-only is
  a property of the surface, not a discipline. The page is one static
  HTML document (inline style and script, CSP `default-src 'none'` with
  self-only connections): claims render from stored columns and side
  tables, never by re-parsing text — the tree-sitter grammar stays the
  single grammar source, and no client-side parser exists to drift —
  while `raw_line` is shown where the authored text is the point.
  Binding is `127.0.0.1` unless `--host` widens it deliberately. Every model
  runs against a §9.7 sensitivity-scoped projection, not against full-store
  results scrubbed afterward. Narrow audiences reuse immutable, indexed
  projections keyed by source revision and sensitivity ceiling. Transactional
  reads use disposable projections because SQLite change counters do not rewind
  on rollback; adapters without transaction-state inspection also bypass reuse.
  Store cleanup
  hooks close all cached projections when the source store closes; HTTP-handle
  closure retains caller ownership of that source. Local writes
  and commits from other connections invalidate them before the next read,
  while an explicit `restricted` read uses the complete store directly.
- **Reports render deterministically or mark the hole** (§31):
  `cave report` (also `@cavelang/view`) walks the template line by
  line — fenced `cave-q` blocks render a fragment per CAVE-Q solution
  (`?var` substituted longest-name-first, unbound tokens passing
  through), inline splices demand exactly one variable and one
  solution, and every failure renders a visible marker, lands on
  stderr with the template line, and fails the exit code — a
  deliverable never silently drops a fact. Citations dedupe by row id
  into `[^cN]` footnotes built from the *canonical* line (`emitClaim`
  over the stored row and side tables — §9.5 stamps live in the
  context table, and provenance must not hide), the tx date and the
  claim key; the §9.7 audience ceiling and §12.3/§13.6/§26.4 read opt-ins
  forward to every query in the template unchanged.
- **The standard prelude is opt-out, not baked in**: no verb is born with
  an inverse (§5.5), but `@cavelang/store` and the CLI default to the shared
  §5.5 prelude registry (`--no-prelude` / `Registry.empty` to opt out).

## Status vs the spec

Numeric value parsing checks finiteness after multiplier normalization.
Oversized scalars or trajectory endpoints retain their authored text as atoms,
so storage does not receive infinity from those literals.
Multiplier normalization shifts the decimal exponent before one numeric
conversion, avoiding intermediate underflow and double rounding. A nonzero
literal whose scaled value still rounds to zero stays textual instead of
acquiring a false zero numeric projection.
`Claim.of` also rejects non-finite metric/attribute numeric fields and confidence
outside the finite `[0, 1]` interval, enforcing numeric boundaries for callers
that construct claims directly rather than parsing text.

Trajectory interpolation preserves clamped endpoints directly and uses a
weighted sum for opposite-sign endpoints to avoid overflowing their difference.
Display formatting retains the finite unscaled value if four-digit rounding,
including multiplier expansion, would overflow. These safeguards preserve the
§32 linear model at floating-point extremes.
Interpolation range selection rejects open ranges rather than ignoring them:
a closed range combined with an open range remains ambiguous, even though
either range may independently make the claim visible to an `at` query.

- **Normative spec**: implemented, including legacy acceptance
  (colonless attributes parse, emitters always produce the colon form).
- **Draft history (§17)** — rules `=>` passed the parser gate and are
  committed + implemented as §24 (`@cavelang/rules`, `cave derive`);
  temporal layer 2 passed it too and is committed + implemented as §32
  (trajectory values in `@cavelang/core`, time contexts in `Time`,
  interpolation in `@cavelang/query` / `cave query --at`). The remaining
  sketches are resolved non-features: stored claims stay fully bound,
  qualifier/provenance edges replace `[S V O]` values, and executable
  `(t -> expr)` formulas stay in external evaluators. CAVE-Q's contextual
  `?x` layer (§12) is implemented. The durable rationale and evidence needed
  to revisit these boundaries live in `PROJECT-BOUNDARIES.md`.
- **Non-normative agent layer (§18)**: implemented as `@cavelang/loop`,
  including the LLM-driven policy over shell-agent templates
  with the heuristic policy as its eval baseline.
