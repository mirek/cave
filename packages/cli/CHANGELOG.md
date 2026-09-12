# @cavelang/cli

## 0.36.2

### Patch Changes

- Updated dependencies [9207b82]
- Updated dependencies [9e9d967]
  - @cavelang/core@0.36.2
  - @cavelang/canonical@0.36.2
  - @cavelang/fusion@0.36.2
  - @cavelang/parser@0.36.2
  - @cavelang/query@0.36.2
  - @cavelang/store@0.36.2
  - @cavelang/highlight@0.36.2

## 0.36.1

### Patch Changes

- Updated dependencies [7a3cad1]
  - @cavelang/core@0.36.1
  - @cavelang/canonical@0.36.1
  - @cavelang/fusion@0.36.1
  - @cavelang/parser@0.36.1
  - @cavelang/query@0.36.1
  - @cavelang/store@0.36.1
  - @cavelang/highlight@0.36.1

## 0.36.0

### Minor Changes

- b3f5de7: Add opt-in current-only store search and use it for ingestion context, filtering superseded and retracted rows before the result limit.
- b3f5de7: Reject automation polling intervals outside the runtime timer range before opening the database, preventing overflow from creating a 1 ms polling loop.
- b3f5de7: Reject process deadlines beyond the timer range before launching commands or synchronous bridge workers, preventing immediate timeout on overflow.
- b3f5de7: Add cooperative AbortSignal support to automation settling and watch cycles.
  Stop claiming or executing after cancellation, discard late agent replies,
  and yield between watch settles so busy daemons can stop cleanly.
- b3f5de7: Add synchronous store cleanup hooks and close cached sensitivity projections when their source closes, attempting all resource cleanup even after errors.
- b3f5de7: Preserve explicit provenance dimensions in optional JSON transaction-annotation
  payloads. Validate payloads and identity agreement before replay, preserve empty
  sets, and retain legacy bare annotations and ordinary imports. Database copies
  now preserve authoritative provenance tables without adding inferred entries.
- b3f5de7: Apply shared strict validation of cardinality and unit tags to runtime shape readers and gates, matching client generation instead of silently weakening malformed constraints.
- b3f5de7: Expose automation report completion explicitly. Pass exhaustion and unfinished
  rule derivation no longer count as successful settling: text reports say
  incomplete, JSON includes complete, and automate --once exits nonzero while
  preserving committed watermarks for resumption.
- b3f5de7: Reject non-finite numeric fields, including nested structured values, before SQL staging can replace them with NULL or pass through infinities.
- b3f5de7: Resolve connector fields only from own properties, treating inherited JavaScript properties as missing while preserving explicit JSON keys and nested array access.
- b3f5de7: Preserve prototype-named rule variables and require supplied action arguments to be own properties instead of inherited JavaScript values.
- b3f5de7: Compare action-effect confidence exactly so small revisions, explicit retractions and reactivation are applied instead of being skipped by an absolute tolerance.
- b3f5de7: Generate alias suggestions with canonical emission, reversing undirected relations when needed to retain numeric-looking entity names. Report an explicit error when neither orientation is representable, preserving preferred-name fields and atomic write validation.
- b3f5de7: Compare automation reply confidence exactly so tiny revisions, retractions and reactivation are stored while identical unreferenced claims remain deduplicated.
- b3f5de7: Deduplicate automation replies against earlier claims in the same response, preserving change-and-restoration sequences and suppressing consecutive equal unreferenced claims.
- b3f5de7: Preserve computed rule confidence through threshold checks and storage, retain small confidence revisions, and re-evaluate older rounded-confidence watermarks on the next derivation.
- b3f5de7: Expose non-default sigma levels in structured ClaimView records and render them beside uncertainty deltas in the local viewer, preserving uncertainty meaning across entity and history views.
- b3f5de7: Add a read-only store.search diagnostic to detect missing, duplicate, orphaned, and stale search entries. Keep text-store and declared-source load errors private in shareable doctor reports. Document the new check and its limits in the CLI reference, architecture, and book.
- b3f5de7: Reject CSV/TSV rows with excess cells instead of silently discarding values beyond the header, preserving existing missing-cell defaults.
- b3f5de7: Reject unterminated CSV and TSV quoted fields with their opening line number before mapping or pruning can change the store.
- b3f5de7: Require Node 24.16.0+ or 26.1.0+ for lossless native SQLite text, reject truncating bindings before opening caller databases, and align engines, doctor, CI and documentation.
- b3f5de7: Refresh vocabulary, deduplicate and insert automation replies under one write transaction, preventing competing commits between reads and writes and rolling back thrown failures.
- b3f5de7: Verify and restore supported historical snapshot schemas without changing their bytes; migrate only on a subsequent writable open.
- b3f5de7: Extend ingestion cancellation across source fetching, cooperative in-process agents, batch boundaries and strict staged publication, preserving prior accepted lenient work.
- b3f5de7: Share JSON array answer extraction across judges. Prevent evaluation scores from using pairs hidden in strings or unrelated object fields while preserving the explicit pairs wrapper. Export lastJsonArray through the CLI loop surface.
- b3f5de7: Share the iterative JSON syntax index through the agent layer and use it in alias reply parsing, avoiding repeated decoding of overlapping malformed candidates. Export jsonValueEnds through the CLI loop surface and retain evaluation recovery behavior.
- b3f5de7: Reject duplicate CSV/TSV header names after trimming instead of silently keeping the later cell, including header-only sources and SQL staging.
- b3f5de7: Reject non-scalar and non-finite connector record keys instead of coercing them into colliding identities, preserving pruning safeguards for unidentified records.
- b3f5de7: Add opt-in strict UTF-8 process stdout validation with a typed encoding failure, and enable it for shell agents used by ingestion and evaluation.
- b3f5de7: Require positive safe integer automation pass limits before processing pending work or opening the CLI database.
- b3f5de7: Reject stray CSV quotes and text following closed quoted fields before mapping or pruning, reporting the physical source line instead of silently altering values.
- b3f5de7: Validate rule, action, and automation preludes before trusting cached digests.
  Invalid preludes now reject the declaration call without appending partial
  rows or declarations, including retries against older cached failures.
  Also return failure from cave derive for declaration errors in text and JSON.
- b3f5de7: Reject invalid evaluation repetition counts before suite discovery or agent work, requiring positive safe integers in the library and CLI.
- b3f5de7: Reject non-finite and out-of-range evaluation tolerances before agent work and in direct scoring calls, enforcing the documented 0–1 range.
- b3f5de7: Require positive safe-integer ingestion batch sizes and validate them before source selection, rejecting invalid CLI sizes before opening a database.
- b3f5de7: Reject invalid rule confidence thresholds and pass limits before derivation writes, and require safe integer pass counts in the CLI.
- b3f5de7: Validate health and alias-discovery options before database reads, and require positive safe-integer suggestion limits in both the library and CLI.
- b3f5de7: Validate CSV/TSV delimiters in the shared reader, rejecting empty or multi-character delimiters and quote/newline conflicts before parsing any source.
- b3f5de7: Make suggest-alias --json --write perform the requested write and return selected suggestions with the actual appended count, rather than silently returning a preview.

### Patch Changes

- b3f5de7: Accept CRLF line endings in stdout ingestion fences so valid extracted claims and source digests are recorded under both strict and lenient policies.
- b3f5de7: Recognize tab-separated WHERE clauses in evaluator fixtures and route incomplete clauses through query validation.
- b3f5de7: Avoid repeatedly copying accumulated context arrays when database sync infers provenance for legacy stores.
- b3f5de7: Add task navigation to the connector guide and expose focused sections for federated records, cancellation and watch lifecycle.
- b3f5de7: Add a keyboard-visible skip link to the local viewer so users can bypass the header without changing the current route or reloading data.
- b3f5de7: Include changeset validation in the aggregate CI gate, allowing skipped validation
  only for the workflow's push and release-branch exceptions.
- b3f5de7: Score alias candidate pairs in their first shared group to avoid retaining an all-pairs deduplication set while preserving suggestions and ranking.
- b3f5de7: Align the repository maintenance regression with full dependency audit coverage, preserving the failing ownership-report contract.
- b3f5de7: Align the architecture overview with bounded URL fetching and the distinction between accepted staged batches and committed source digests.
- b3f5de7: Correct the implementation guide's stale ingestion actor identity and document current-belief context refresh and its candidate limits in the design references.
- b3f5de7: Advertise strings, numbers and booleans in generated MCP action parameter schemas,
  matching the engine's existing scalar support, and disallow unknown argument names.
- b3f5de7: Align MCP derivation exhaustion with the CLI incomplete marker, explain retained-work reports to agents, and verify same-session preview, history preservation and retry.
- b3f5de7: Order revised in-memory reconstruction claims by their latest occurrence so equal-score traversal matches SQLite under bounded step budgets.
- b3f5de7: Align the playground query prompt with its first line and clarify the browser suite's engine coverage.
- b3f5de7: Index in-memory reconstruction evidence by entity in transaction order so mixed incoming and outgoing claims match SQLite without sorting each lookup.
- b3f5de7: Clarify historical MCP search and the programmatic scope of current-only store search, and correct the CLI serve reference to include HEAD support.
- b3f5de7: Create external ingestion-plan MCP configurations only after a batch prompt is ready, avoiding unused artifacts for empty or failed plans.
- b3f5de7: Anchor generated-client test fixtures to the test module rather than the process working directory, preserving workspace import resolution when running the shape suite from either the repository root or package directory.
- b3f5de7: Expose local viewer loading, completion and error states to assistive technology while ignoring stale navigation responses.
- b3f5de7: Append report footnotes iteratively so large citation lists do not exceed JavaScript's function-argument limit.
- b3f5de7: Claim automation batches atomically with refreshed declarations and vocabulary,
  preventing duplicate concurrent firings and firing revoked automations. Commit
  watermarks before executing steps, and reject settling inside caller-owned
  transactions before any derivation or batch claim.
- b3f5de7: Add an executable alias-suggestion identity audit and document the discovered numeric-target payload defect and required regression scope.
- b3f5de7: Extend the production documentation link audit to cover page links without fragments and save a rendered link inventory alongside section-target checks.
- b3f5de7: Extend the production documentation audit to detect duplicate IDs across each rendered page and include them in the reviewable link inventory.
- b3f5de7: Extend the independent Python Fraction audit to public exact comparison, covering signed large operands and invalid denominators alongside normalization and arithmetic checks.
- b3f5de7: Extend the independent Python Fraction audit through explanation arithmetic, checking signed rational results and indeterminate division by assigned zero after bigint normalization changes.
- b3f5de7: Extend the independent Python Fraction audit to exact product constants used by linear analysis, covering two- and four-factor signed, zero and cancelling products. Preserve reproducible runtime reports and document the expanded 9,216 checks.
- b3f5de7: Add a reproducible differential audit of in-memory and SQLite reconstruction adapters, including synchronous and awaited traversal across generated claim histories.
- b3f5de7: Report invalid solver limit objects and functions without invoking caller-defined coercion, retaining the named limit validation error for malformed values.
- b3f5de7: Recognize zero products after all explanation operands are evaluated and type-checked, avoiding unnecessary nonzero intermediates while retaining arithmetic errors. Add bounded measurements and hard/soft constraint regressions.
- b3f5de7: Avoid scenario comparison cross-products for positive-denominator values with zero, opposite-sign or equal numerators while preserving general signed-fraction ordering.
- b3f5de7: Await initialized MCP server cleanup after unexpected transport closure and retain cleanup failures alongside the original input-buffer error.
- b3f5de7: Parse complete alias-judge JSON arrays so nested arrays and quoted bracketed numbers cannot accidentally confirm and write aliases.
- b3f5de7: Batch alias health-report scope context reads while preserving structured context boundaries and actor provenance semantics.
- b3f5de7: Batch generated-client constraint tags by declaration and append grouped fields without repeated copies, preserving deterministic output while reducing large-schema query counts.
- b3f5de7: Extend the report benchmark with large empty and padded live blocks, checking exact diagnostics and rendered output beside timing samples.
- 0606c05: Keep the book's doctor example valid across releases by using the existing version-token placeholder for the installed CAVE version.
- b3f5de7: Bound grammar toolchain downloads with a configurable five-minute default deadline, validate settings before cache creation, and wait for parallel cleanup before reporting setup failures.
- b3f5de7: Limit ingestion URL selection to eight concurrent fetches while preserving source order, isolated failures and cancellation of queued work.
- b3f5de7: Bound alias edit-distance work by the existing similarity threshold, preserving exact qualifying scores and verifying against a full-matrix reference.
- b3f5de7: Retain only the requested best alias suggestions during limited discovery, preserving the exact ranking of an unlimited run followed by slicing.
- b3f5de7: Deduplicate ingestion context path-token searches and stop lookups once the related-claim budget is filled, preserving prompt content and order.
- b3f5de7: Add a documented Down Arrow shortcut from the documentation filter to its first matching page, preserving modified keys, IME composition and empty-result behavior.
- b3f5de7: Apply a cumulative numeric-digit budget to sensitivity samples and fixed bindings before exact normalization, preventing padded values from bypassing input-size protection.
- b3f5de7: Reuse stored identity comparisons within text-sync validation to accelerate repeated graph references without skipping per-occurrence checks.
- b3f5de7: Precompute alias candidate name features once per discovery call and add a deterministic benchmark that verifies unchanged suggestions as unrelated candidate groups grow.
- b3f5de7: Stop pending automation declaration stdin reads on cancellation, discard their buffered claims, and remove input listeners without destroying caller-owned streams.
- b3f5de7: Propagate cancellation through declared URL preparation and discovery, prevent application after abort, and stop queued watch work while preserving resource cleanup.
- b3f5de7: Propagate caller cancellation through direct connector URL fetches and body reads, and reject returned records before mapping or committing after abort.
- b3f5de7: Reject already-cancelled shell completions before creating prompt files, preserving the cancellation reason even when prompt-file writes would fail.
- b3f5de7: Capture action execution options once so dry runs remain rolled back and never resolve hooks when option getters change.
- b3f5de7: Reuse validated action parameter values for post-commit hooks, preventing accessor re-reads and omissions of non-enumerable own arguments.
- b3f5de7: Capture the alias-discovery result limit once so validation and candidate collection use the same programmatic value.
- b3f5de7: Capture alias judge candidate order, descriptions and endpoints before evidence reads, preventing caller mutations from mixing different pairs in a single prompt.
- b3f5de7: Capture and validate process stdin before launch in both runners, preserving non-enumerable input and preventing getter changes or invalid input from affecting an already-started child.
- b3f5de7: Validate and capture SQL source headers before staging so malformed or changing schemas cannot silently disable missing-column validation.
- b3f5de7: Capture the automation command's cancellation signal once so already-cancelled invocations cannot proceed to declaration retraction.
- b3f5de7: Capture automation cycle options so replacing caller settings during pending completions cannot disable cancellation or alter execution settings.
- b3f5de7: Capture the evaluation comparison tolerance once so every fact is scored with the validated setting, including when callers supply a changing getter.
- b3f5de7: Capture connector command context at entry so a changing signal getter cannot bypass pre-cancellation and create or modify a database.
- b3f5de7: Capture connector options before processing records so changing getters cannot enable unintended pruning or switch pass configuration after work begins.
- b3f5de7: Read each referenced connector record field once per record and reuse its value for repeated template slots and keyed bookkeeping. This keeps claims and digest identity consistent when programmatic records use changing getters.
- b3f5de7: Capture declared-source discovery settings before snapshot allocation so changing caller options cannot hide cancellation during asynchronous source reads.
- b3f5de7: Capture query and instruction options once per direct selection-prompt call so changing getters cannot replace or erase the checked values during rendering.
- b3f5de7: Capture programmatic diagnose database and hook options once before inspection, keeping configured-source reporting and hook selection consistent when options use changing getters.
- b3f5de7: Capture entity-view options before reading so alias-expanded facts, relationships and activity use one consistent configuration even when callers supply changing getters.
- b3f5de7: Capture the evaluation command's cancellation signal once, preserving the initial signal or its absence through suite execution and result rendering. Add regressions for changing context getters and cancellation during fixture loading.
- b3f5de7: Capture evaluation retention at startup so changing keep during an agent run cannot delete reported databases or leave unreported temporary results behind.
- b3f5de7: Capture evaluation settings before fixture discovery so repeated runs cannot switch agents or scoring configuration after asynchronous caller mutations.
- b3f5de7: Capture scenario definitions before explanation validation so returned provenance queries always match the definition whose digest was checked.
- b3f5de7: Copy scenario input records before explanation validation so changing getters and later caller mutations cannot replace the values associated with a checked input digest.
- b3f5de7: Capture the ingestion command's cancellation signal once and retain it through source selection, execution and final checks. Prevent changing context getters from substituting another signal or hiding cancellation of the original signal.
- b3f5de7: Capture ingestion prompt settings and each file's path and content once, preserving consistent filenames, citations and embedded text for getter-backed inputs.
- b3f5de7: Capture ingestion run settings and source lists before staging so caller mutation cannot redirect strict publication to another store.
- b3f5de7: Capture the MCP configuration directory option once so write failures cannot delete caller-owned directories or leak helper-owned directories when a getter changes its value.
- b3f5de7: Capture MCP connection scope fields and copy permission/tool lists at setup.
  Caller mutations no longer change action permissions on an existing connection;
  permitted action declarations remain dynamic within the captured scope.
- b3f5de7: Read MCP source and hook options once per tool call. Changing getters no longer
  select a different provenance stamp within one call; configuration stays lazy
  and refreshes on subsequent calls, including recovery after lookup failures.
- b3f5de7: Capture MCP query arguments once so validation, pagination and rendered time labels use the same supplied values.
- b3f5de7: Capture fusion selectors, search limits, reconstruction inputs and export sensitivity once so programmatic MCP requests validate and use the same values.
- b3f5de7: Capture the MCP startup signal once so context changes cannot lose cancellation before the protocol server starts.
- b3f5de7: Capture the MCP transport signal for consistent cleanup and skip transport setup for already-cancelled serving calls.
- b3f5de7: Copy declared-source identity before synchronous or asynchronous preparation so fetched content cannot acquire a replacement name or path through caller mutation.
- b3f5de7: Capture the asynchronous process runner's abort signal once so changing options cannot miss cancellation or leave a listener attached to the original signal.
- b3f5de7: Capture process working-directory and environment options once, and preserve non-enumerable values through the synchronous bridge so children use the intended launch configuration.
- b3f5de7: Capture promptFor source paths, selected contents and settings before context lookup and file reads, keeping getter-backed source selection consistent throughout prompt assembly.
- b3f5de7: Capture query match fields before evidence projection so repeated getters or caller mutation cannot replace bindings, interpolation metadata or evidence rows during structured-record construction.
- b3f5de7: Capture reconstruction frontier entries before awaiting model completion so replies and heuristic fallback use the same names, scores and depths as prompt generation.
- b3f5de7: Capture reconstruction policy prompt settings at creation so awaited model callbacks cannot change the query, guidance or offered-cue limit for later steps.
- b3f5de7: Capture report query options once so every template query and citation uses consistent alias, resolution and time settings.
- b3f5de7: Keep rule execution on its validated confidence threshold and pass limit by capturing options before the write transaction.
- b3f5de7: Capture replay compatibility expectations once so changing getters cannot crash backend checks or produce diagnostics that disagree with the compared values.
- b3f5de7: Capture shell-agent cancellation and output limits once before process forwarding so changing getters cannot bypass them.
- b3f5de7: Capture shell-completion settings once so changing caller options or getters cannot bypass cancellation or output limits across agent calls.
- b3f5de7: Capture source-selection settings before asynchronous URL reads so batching uses the validated size and retains its cancellation signal.
- b3f5de7: Share connector batch validation with SQL projection so malformed or changing array entries cannot produce misleading filtered sources and pruning.
- b3f5de7: Capture semantic claims before validating and emitting structured records. Read claim getters during capture and keep returned terms, values, contexts and tags independent of later caller mutation.
- b3f5de7: Capture sync merge-record options before transaction callbacks can change the requested record or its source and target labels.
- b3f5de7: Use one captured dry-run decision for annotated-text sync transaction handling and reporting.
- b3f5de7: Capture topic alias settings before sensitivity projection work so adapter callbacks cannot change the configuration of an in-progress membership read.
- b3f5de7: Capture URL-selection refresh policy and cancellation across parallel requests so asynchronous option changes cannot alter source classification.
- b3f5de7: Capture the viewer search sensitivity ceiling once so result selection and linked-evidence counts cannot use different audiences.
- b3f5de7: Retain the viewer's original cancellation signal through startup and shutdown waiting so changing context getters cannot lose cancellation.
- b3f5de7: Keep watch-cycle cancellation and settings stable across repeated settle calls and caller report callbacks.
- b3f5de7: Avoid repeated array-front insertion when attaching long comment blocks to connector mappings, preserving order and optional-field removal.
- b3f5de7: Verify and document book transcript matching across blank lines and control characters.
- b3f5de7: Check the manifest's supported Node ranges before bootstrap probes or invokes package managers. Unsupported runtimes now receive an actionable diagnostic pointing to .nvmrc before dependency installation begins.
- b3f5de7: Validate literal bracket-form require and import.meta resolve lookups against runtime dependencies, matching the existing dot-form checks.
- b3f5de7: Check cancellation after automation premise preparation so a raised signal does not consume an unstarted batch.
- b3f5de7: Check cancellation before selecting or loading a CLI command so already-cancelled invocations consistently avoid command-specific I/O, including help output.
- b3f5de7: Keep runtime dependency checks active when grouping parentheses surround module calls, resolution receivers, literal resolve member names or literal import targets.
- b3f5de7: Exercise invalid report time options through the installed CLI and verify existing output remains intact.
- b3f5de7: Include literal import.meta.resolve lookups in the CLI runtime dependency guard.
  Undeclared or development-only lookup targets now fail the package build.
- b3f5de7: Report generated interface collisions with Store and CaveValue as naming problems instead of returning uncompilable client code.
- b3f5de7: Reject database sync when an existing row ID names different claim data or
  explicit provenance, before copying rows, lineage, or a merge record. Preserve
  compatibility with text replay, metadata reordering, and inferred provenance.
  Report conflicting IDs in text and JSON, including dry runs.
- b3f5de7: Detect historical rows and lineage added below a pagination cutoff, rejecting
  stale cursors and changes during page construction with a restart instruction.
  Preserve continuation across wholly future appends. Version opaque cursors to
  include a bounded append revision; keep the public page envelope unchanged.
- b3f5de7: Reject annotated-text sync when an incoming ID names different canonical
  interchange content from an existing target row, before adding rows or lineage.
  Accept equivalent canonical spellings and reordered contexts or tags.
- b3f5de7: Correct the hook-output contract to describe captured stream prefixes and verify which bytes survive an output-limit failure.
- b3f5de7: Document and verify metadata-only action template edits: unchanged effects preserve their stored tags and lineage until their key, value or confidence changes.
- b3f5de7: Clarify automation startup and polling serialization, and verify existing cancellation, watermark and diagnostic-failure recovery coverage.
- b3f5de7: Consolidate connector refresh failure and recovery guidance, distinguishing source rejection, record isolation, pruning rollback and transactional declaration replacement.
- b3f5de7: Verify generated inverse vocabulary across previews, lost support, reopen and rule retraction, and clarify the additive vocabulary exception in the rule reference, specification and book.
- b3f5de7: Correct duplicate-record diagnostics to identify the last successful record as the winner, and verify that failed duplicates preserve its claims while absent records are pruned.
- b3f5de7: Verify unchanged rule conclusions retain their historical evidence while support follows current premises, and clarify that distinction in the rule reference and local lineage viewer.
- b3f5de7: Document and verify literal phrase semantics for HTTP search, including FTS operator text and punctuation.
- b3f5de7: Clarify that automation steps can run during incomplete rule derivation, and verify that recovery preserves their firing watermark without replaying the step.
- b3f5de7: Clarify that accepted source status describes a batch outcome, strict publication depends on the whole run, and the failure count measures batches plus failed URL selections. Verify retry selection after rollback.
- b3f5de7: Document and verify ingestion digest behavior across source revisions, disappearance, restoration, and empty extraction.
- b3f5de7: Clarify that literal MCP fusion uses store vocabulary and optional alias grouping without selecting stored estimates or appending claims, and verify alias snapshot consistency.
- b3f5de7: Limit local viewer search submission to plain Enter, preserve modified and composing input, and advertise the shortcut and virtual-keyboard Search action.
- b3f5de7: Align architecture and shape-gate references with deferred action snapshots, and verify that malformed shapes block writes while unchanged actions remain read-only.
- b3f5de7: Clarify the reconstruction claim-count threshold as a check between complete expansions, and verify consistent synchronous and asynchronous stopping without an extra model completion.
- b3f5de7: Clarify that report citations identify matched claims without validating ordinary prose, and record verified output-failure behavior.
- b3f5de7: Clarify and verify that report bindings preserve Markdown text without evaluating inserted query splices.
- b3f5de7: Clarify synchronization API handling for rejected-source reports versus thrown file, schema, decoding and execution errors, including dry runs.
- b3f5de7: Document and verify sync JSON reports versus stderr-only source failures, including dry-run isolation and corrected-source retry.
- b3f5de7: Clarify sync failure outcomes and verify existing file rejection, attachment cleanup and corrected replay coverage.
- b3f5de7: Document and verify that viewer search retains superseded revisions and retractions as individually identified historical evidence.
- b3f5de7: Label viewer history as visible events and identify retracted series without calling a retraction a current belief.
- b3f5de7: Clean owned ingestion configuration directories after setup failures and place run configuration and prompts under one cleanup scope.
- b3f5de7: Close previously registered watchers if later registration fails during direct or declared connector watch startup.
- b3f5de7: Clean grammar SDK staging directories when extracted metadata cannot be read or written, preserving preparation and cleanup failures if both occur.
- b3f5de7: Release partially initialized automation stdin readers when listener registration or stream startup fails.
- b3f5de7: Remove shell-agent temporary prompt directories when writing the prompt file fails, preserving the original write error and allowing a clean retry.
- b3f5de7: Terminate spawned children and clean up partial registration when process startup throws.
- b3f5de7: Close the MCP store when startup announcement output throws by covering post-open startup work with the cleanup boundary.
- b3f5de7: Close MCP transport listeners before rejecting input-stream failures while preserving caller stream and store ownership.
- b3f5de7: Close unpublished sensitivity projections when post-copy revision verification fails, preserving the existing cache and later recovery.
- b3f5de7: Ensure viewer database cleanup runs after HTTP shutdown errors and verify cleanup for startup-announcement failures.
- b3f5de7: Preserve distinct generated-client fields when type or property names contain the separator previously used for conflict detection.
- b3f5de7: Compute health coverage counters and mean confidence in one current-belief aggregate, preserving negative, retracted, and empty-store semantics.
- b3f5de7: Compare exact rational cross-products directly instead of allocating their difference, with a reproducible large-fraction benchmark and unchanged operand validation.
- b3f5de7: Compare normalized explanation fractions directly for equality and inequality, avoiding cross-products while retaining ordering semantics. Add sign/zero/scaling regressions and bounded before/after measurements.
- b3f5de7: Add a repeatable shape-fact SQL comparison with ordered-result and retraction checks, and document why a blanket grouped-query replacement is not adopted.
- b3f5de7: Compute relative scoring error directly so rounding a subnormal tolerance threshold cannot accept values outside the requested tolerance.
- b3f5de7: Keep text sync identity comparison independent of tag order when distinct Unicode tag names collate equally.
- b3f5de7: Compare evaluator query binding records independently of insertion order even when distinct Unicode variable names collate equally.
- b3f5de7: Preserve complete text and code literal neighbors in alias suggestion explanations and emitted evidence comments instead of truncating them at spaces.
- b3f5de7: Check and gate instances across the complete EXTENDS taxonomy, removing a silent 32-hop cutoff while retaining cycle termination and instance deduplication.
- b3f5de7: Wait for input-method composition to finish before Enter starts a read-only view search, and give the search field an explicit accessible name.
- b3f5de7: Read all current-claim evidence for an alias judge prompt from one snapshot so concurrent updates cannot manufacture contradictory evidence.
- b3f5de7: Generate client declarations and relation mappings from one read snapshot, preserving cleanup on errors and caller transaction rollback.
- b3f5de7: Assemble every health-report section within one read snapshot, preserving read-only access, caller transactions, and cleanup after errors.
- b3f5de7: Read shape declarations, constraint tags, and qualifier edges in one snapshot so concurrent metadata changes cannot hide a current expectation.
- b3f5de7: Keep standalone shape declaration and fact reads in one read snapshot so concurrent revocation cannot produce a false violation from mixed database states.
- b3f5de7: Consolidate the process-runner reference with an option table and clarify that redacted error messages still retain child output for diagnostics.
- b3f5de7: Report agent reply persistence errors as failed automation steps after rolling back the reply, allowing later steps to run while preserving no-replay semantics.
- b3f5de7: Contain thrown errors at the automation step boundary so action write failures report failed outcomes and preserve later execution, while cancellation still stops settlement.
- b3f5de7: Keep unprintable store exceptions inside the HTTP request handler. Return a
  stable JSON error response instead of throwing while formatting diagnostics,
  with regression coverage for GET, HEAD and subsequent request recovery.
- b3f5de7: Report lazy hook lookup failures without losing committed action results, skip getters for inactive hooks, and continue later automation steps.
- b3f5de7: Report unprintable agent exceptions as failed prompt steps without aborting the
  automation cycle. Preserve later-step execution and recorded-event ownership,
  with coverage for serializable reports and subsequent new events.
- b3f5de7: Include direct agent writes in stdout ingestion batch counts while retaining strict rollback, partial-output flags, and source retry semantics.
- b3f5de7: Reserve the derivation transaction before reading rules and watermarks, and
  refresh vocabulary inside it. Prevent firing rules revoked before the write
  reservation and honor inverse declarations added by another connection.
- b3f5de7: Keep the served view on the latest navigation, recover from malformed URL fragments, and preserve GET cache protections on HEAD and error responses.
- b3f5de7: Read shape declarations without loading unrelated facts when listing expectations or generating clients, and reuse constraint tags from the same snapshot.
- b3f5de7: Clarify that declared-source retractions affect their own belief series and can
  expose another source's surviving path, without automatically retiring imported
  data.
- b3f5de7: Decode valid URL escapes when selecting related knowledge for ingestion prompts, preserving literal file and source identities.
- b3f5de7: Deduplicate reconstruction seeds in first-seen order before policies inspect the frontier so repeated seeds cannot hide distinct choices under model cue limits.
- b3f5de7: Document which derivation counters describe retained writes and which describe attempted evaluation, including incomplete reconciliation and dry-run reports.
- b3f5de7: Add a dense matching benchmark to compare full alias discovery with bounded result retention using counts, prefix digests, timing and documented memory measurements.
- b3f5de7: Recognize NDJSON and JSONL HTTP media types before generic JSON, normalize media-type casing, and retain explicit format overrides.
- b3f5de7: Detect historical claim keys that disagree with their semantic claims and stored contexts in read-only doctor diagnostics.
- b3f5de7: Have doctor stream stored claims through the row decoder to detect authored-value and numeric-cache inconsistencies without modifying the database or exposing claim details.
- b3f5de7: Extend read-only doctor row diagnostics to reject invalid stored confidence and sigma levels, preserve valid numeric boundaries and legacy null sigma defaults, and refresh the operating guide transcript and PDF.
- b3f5de7: Detect unsupported stored edge roles in read-only doctor diagnostics before export or sync.
- b3f5de7: Detect empty and non-text stored provenance in doctor row checks without exposing stored values, and verify read-only diagnosis and recovery.
- b3f5de7: Add a read-only doctor check for conflicting stored payload columns and invalid negation or importance flags, without exposing claim contents or identifiers.
- b3f5de7: Detect malformed or mismatched stored transaction identities in doctor even when SQLite integrity and search-content checks pass. Preserve redacted reporting and read-only diagnosis.
- b3f5de7: Check canonical emission with stored tags during doctor diagnosis, identifying malformed historical claim text before export or sync.
- b3f5de7: Prevent sensitivity projections from retaining rolled-back rows or lineage-driven vocabulary changes.
- b3f5de7: Correct the connector reconciliation ownership comment and record verified record-level rollback, pruning and provenance boundaries.
- b3f5de7: Record connector watch lifecycle evidence and distinguish covered shutdown/retry contracts from remaining ingestion provenance review.
- b3f5de7: Clarify declaration snapshot comparison and record discovery selection, ownership baseline and cleanup review evidence.
- b3f5de7: Preserve structured context boundaries in alias disagreement grouping so a context containing a separator cannot collide with a different context set.
- b3f5de7: Encode shape violation identities as JSON tuples so separator characters in names cannot hide new violations behind existing ones during checked ingestion or action execution.
- b3f5de7: Mark partially accepted stdout batches explicitly so evaluation cannot score source-change failures as successful runs after direct agent writes.
- b3f5de7: Preserve successful text-store diagnosis and its claim count when the temporary store fails to close, reporting a redacted store.cleanup failure instead of a misleading load error.
- b3f5de7: Document and verify an atomic rule replacement recipe using caller transactions, explicit report validation and corrected retries while preserving historical lineage.
- b3f5de7: Document and verify atomic recording of prepared result, recommendation and decision artifacts in a caller transaction, including rollback and corrected retries with the same IDs.
- b3f5de7: Document a direct macOS application launch for editor-host verification when the shell launcher exits without a test result.
- b3f5de7: Document hook validation ownership, its shared file contract, and the packaging implications of moving helpers between private command packages.
- b3f5de7: Document CI's incremental build verification command and index the decimal suffix and scenario parsing benchmarks.
- b3f5de7: Document JSON number precision and verify that quoted large identifiers and exact decimal strings survive local and HTTP loading and SQL projection.
- b3f5de7: Document asynchronous reconstruction's live-read contract and verify peer updates
  between awaited expansions. Clarify that deterministic reconstruction requires a
  stable store view; the loop itself does not open a transaction across awaits.
- b3f5de7: Document and verify parser whitespace normalization when structured comments round-trip through canonical text, including CRLF and empty edge lines while preserving claim identity and input objects.
- b3f5de7: Document alternating replay measurements for unique and repeated identities on both supported Node majors.
- b3f5de7: Avoid full shape snapshots when no EXPECTS rows exist, rechecking each evaluation so newly introduced declarations retain transactional enforcement.
- b3f5de7: Encode newline filenames in new ingestion digest provenance so exported claims survive strict import and remain distinct from literal encoded-looking paths.
- b3f5de7: Require changesets for bundled private modules to name the CLI at matching or
  higher severity during release validation. Correct three pending audit
  changesets that omitted their CLI release impact.
- b3f5de7: Keep ingestion UTF-8 diagnostics readable by escaping control characters and line separators in source-path labels.
- b3f5de7: Escape control characters in ingestion file-selection read errors while preserving the original filesystem error as the cause.
- b3f5de7: Share escaped filesystem diagnostics across ingestion source reads, instruction reads, glob expansion and matched-file inspection.
- b3f5de7: Escape control-bearing path labels in ingestion text plans and source outcomes while retaining original JSON path identities.
- b3f5de7: Keep ingestion source-change and read-failure diagnostics on one line for control-bearing paths and filesystem error details.
- b3f5de7: Escape control characters in URL failure diagnostics while retaining exact source URLs in structured results.
- b3f5de7: Stage strict ingestion from an exact SQLite snapshot so existing provenance
  and stored claim data survive. Check the final sync report and fail the run
  when existing identities conflict instead of reporting an unapplied extraction
  as successful.
- b3f5de7: Read direct SQLite source integers without range errors, preserving unsafe integers as exact decimal text just like SQL over staged records.
- b3f5de7: Prevent alias judge replies from confirming suggestions through arrays embedded in complete JSON strings or objects, preserving ordinary array answers and unfinished-prose recovery.
- b3f5de7: Exclude numeric trajectories from rare textual alias evidence while retaining explicitly quoted identifiers.
- b3f5de7: Expand large connector template comment runs and preludes without exceeding JavaScript's function-argument limit.
- b3f5de7: Document the CLI consolidation step when comparing forced compiler output with packaged artifacts.
- b3f5de7: Make strict ingestion rollback explicit in text output when successful batch results were staged but the run was not applied.
- b3f5de7: Explain bare evaluation queries that the golden fixture cannot answer as no matches, alongside existing missing and unexpected binding details.
- b3f5de7: Document evaluator summary weighting, query pass-rate aggregation and the effect of failed or absent scored runs on minimum-score checks.
- b3f5de7: Explain historical revisions and retractions directly on the viewer search page and point readers to claim history.
- b3f5de7: Explain hook configuration encoding and name requirements in doctor recovery hints and the action reference, distinguishing pre-execution validation from post-commit hook failures.
- b3f5de7: Document exact-string source deduplication and the distinct provenance identities retained by different path spellings.
- b3f5de7: Explain and verify mixed action imports: an invalid replacement retains the previous body while valid metadata and other declarations apply, and corrected retries remain idempotent.
- b3f5de7: Include individual diagnostics when multiple cached view projections fail to
  close. Preserve all original errors and complete remaining cleanup even when
  one diagnostic cannot be formatted.
- b3f5de7: Explain beside the playground's active Stop query control that stopping closes the database and appended history while retaining editor text. Associate the visible help with the button for assistive technology.
- b3f5de7: Explain report exit statuses, diagnostic document publication and atomic file-output failures in the report reference.
- b3f5de7: Clarify order-independent Unicode tag replay, preservation of distinct strings and atomic rejection of genuine identity conflicts.
- b3f5de7: Include both underlying diagnostics in combined view read and cleanup errors,
  using safe formatting while preserving original aggregate members, cause and
  single-attempt cleanup behavior.
- b3f5de7: Label viewer search as phrase matching and explain the 100-row result limit when the page reaches it.
- b3f5de7: Extend the current registry when inserting generated vocabulary instead of replaying all declarations, preserving first-declaration-wins semantics and lineage-triggered rebuilds.
- b3f5de7: Extend the reproducible scenario arithmetic benchmark with opposite-sign, equal-numerator and general unequal-denominator comparison workloads.
- b3f5de7: Complete direct and declared watch cleanup after timer or watcher failures, retain registration diagnostics, disable stale callbacks, and await active passes before closing the store.
- b3f5de7: Finish MCP stdio serving when its output stream closes, releasing transport listeners without waiting for unrelated input cancellation.
- b3f5de7: Keep local viewer controls and long claim content within narrow screens, with live browser regression coverage.
- b3f5de7: Format action parameters by position when checking subject premises, so numeric-looking entity names match without changing numeric value bindings or rereading caller arguments.
- b3f5de7: Correct current-row prefix reads for empty prefixes and Unicode scalar boundaries while retaining indexed ranges and rejecting malformed UTF-16 input.
- b3f5de7: Format variables after an explicit @claim marker as subjects, preserving quoted entity identities instead of treating numeric-looking names as payload values.
- b3f5de7: Quote numeric-looking entity names in mapping qualifiers, including comparisons, negation and explicit claim prefixes, without changing numeric payload formatting.
- b3f5de7: Focus destination headings after local viewer claim navigation while preserving search focus moved during pending requests.
- b3f5de7: Focus local viewer navigation errors for keyboard recovery while preserving search focus during delayed failures.
- b3f5de7: Fold CRLF and CR comment line endings consistently with LF in report citations, keeping Markdown footnotes on one line without modifying stored comments.
- b3f5de7: Add a measured legacy-migration performance budget to catch repeated context-array copying regressions.
- b3f5de7: Hash original local-file bytes for ingestion selection and drift checks, and reject invalid UTF-8 when embedding source text in prompts.
- b3f5de7: Honor an already-aborted automation signal before argument handling and database access, preventing cancelled retractions and creation of empty databases.
- b3f5de7: Stop already-cancelled direct connector invocations before argument handling, source reads, or database access, matching the shared CLI startup boundary.
- b3f5de7: Honor cancellation in direct evaluator reconstruction calls before heuristic work and around agent completions, retaining simultaneous completion failures.
- b3f5de7: Stop already-cancelled direct MCP and HTTP viewer invocations before database access or service startup, matching the shared CLI cancellation boundary.
- b3f5de7: Include the source path or URL in JSON ingestion syntax errors while preserving the SyntaxError type and original parser error as cause.
- b3f5de7: Identify the field and claim ID when stored action bodies or hook references contain non-text values, preserving rollback and repair recovery.
- b3f5de7: Identify the field and claim when stored automation declaration text is malformed.
- b3f5de7: Identify malformed stored rule text by field and claim during listing and derivation.
- b3f5de7: Identify the published output and temporary directory when export, generate or report finishes publication but cleanup fails, retaining the cleanup error as the cause.
- b3f5de7: Include selected source SHA-256 hashes and Node launch arguments in raw query-record benchmark reports, distinguishing loader-based baselines and later source revisions without relying solely on a separate review artifact.
- b3f5de7: Identify the stored claim when report citation generation fails, preserving the underlying cause and rejecting incomplete reports with actionable diagnostics.
- b3f5de7: Keep evaluator discovery working when a source candidate is a broken symlink, reporting no source or selecting a remaining valid file as appropriate.
- b3f5de7: Include underlying cleanup and directory synchronization failure details in published-snapshot errors so backup and restore CLI diagnostics expose the cause while retaining publication status.
- b3f5de7: Traverse declared-source ownership with an indexed, deduplicated queue, preserving cyclic and shared ownership closure without repeated array compaction.
- b3f5de7: Index ingestion batch membership once when constructing source manifests, preserving multi-file failure statuses and strict unrun sources.
- b3f5de7: Index JSON syntax in linear time before decoding judge answers, avoiding repeated scans of malformed nested spans while preserving recovery and scoring.
- b3f5de7: Add a complete benchmark index with workload descriptions, commands and package
  references, linked from the development guide and website documentation.
- b3f5de7: Index the remaining exact-arithmetic, explanation, recorded-query, solver sensitivity and search-view benchmark scripts with their owning package guides.
- b3f5de7: Index rare-value alias evidence by entity pair and append candidate buckets without repeated array copies, preserving scoring and the two-signal limit.
- b3f5de7: Use indexed automation declaration discovery for loading, listing, and retraction, preserving disabled winners across actor series without materializing unrelated beliefs.
- b3f5de7: Discover derivation rules through indexed declaration rows instead of materializing all current beliefs, preserving latest-version and retraction semantics.
- b3f5de7: Share indexed declaration discovery across rule derivation, listing, and retraction while preserving latest-version ordering and transactional ambiguity checks.
- b3f5de7: Infer TSV sources from the text/tab-separated-values HTTP content type, including extensionless endpoints, while preserving explicit format overrides and source line spans.
- b3f5de7: Return HTTP 400 for malformed view request URLs instead of reporting a server failure, preserving error headers and HEAD behavior.
- b3f5de7: Track active vocabulary alongside rule transaction watermarks, re-evaluating after metadata-only mapping changes and restarting support when vocabulary changes during derivation.
- b3f5de7: Reevaluate settled rules when alias matching or the confidence floor changes, including when returning to defaults.
- b3f5de7: Isolate function-agent file lists from ingestion batch membership so adapter mutation cannot corrupt manifests or discard successful strict runs.
- b3f5de7: Capture connector command output through injected streams so integration tests cannot swallow test-runner events or hide reported test results.
- b3f5de7: Keep temporary generated shape clients outside composite build inputs and verify their exclusion with TypeScript.
- b3f5de7: Avoid function-argument limits when assembling large report fragments and selecting code-span delimiters for source locators with many backtick runs.
- b3f5de7: Use iterative alias-root lookup in health reports and alias discovery, preventing stack overflow on long alias chains while retaining complete closure membership.
- b3f5de7: Resolve shared shape vocabulary lazily so attribute-only checks avoid replaying unrelated peer declarations, while later relation checks refresh normally.
- b3f5de7: Keep SQLite doctor checks in one read transaction so a concurrent writer cannot mix database states within a report; later diagnoses observe subsequent commits.
- b3f5de7: Normalize explanation arithmetic directly as bigints, avoiding repeated decimal serialization and parsing while preserving exact fraction, sign and zero behavior.
- b3f5de7: Keep finite MCP fusion results writable when compact display rounding would overflow a magnitude multiplier.
- b3f5de7: Exclude retracted and superseded claims from ingestion context so historical search results cannot overwrite current knowledge in agent prompts.
- b3f5de7: Keep short inline documentation code tokens together across line boundaries while allowing long identifiers to wrap within narrow article layouts.
- b3f5de7: Disable browser spelling, capitalization, correction and completion assistance on playground syntax inputs to help preserve literal CAVE names and queries.
- b3f5de7: Label the final derivation text summary as incomplete when its pass limit prevents settling, retaining the dry-run marker and existing JSON completion field.
- b3f5de7: Add a larger alias-discovery benchmark mode and document constrained-heap reproduction with complete suggestion-output checks.
- b3f5de7: Read alias disagreement rows in one ordered query and group them in memory, avoiding SQLite parameter limits and repeated group-array copying for large alias closures.
- b3f5de7: Add a reproducible large automation benchmark covering 1,000, 2,000 and 4,000 events, with optional populated shape gates and full correctness and quiet-cycle assertions.
- b3f5de7: Launch bootstrap package-manager commands through the Windows command interpreter so pnpm, Corepack, and npm .cmd shims can run. Preserve exact-version resolution, installation output, and failure exit codes.
- b3f5de7: Build alias disagreement buckets without repeated array copies and detect differing values or polarities in linear time, preserving cross-name conflict semantics and every reported actor row.
- b3f5de7: Build taxonomy-child and per-type expectation groups with local appends instead of repeatedly copying growing arrays.
- b3f5de7: Connect automation operations to action validation, watch completion, cancellation and sync identity guidance in the live documentation.
- b3f5de7: Handle changeset CI branch names and filenames as literal data, preserving
  unusual valid paths and failing explicitly when the Git comparison fails.
- b3f5de7: Preserve literal committed changeset filenames and file contents during release
  preflight so unusual paths cannot disappear from the pending set and metadata
  validation agrees with CI.
- b3f5de7: Escape source-link labels and destinations in Markdown reports so punctuation and entity-like source text preserve their literal display and navigation target.
- b3f5de7: Normalize quotes and backticks in sync labels so merge-record comments cannot become part of the destination entity.
- b3f5de7: Preserve literal binding text in reports and automation prompts, distinguish authored citation placeholders from stored values, and avoid generated footnote collisions with existing template labels.
- b3f5de7: Substitute HTML page metadata once with callbacks so database labels preserve dollar tokens and template-marker text without duplicating markup.
- b3f5de7: Retain source names, paths and original causes when declared discovery fails while applying prepared data to its preview snapshot.
- b3f5de7: Identify the declared source and path when preview/query discovery preparation fails, retaining original causes and cancellation behavior.
- b3f5de7: Include the source path or URL and physical line number in JSONL syntax errors, retaining the underlying parser error as the cause.
- b3f5de7: Move detailed doctor guidance into a linked diagnosis section with examples, restore the help command to its Markdown table, and verify section navigation on mobile and desktop.
- b3f5de7: Match HTML response media types exactly during URL ingestion so unrelated content types and parameters cannot trigger HTML extraction and alter source digests.
- b3f5de7: Use the measured sticky header height when revealing focused documentation table headings, preserving horizontal position even when the header grows beyond the default anchor offset.
- b3f5de7: Document and benchmark bounded arithmetic intermediate growth when explanations repeatedly use large assignment values under the existing model-input budget.
- b3f5de7: Add a Unicode ANSI-rendering workload to the representative performance gate, with source-preservation checks and per-workload baseline provenance.
- b3f5de7: Add a correctness-checked benchmark for quiet runs with many settled rules and isolate evaluation-policy hashing cost.
- b3f5de7: Measure and document incremental query-match capture and metadata validation cost with a guarded prior-constructor baseline, retaining nested claim/provenance capture and snapshots. Preserve paired supported-runtime reports, source hashes and workload limits.
- b3f5de7: Extend the search-view benchmark to verify distinct contexts, tags and evidence counts on populated claims, and document bounded measurements on both supported Node versions.
- b3f5de7: Add a reproducible sensitivity workflow benchmark and document measured batch overhead and generated-limit rejection on both supported Node versions.
- b3f5de7: Document paired measurements of claim/provenance capture and provenance validation across supported Node versions, memory and WAL stores, metadata sizes and caller transactions. Retain raw samples and guarded baseline tooling; clarify the earlier trial's historical source dependency.
- b3f5de7: Record paired claim-view search measurements for numeric-cache validation with a reproducible benchmark-only baseline and explicit workload limits.
- b3f5de7: Add a reproducible search-view benchmark and document bounded measurements with stored-field validation enabled, retaining baseline data and measurement limitations.
- b3f5de7: Record isolated automation throughput and zero-write quiet cycles after vocabulary watermark and qualifier-edge registry updates.
- b3f5de7: Record verified automation throughput and quiet-cycle measurements after indexed rule and automation declaration discovery.
- b3f5de7: Record measured report parser and CLI import costs, correctness checks, and
  the limits of the existing performance gates.
- b3f5de7: Merge broad reconstruction frontiers without exceeding JavaScript's function-argument limit.
- b3f5de7: Give local viewer tabs descriptive titles for loaded views, loading and errors while retaining the database label across navigation and retries.
- b3f5de7: Omit redundant confidence and negation columns from shape fact projections after SQL has filtered them, and remove duplicate index checks. Preserve historical latest-row selection and complete shape declarations while reducing repeated gate evaluation work.
- b3f5de7: Materialize only target/value fields for ordinary shape facts while retaining complete declaration rows for provenance, reducing repeated gated-action snapshot costs.
- b3f5de7: Add automation guide topic navigation and place scaling measurements after operational semantics.
- b3f5de7: Accept decimal-second deadlines that resolve to whole milliseconds in shell completions and web ingestion, and reject invalid settings before starting agent or fetch work.
- b3f5de7: Recognize CR-only line endings when selecting an MCP ingestion agent's final output line for batch reports.
- b3f5de7: Normalize Boolean and enum sensitivity values before duplicate detection so property order and extra fields cannot cause redundant sample runs.
- b3f5de7: Normalize attribute colons in synchronization labels so names such as team:blue cannot prevent an otherwise valid merge.
- b3f5de7: Number CR-delimited embedded source lines correctly in ingestion prompts so source citations use the same line boundaries as LF and CRLF inputs.
- b3f5de7: Omit heading and list markers for empty extracted HTML blocks, avoiding meaningless source lines and digest changes.
- b3f5de7: Keep the read-only browser view and alias toggle usable when saved-preference reads or writes fail.
- b3f5de7: Wait for descendant readiness and probe survival only after CLI exit in the cancellation regression, removing an ambiguous startup deadline.
- b3f5de7: Make automation input, watch behavior, cancellation and limits directly navigable, and clarify cancellation-only status versus independent failures.
- b3f5de7: Move ingestion context behavior into the API-access reference and batch validation into options and limits, keeping recipes focused on runnable workflows.
- b3f5de7: Make ingestion cancellation, cleanup, option limits, source identity and report interpretation directly navigable while preserving the existing report section link.
- b3f5de7: Organize MCP startup, stream termination, reply draining and caller ownership into a lifecycle reference.
- b3f5de7: Place source failure contracts beside their owning SQL, declared-source and
  URL-selection documentation instead of after unrelated design or test sections.
- b3f5de7: Contain fatal connector watch callbacks and scheduling errors within command shutdown instead of escaping timers or waiting indefinitely.
- b3f5de7: Handle connector filesystem watcher error events through owned shutdown, preserving diagnostics, closing subscriptions and allowing corrected reruns.
- b3f5de7: Make viewer runtime HTTP server errors initiate owned command shutdown, preserving diagnostics and releasing listener, store and abort subscriptions.
- b3f5de7: Reject database-file sync inside caller-owned transactions before attaching or
  copying. Prevent failed detaches from leaving merged rows and source attachments
  behind, including dry runs. Annotated-text sync remains nestable.
- b3f5de7: Stage absent JSON fields as SQL NULL even when their names match inherited JavaScript properties, preserving explicitly supplied values.
- b3f5de7: Use Markdown's parsed inline code spans for report splices, preserving escaped
  syntax and multiline examples while supporting live multiline queries with
  correct source-line diagnostics.
- b3f5de7: Recognize report query fences through the Markdown tree, keeping malformed
  openers and container examples literal and preserving unclosed-fence diagnostics.
- b3f5de7: Anchor incremental-build verification to the repository, launch the Windows
  pnpm shim through cmd.exe, and expose process-start and signal failures.
- b3f5de7: Validate every generated sensitivity model before backend execution so a later sample exceeding model limits cannot cause partial batch execution.
- b3f5de7: Prepare automation premise text before committing its firing watermark so serialization failures preserve the batch for repair and retry.
- b3f5de7: Retain original action-file line numbers in prelude diagnostics while preserving declaration digest and replay behavior.
- b3f5de7: Preserve structured attribute, value and unit boundaries when grouping and describing rare-value alias evidence.
- b3f5de7: Preserve declaration assembly's LocateError classification, source context and
  original cause when preparation errors cannot be formatted.
- b3f5de7: Keep the automation hook identity placeholder tied to the firing automation when a trigger also binds a variable named automation.
- b3f5de7: Finish automation stdin cleanup after individual failures, retaining input and cleanup diagnostics without ingesting partial declarations.
- b3f5de7: Preserve multibyte UTF-8 characters across automation declaration stdin chunks and reject invalid UTF-8 files or streams before appending declarations or prelude claims.
- b3f5de7: Safely format automation command and watch failures without replacing original
  errors. Cover unusual poll/cycle failures together with transient or persistent
  diagnostic-sink failures and complete owned-resource cleanup.
- b3f5de7: Preserve the final package-manager version probe's stderr, exit or signal detail, and process-start cause when bootstrap cannot resolve the declared pnpm version. Continue stopping before dependency installation on failure or a mismatched version.
- b3f5de7: Capture cancellation error causes once and tolerate unreadable nested error
  metadata without discarding the original work or transport failure.
- b3f5de7: Preserve automation step failures concurrent with cancellation, including wrapped diagnostics, without replaying claimed batches.
- b3f5de7: Unify buffered CLI store cleanup across synchronous and asynchronous commands. Preserve completed output and original diagnostics when closing fails, retain existing failure status, await async work before closing, and document committed-write and overlay boundaries.
- b3f5de7: Retain structured failure output from backup, restore, alias suggestion and reconstruction when setup throws an unprintable value. Reuse the shared safe formatter before owned-store execution as well as during cleanup.
- b3f5de7: Preserve connector command failures alongside final store-close failures across direct, declared, query, dry-run, listing, and watch lifetimes.
  
  Make the failed-discovery cleanup test inspect its owned temporary directory so concurrent test processes cannot change its result.
- b3f5de7: Safely format connector command, watch and owned-store cleanup failures.
  Preserve operation and close diagnostics across direct and declared command
  modes, including errors without printable messages.
- b3f5de7: Restrict model-reply list cleanup to whitespace-delimited markers so numeric, hyphen and dot prefixes in frontier cue names cannot be stripped into a different entity.
- b3f5de7: Prefer complete frontier cue names before removing sentence punctuation from model replies, preserving literal suffixes in listed and quoted names.
- b3f5de7: Preserve declaration-reading failures when scratch-store cleanup also fails, with one close attempt and both diagnostics. Document the contract and cover both text declaration readers.
- b3f5de7: Preserve discovery and declaration-scratch failures when cleanup diagnostics
  cannot be formatted. Keep original errors, causes and remaining cleanup attempts.
- b3f5de7: Attempt private discovery snapshot removal even when closing fails, and preserve operation, close, and removal errors together. Cover failed creation and disposal with isolated fault-injection regressions and document cleanup ownership.
- b3f5de7: Preserve dispatcher diagnostics for unprintable exceptions and unreadable debug stacks. Read a debug stack once, fall back to the message when needed, and share safe formatting with owned-store cleanup.
- b3f5de7: Preserve completed doctor checks when the owned database connection fails to close, adding a redacted store.cleanup failure in text and JSON reports instead of throwing away the report.
- b3f5de7: Retain SQLite capability results when the temporary doctor probe fails to close, reporting a separate redacted runtime.sqlite.cleanup failure in text and JSON output.
- b3f5de7: Keep reconstruction cue and STOP mentions from matching inside names joined by dots or colons, while preserving sentence punctuation and exact-name selection.
- b3f5de7: Preserve prototype-named variables in evaluator query expectations and reject repeated variables on a single solution line instead of silently discarding bindings.
- b3f5de7: Preserve evaluation cleanup and cancellation failures when diagnostic messages
  or nested error metadata cannot be read, without continuing cancelled runs.
- b3f5de7: Preserve evaluation failures when removal of the owned temporary root also fails. Retain both diagnostics and error identities while respecting the captured keep policy, with cancellation and fixture-read regressions.
- b3f5de7: Preserve complete ISO transaction dates in report citations for UUID timestamps beyond year 9999.
- b3f5de7: Preserve simultaneous cancellation and transport failures when diagnostic
  formatting throws, retaining original aggregate members and cause for both
  fetch startup and response-body failures.
- b3f5de7: Preserve inherited and non-enumerable file-sync options so dry-run requests cannot become committed merges during dispatch.
- b3f5de7: Keep text health summaries from rounding positive average confidence to 0% or non-certain averages to 100%, preserving JSON numeric precision and empty-average behavior.
- b3f5de7: Use the requested historical alias graph for MCP fusion quantity grouping so later merges and retractions cannot change past results.
- b3f5de7: Preserve address block boundaries during HTML ingestion so adjacent contact details do not merge into a single word.
- b3f5de7: Preserve preformatted HTML whitespace and require a complete matching line before suppressing the extracted page title.
- b3f5de7: Preserve text boundaries between HTML structural containers without flattening nested headings or preformatted blocks during ingestion.
- b3f5de7: Canonicalize validated alias suggestion lines before joining a write batch, preventing retained indentation from creating unintended grouping edges while preserving comments and metadata.
- b3f5de7: Preserve ingestion cleanup and cancellation failures when diagnostic formatting
  throws, retaining original error chains and strict/lenient write boundaries.
- b3f5de7: Retain ingestion command output and final-close errors when diagnostics cannot
  be formatted, covering planning and execution without changing committed writes.
- b3f5de7: Keep multiline comments inside ingestion context claim blocks by normalizing display line endings and indenting every emitted line without changing stored text.
- b3f5de7: Preserve ingestion command failures when the final owned-store close also fails. Retain both diagnostics and original error identities while attempting close once, with planning and committed-write regressions.
- b3f5de7: Preserve and render large evaluation fixture diagnostic lists without exceeding JavaScript's function-argument limit.
- b3f5de7: Return complete diagnostics for large malformed text sync sources without exceeding JavaScript's function-argument limit.
- b3f5de7: Preserve local viewer search drafts during same-route refresh and retry, while restoring submitted queries on actual route and history navigation.
- b3f5de7: Preserve inherited and non-enumerable registry and assembly options when opening stores by path instead of silently dropping them during option forwarding.
- b3f5de7: Preserve hook setup diagnostics in generated MCP action replies instead of rendering an undefined no-fire reason, while retaining committed-effect and retry semantics.
- b3f5de7: Preserve MCP startup and protocol failures when final owned-store cleanup also fails. Document the ordered aggregate error contract and cover announcement, protocol-input and close-only failures without contaminating protocol stdout.
- b3f5de7: Preserve MCP operation and cleanup failures when thrown values cannot be
  formatted. Use a stable diagnostic fallback without replacing original errors,
  and cover source-token rejection through the CLI before database startup.
- b3f5de7: Clear the documentation filter only on plain Escape, preserving modified Escape keystrokes and input during composition. Verify behavior at mobile and desktop widths.
- b3f5de7: Preserve word boundaries between nested HTML blocks during URL ingestion so paragraphs and list items do not merge into words.
- b3f5de7: Keep playground worker failure replies and fatal cleanup classification intact
  when thrown values cannot be formatted. Preserve original WASM cleanup failures
  and provide a printable diagnostic fallback.
- b3f5de7: Report rule and automation prelude errors at their original source lines without changing prelude digest or replay behavior.
- b3f5de7: Resolve premise-bound prototype-named action variables from actual bindings and retain ambiguity checks instead of reading inherited object properties.
- b3f5de7: Settle process execution despite cleanup failures, retaining typed process outcomes and attempting all resource cleanup.
- b3f5de7: Preserve publication audit failures when temporary installation cleanup also fails, including unprintable thrown values, and document the diagnostic behavior.
- b3f5de7: Preserve both callback and savepoint release errors when a view or report snapshot fails.
- b3f5de7: Preserve collected-claim arrays in retained reconstruction states so later expansions cannot change the evidence associated with an earlier step.
- b3f5de7: Keep report query failures as line-specific diagnostics when a thrown value
  cannot be formatted. Continue rendering and preserve per-occurrence problems
  and later successful query recovery.
- b3f5de7: Preserve explicit actor, source, run and domain provenance when constructing sensitivity-scoped views instead of inferring replacement attribution.
- b3f5de7: Keep delayed local viewer search responses from overwriting the user's next search draft.
- b3f5de7: Preserve frontier score values in LLM selection prompts instead of rounding small positive scores to zero or distinct scores to apparent ties.
- b3f5de7: Preserve named maxRuns validation errors for malformed sensitivity request objects instead of failing during string conversion, before backend execution.
- b3f5de7: Preserve read and savepoint-release failures across shape evaluation, health reporting, alias discovery, client generation, and emitted client readers.
- b3f5de7: Preserve query and close failures in SQLite sources and temporary SQL staging, and stop empty-source inference when cleanup fails.
- b3f5de7: Preserve original SQL errors during empty-source column inference when their
  messages are unreadable or non-string, without retrying the failed staging run.
- b3f5de7: Preserve database sync failures through temporary-table cleanup and source detach, including nested failures. Document rollback versus post-commit detach behavior and cover dry-run, retry and caller-store ownership.
- b3f5de7: Preserve database sync attachment and inspection failures so busy sources are not misreported as malformed databases, with atomic failure and retry regressions.
- b3f5de7: Preserve nested merge and cleanup errors when diagnostic formatting throws.
  Keep rollback and attachment cleanup behavior in normal and dry-run sync,
  with safe fallback text for unprintable failures.
- b3f5de7: Preserve inherited and non-enumerable process command fields in the synchronous bridge, ignore custom command serialization, and redact command-field read failures consistently.
- b3f5de7: Preserve inherited environment entries and prevent custom environment JSON serialization from replacing synchronous child variables.
- b3f5de7: Forward captured process deadlines to the synchronous worker and prevent custom option serialization from replacing validated settings.
- b3f5de7: Preserve read and close failures for temporary sensitivity projections using the shared read-resource cleanup contract.
- b3f5de7: Preserve text-store replay or assembly failures when closing the failed in-memory store also throws, retaining both errors and the original cause.
- b3f5de7: Preserve unbound Unicode report placeholders instead of substituting a shorter bound variable prefix.
- b3f5de7: Preserve projection copy and revision-check failures when closing an unpublished candidate also fails.
- b3f5de7: Preserve a leading UTF-8 BOM in non-HTML URL source content and digests, matching embedded local sources and detecting BOM-only changes.
- b3f5de7: Preserve combined viewer startup and cleanup failures when diagnostic formatting
  throws. Share the HTTP handler's safe formatter and retain original aggregate
  members, cause and cleanup ordering.
- b3f5de7: Keep compact viewer confidence labels from rounding positive beliefs to 0% or non-certain beliefs to 100%, including history tooltips and dashboard averages.
- b3f5de7: Preserve viewer startup and shutdown failures together, attempt connection cleanup independently, and await listener shutdown before closing the store even when connection termination throws.
- b3f5de7: Preserve HTTP status in local viewer errors when response bodies cannot be read as JSON error messages, retaining retry recovery.
- b3f5de7: Preserve explicitly quoted empty CSV/TSV records, including final records without a newline, while continuing to ignore blank lines.
- b3f5de7: Preserve HTML line-break separators during readable-text ingestion so adjacent words do not merge and preformatted lines remain distinct.
- b3f5de7: Preserve existing percent escapes in source-provenance links so encoded paths and query values continue to identify the original URL in reports and other views.
- b3f5de7: Add a reproducible malformed-judge parsing benchmark and document the observed scaling issue and compatibility-preserving optimization requirements.
- b3f5de7: Document measured shape-gate CPU costs and the semantic requirements for narrowing evaluation snapshots.
- b3f5de7: Capture federated JSON query records before rolling back temporary source claims, preserving their contexts and provenance for direct and declared queries. Retain partial results and nonzero status on mapping failures.
- b3f5de7: Propagate SDK transport buffer failures without waiting for EOF or cancellation, preserving cleanup and permitting a corrected fresh session.
- b3f5de7: Propagate evaluation cancellation instead of converting it into failed runs or judge scores, stop later agent calls, and preserve throwaway-store cleanup.
- b3f5de7: Prevent report, export, generate and backup output from overwriting SQLite WAL, shared-memory or rollback-journal files belonging to the source database, including through database symlinks.
- b3f5de7: Preserve existing reports and generated clients on output-write failures using the shared atomic text writer.
- b3f5de7: Stage and flush text exports before replacing output files, preserving existing exports on write failures.
- b3f5de7: Update internal-package README consumer examples to published CLI subpaths and prevent regression with a package-surface-driven documentation check.
- b3f5de7: Match large context and tag lists without growing SQL expression depth, and retain incremental rule wake-up for large context premises.
- b3f5de7: Select entity-view facts through the recursive alias closure so large alias groups do not exceed SQLite's parameter limit.
- b3f5de7: Handle automation cancellation quietly across declaration and once modes, matching watch-mode shutdown while preserving CLI signal exit codes and database cleanup.
- b3f5de7: Fix documented Git union drivers for paths containing spaces and clean up temporary databases after failed merges.
- b3f5de7: Keep control-bearing file names on one prompt label line while preserving exact source contexts and content line numbers.
- b3f5de7: Build action listings from one current-belief read so concurrent updates cannot mix bodies and metadata, while avoiding repeated parameter-documentation scans.
- b3f5de7: Accumulate short file reads when detecting SQLite headers so valid databases are not misclassified as text; stop at EOF and retain descriptor cleanup.
- b3f5de7: Spell NUL key separators as explicit escapes in shape sources so text search and code review remain usable without changing runtime keys.
- b3f5de7: Refresh hosted release evidence and distinguish the last successful v1 action from the local v2 migration.
- b3f5de7: Re-evaluate incremental rules when mutable premise values or tags change, including equivalent numeric spellings and replacements that invalidate prior conclusions.
- b3f5de7: Match literal CAVE object prefixes during diagnosis so unrelated SQLite tables such as caveat do not produce misleading migration guidance. Preserve case-insensitive detection and read-only behavior.
- b3f5de7: Recognize tab-separated WHERE filters in reports and reject incomplete filters instead of rendering unfiltered rows.
- b3f5de7: Recognize hard links to the target database as self-sync before SQLite attachment, preserving the no-op contract in ordinary and dry-run syncs.
- b3f5de7: Record complete Node 26 workspace verification after bootstrap improvements, retain separate LTS evidence, and confirm the incremental TypeScript build remains up to date.
- b3f5de7: Record the complete Node 26 workspace checkpoint after source outcomes and
  cancellation traversal fixes, retaining separate Node 24 and evaluation review
  boundaries.
- b3f5de7: Record unchanged-budget performance-gate results for all 12 workloads on both
  supported Node majors after claim input capture fixes, including full reports
  and measurement limits.
- b3f5de7: Refresh production website verification evidence for current store and ingestion guides, navigation, and playground behavior.
- b3f5de7: Refresh Node 24 integration evidence for current search, ingestion context and reporting, and viewer sensitivity behavior.
- b3f5de7: Record full Node 24 workspace verification of current read options, arithmetic shortcuts and large serialization round trips.
- b3f5de7: Refresh system review integration evidence for current-only search and the recent ingestion context, reporting, and viewer changes.
- b3f5de7: Record the complete Node 24 workspace checkpoint after exact-number and MCP/HTTP
  diagnostic fixes, distinguishing integrated results from remaining viewer
  fault-testing and hosted release verification.
- b3f5de7: Record complete workspace verification on both supported Node majors after evaluation cleanup and report recovery fixes, preserving the remaining system review scope.
- b3f5de7: Record full Node 24 workspace verification of the current graph and emitter fixes.
- b3f5de7: Record full Node 26 workspace verification of graph validation, self-edge replay and emitter robustness fixes.
- b3f5de7: Record full Node 26 workspace verification of indexed current search and its latest regressions.
- b3f5de7: Record installed-package and workspace verification of recent large-input handling fixes.
- b3f5de7: Record full workspace and rendered documentation verification for MCP lifecycle changes.
- b3f5de7: Record full Node 26 workspace verification after sync provenance and process-boundary fixes.
- b3f5de7: Record full workspace and production documentation verification after the process-runner fixes.
- b3f5de7: Record full Node 26 workspace verification of read-option validation and exact fraction-order shortcuts.
- b3f5de7: Record the complete Node 24 workspace validation checkpoint for recent store
  diagnostic and playground recovery fixes, distinguishing it from browser coverage
  and the remaining system review.
- b3f5de7: Record the expanded full browser checkpoint and clarify that tutorial report footnotes identify claims supporting embedded query results.
- b3f5de7: Record full Node 24 workspace and documentation verification after viewer and MCP lifecycle fixes.
- b3f5de7: Record the shape validation, gate and alias suggestion review with passing checks on both supported Node majors.
- b3f5de7: Refresh the system review verification map with current source-integrity and scenario integration evidence.
- b3f5de7: Record the complete Node 24 workspace checkpoint after connector and ingestion
  outcome fixes, keeping separate runtime/browser evidence and remaining review
  boundaries explicit.
- b3f5de7: Record the complete production website and local-viewer browser checkpoint
  after diagnostic fixes, retaining separate native fault and hosted-release
  verification boundaries.
- b3f5de7: Record the complete Node 26 workspace checkpoint after viewer, sync and
  automation diagnostics changes, with separate browser, Node 24 and remaining
  connector/release verification boundaries.
- b3f5de7: Recover judge answers after malformed prose quotes without reinterpreting strings inside valid JSON arrays as separate answers.
- b3f5de7: Keep synchronous process-launch exceptions typed and redacted without reading arbitrary thrown values or copying their properties into diagnostics.
- b3f5de7: Redact synchronous process working-directory, environment, and request-serialization failures before starting the worker.
- b3f5de7: Normalize synchronous Node spawn validation errors into redacted ProcessFailure diagnostics, preserving the process runner error contract for malformed execution inputs.
- b3f5de7: Refresh the book's doctor transcript and PDF to include the new stored-row consistency check.
- b3f5de7: Refresh and replay long recorded book-session outputs without exceeding argument or whole-transcript regular-expression limits, preserving surrounding chapter text and placeholder matching.
- b3f5de7: Refresh the operating chapter and generated PDF for doctor provenance validation, and clarify that success diagnostics are part of executable book examples.
- b3f5de7: Refresh local viewer results when users submit the same search again after store changes.
- b3f5de7: Refresh the recommended and CI runtime pins to Node 24.21.0 LTS and Node 26.8.1 Current. Retain the supported engine minima at 24.16.0 and 26.1.0 and their CI coverage, and align runtime documentation and contract checks.
- b3f5de7: Report asynchronous store cleanup callbacks explicitly, observe native Promise rejection and continue remaining cleanup and database closure.
- b3f5de7: Reject binary stored shape-unit constraints in runtime checks and generated clients, preserving the store on failure and allowing validation to recover after repair.
- b3f5de7: Reject blank cave serve port values before database access instead of silently converting them to port zero.
- b3f5de7: Reject nonnumeric programmatic timeouts without invoking coercion hooks in completion, ingestion and evaluation adapters. Preserve valid whole-millisecond deadlines and existing zero-timeout policies.
- b3f5de7: Reject --json combined with ingestion planning modes before source reads, and direct machine-readable planning to --plan.
- b3f5de7: Reject source contexts, tags, provenance and edges that reference missing source claims before database sync copies or discards data.
- b3f5de7: Have CLI and MCP reference checks reject command rows detached from their Markdown tables, preventing explanatory paragraphs from silently breaking rendered command documentation.
- b3f5de7: Report directory-valued golden, query, loop and selected instruction paths as fixture problems during discovery while retaining valid sibling cases.
- b3f5de7: Reject path-based ingestion batches whose files change or become unreadable before or during an agent call, preserving retry eligibility and strict/lenient ownership.
- b3f5de7: Reject duplicate SQL source result names before record conversion can overwrite values or a refresh can prune existing claims.
- b3f5de7: Reject duplicate required HTTP view parameters instead of silently using the first target or search query.
- b3f5de7: Reject empty minimum-score and tolerance arguments, including a bare percent sign, instead of silently interpreting them as zero.
- b3f5de7: Reject empty and invalid viewer hosts before listener creation so an empty host cannot silently bind an unspecified interface.
- b3f5de7: Reject stored numeric, unit, approximation and uncertainty projections that disagree with authored values during claim conversion and export, without rewriting historical rows.
- b3f5de7: Reject conflicting or incomplete stored claim payload columns when converting rows, preventing export from silently discarding malformed historical data.
- b3f5de7: Reject invalid array proxy lengths before connector writes, pruning or SQL projection while capturing valid lengths once.
- b3f5de7: Reject malformed or mismatched row identities in transaction-annotated exports, preserving sensitivity scoping and existing output files on failure.
- b3f5de7: Validate MCP stdio input as streaming UTF-8 before SDK decoding, rejecting malformed bytes and incomplete EOF sequences instead of silently storing replacement text.
- b3f5de7: Validate direct store access modes before invoking SQLite adapters so unsupported values cannot fall through to writable connections or unrelated schema errors.
- b3f5de7: Reject unsupported historical edge roles before database sync propagates an unexportable relationship to its destination.
- b3f5de7: Reject unpaired Unicode surrogates in shell-agent prompts before UTF-8 encoding can silently alter stdin or temporary prompt-file contents.
- b3f5de7: Reject malformed UTF-8 in the shared CAVE file/stdin reader before parsing or ingestion can silently replace bytes.
- b3f5de7: Reject invalid UTF-8 in evaluation golden answers, query fixtures, reconstruction knowledge, and loop specifications before running the affected case.
- b3f5de7: Reject malformed percent escapes and UTF-8 query strings before HTTP URL decoding can replace bytes and search for different text.
- b3f5de7: Return an encoding failure for malformed Unicode prompts passed to the ingestion shell-agent adapter before starting a process or silently altering stdin.
- b3f5de7: Reject invalid UTF-8 instruction files before ingestion sends silently repaired guidance to an agent.
- b3f5de7: Use shared strict UTF-8 decoding for connector mapping files and declared CAVE sources, preserving existing records on failed refreshes.
- b3f5de7: Reject malformed UTF-8 stdout in shell completion agents before reconstruction or automation interprets their structured replies, preserving valid Unicode output.
- b3f5de7: Reject invalid UTF-8 in structured source files and fetched text bodies before decoding can replace record data, preserving declared-source history on failed refreshes.
- b3f5de7: Reject malformed UTF-8 before text-store replay or annotated file sync can replace claim text while retaining transaction identities.
- b3f5de7: Validate and capture connector record batches before writes so sparse or malformed arrays cannot trigger misleading pruning or mixed record identities.
- b3f5de7: Reject malformed Unicode in ingestion sources, instruction paths and working directories before filesystem or URL access can replace their identity.
- b3f5de7: Reject unpaired Unicode surrogates in MCP about lookups consistently across alias and resolution modes.
- b3f5de7: Reject malformed extra fusion selectors and supplied time cutoffs rather than
  silently choosing a different estimate source or falling back to current beliefs.
- b3f5de7: Reject malformed MCP query cutoffs, valid-time anchors and continuation cursors
  instead of silently dropping the requested scope or restarting pagination.
- b3f5de7: Reject malformed boolean read flags across MCP query, fusion, search, entity
  reads and export instead of silently changing the requested mode. Preserve
  false defaults for omitted flags and validate fusion aliases before selection.
- b3f5de7: Reject non-boolean programmatic MCP readOnly settings during scope calculation
  and server setup, rather than treating them as false and exposing write tools.
- b3f5de7: Reject malformed MCP reconstruction seed lists and budgets before traversal,
  instead of discarding seed entries or silently substituting default budgets.
  Advertise nonempty seed strings and nonnegative safe integer budgets in the schema.
- b3f5de7: Reject non-boolean ingestion strictness and derivation dry-run/full/alias flags
  before writes. Malformed preview flags no longer silently become durable derivations.
- b3f5de7: Reject malformed annotation-shaped lines during strict text sync instead of silently merging them as comment prose.
- b3f5de7: Reject database sources with empty or binary provenance before sync copies claims, edges, vocabulary or merge records.
- b3f5de7: Reject unpaired Unicode surrogates in explicit provenance before annotated sync can silently replace identity text during UTF-8 storage.
- b3f5de7: Reject malformed UTF-8 web-source bodies before extraction or digesting, preserving healthy source selection and recovery after corrected responses.
- b3f5de7: Reject malformed Unicode in web-source URLs before fetching, while preserving valid Unicode URL paths and source identity.
- b3f5de7: Require the search table to expose its hidden FTS search column, rejecting incompatible virtual tables such as R-trees during schema validation and diagnosis.
- b3f5de7: Reject non-binary stored approximation flags during claim reconstruction and doctor diagnostics. Verify native/browser SQLite rejection, HTTP sensitivity boundaries, unchanged data on failure and recovery after repair.
- b3f5de7: Reject non-binary stored negation and importance flags during claim conversion instead of silently treating malformed historical values as true.
- b3f5de7: Reject an explicit null action hook timeout before execution instead of silently
  using the default. Omission retains the default and numeric zero remains unlimited.
- b3f5de7: Reject null ingestion timeouts and batch sizes instead of selecting defaults.
  Validate batch sizes at run entry before staging, as well as during selection.
- b3f5de7: Reject explicit null process deadlines and output limits before launching a child or synchronous bridge worker.
- b3f5de7: Reject explicit null port, host and sensitivity settings before starting the HTTP viewer instead of silently selecting defaults. Omitted settings retain their defaults.
- b3f5de7: Reject an ordinary table substituted for the full-text search index during schema validation and diagnosis, even when its columns and rows match the claims.
- b3f5de7: Reject nonfinite propagated scores in both built-in reconstruction policies instead of placing overflowed values in the frontier or model prompts.
- b3f5de7: Reject unsupported publisher arguments before preflight, including --dry-run,
  instead of silently proceeding with ordinary publication semantics.
- b3f5de7: Reject native transaction promises even when their then property is shadowed, preserving rollback and observing asynchronous rejection without invoking that property.
- b3f5de7: Reject source SQL without result columns before execution, preventing VACUUM INTO side effects and mutation statements from masquerading as empty record sources.
- b3f5de7: Validate canonical emission of source claims and their stored tags before database sync copies them into the destination.
- b3f5de7: Reject literal imports and module lookups naming nonexistent Node builtins instead of skipping them as generic URL specifiers.
- b3f5de7: Reject unsupported path-opening intents before file detection or opening, preventing unknown modes from falling through to SQLite migration access.
- b3f5de7: Reject views substituted for required SQLite tables during schema validation, so opening and diagnosis catch incompatible stores before later table operations fail.
- b3f5de7: Release the viewer startup error listener after binding so it cannot silently consume a later server error; document programmatic runtime-error ownership.
- b3f5de7: Cancel unread HTTP error response bodies while preserving the original URL and status diagnostic if cleanup fails.
- b3f5de7: Cancel unread HTTP error response bodies during URL ingestion while preserving the original HTTP failure and retry classification.
- b3f5de7: Prevent connector pruning from retracting prior data when failed records cannot be identified. Roll back an entire declared-source replacement if any record fails, preserving the last good data and enabling a complete retry. Document these failure and recovery contracts in the connector reference, specification, architecture, and book.
- b3f5de7: Render large packed API reports iteratively and terminate namespace re-export cycles with ancestor references.
- b3f5de7: Preserve large per-record connector diagnostics in text reports without exceeding JavaScript's function-argument limit.
- b3f5de7: Render completed evaluation runs with large diagnostic lists without exceeding JavaScript's function-argument limit.
- b3f5de7: Render large health-report sections without exceeding JavaScript's function-argument limit or treating advisory findings as command failures.
- b3f5de7: Render large source-policy tables without exceeding JavaScript's function-argument limit during column-width calculation.
- b3f5de7: Render alias suggestion text after ranking and applying the result limit, so an unsupported lower-ranked pair cannot block valid selected results.
- b3f5de7: Re-extract the verified grammar SDK archive when installed version or source-marker metadata is a directory, allowing offline cache repair without manual deletion.
- b3f5de7: Report automation command-store close failures through stderr and a nonzero return status, preserving prior command diagnostics even during cancellation. Cover declaration, listing, retraction, settling and watch shutdown, and document committed-write behavior.
- b3f5de7: Report explicit closed-database errors for WASM reads and retained statements,
  and verify real-store replacement cleanup and retry behavior.
- b3f5de7: Preserve surrounding spaces in fully bound report bullets by padding Markdown
  code spans so rendering does not trim the stored claim's whitespace.
- b3f5de7: Recognize handwritten footnote containers when detecting report code blocks,
  so continued footnote paragraphs keep live splices and nested examples stay
  literal.
- b3f5de7: Keep report splices inert inside indented Markdown code examples using parsed
  block boundaries, while preserving live paragraph and list continuations.
- b3f5de7: Return HTTP 400 for NUL-bearing viewer search queries while preserving HEAD behavior and recovery.
- b3f5de7: Keep report queries inside raw HTML blocks, comments and inline tag attributes
  literal while rendering splices in surrounding Markdown prose.
- b3f5de7: Keep report Markdown parser updates out of routine Dependabot groups so changes
  to executable template boundaries receive individual review.
- b3f5de7: Display control characters visibly in report source citations so decoded
  newlines cannot split footnotes or link labels, preserving original source
  identities and encoded link destinations.
- b3f5de7: Add a guarded baseline mode for isolated product-chain measurements that restores the recorded prior linear implementation inside benchmark children without editing runtime files. Document commands and preserve a second paired run on both supported Node versions.
- b3f5de7: Add a reproducible report benchmark with literal-output and live-splice checks,
  and document current parser measurements for indented, HTML and multiline examples.
- b3f5de7: Resolve action and automation hook commands only from explicit own configuration entries, preserving prototype-named hooks when intentionally configured.
- b3f5de7: Require own trigger bindings for action parameters so unbound prototype-named parameters report a local step failure instead of crashing settlement and skipping later steps.
- b3f5de7: Select action declaration series inside the retraction transaction so peer commits before the write reservation are included and already-completed retractions append nothing.
- b3f5de7: Recheck both directions of alias history inside the suggestion write transaction, skipping reviewed and duplicate pairs so retained proposals cannot revive rejected links.
- b3f5de7: Read automation declaration series after reserving the retraction transaction, so actor-specific declarations committed before reservation cannot survive a successful retraction.
- b3f5de7: Recheck connector record and prelude digests under the write reservation so concurrent identical refreshes skip duplicate appends while force retains its behavior.
- b3f5de7: Select rule declarations and check digest-prefix ambiguity inside the retraction
  transaction, preventing concurrent declarations from escaping retraction or
  causing an ambiguous prefix to retract a rule.
- b3f5de7: Read shape-gate baseline violations inside the reserved write transaction so concurrent repairs cannot be silently undone by a gated append.
- b3f5de7: Reserve annotated-text sync before refreshing vocabulary, validating, and
  canonicalizing input. Honor inverse declarations committed by another writer
  before the merge, while keeping dry-run registry and UUID state restoration.
- b3f5de7: Keep binding-like text inside quoted and backticked query expectation values intact instead of splitting it into additional variables.
- b3f5de7: Respect Unicode word boundaries when parsing reconstruction cue mentions and stop instructions, avoiding accidental selections or early termination inside larger words and entity paths.
- b3f5de7: Retain simultaneous atomic-output write, close and temporary-directory cleanup failures in their original order. Never publish after a failed write or file close, and document the completed-file state when directory cleanup fails after replacement.
- b3f5de7: Do not hide independent automation command or watcher failures when cancellation arrives simultaneously; retain their diagnostics and failing exit status.
- b3f5de7: Retain original automation command and cleanup errors when the final diagnostic sink also throws.
- b3f5de7: Retain bigint intermediates across constant multiplication chains in linear analysis, preserving cross-cancellation and operand evaluation while avoiding repeated growing decimal serialization. Add exact-chain regressions and paired resource measurements on both supported Node versions.
- b3f5de7: Keep owned-store cleanup and completed command output intact when a thrown value cannot be formatted. Synchronous and asynchronous wrappers now use a stable diagnostic placeholder while preserving simultaneous work and close failures.
- b3f5de7: Retain direct indexed lookups for small metadata lists while using bounded SQL for large query and rule requirements.
- b3f5de7: Keep unprintable evaluation errors as failed-run notes instead of aborting
  report construction, sharing safe formatting with resource cleanup.
- b3f5de7: Preserve evaluation fixture exceptions when scratch-store close also fails, and retain the diagnostic chain through root removal. Share the private cleanup policy with the root scope and verify preflight failure ordering before agent calls.
- b3f5de7: Preserve useful tolerance and run-count validation diagnostics for unprintable programmatic settings in evaluation and direct scoring.
- b3f5de7: Keep unprintable query execution errors as failed evaluation expectations so later checks can run and reports remain serializable.
- b3f5de7: Preserve cancellation and caught work exceptions when extraction or reconstruction evaluation stores fail to close. Retain ordinary failed-run reports when close succeeds, stop after close failure, and respect keep policy.
- b3f5de7: Preserve function-agent diagnostics alongside ingestion cancellation without changing strict publication or lenient direct-write behavior.
- b3f5de7: Report unprintable function-agent errors as failed batches while preserving
  strict isolation and lenient continuation. Share safe diagnostic formatting
  with cleanup and selected-source read checks.
- b3f5de7: Retain primary ingestion exceptions through prompt-directory, strict-stage and standalone configuration cleanup failures. Preserve nested diagnostics and continue outer cleanup, with regressions for rollback and post-commit cleanup boundaries.
- b3f5de7: Retain HTML table and definition-list labels during URL ingestion, and preserve article body text when no selected blocks exist.
- b3f5de7: Return all diagnostics for large invalid action-effect metadata without exceeding JavaScript's function-argument limit.
- b3f5de7: Collect rule, action and automation declaration diagnostics iteratively so large invalid preludes return source errors without crashing.
- b3f5de7: Render large derivation note and per-rule diagnostic lists without exceeding JavaScript's function-argument limit.
- b3f5de7: Keep SQLite reconstruction adapter row selection and claim metadata projection
  within one short read snapshot. Preserve fresh reads between asynchronous steps,
  caller transaction ownership, and combined read/cleanup failures.
- b3f5de7: Keep MCP entity overviews and neighbor traversals in one deferred read snapshot.
  Concurrent alias or claim updates no longer mix old selection or forward edges
  with new claims or reverse edges in one response. Preserve caller transactions.
- b3f5de7: Keep MCP fusion estimate selection and alias grouping within one deferred read
  snapshot. Concurrent alias updates no longer split a previously selected quantity
  mid-call. Preserve caller transaction ownership and combined read/cleanup failures.
- b3f5de7: Keep synchronous MCP reconstruction on one deferred database snapshot across
  cue expansion and result rendering. Concurrent updates no longer change the
  traversed graph partway through one result; later calls see the updated graph.
- b3f5de7: Retain article text before, between and after recognized HTML blocks during URL ingestion.
- b3f5de7: Preserve nested evaluation cancellation diagnostics and simultaneous judge prompt work and cleanup failures.
- b3f5de7: Preserve database replacement and cleanup errors in the playground. Retire workers
  after database cleanup failure so rebuilding starts a fresh runtime instead of
  querying a possibly closed database.
- b3f5de7: Retain concurrent cancellation and automation premise-preparation failures without claiming the batch.
- b3f5de7: Keep resolution reliability and effective-confidence labels from rounding positive values to zero or values below one to certainty.
- b3f5de7: Collect SDK-reported errors during requested MCP shutdown, reject cleanup failures after EOF, and preserve preceding stream failures while retaining borrowed-store and stream ownership.
- b3f5de7: Preserve both shell-completion and temporary prompt cleanup failures, including cancellation and unprintable thrown values, instead of masking the completion failure.
- b3f5de7: Preserve errors wrapping HTTP-source cancellation and retain simultaneous fetch/body failures alongside the caller's abort reason.
- b3f5de7: Retain the unusable-source-name diagnostic when an invalid programmatic value cannot be serialized, and verify rejection before writes plus idempotent recovery.
- b3f5de7: Retain the original cause when adding the source filename to a sync schema
  validation error, and safely format unusual thrown values. Verify destination
  preservation, source detachment and retry in normal and dry-run modes.
- b3f5de7: Keep unprintable URL transport errors as retryable source outcomes instead of
  aborting selection, with healthy-source continuation and retry coverage.
- b3f5de7: Preserve SQL.js execution and statement-release errors together instead of
  allowing cleanup failures to hide the original error; keep statements reusable
  after failed calls.
- b3f5de7: Close obsolete declared-source and mapping watchers after declaration changes and ignore their late callbacks.
- b3f5de7: Retire every obsolete declared-watch subscription even when closing fails, preserving diagnostics and allowing reintroduced source paths to receive fresh watchers. Add lifecycle regressions covering late callbacks, repeated paths and subsequent ingestion.
- b3f5de7: Retire the playground worker when its store fails to initialize, including when
  startup cleanup also fails, so Rebuild starts a fresh runtime. Preserve startup
  diagnostics and original causes.
- b3f5de7: Report automation polling watermark failures and retry on the next poll without advancing the processed boundary. Ignore cancelled timer callbacks and verify recovery processes pending events exactly once.
- b3f5de7: Report declared watcher refresh failures without rejecting scheduled work, preserving existing subscriptions so the next save can retry.
- b3f5de7: Add a keyboard-accessible Retry view action to local database viewer errors, preserving the current route and restoring focus after recovery.
- b3f5de7: Return independent empty projection-cache statistics so caller mutations cannot affect diagnostics for other stores.
- b3f5de7: Reuse the version-aware vocabulary cache under the action write reservation, avoiding repeated full registry rebuilds while retaining peer-committed inverse and rename declarations.
- b3f5de7: Reuse shared premise text within each claimed automation batch while capturing fresh metadata for later events.
- b3f5de7: Use the store's version-aware vocabulary refresh inside reply transactions, avoiding repeated full registry rebuilds while preserving peer-committed inverse and rename declarations.
- b3f5de7: Reuse verified explanation digests in workflow reports and sensitivity summaries, avoiding redundant model copying and canonical serialization while retaining validation.
- b3f5de7: Reuse alias-component representatives within each MCP fusion snapshot to avoid repeated graph traversal while preserving fresh and historical selection.
- b3f5de7: Use version-aware registry refresh for derivation, automation trigger reservations and declaration entry points, retaining the explicit rebuild needed after generated vocabulary claims.
- b3f5de7: Reuse claim views within lineage requests so shared evidence avoids repeated metadata reads while retaining branches, repeat markers, and depth limits.
- b3f5de7: Reuse normalized assigned values within each explanation report's hard and soft constraints, preserving fresh assignments across reports. Add isolation coverage and bounded performance measurements.
- b3f5de7: Prepare context and tag reads once per sensitivity projection while retaining row validation, provenance and snapshot behavior.
- b3f5de7: Reuse the last successful identical query within a report render, preserving
  fresh data/options across reports and per-line errors. Extend the reproducible
  benchmark with repeated live splices and document the measured improvement.
- b3f5de7: Reuse the version-aware vocabulary cache during annotated-text sync while retaining peer-declaration refresh and transactional rollback.
- b3f5de7: Reuse metadata statements within each claim-view batch to reduce search construction time while preserving stored-row validation, sensitivity filtering and fresh evidence reads. Document bounded before/after measurements on both supported Node versions.
- b3f5de7: Keep documentation section headings visible below taller sticky headers by sharing the measured scroll adjustment used for focused code blocks and tables.
- b3f5de7: Reveal the beginning of keyboard-focused code examples below the sticky website header, sharing table focus behavior and retaining horizontal scroll position.
- b3f5de7: Reveal documentation table headings below the sticky header when keyboard focus would otherwise obscure them in a short viewport. Preserve horizontal scrolling and ordinary pointer and cell-link behavior.
- b3f5de7: Reveal focused local-viewer headings below the measured sticky header after navigation, including long claim-history headings taller than the viewport.
- b3f5de7: Keep the website's Skip to content destination visible below the current sticky header height, including enlarged mobile headers, while preserving keyboard focus and the current URL.
- b3f5de7: Record verified action rollback, nested-transaction and post-commit hook behavior against current implementation and integration evidence.
- b3f5de7: Record the automation watch lifecycle review against current implementation, documentation and passing cancellation/retry regressions.
- b3f5de7: Record connector refresh, pruning and recovery review against current transaction boundaries and passing integration regressions.
- b3f5de7: Record ingestion staging, source/agent outcome, digest retry and cleanup review against current implementation and integration evidence.
- b3f5de7: Record the synchronization validation, transaction and recovery review against current dual-runtime regression evidence.
- b3f5de7: Correct pending internal-package release ownership, document the public CLI requirement, and refresh the reviewed declaration closure after the schema snapshot optimization.
- b3f5de7: Roll back rule support reconciliation when its pass budget expires, retaining earlier additions and reporting only retained writes so incomplete derivations preserve prior conclusions until a complete retry.
- b3f5de7: Emit computed property names in generated readers so fields such as __proto__ remain own data properties instead of changing the result object's prototype.
- b3f5de7: Skip report block and fragment blank prefixes with index scans instead of repeated array shifts, preserving output and diagnostics for large templates.
- b3f5de7: Collect SQLite reconstruction claims from indexed entity history instead of loading every current belief for each cue, preserving current-row ordering and retractions.
- b3f5de7: Limit the changeset CI exemption to the exact same-repository version PR branch
  targeting main, and require a successful changeset job on every pull request.
- b3f5de7: Restrict shape constraint-tag and qualifier-edge reads to current declaration IDs, preserving exclusions and avoiding unrelated side-table materialization.
- b3f5de7: Score each fact key once in direct evaluator comparisons, using the last supplied fact on each side so duplicate inputs cannot inflate precision or F1.
- b3f5de7: Select current reconstruction claims inside SQLite after scoping entity history, avoiding transfer of superseded revisions into JavaScript while preserving read validation and ordering.
- b3f5de7: Add a repository .nvmrc for the recommended development runtime, document selecting it before bootstrap, and verify agreement with fixed CI workflow runtime pins.
- b3f5de7: Build shape observed-value indexes only for active expectations' attributes and relation directions. Retain taxonomy targeting, explicit taxonomy relation checks, inverse direction handling and fresh evaluation state while reducing unused indexing work.
- b3f5de7: Separate scenario explanation validation and recovery guidance into readable paragraphs for the documentation website.
- b3f5de7: Serialize connector watch startup with later refreshes so saves during a pending initial load cannot start overlapping passes.
- b3f5de7: End MCP serving when output finishes, including writable streams that do not emit close.
- b3f5de7: Reject MCP output-stream failures after transport cleanup instead of leaving the serving promise waiting for unrelated input or cancellation.
- b3f5de7: Recognize unchanged zero-confidence rule conclusions when minConf is zero, avoiding duplicate rows and pass-limit exhaustion while preserving later positive reactivation.
- b3f5de7: Reuse the shared latest-claim SQL in shape reports and document dependencies required for a future incremental gate.
- b3f5de7: Share one version-aware vocabulary snapshot throughout shape evaluation, removing per-instance SQLite cache checks while retaining peer refresh.
- b3f5de7: Share hook-file validation between action execution and doctor, rejecting invalid UTF-8, unpaired surrogates and blank names before action effects.
- b3f5de7: Make concurrent and repeated viewer handle close calls share one shutdown result while retaining caller ownership of the store.
- b3f5de7: Share changeset syntax and package/severity validation between PR CI and release
  preflight, rejecting malformed release metadata before merge.
- b3f5de7: Share one current-belief read for entity and typed-entity health coverage while preserving literal, polarity, and actor-series semantics.
- b3f5de7: Show C1 control characters as visible Unicode escapes in report citation source labels, retaining the original stored source identity and encoded link destination.
- b3f5de7: Finish MCP serving for already-terminal streams, and drain accepted request replies on normal input EOF so buffered requests are not lost during shutdown.
- b3f5de7: Skip full shape snapshots for entirely unchanged actions while retaining before/after gating for every execution that changes an effect.
- b3f5de7: Avoid unused transaction-head scans for skipped rules, reducing measured 1,000-rule quiet runs from 333 ms to 80 ms.
- b3f5de7: Skip shape fact snapshots when no active expectations remain after declaration and qualifier checks, while observing reactivation on every evaluation.
- b3f5de7: Read alias-discovery evidence and decision history in one snapshot, releasing it before scoring and after read failures.
- b3f5de7: Copy disposable sensitivity projections within a read snapshot so adapters without transaction inspection cannot mix claims and citation edges across peer commits.
- b3f5de7: Retain selected embedded file content with its digest so later edits cannot change the prompt under stale provenance.
- b3f5de7: Generate typed readers that hold one read snapshot across fields and release it after validation failures without committing caller transactions.
- b3f5de7: Keep restricted viewer responses on one read snapshot across concurrent database commits while preserving caller transactions.
- b3f5de7: Keep viewer search matches and evidence counts on one read snapshot across concurrent commits at every sensitivity ceiling.
- b3f5de7: Validate connector URL Unicode and decimal deadlines before fetching, and retain source parsing and cancellation settings across awaited transport work.
- b3f5de7: Allow stalled grammar-download fixtures enough startup time under workspace load while retaining request-count, deadline and partial-file cleanup assertions.
- b3f5de7: Give the grammar retry fixture enough time for both localhost requests to start under workspace load, while retaining timeout, cleanup, retry and offline-cache assertions.
- b3f5de7: Avoid invented trailing blank lines in title-only HTML extraction so equivalent title content retains its ingestion digest.
- b3f5de7: Stop automation watches cleanly when reporting a poll or cycle error also fails. Observe rejected cycle promises, retain both failures, remove abort listeners, cancel polling and await active work before closing the store.
- b3f5de7: Stop queued direct connector watch passes and ignore file callbacks after cancellation, matching declared watch shutdown.
- b3f5de7: Add a Stop query control to the browser playground. It terminates a pending query's worker, retains editor text, and focuses Rebuild database so users can recover without leaving the page.
- b3f5de7: Reject extra or repeated release-validator arguments before repository access,
  so a typo or competing modes cannot silently select the first mode.
- b3f5de7: Preserve valid judge pairings beside JSON strings containing brackets and recover balanced answers after unfinished prose brackets.
- b3f5de7: Use the effective verb registry when declaring sync merge events so conditional
  vocabulary claims cannot suppress the required top-level declaration.
  Clarify that sync skips matching identities and rejects identities reused with
  different content.
- b3f5de7: Keep the documentation text-enlargement regression focused on the command table instead of whichever table happens to appear last, preserving keyboard-overflow coverage as guides grow.
- b3f5de7: Resolve named action attributes with a targeted latest-row query, preserving source-series and disabled-declaration semantics while avoiding whole-store materialization per firing.
- b3f5de7: Avoid loading unrelated current beliefs for automation declaration idempotence, preserving newest-actor resolution including retractions and negations.
- b3f5de7: Restrict shape fact snapshots to taxonomy, typings, and active expected slots while preserving current-version and inverse-relation semantics.
- b3f5de7: Prevent model-reply parsing from looping forever on an empty reconstruction cue and an unrecognized reply.
- 0b1f150: Limit CI runtime versions to Node 24.21.0 and 26.8.2 while retaining Linux, macOS and Windows coverage.
- b3f5de7: Track complete agent-output fences so other language blocks cannot consume CAVE output, preserving line endings and wider fence contents.
- b3f5de7: Evaluate action declarations, refreshed vocabulary, premises, and shape baselines under the same write reservation as their effects. Prevent competing writers from revoking prerequisites between validation and commit while preserving post-commit hooks for standalone actions.
- b3f5de7: Discover and retire vanished connector records within one write transaction, preventing stale prune lists and rolling back the whole pruning phase on failure.
- b3f5de7: Typecheck a generated client in the test suite, covering special property names, value/type namespace coexistence, units, cardinality and inverse relations.
- b3f5de7: Use consistent theme-aware keyboard focus outlines for local-viewer links and controls, with light and dark browser coverage for wrapped source links.
- b3f5de7: Reject unknown permission and static-tool names consistently in static and
  generated-action scope helpers, while preserving future act_ declarations.
- b3f5de7: Reject malformed programmatic action dryRun, check and aliases settings before
  execution. String preview flags can no longer enter the durable write path;
  valid boolean settings and omitted defaults retain their existing behavior.
- b3f5de7: Reject invalid action hook budgets before committing effects and normalize whole-millisecond decimal timeouts.
- b3f5de7: Reject nonnumeric action hook timeouts with the normal validation report before coercion, action writes or lazy hook lookup.
- b3f5de7: Reject fresh alias suggestion batches unless every line represents exactly one positive relation between its proposed names, preventing misleading value-target appends and unrelated claims.
- b3f5de7: Reject repeated action CLI parameters and preserve prototype-named extra arguments for unknown-parameter validation before executing effects.
- b3f5de7: Validate lower-level file/web selection flags before source work. Capture file
  force and embed settings once so getter changes cannot alter a batch midway.
- b3f5de7: Reject invalid automation hook budgets before consuming events and normalize decimal-second deadlines for direct hooks.
- b3f5de7: Reject malformed UTF-8, unpaired Unicode surrogates, and blank names in automation hook configuration before settlement consumes pending events, matching action and doctor requirements.
- b3f5de7: Reject malformed automation mode flags, null limits and nonnumeric hook timeouts
  before durable work. Timeout validation no longer invokes object coercion.
- b3f5de7: Validate automation timeout range and millisecond precision before opening the database, consistently with the agent process timer contract.
- b3f5de7: Reject blank cave serve host options before database access, with a clear CLI diagnostic and no listener startup.
- b3f5de7: Reject null and nonnumeric connector fetch deadlines before network requests without coercing caller values. Preserve whole-millisecond decimal deadlines and the default for omitted settings.
- b3f5de7: Validate and capture connector source contexts before lifecycle writes so invalid source identities or later line spans cannot leave partial prelude or record updates.
- b3f5de7: Reject malformed connect force, prune and preludeLifecycle options before any
  unit is published. Preserve valid settings and digest-based retry behavior.
- b3f5de7: Reject nonstring CSV and TSV delimiters without coercion, including explicit null, instead of accepting values that cannot split fields correctly. Preserve default delimiters when omitted.
- b3f5de7: Validate declared source execution, discovery and assembly mode flags before
  source work. Capture execution flags while preserving cancellation and transitions.
- b3f5de7: Reject malformed derivation boolean flags and explicit null numeric limits before
  the write transaction. Preserve captured options, valid previews and omitted defaults.
- b3f5de7: Reject invalid entity activity limits before reading the store instead of silently coercing or slicing with negative and fractional values; retain zero-limit and default behavior.
- b3f5de7: Reject invalid evaluation modes and unsupported agent timeout values before fixture discovery. Apply the same whole-millisecond timeout bounds to the evaluation API and CLI.
- b3f5de7: Reject invalid explicit connector source formats before file or network access instead of bypassing parsing or silently inferring a format for null. Preserve automatic detection when the format is omitted.
- b3f5de7: Reject missing or directory-valued explicit evaluator instructions before agent work instead of falling back to different instructions.
- b3f5de7: Reject invalid or repeated HTTP viewer alias settings with a clear 400 response instead of silently disabling expansion. Preserve omitted and explicit 0/1 behavior and HEAD response semantics.
- b3f5de7: Reject corrupt claim keys and transaction identities in restricted HTTP claim views before displaying dates and history links.
- b3f5de7: Reject malformed ingestion force, embed and noPrelude flags before staging or
  source handling. Validate MCP noPrelude before creating or replacing its config.
- b3f5de7: Reject invalid ingestion commit policies before staging or agent work, preserving the target and retaining strict as the omitted-option default.
- b3f5de7: Validate ingestion context claim limits before reading the store, rejecting invalid budgets that silently disabled or exceeded the cap.
- b3f5de7: Validate captured ingestion working directories before staging databases or creating temporary prompt directories.
- b3f5de7: Reject invalid ingestion output modes before staging or agent calls so misspelled modes cannot silently ignore stdout claims and certify sources.
- b3f5de7: Validate complete ingestion source collections as arrays of strings before file reads and URL fetches.
- b3f5de7: Validate ingestion timeouts before opening or reading sources and convert valid decimal seconds to whole milliseconds without floating-point rejection.
- b3f5de7: Validate action and automation hook mappings at library entry points before committing effects or consuming events.
- b3f5de7: Validate malformed Unicode in MCP fusion entity selectors before treating the request as an empty result.
- b3f5de7: Reject malformed UTF-8, unpaired Unicode surrogates, and blank hook names during MCP configuration validation, before database or protocol startup.
- b3f5de7: Reject null, non-array, sparse and non-string MCP scope lists consistently.
  Malformed permission lists no longer silently select unrestricted defaults.
- b3f5de7: Reject malformed Unicode reconstruction seeds before graph traversal, including with zero budgets.
- b3f5de7: Validate older versioned database sync sources against their recorded schema so missing provenance cannot silently fall back to legacy inference.
- b3f5de7: Reject malformed performance budgets and incomplete workload coverage so configuration errors cannot silently pass the regression gate.
- b3f5de7: Reject malformed process stdout UTF-8 validation modes before launch instead of silently disabling validation.
- b3f5de7: Apply shared source-token validation to programmatic MCP calls and CLI --src.
  Malformed explicit values no longer silently select default provenance or reach
  writes; false still disables stamping and omission uses the agent source.
- b3f5de7: Validate and capture numeric HTTP viewer ports before creating a listener, rejecting invalid types and out-of-range values consistently.
- b3f5de7: Share binding-map and interpolation validation between query-record construction and decoding. Reject malformed metadata and sparse/non-object support rows before evidence projection while retaining valid plain/null-prototype maps and numeric precision independent of display rounding.
- b3f5de7: Reject invalid reconstruction cue limits before prompt rendering or model work instead of silently coercing them through array slicing.
- b3f5de7: Reject unsafe integer reconstruction budgets as line-numbered fixture problems before starting an evaluation policy.
- b3f5de7: Validate built-in reconstruction step and claim budgets before traversal or model completions, preventing invalid numeric settings from bypassing stopping thresholds.
- b3f5de7: Reject nonfinite and negative reconstruction decay and score-floor settings before traversal while preserving finite amplification and pruning thresholds.
- b3f5de7: Capture and validate provenance when constructing structured claim records, rejecting malformed entries before publication and preserving valid array ordering and duplicates independently of caller mutation.
- b3f5de7: Reject corrupted claim keys before rendering report citations or copying sensitivity projections, preserving reliable history references.
- b3f5de7: Reject malformed or mismatched stored transaction identities before rendering report dates or copying sensitivity projections.
- b3f5de7: Reject malformed programmatic report aliases and resolve settings before store reads instead of silently disabling the requested mode. Preserve valid boolean settings and per-line template query diagnostics.
- b3f5de7: Validate report time options before reading inputs or replacing output, including templates without live queries.
- b3f5de7: Validate the exact SDK version before replacing a grammar toolchain installation, preserving the prior installation when a verified archive has missing or mismatched version metadata.
- b3f5de7: Validate Boolean sensitivity samples and fixed values before any backend call, preventing an invalid later sample from triggering partial batch execution.
- b3f5de7: Validate sensitivity sample values and fixed bindings, including sparse array holes, with contextual errors before backend execution.
- b3f5de7: Require arrays for supplied sensitivity fixed-binding and observation lists, rejecting null and iterable strings instead of silently changing request meaning.
- b3f5de7: Validate sensitivity request objects and sample arrays explicitly before solving, replacing incidental property and method errors with named workflow validation diagnostics.
- b3f5de7: Reject malformed expected snapshot hashes before file inspection, including trailing newlines, while accepting uppercase hexadecimal.
- b3f5de7: Keep malformed HTTP(S) source identities as plain provenance citations instead of exposing invalid navigable links. Preserve stored source identities, line spans, and existing URL escapes.
- b3f5de7: Validate stored claim fields before shaping HTTP views so search rejects malformed payloads and boolean flags consistently with entity, history and lineage reads.
- b3f5de7: Reject malformed sync dryRun and record options before merging across database,
  file and text entrypoints. Preserve valid previews, defaults and idempotent retry.
- b3f5de7: Reject database sync sources with undecodable historical claims or inconsistent semantic keys before copying data into the target.
- b3f5de7: Reject transaction indexes with incompatible collation during schema checks, migration, and database sync; verify native and WASM rollback and repair.
- b3f5de7: Require boolean alias options in programmatic entity and topic views before database reads or sensitivity projection work. Preserve omitted, false and true behavior.
- b3f5de7: Reject explicit null viewer limits and stale horizons instead of silently selecting defaults. Validate search limits before opening a read snapshot, while preserving zero limits and defaults for omitted options.
- b3f5de7: Validate and capture dashboard caps and staleness horizons before store work, retaining zero caps without allowing negative SQL limits.
- b3f5de7: Share sensitivity-ceiling validation across viewer APIs, reports and HTTP startup. Reject null and unknown values before database work instead of silently defaulting or returning empty projections.
- b3f5de7: Reject invalid programmatic HTTP viewer sensitivity ceilings before creating the server.
- b3f5de7: Reject fractional-millisecond automation polling intervals before opening the database and round validated timer delays to preserve the requested interval.
- b3f5de7: Validate every explicit replay ID as a canonical lowercase UUIDv7 before any
  row is inserted or the receive clock observes an ID. Reject malformed batches
  without changing stored data, vocabulary, or future transaction allocation.
  
  Database sync also rejects malformed or mismatched source id/tx values before
  copying rows, lineage, or recording a merge.
- b3f5de7: Verify prototype-named trigger variables through joins, prompt substitution, firing reports, resulting claims and watermark idempotence, and cover rule verb-variable specialization.
- b3f5de7: Record clean-build integration verification of the accumulated system review,
  including the full test suite, browser workflows, installed artifacts and
  incremental no-op checks.
- b3f5de7: Verify binary SIGINT handling during pending ingestion URL reads, including quiet exit 130, no agent invocation and an unchanged target database.
- b3f5de7: Record full workspace, packed-artifact, book-example, and production website verification of the connector validation and concurrency fixes.
- b3f5de7: Verify declared-source CSV validation preserves claims, record digests and declaration metadata through pruning, assembly failures and valid-source recovery.
- b3f5de7: Verify cancellation ownership for agents that write through a separate database connection, including strict staging cleanup and lenient digest withholding.
- b3f5de7: Record full workspace, packed-package, executable-book, production-browser and performance verification of scenario validation, alias discovery improvements and documentation filtering.
- b3f5de7: Record workspace, packed CLI, executable book, and production website verification of rule and automation limits and process and solver deadlines.
- b3f5de7: Record the full-suite, production-browser and incremental-build verification of
  the accumulated fusion and release validation improvements.
- b3f5de7: Record workspace, packed CLI, performance, book-example, and production browser verification of health coverage, inactive-shape gating, and documentation navigation.
- b3f5de7: Verify JSON source selectors preserve own prototype-like and dotted keys across local and HTTP loading, and clean up temporary source-test directories.
- b3f5de7: Record full workspace, book, packed-package, browser and constrained-heap alias verification of lifecycle, governance and discovery changes.
- b3f5de7: Verify and document split UTF-8 capture at exact byte limits through both asynchronous and synchronous process runners.
- b3f5de7: Verify prototype-named query bindings through CLI JSON/text and MCP tool-result rendering.
- b3f5de7: Verify that reactivating historical expectations gates the resulting batch, rolls back vocabulary with rejected writes, and accepts a corrected retry.
- b3f5de7: Record workspace, executable-book, packed-package and documentation-link verification of scenario recording guards and client and alias-judge fixes.
- b3f5de7: Record full workspace, book, packed-package, documentation and performance verification of scenario definition validation and bounded alias result retention.
- b3f5de7: Verify stable sorted unit diagnostics across later shape evaluations and document an allocation experiment that showed no material automation speedup and was reverted.
- b3f5de7: Record full workspace, packed consumer, executable book, browser and fixed performance verification of optimized shape fact projections and observed indexes.
- b3f5de7: Record workspace, packed-package, performance, executable-book and production-browser verification of consistent shape snapshots and generated-client field identities.
- b3f5de7: Record full workspace, packed CLI, performance, book-example, and production website verification of narrowed shape snapshots and indexed declaration discovery.
- b3f5de7: Verify and document merge-record direction and idempotence when imported vocabulary declares SYNCED-INTO as a reverse verb.
- b3f5de7: Verify health and shape read snapshots, gated rollback, caller transactions, and error cleanup against the sql.js adapter.
- b3f5de7: Verify atomic action recovery after effect and lineage write failures, and document thrown execution errors.
- b3f5de7: Verify and document action lineage across effect updates, no-ops, dry runs and database reopen.
- b3f5de7: Document and verify that hook timeouts retain committed action history and that repeating an unchanged action does not retry its external side effect.
- b3f5de7: Verify and document hook retractions, actor-attributed parameter descriptions, and action removal in batched listings.
- b3f5de7: Record full workspace integration of action metadata diagnostics and repair recovery on both supported Node majors.
- b3f5de7: Verify newer positive parameter metadata can clear and restore action descriptions across actor series without changing history or action execution.
- b3f5de7: Verify that action parameter declarations reject prototype setters and other names that do not start with a letter, preserving the documented boundary from general query variables.
- b3f5de7: Verify that existing action effects cannot bypass premises invalidated by local or peer-written qualifier edges, while preserving past effect lineage.
- b3f5de7: Document and verify atomic rollback and retry of multi-series action retractions, including preservation of past effects and their lineage.
- b3f5de7: Verify generated action schemas through SDK stdio and installed packages, including
  numeric/boolean effects and unchanged history after rejected arguments.
- b3f5de7: Verify malformed shell-agent output appends no reply claims during automation settlement, document its recorded-firing retry semantics, and check recovery on a later trigger.
- b3f5de7: Verify annotated self-edge replay preserves transaction identity and all four edge roles without duplicating rows or edges on repeated sync.
- b3f5de7: Verify that annotation-like comments retain history and provenance through strict text and database sync.
- b3f5de7: Verify supported prototype-named trigger bindings through governed action execution and document the narrower action-parameter naming boundary.
- b3f5de7: Verify missing action-binding failures through text and JSON automation commands, including nonzero status, persisted later effects and no event replay after reopening.
- b3f5de7: Document verified CLI diagnostics and retry behavior for malformed stored automation bodies.
- b3f5de7: Exercise nested, cyclic and unreadable error metadata during automation cancellation while preserving diagnostic identities and claimed-batch non-replay.
- b3f5de7: Verify installed cancelled automation commands and the full Node 24 workspace after action and automation option-capture fixes.
- b3f5de7: Verify automation cycle validation before completion/report callbacks and durable
  history changes, including installed recovery and no replay after correction.
- b3f5de7: Verify installed integration and built-CLI text/JSON recovery after automation premise preparation failures.
- b3f5de7: Record full workspace verification of automation premise preparation and batch snapshot recovery on both supported Node majors.
- b3f5de7: Verify installed packages and production browser behavior after automation storage diagnostics and guide navigation changes.
- b3f5de7: Document and verify atomic rejection and listener cleanup for truncated UTF-8, premature close, and transport errors in automation declaration streams.
- b3f5de7: Verify the automation watcher schedules the exact validated millisecond delay and clears its timer when cancellation arrives during setup.
- b3f5de7: Extend production browser recovery checks to invalid query counts and output values inside otherwise valid worker replies, verifying preserved draft text and a successful rebuild/query afterward.
- b3f5de7: Verify local-viewer source citations on mobile and desktop, including plain invalid destinations, keyboard navigation to valid encoded URLs, history navigation and unchanged stored provenance.
- b3f5de7: Verify built sync CLI JSON failure reporting, unchanged history and corrected replay on both supported Node majors.
- b3f5de7: Verify and document that a successful no-op action retry preserves committed history without rerunning a previously failed hook, while a new effect runs the corrected hook.
- b3f5de7: Verify and document multiline query diagnostics, JSON-mode failure output, and database preservation through the executable CLI.
- b3f5de7: Verify and document typed-client identity across equivalent source declarations, conflicting unit revisions, correction and redundant-source retraction.
- b3f5de7: Verify combined asynchronous-cleanup and database-close failures, ordered error retention, reentrant closure and corrected retry without repeating callbacks.
- b3f5de7: Verify and document recovery after failed source pruning, including retained record commits, digest skipping and idempotent retirement.
- b3f5de7: Verify connector report counts, per-record rollback and retry behavior when ingestion rejects one record while another updates and absent records are pruned.
- b3f5de7: Document and verify reconciliation isolation for overlapping source facts, pruning, and restored records.
- b3f5de7: Verify that watch startup cancellation discards queued refreshes and late response writes, and document transport settlement ownership.
- b3f5de7: Verify serialized connector watch startup and cancellation across full workspace runs on both supported Node majors.
- b3f5de7: Fail CLI consolidation when a published module's literal runtime import is
  missing from the CLI's runtime dependency declarations, identifying the file
  and dependency before packaging.
- b3f5de7: Verify constraints filter prototype-named premise bindings before action effect selection, and ambiguity leaves stored history unchanged.
- b3f5de7: Verify strict and lenient ingestion supply later batches with current context while retaining superseded and retracted history in storage.
- b3f5de7: Record production website verification of the current emitter runtime and graph documentation.
- b3f5de7: Record current 1,000–4,000-event shaped automation measurements, complete result checks and zero-write quiet cycles.
- b3f5de7: Record full Node 24 workspace and installed-package verification for the current system review changes.
- b3f5de7: Record production website verification of current read-option, arithmetic and emitter documentation changes.
- b3f5de7: Verify stored rule and automation diagnostics across both supported Node workspace suites.
- b3f5de7: Verify declared-source discovery preserves cancellation diagnostics, releases private snapshots, and retries without changing original history.
- b3f5de7: Verify and document declared file failure recovery, unchanged-byte retries and declaration removal without implicit imported-data retirement.
- b3f5de7: Verify that malformed declared JSON refreshes preserve claims and ownership, identify the declared source, and retry without duplicate history after correction.
- b3f5de7: Document and verify declared-query rediscovery, retry exhaustion and history preservation during concurrent declaration changes.
- b3f5de7: Verify a repaired declared-source replacement skips unchanged records and adds no history on its next run.
- b3f5de7: Verify doctor releases rollback-journal read locks after healthy and invalid-row reports so the existing writer connection can update and repair the store.
- b3f5de7: Verify documentation filter recovery and keyboard selection at mobile and desktop widths, and correct the overview to describe citations on embedded query results.
- b3f5de7: Document and verify rollback and retry of edge-only database and annotated-text sync when merge-record insertion fails.
- b3f5de7: Document and verify evaluation scoring across actor changes, lifecycle ownership, and separate content sources without mutating stored provenance.
- b3f5de7: Verify exact confidence preservation through both SQLite adapters, canonical
  history/current export, import, and annotated sync across retraction and reassertion.
- b3f5de7: Verify playground cancellation during synchronous worker execution, including native worker closure and a successful query after rebuilding. Document the distinction from a request held before execution.
- b3f5de7: Verify malformed stored payloads fail export without partial stdout, destination changes or database mutations, and that export succeeds after repair.
- b3f5de7: Verify complete federated-query history rollback when output and store cleanup both fail.
- b3f5de7: Verify and document that direct and declared federated JSON queries roll back temporary claims and emit no JSON when stored-record projection fails, then recover after the malformed record is repaired.
- b3f5de7: Verify direct and declared federated JSON recovery from malformed stored provenance, including no partial output and preservation of claim, context, provenance, tag and edge history on projection failure and successful retry after repair.
- b3f5de7: Compile a generated-client consumer to verify scalar and array cardinality, literal units, read-only fields, and rejection of undeclared properties.
- b3f5de7: Verify that binary unit declaration errors preserve an existing generated client file and that corrected generation restores identical output.
- b3f5de7: Verify generated readers retain one snapshot across mixed attribute and relation updates, and align the typed-client specification with non-text unit rejection.
- b3f5de7: Exercise the documented union driver through local Git merges, including preserved claim identities and unresolved invalid input.
- b3f5de7: Verify grammar toolchain timeout recovery with checksum-verified local fixture archives, successful retry and offline cache reuse without further requests.
- b3f5de7: Record full Node 24 and 26 integration and installed-package verification for historical fusion grouping and per-call alias-component reuse.
- b3f5de7: Verify HTML source extraction retains the same content and digest with or without a leading BOM, including responses without a declared media type.
- b3f5de7: Verify ingestion's URL concurrency limit remains in force while real HTTP response bodies are still being read.
- b3f5de7: Verify every HTTP view endpoint retains its configured sensitivity ceiling despite request-level override attempts, and document startup-owned audience configuration.
- b3f5de7: Verify strict and lenient ingestion of malformed UTF-8 over real HTTP, including digest preservation, corrected-source recovery and unchanged-source skipping.
- b3f5de7: Verify interrupted HTTP delivery preserves server usability and caller ownership of the source store.
- b3f5de7: Verify HTTP views reject inconsistent numeric caches, preserve sensitivity filtering and recover after repair without exposing corrupted values in diagnostics.
- b3f5de7: Verify extensionless HTTP TSV imports preserve history after malformed refreshes with pruning enabled and resume idempotent updates after correction.
- b3f5de7: Verify escaped ingestion setup errors and unchanged planning retries through normal and debug CLI processes.
- b3f5de7: Verify installed shell-agent option forwarding and full workspace integration of ingestion target, batch and manifest changes.
- b3f5de7: Verify captured ingestion source lists retain queued URLs, manifests and recorded digests across caller mutation.
- b3f5de7: Exercise premise-bound action variable names, atomic ambiguity failures and action CLI argument validation through installed package exports.
- b3f5de7: Verify installed action and proposal timeout validation rejects null and other
  malformed values without writes, hook lookup or coercion, then permits recovery.
- b3f5de7: Verify installed actions retain their captured execution mode, preserve dry-run history and defer hook lookup until after commit.
- b3f5de7: Verify installed action and proposal entrypoints reject malformed execution modes,
  preserve history on rejection and preview, and allow a valid durable retry.
- b3f5de7: Verify packed doctor and export reject malformed approximation flags, preserve database and output bytes, respect export sensitivity, and recover after repair.
- b3f5de7: Verify installed automation cancellation and non-replayed claimed batches, keeping option capture in an internal module without changing the declaration snapshot.
- b3f5de7: Verify bundled automation cancellation diagnostics, claimed-batch non-replay and hook identity placeholders through installed CLI exports.
- b3f5de7: Verify that installed structured-record construction rejects malformed claim
  flags, raw text, terms and payloads, and preserves a valid JSON round trip.
- b3f5de7: Verify installed doctor and export commands reject malformed confidence and sigma levels, preserve database and output bytes on failure, respect export sensitivity scope, and recover after repair.
- b3f5de7: Verify installed connector source loading rejects malformed fetch deadlines without invoking transport or caller conversion methods, and still accepts valid decimal deadlines.
- b3f5de7: Verify installed direct and declared connector mode validation preserves history,
  accepts corrected requests and retains read-only discovery and unchanged repeats.
- b3f5de7: Verify installed rule and automation storage diagnostics, history preservation, and repaired retries.
- b3f5de7: Verify installed connector CSV and TSV parsing rejects nonstring delimiters without coercion and preserves custom and omitted delimiter behavior.
- b3f5de7: Verify installed derivation option validation preserves history and lineage on
  rejection and preview, then supports a durable retry and unchanged repeat.
- b3f5de7: Verify installed diagnosis captures options once and preserves successful text-store assembly, claim counts and source bytes when cleanup fails, with a healthy retry after recovery.
- b3f5de7: Verify installed doctor retains a consistent SQLite snapshot and reports simultaneous configured-store and capability-probe cleanup failures without discarding earlier checks or exposing raw errors.
- b3f5de7: Exercise evaluation mode and timeout preflight and repeated-run configuration ownership through the installed CLI bundle.
- b3f5de7: Exercise duplicate scoring, subnormal tolerance, query expectation bindings, safe reconstruction budgets and cancellation through the packed CLI evaluator exports.
- b3f5de7: Verify installed direct and declared federated JSON queries retain source contexts and run provenance before rollback, including valid partial output on mapping failures.
- b3f5de7: Execute clients emitted by the installed generator against concurrent updates and validation-failure recovery in the packed smoke suite.
- b3f5de7: Verify the installed HTTP viewer rejects invalid and repeated alias settings for GET and HEAD, and accepts corrected requests on the same server.
- b3f5de7: Verify installed HTTP views reject duplicate required parameters, including encoded parameter names and empty first values, under GET and HEAD.
- b3f5de7: Verify HTTP TSV format inference, multiline source spans, SQL projection and explicit format overrides through the installed connector export.
- b3f5de7: Fix installed ingestion MCP config generation by resolving the exported MCP module
  and its bundled sibling executable. Verify malformed flags preserve caller files
  and corrected boolean settings generate usable configuration.
- b3f5de7: Verify installed ingestion limit rejection before source fetching, agent calls or
  history changes, followed by successful source selection and corrected ingestion.
- b3f5de7: Verify installed ingestion preserves its publication target and validated batching across asynchronous caller-option changes.
- b3f5de7: Verify installed ingestion rejects malformed Unicode paths, retains escaped filesystem causes and validates working directories before database copying.
- b3f5de7: Verify installed ingestion rejects invalid commit policies and output modes before agent calls or target writes and recovers with corrected options.
- b3f5de7: Verify source collection validation, queued URL ownership and HTML content identity through installed CLI ingestion exports.
- b3f5de7: Verify exact 18-factor product cancellation through installed linear analysis, including signed and zero products and zero/nonzero divisor classification with large rational factors.
- b3f5de7: Verify installed SQLite loop reads retain metadata from their selection snapshot,
  while asynchronous reconstruction continues to observe updates between expansions.
- b3f5de7: Verify installed MCP stdio source validation, per-call source and hooks capture,
  configuration-error recovery without writes, and disabled/default stamping.
- b3f5de7: Verify installed MCP tools reject malformed query scope, fusion selectors and
  reconstruction inputs while preserving valid pagination, fusion and reconstruction.
- b3f5de7: Verify installed MCP read tools reject malformed mode flags, preserve omitted
  false defaults, accept true values and leave stored history unchanged.
- b3f5de7: Verify installed MCP fusion, entity overview, neighbor and reconstruction tools
  retain one reply snapshot during peer writes, then see updates on the next call.
- b3f5de7: Verify installed strict and lenient ingestion extract CAVE claims after a differently labelled code block and retain incremental replay skipping.
- b3f5de7: Exercise non-FTS virtual search-table rejection through installed store opening, backup verification, restore and doctor, including preservation of the damaged database and restore destination and successful recovery after repair.
- b3f5de7: Verify installed viewer startup rejects null settings before listener creation and retains corrected public-sensitivity startup, shared shutdown and unchanged history.
- b3f5de7: Verify installed doctor and export reject inconsistent numeric caches without changing database bytes or prior output, preserve sensitivity filtering, and recover after repair.
- b3f5de7: Verify original prelude source lines, failure history preservation, corrected input and replay through all three installed declaration commands.
- b3f5de7: Verify cancellation during automation preparation and diagnostic-preserving retries through installed packages.
- b3f5de7: Verify installed connector record fields are captured consistently for durable imports and federated queries, preserving temporary rollback and unchanged-input skips.
- b3f5de7: Verify installed record identity/key validation, one-time field capture, query option capture and consistent metadata projection across live WAL peer updates.
- b3f5de7: Verify installed report rendering rejects malformed mode settings, recovers with valid booleans and alias-expanded citations, and preserves source history.
- b3f5de7: Verify installed reports preserve historical values and citations with captured query options and leave store history unchanged.
- b3f5de7: Verify installed rule-limit capture, later policy reevaluation and unchanged history on invalid limits, and check the updated bundled documentation.
- b3f5de7: Verify installed scenario binding retains exact decimal conversions, uncertainty, confidence, source row evidence and repeatable history-preserving reads.
- b3f5de7: Verify installed-package rejection of substituted search tables across opening, doctor, snapshot verification and restore, including destination preservation and repaired search recovery. Cover literal CAVE schema prefixes in installed diagnosis.
- b3f5de7: Verify installed connector source formats reject invalid overrides before I/O, capture the selected format once, and preserve valid overrides and automatic detection.
- b3f5de7: Verify installed source selectors reject malformed flags, retain captured file
  batch settings, and preserve normal web digest skipping and explicit refresh.
- b3f5de7: Verify installed claim/provenance capture and independence from caller mutation, plus malformed stored provenance rejection and repair recovery through record and query projections.
- b3f5de7: Verify installed database, file and text sync reject malformed mode flags without
  history changes, preserve previews and complete corrected idempotent imports.
- b3f5de7: Verify installed doctor and transaction-annotated export reject malformed and mismatched row identities, preserve existing output, retain public-scope export and recover after explicit repair.
- b3f5de7: Verify installed evaluator and sync exports preserve Unicode identity across reordered bindings and tags while rejecting real content conflicts atomically.
- b3f5de7: Verify installed URL selection retains refresh policy and cancellation across caller-option changes without modifying store history.
- b3f5de7: Verify bundled ingestion preserves bounded URL fetching, source order, isolated failures and cancellation of queued requests.
- b3f5de7: Verify installed entity and topic views reject malformed alias options, preserve store history, and retain valid alias-expanded facts and membership.
- b3f5de7: Verify installed viewer limits reject null and malformed search limits before reads, while retaining zero limits, omitted defaults and unchanged store history.
- b3f5de7: Verify installed viewer and report sensitivity options reject invalid policies, preserve history and retain valid audience filtering.
- b3f5de7: Verify installed viewer snapshot consistency across peer commits with and without adapter transaction inspection.
- b3f5de7: Verify installed viewer caps, captured search sensitivity, repeated lineage evidence, and fresh responses after store updates.
- b3f5de7: Record full-workspace verification of mapping and action formatting corrections and review of playground error recovery controls.
- b3f5de7: Record integrated workspace and browser verification of the accumulated system-review changes, preserving the remaining review and hosted-release boundaries.
- b3f5de7: Verify interrupted native HTTP response bodies preserve imported history under pruning, identify the failing source and allow an idempotent retry after recovery.
- b3f5de7: Verify that malformed selected JSON records preserve existing claims and transaction history under pruning, with normal update, pruning and idempotent recovery after correction.
- b3f5de7: Verify and document that malformed JSONL refreshes preserve prior claims under pruning and recover idempotently after correction.
- b3f5de7: Exercise health-report scope batching with over 33,000 evidence rows and preserve conflict scope at the end of the batch.
- b3f5de7: Refresh the system review verification map and production website evidence after large-input handling documentation updates.
- b3f5de7: Verify numeric-looking ingestion digests preserve leading zeros through provenance export/import and unchanged-source selection.
- b3f5de7: Verify source-reference validation, repair and idempotent retry for legacy sync tables without declared foreign keys.
- b3f5de7: Document and verify that backup and restore require literal boolean true to replace a destination, preserving existing files for truthy nonboolean options without coercion.
- b3f5de7: Verify shared lineage rendering and fresh evidence after browser Back in the local HTTP viewer.
- b3f5de7: Verify browser announcement, keyboard focus and recovery after an invalid local viewer search.
- b3f5de7: Verify loop projection and post-release error preservation, same-transaction retry, and caller rollback ownership.
- b3f5de7: Verify and document malformed automation redeclaration, rearming, and retraction recovery.
- b3f5de7: Verify that an MCP input decoding failure after a completed write preserves committed history and releases session listeners.
- b3f5de7: Cover MCP protocol error replies and subsequent valid discovery during buffered EOF shutdown.
- b3f5de7: Verify that malformed stdio frames do not block later valid MCP requests or EOF draining, and document the distinction between discarded frames and protocol error replies.
- b3f5de7: Verify text and JSON ingestion reports retain the final MCP agent note while deriving claim counts from database changes rather than agent prose.
- b3f5de7: Verify MCP query projection failures through the SDK stdio transport: malformed
  stored identity or provenance returns a tool error without partial matches or
  writes, and a query succeeds in the same session after repair.
- b3f5de7: Verify reconstruction input schemas and malformed-argument rejection through MCP
  stdio, including zero budgets, unchanged history and same-session corrected requests.
- b3f5de7: Verify scope capture over workspace and installed MCP stdio connections. Caller
  mutations cannot change permissions, while permitted future actions remain dynamic.
- b3f5de7: Verify malformed MCP scopes reject stdio startup before buffered writes, retain
  SDK error replies and cleanup, and fail consistently through installed scope APIs.
- b3f5de7: Document NUL query rejection in MCP search discovery and verify tool errors and recovery over real stdio transport.
- b3f5de7: Verify malformed Unicode tool errors, atomic additions and session recovery through MCP stdio.
- b3f5de7: Verify malformed MCP write flags over SDK stdio and installed CLI tool exports,
  including unchanged history, real previews and corrected durable writes.
- b3f5de7: Exercise bootstrap with real local executable shims for pnpm, Corepack, and npm, checking version resolution, output, and installation status in paths containing spaces. Run these dependency-free checks in every CI runtime-matrix job before dependency installation, including native Windows .cmd shims.
- b3f5de7: Verify native HTTP refreshes reject malformed UTF-8 before pruning imported records, preserve history across failures, and resume updates and idempotent refreshes after correction.
- b3f5de7: Verify and document that failed first-time exports, reports, and module writes leave no partial destination and recover on retry.
- b3f5de7: Record full Node 24 workspace and integrated browser verification, and refresh the hosted release evidence without treating the older workflow as migration proof.
- b3f5de7: Verify malformed prompt rejection, strict shell-completion stdout, and valid Unicode round-trips through the installed CLI agent adapters.
- b3f5de7: Verify installed alias discovery distinguishes trajectories from quoted identifiers and respects option capture and later rejection history.
- b3f5de7: Verify scoped alias conflicts, stable evidence records, actor provenance, and unchanged history through the installed health-report command.
- b3f5de7: Verify installed automation commands report missing action bindings, retain later successful effects and leave history unchanged on a second invocation.
- b3f5de7: Exercise asynchronous cleanup rejection, generated sensitivity preflight and digest identity, and MCP hook setup diagnostics through installed package exports.
- b3f5de7: Verify the installed CLI accepts CRLF fenced shell-agent replies and skips successfully recorded sources under both ingestion policies.
- b3f5de7: Verify installed ingestion context rejects invalid limits, excludes superseded and retracted knowledge, and preserves multiline comment boundaries without rewriting history.
- b3f5de7: Verify installed doctor commands detect malformed stored payloads and flags without exposing claim data or changing database bytes, and report healthy rows after repair.
- b3f5de7: Verify packaged explanation arithmetic preserves normalized equality, zero-product errors, hard/soft evaluations and fresh assignments across reports.
- b3f5de7: Verify installed export commands reject malformed stored payloads and flags while preserving output and database bytes, respecting sensitivity scope and recovering after repair.
- b3f5de7: Exercise historical snapshot verification, exact restoration, and subsequent migration through the installed CLI in packed smoke tests.
- b3f5de7: Verify packaged ingestion preserves HTTP media-type source identity and supplies correct CR source line numbers to a real shell agent.
- b3f5de7: Verify buffered MCP replies and terminal stream cleanup through the installed CLI subpath.
- b3f5de7: Verify strict stdout decoding, getter capture and recovery through both installed process runners and the packaged synchronous bridge.
- b3f5de7: Verify structured query capture, historical option capture, direct search validation and HTTP decoding recovery in installed packages.
- b3f5de7: Exercise sensitivity request validation and numeric-budget recovery through installed package exports in packed smoke checks.
- b3f5de7: Exercise SQL source collision failures, history preservation under prune, and corrected-query recovery through the packed CLI.
- b3f5de7: Exercise non-projecting source SQL rejection and colon-bearing synchronization labels through the packed CLI smoke workflow.
- b3f5de7: Verify installed sync rejects malformed UTF-8 without changing target history and recovers after source correction.
- b3f5de7: Verify sync preview history preservation, captured options, and idempotent real merges through the installed CLI package.
- b3f5de7: Extend installed-package smoke coverage for shadowed transaction promises, malformed Boolean samples and semantic duplicate sensitivity samples.
- b3f5de7: Verify viewer startup validation, public-only serving, shared shutdown, and caller store ownership through the installed CLI package.
- b3f5de7: Document and verify the executable's partial action-import contract: exit 1 with accepted counts, source diagnostics, inspectable retained definitions and idempotent corrected retries.
- b3f5de7: Verify a failed grammar archive request does not interrupt its successful peer, and retry reuses the verified archive while fetching only the missing tool.
- b3f5de7: Verify and document keyboard skip navigation during delayed website page downloads, including focus transfer to loaded content or the recovery heading and keyboard access to Reload page.
- b3f5de7: Add production-browser coverage for claims-editor highlight alignment through scrolling, mobile resizing, source replacement and keyboard navigation.
- b3f5de7: Verify that both playground query fields ignore composing Enter, submit once on
  ordinary Enter, and retain input focus when results arrive.
- b3f5de7: Verify that alias-policy changes recompute derived facts without replaying automation events behind the firing watermark.
- b3f5de7: Record full workspace integration of batch-local automation premise-text reuse on both supported Node majors.
- b3f5de7: Record installed-package integration of automation premise-text reuse and full browser verification of current guides.
- b3f5de7: Verify automation preparation cancellation and diagnostic preservation across both supported Node workspace suites.
- b3f5de7: Verify projection cleanup errors do not prevent remaining resource cleanup or rebuilding an explicitly evicted cache.
- b3f5de7: Document and verify bounded sensitivity-projection retries under continuous source commits, including discarded database cleanup, refusal to return stale data and recovery with the same sensitivity ceiling.
- b3f5de7: Document and verify recovery when a retired sensitivity projection's cleanup fails after its replacement is cached, preserving fresh data and deterministic source cleanup.
- b3f5de7: Verify prototype-named report variables preserve literal binding values and generated citations in blocks and inline splices.
- b3f5de7: Verify that completed report, export and generated files remain published when final store cleanup fails, with publication output retained and a nonzero status. Document this case in the report outcome table.
- b3f5de7: Verify that malformed query bindings prevent evaluator agent work and that corrected prototype-named bindings with literal values pass fixture self-checking and scoring.
- b3f5de7: Verify direct and transitive query-record failure and repair recovery for malformed stored provenance inside caller-owned transactions, including retained staged data and a later caller rollback. Clarify valid empty provenance arrays versus malformed empty entries.
- b3f5de7: Verify sensitivity preflight, corrected-limit recovery, exact sample assignments and authored-model report identity through the real Z3 adapter.
- b3f5de7: Verify record and digest rollback after a connector write exception, preservation of earlier commits, and idempotent retry through remaining records and pruning.
- b3f5de7: Document and verify that report citation failures preserve existing output files, create no partial new file, emit no partial stdout and allow corrected retries.
- b3f5de7: Verify that multi-query restricted reports preserve consistent values and citations during external database commits.
- b3f5de7: Verify malformed report templates retain diagnostic line numbers and valid query results across LF, CRLF and CR line endings.
- b3f5de7: Verify retraction and independent confirmation of reversed alias suggestions through annotated replay, and clarify that review preserves the emitted direction and source context.
- b3f5de7: Document and verify rollback of derived conclusions and lineage when watermark or vocabulary bookkeeping writes fail, including corrected retries and restored incremental behavior.
- b3f5de7: Verify that late derivation failures restore cascaded retractions and replacement conclusions together, preserving historical lineage and allowing an idempotent corrected retry.
- b3f5de7: Verify partial rule declaration and invalid-prelude recovery across LF and CRLF files, preserving cached preludes, settled conclusions and evaluation history.
- b3f5de7: Record integrated verification of rule reconciliation, CLI/MCP reporting and shape-unit validation, and document sequential local runtime-matrix testing after an observed shared Tree-sitter cache-lock failure.
- b3f5de7: Document and verify overlay insertion failure recovery, including rollback of temporary vocabulary, suppression of evaluation and stable inputs on retry.
- b3f5de7: Verify exact min/max scenario binding across converted opposite-sign, zero and equal-numerator fractions, including stable supporting evidence and unchanged history.
- b3f5de7: Verify public historical search preserves visible row metadata without leaking hidden revision values, comments, tags, or evidence counts.
- b3f5de7: Document and verify whole-array validation and recovery for selected JSON records across synchronous, asynchronous local and HTTP source loaders.
- b3f5de7: Verify and document that shape-gate rollback failures preserve the original rejection and cleanup error, with recovery through caller rollback or closing/reopening the store and no persisted rejected history or vocabulary.
- b3f5de7: Verify that rejected shape gates discard inverse vocabulary used during evaluation and accept a corrected retry.
- b3f5de7: Verify and document HTTP source deadlines through stalled response bodies and successful subsequent loads.
- b3f5de7: Verify action rollback and same-store recovery for binary stored hook references, and document the pre-commit boundary.
- b3f5de7: Verify sync failure recovery with the default verb registry and clarify the vocabulary role of no-prelude.
- b3f5de7: Verify missing and directory sync sources fail without creating files or changing destination history, including dry runs and subsequent recovery.
- b3f5de7: Verify that malformed database and annotated-text sync files preserve populated target history, release source attachments, and permit corrected-input recovery.
- b3f5de7: Document and verify that invalid Unicode merge labels roll back sync and corrected retries preserve valid Unicode source and destination names.
- b3f5de7: Verify rollback and retry after late merge-record failures in text and database sync, including dry runs.
- b3f5de7: Verify and document database sync source-write reservations, dry-run isolation and later-write recovery in WAL and rollback-journal modes.
- b3f5de7: Verify CLI viewer shutdown with an unfinished HTTP request and document the distinction from graceful library shutdown.
- b3f5de7: Verify Unicode tag-value reordering remains replayable while genuine value conflicts reject the entire text-sync batch without changing history.
- b3f5de7: Verify and document that URL ingestion timeouts cover stalled response bodies and permit a fresh retry.
- b3f5de7: Verify UUID line-terminator rejection and clock isolation, and remove a redundant CLI checksum length check after confirming existing regex behavior.
- b3f5de7: Verify malformed restricted rows do not alter public HTTP view responses while inclusive requests retain row-validation errors and recovery behavior.
- b3f5de7: Verify packed viewer listener cleanup and record unequal-denominator comparison measurements with analytic correctness checks on both supported Node majors.
- b3f5de7: Verify and document viewer recovery from an occupied port without closing or changing the caller's store.
- b3f5de7: Record successful full Node 24 and Node 26 integration checks for viewer runtime-error shutdown and existing system regressions.
- b3f5de7: Verify connector shutdown drains active refreshes after watcher errors, retains cleanup diagnostics and supports idempotent retries; clarify possible commits before nonzero completion.
- b3f5de7: Record full Node 24 and Node 26 integration checks for connector watcher error handling, active-refresh cleanup and solver capture regressions.
- b3f5de7: Verify connector watch startup in installed package integration and current guide navigation in the complete production browser suite.
- b3f5de7: Include malformed stored rules in automation report problems when derivation
  is enabled, so automate --once reports failure instead of successful settling.
  Valid declarations continue running and --no-derive skips rule checks.
- b3f5de7: Wait for documentation section navigation to finish rendering before recording the production link inventory, preventing incomplete and timing-dependent audit results.
- b3f5de7: Wake settled rules after new vocabulary declarations so updated mappings can match pre-existing facts.
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b723c48]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [0b1f150]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
- Updated dependencies [b3f5de7]
  - @cavelang/canonical@0.36.0
  - @cavelang/core@0.36.0
  - @cavelang/store@0.36.0
  - @cavelang/fusion@0.36.0
  - @cavelang/query@0.36.0
  - @cavelang/highlight@0.36.0
  - @cavelang/parser@0.36.0

## 0.35.0

### Minor Changes

- d64cad8: Declared sources (spec §23.4): `source/<name> HAS path: …` claims persist a `cave connect` invocation in-band, with `map`, `key`, `format`, `delimiter`, `table`, `sql`, and `records` attributes mirroring the options; a `.cave` path needs no map and is a lifecycle unit. `cave connect` with no source runs every declared source (`--list`, `--name`, `--force`, `--prune`, `--dry-run`, `--watch`, `--query`), `cave query --sources` overlays them in a rolled-back transaction, and a CAVE text file used as `--db` follows its declared sources on every open, in every surface. Declared sources stamp `@src:<name>/<key>` and keep digests under `source/<name>/<key>`, so the §26.3 policy on the same entity applies to what they yield. `@cavelang/connect` exports `Declared`, `assemble`, `declaredNaming`, `adHocNaming`, and `Source.loadSync`; `@cavelang/store`'s `openAt` and `openText` take an `assemble` hook.
- 25b8eb0: Mapping templates can be written inline as a comma-separated list of claim lines (`--map '?name IS person, ?name WORKS-AT ?company'`, or `source/<name> HAS map:` with the same text), and `--sql` reshapes any tabular source — csv, tsv, json, jsonl — through a temporary in-memory SQLite table before the mapping sees the records (spec §23.1). `@cavelang/connect` exports `Template.isInline`, `Template.inlineDocument`, `Template.parseAny`, and `Source.queryRecords`; `@cavelang/parser` exports `Token.topLevel` and `Token.splitTopLevel`, which rules and actions now share.

### Patch Changes

- 0c9e0b7: Declared sources (spec §23.4): declarations are re-read after every followed source and a re-declared source runs again, so a `.cave` source that supersedes a path or mapping wins in passes, assembly, overlays, and dry runs alike; source names are one path segment, so they cannot collide with record keys; and a text store's `--sources` overlay recognizes record-only sources as already followed.
- Updated dependencies [d64cad8]
- Updated dependencies [15c38bf]
  - @cavelang/core@0.35.0
  - @cavelang/canonical@0.35.0
  - @cavelang/fusion@0.35.0
  - @cavelang/parser@0.35.0
  - @cavelang/query@0.35.0
  - @cavelang/store@0.35.0
  - @cavelang/highlight@0.35.0

## 0.34.0

### Patch Changes

- Updated dependencies [0e502f1]
  - @cavelang/store@0.34.0
  - @cavelang/query@0.34.0
  - @cavelang/core@0.34.0
  - @cavelang/parser@0.34.0
  - @cavelang/canonical@0.34.0
  - @cavelang/fusion@0.34.0
  - @cavelang/highlight@0.34.0

## 0.33.0

### Minor Changes

- cdf4ed9: Rewrite the book as a 31-chapter course on one running example (a coffee roastery), and replay every runnable session in it against the real CLI (sessions that need a language model, a browser, a long-running server, or the optional Z3 solver package are marked `// no-test` and skipped): `scripts/book-examples.mjs` extracts `$`-prompt sessions and `#file` listings from `book/chapters/*.typ`, runs them in a scratch directory, and compares recorded output; `packages/cli/test/book.test.ts` runs it under `pnpm test`, and `--update` refreshes recorded output.
- 2ba7ab6: Add `cave search`, an FTS5 full-text search from the shell over the store's index (subject, verb, object, attribute name, value text, comment, and the raw line, so tags, contexts, and inverse spellings match too): one literal phrase by default, `--raw` for FTS5 MATCH syntax, `--limit` (default 100) with a trailing cap notice, and `--json` emitting a `cave.search/v1` object of `cave.claim/v1` records. `cave query` binding lines now end with the matched claim's comment (`?x = value  ; comment`) so the evidence written next to a claim reaches the reader. The `cave_search` MCP tool gains `limit` (default 100) and describes the indexed columns.

### Patch Changes

- cdf4ed9: `cave help --help` and `cave help help` print the help command's own usage instead of exiting 2 with an unknown-command error, so every command in the reference, `help` included, answers `--help`. `cave version`, `cave demo`, and `cave help` now reject surplus positional arguments with status 2, as `cave doctor` already did, instead of ignoring them; delegated commands such as `cave serve` keep reporting argument errors with status 1.
- Updated dependencies [cdf4ed9]
- Updated dependencies [1320911]
- Updated dependencies [857aa3c]
- Updated dependencies [0adc7d2]
  - @cavelang/core@0.33.0
  - @cavelang/parser@0.33.0
  - @cavelang/canonical@0.33.0
  - @cavelang/fusion@0.33.0
  - @cavelang/query@0.33.0
  - @cavelang/store@0.33.0
  - @cavelang/highlight@0.33.0

## 0.32.3

### Patch Changes

- 2a92792: Move `@modelcontextprotocol/server` from 2.0.0-beta.5 to the stable 2.0.0 release and bump `typst-community/setup-typst` to 5.3.

  CI's changeset job and `scripts/release-validate.mjs` now reject a changeset that names only packages outside the fixed release group (for example a private workspace such as `@cavelang/mcp`), since such a changeset would version that package without advancing the release; the changeset instructions say so explicitly.

- 4a7cf30: `cave doctor` no longer certifies nightly or release-candidate Node builds (for example `26.0.0-nightly…` or `24.0.0-rc.1`) as supported: only stable releases on the 22.18+, 24, and 26 lines pass the runtime check.
- Updated dependencies [658d9fb]
- Updated dependencies [7c1950a]
- Updated dependencies [9c28743]
  - @cavelang/parser@0.32.3
  - @cavelang/core@0.32.3
  - @cavelang/canonical@0.32.3
  - @cavelang/query@0.32.3
  - @cavelang/fusion@0.32.3
  - @cavelang/store@0.32.3
  - @cavelang/highlight@0.32.3

## 0.32.2

### Patch Changes

- Updated dependencies [a7397de]
- Updated dependencies [a1f05bc]
  - @cavelang/core@0.32.2
  - @cavelang/canonical@0.32.2
  - @cavelang/fusion@0.32.2
  - @cavelang/parser@0.32.2
  - @cavelang/query@0.32.2
  - @cavelang/store@0.32.2
  - @cavelang/highlight@0.32.2

## 0.32.1

### Patch Changes

- Updated dependencies [af53c4c]
  - @cavelang/core@0.32.1
  - @cavelang/canonical@0.32.1
  - @cavelang/fusion@0.32.1
  - @cavelang/parser@0.32.1
  - @cavelang/query@0.32.1
  - @cavelang/store@0.32.1
  - @cavelang/highlight@0.32.1

## 0.32.0

### Patch Changes

- Updated dependencies [377758f]
  - @cavelang/canonical@0.32.0
  - @cavelang/query@0.32.0
  - @cavelang/store@0.32.0
  - @cavelang/core@0.32.0
  - @cavelang/parser@0.32.0
  - @cavelang/fusion@0.32.0
  - @cavelang/highlight@0.32.0

## 0.31.1

### Patch Changes

- @cavelang/highlight@0.31.1
- @cavelang/core@0.31.1
- @cavelang/parser@0.31.1
- @cavelang/canonical@0.31.1
- @cavelang/store@0.31.1
- @cavelang/query@0.31.1
- @cavelang/fusion@0.31.1

## 0.31.0

### Minor Changes

- c9f5adc: Add version-matched CAVE usage guidance through the read-only `cave_help` MCP tool and publish a portable Agent Skill for CAVE workflows.

### Patch Changes

- @cavelang/core@0.31.0
- @cavelang/parser@0.31.0
- @cavelang/canonical@0.31.0
- @cavelang/store@0.31.0
- @cavelang/query@0.31.0
- @cavelang/fusion@0.31.0
- @cavelang/highlight@0.31.0

## 0.30.0

### Minor Changes

- 3ebe3e4: Serve CAVE through the official MCP TypeScript SDK v2 with modern protocol support and legacy fallback for GitHub Copilot CLI and older clients.

### Patch Changes

- 075a804: Run agents, hooks, and direct commands through one portable, output-bounded process-tree boundary.
- dbe8ad3: Define and continuously test the exact Node and operating-system support contract.
- Updated dependencies [afce4f3]
- Updated dependencies [6035063]
- Updated dependencies [26b23cf]
  - @cavelang/core@0.30.0
  - @cavelang/canonical@0.30.0
  - @cavelang/fusion@0.30.0
  - @cavelang/parser@0.30.0
  - @cavelang/query@0.30.0
  - @cavelang/store@0.30.0
  - @cavelang/highlight@0.30.0

## 0.29.1

### Patch Changes

- Updated dependencies [3d2f5b9]
  - @cavelang/core@0.29.1
  - @cavelang/canonical@0.29.1
  - @cavelang/fusion@0.29.1
  - @cavelang/parser@0.29.1
  - @cavelang/query@0.29.1
  - @cavelang/store@0.29.1
  - @cavelang/highlight@0.29.1

## 0.29.0

### Minor Changes

- 996e959: Make LLM ingestion atomic by default, add explicit lenient partial progress,
  and return complete per-source manifests with documented retry and exit rules.
- 9d3c617: Add SQL-bounded, transaction-snapshot-stable CAVE-Q pagination to the library,
  CLI, and MCP query surfaces, with protective defaults and opaque continuations.
- 0b6eb86: Expose command implementation APIs through stable `@cavelang/cli/<feature>`
  subpaths and bundle their private workspace packages into the CLI artifact.
- adb88b0: Create, verify, and atomically restore exact SQLite snapshots while preserving
  row identity, transaction order, provenance, lineage, and full history.
- e5ea4df: Add in-band exact-one cardinality and exact-unit constraints to `EXPECTS`,
  with actionable health reports and transactional gate enforcement.
- 8906d6a: Add storage-independent `cave.claim/v1` and `cave.query-match/v1` records with
  strict decoders and compatibility fixtures, and use them for CLI and federated
  JSON instead of serializing internal SQLite columns.
- b56c68b: Add `cave doctor` read-only runtime, installation, configuration, and store-health diagnostics with safe-to-share human and versioned JSON reports.
- 0977eee: Route every command through one promise-based dispatcher with consistent
  stack-free errors, injectable I/O, shared signal handling, awaited cleanup,
  and conventional signal exit codes. Set `CAVE_DEBUG=1` for diagnostic stacks.

### Patch Changes

- 33865f8: Require an explicitly conflicting cross-name pair before reporting an alias disagreement while preserving actor-attributed rows in genuine multi-alias conflicts.
- 49dc258: Harden ingest digest identities for arbitrary paths and URLs and report provenance write failures with source context.
- e7549c9: Expand packed-artifact smoke coverage across public libraries and offline commands.
- 4474a5a: Isolate URL ingestion failures per source and report retryable network and HTTP outcomes without discarding healthy inputs.
- 4604b1b: Emit every qualifier comparison with a valid canonical CAVE verb while preserving symbolic operator input and the existing `EXCEEDS` representation.
- 651d7c1: Guarantee that report default bullets and citation footnotes use CommonMark-safe delimiters around declarations containing backtick literals.
- 5b373d3: Close watcher startup races, expose deterministic connect runtime hooks, identify failed watch stages, and pin URL, debounce, retry, pruning, provenance, and live automation polling end to end.
- db1e38b: Pin MCP source-option validation to one documented unprefixed context form, with explicit coverage for prefixed, empty, and malformed values.
- d3978d0: Expose incomplete derivation status and preserve suspended conclusions and watermarks when the fixpoint pass limit is exhausted.
- 37ddc5b: Evaluate shape expectations from one indexed current-belief snapshot so SQL
  query count no longer scales with instances multiplied by expectations.
- 9082843: Include canonical license and author attribution files in every public package tarball.
- 2d3eea5: Rescan connect watch targets when filesystem events omit filenames, while preserving exact filtering for string and Buffer filenames.
- ee9d0e6: Gate pull requests, release publishing, and release tagging on the packed npm artifact smoke test.
- 35a8c61: Add deterministic cross-stack performance fixtures, recorded baselines, query
  plan evidence, and CI regression thresholds.
- 216ce5b: Validate MCP protocol negotiation and JSON-RPC batches over stdio.
- 33f7245: Export the shipped command registry and validate CLI and MCP reference tables against their commands, options, tools, parameters, and security boundaries.
- 046f8f6: Document every published entry point and validate package, website, specification, migration, and version projections against their authoritative registries.
- Updated dependencies [9022a00]
- Updated dependencies [75ed4cf]
- Updated dependencies [8003648]
- Updated dependencies [9d3c617]
- Updated dependencies [a606db4]
- Updated dependencies [03373de]
- Updated dependencies [662e6aa]
- Updated dependencies [1f5ae77]
- Updated dependencies [adb88b0]
- Updated dependencies [6f04273]
- Updated dependencies [c73479a]
- Updated dependencies [387edea]
- Updated dependencies [4d3cadc]
- Updated dependencies [364dce7]
- Updated dependencies [3feae4f]
- Updated dependencies [5cd786d]
- Updated dependencies [27b1dc7]
- Updated dependencies [2f31c8f]
- Updated dependencies [f13c698]
- Updated dependencies [a4b41b9]
- Updated dependencies [1ad5401]
- Updated dependencies [5a96c95]
- Updated dependencies [0fe8dfa]
- Updated dependencies [8906d6a]
- Updated dependencies [35a8c61]
- Updated dependencies [fe2706b]
- Updated dependencies [f4461c2]
- Updated dependencies [dbc0d59]
- Updated dependencies [01ca7dc]
- Updated dependencies [0ac44fd]
- Updated dependencies [0021db8]
- Updated dependencies [0f986d1]
- Updated dependencies [3526b49]
  - @cavelang/core@0.29.0
  - @cavelang/query@0.29.0
  - @cavelang/store@0.29.0
  - @cavelang/canonical@0.29.0
  - @cavelang/parser@0.29.0
  - @cavelang/fusion@0.29.0
  - @cavelang/highlight@0.29.0

## 0.28.1

### Patch Changes

- Updated dependencies [16344ea]
- Updated dependencies [16344ea]
  - @cavelang/core@0.28.1
  - @cavelang/automate@0.28.1
  - @cavelang/act@0.28.1
  - @cavelang/canonical@0.28.1
  - @cavelang/connect@0.28.1
  - @cavelang/eval@0.28.1
  - @cavelang/ingest@0.28.1
  - @cavelang/loop@0.28.1
  - @cavelang/mcp@0.28.1
  - @cavelang/parser@0.28.1
  - @cavelang/query@0.28.1
  - @cavelang/rules@0.28.1
  - @cavelang/shape@0.28.1
  - @cavelang/store@0.28.1
  - @cavelang/sync@0.28.1
  - @cavelang/view@0.28.1
  - @cavelang/highlight@0.28.1

## 0.28.0

### Patch Changes

- Updated dependencies [e2a4fd7]
- Updated dependencies [a0a4dd1]
  - @cavelang/core@0.28.0
  - @cavelang/act@0.28.0
  - @cavelang/automate@0.28.0
  - @cavelang/canonical@0.28.0
  - @cavelang/connect@0.28.0
  - @cavelang/eval@0.28.0
  - @cavelang/ingest@0.28.0
  - @cavelang/loop@0.28.0
  - @cavelang/mcp@0.28.0
  - @cavelang/parser@0.28.0
  - @cavelang/query@0.28.0
  - @cavelang/rules@0.28.0
  - @cavelang/shape@0.28.0
  - @cavelang/store@0.28.0
  - @cavelang/sync@0.28.0
  - @cavelang/view@0.28.0
  - @cavelang/highlight@0.28.0
