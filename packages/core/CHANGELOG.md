# @cavelang/core

## 0.36.2

### Patch Changes

- 9207b82: Run website tests in full Chromium headless mode for native new-tab coverage, following intermittent failures in the separate headless shell.
- 9e9d967: Identify each browser navigation scenario separately and attach a bounded native-input timeline when it fails, improving diagnosis of intermittent new-tab failures.

## 0.36.1

### Patch Changes

- 7a3cad1: Record hosted Changesets v3/action v2 release and recovery verification and retire the completed migration task.

## 0.36.0

### Minor Changes

- b3f5de7: Support multiline playground queries with preserved pasted filters, Shift+Enter for newlines, and accessible keyboard guidance.
- b3f5de7: Add an isolated release audit command for published package signatures and attestations, and document the difference between registry presence and artifact verification.
- b3f5de7: Normalize multiplier values from decimal text before numeric conversion, avoiding double rounding and premature underflow. Preserve unrepresentable nonzero magnitudes as textual atoms instead of zero.
- b3f5de7: Reject source-line endpoints outside JavaScript's safe-integer range instead of silently rounding evidence locations or emitting unparseable exponential line numbers.
- b3f5de7: Preserve overflowing numeric literals as textual atoms instead of classifying them with non-finite scalar or trajectory values.
- b3f5de7: Reject non-finite programmatic claim payloads and invalid confidence in Claim.of before they reach serialization or storage.
- b3f5de7: Add Confidence.formatExact for lossless decimal percentage interchange and use it
  in canonical claim emission. Parse percentages without a second rounding step,
  preserving computed and tiny confidence through export, import, and text sync.
  Keep Confidence.format as the existing rounded presentation formatter.
- b3f5de7: Identify the selected documentation section visually and with aria-current, preserving encoded fragment and browser history navigation.

### Patch Changes

- b3f5de7: Make playground results and errors available through a named live region and a keyboard scrolling surface, and restore visible keyboard focus throughout the workbench.
- b3f5de7: Return SQLite's actual last inserted row ID from browser adapter writes instead of zero, with shared native/browser regressions for insert, update and no-op results.
- b3f5de7: Add an accessible, collapsible section navigator to website documentation using rendered heading anchors. Improve narrow-screen article title sizing. Give the solver's exact arithmetic and resource guidance a directly navigable section, and document keyboard, mobile, route and print behavior.
- b3f5de7: Add an optional independent temporal-boundary oracle and document verified timestamp, offset, fractional-second and malformed-input coverage.
- b3f5de7: Add playground result copying with captured query context, accessible feedback, single-request protection and manual selection fallback.
- b3f5de7: Add and document an isolated real VS Code extension-host smoke test for activation and semantic-token ranges.
- b723c48: Attribute private workspace changes to the final lockstep release instead of leaving their notes under provisional Changesets versions.
- b3f5de7: Align both tutorial fixture guides with local workspace CLI invocation and optional agent setup.
- b3f5de7: Expose the active website navigation area to assistive technology across route changes.
- b3f5de7: Restrict documentation fragment focus to article targets so links cannot focus sidebar controls or remove them from the keyboard tab sequence.
- b3f5de7: Include development and packaging dependencies in the scheduled and pull-request advisory gate, with explicit ownership and tooling-aware triage guidance.
- b3f5de7: Distinguish verified system-review outcomes from unfinished resource, lifecycle and hosted release scope.
- b3f5de7: Add a repeatable automation scaling diagnostic for 100/500/1,000 events, with exact rule/action output and quiet-cycle idempotence checks.
- b3f5de7: Keep website startup and history restoration working without crypto.randomUUID, using local history identifiers and preserving unrelated history state.
- b3f5de7: Bind release validation to the publisher's own checkout so inherited root overrides cannot authorize dirty source or preparation drift using another repository's clean state.
- b3f5de7: Make the verification skill's HTTP example bound startup waiting and clean up its owned server, and include the MCP initialized notification without discarding diagnostics.
- b3f5de7: Capture claim initialization options once so construction retains the confidence and uncertainty metadata that passed validation.
- b3f5de7: Capture claim uncertainty and numeric estimate fields once so sigma extraction and fusion conversion use consistent validated values.
- b3f5de7: Capture source-span endpoints once before validation and formatting. Changing getters can no longer substitute invalid or different provenance anchors, and rejection diagnostics retain the values that failed validation.
- b3f5de7: Fail release registry probes on unexpected successful responses, preserve missing-package status independently of npm exit codes, and validate retry settings before requests.
- b3f5de7: Document the verified Changesets v2 action input and publication-event bridge required by CAVE’s pnpm release script.
- b3f5de7: Clarify that Claim.of captures top-level initializer fields while retaining nested read-only object references. Distinguish factory ownership from store insertion capture and avoid implying deep copying or runtime freezing.
- b3f5de7: Clarify on the homepage and in the rebuilt book that report citations support query results rather than every sentence of authored template prose.
- b3f5de7: Align the website, introductory README, and rebuilt book with the language convention that proper names preserve their casing.
- b3f5de7: Distinguish active system-review scope from historical checkpoint notes and update the installed-artifact verification map.
- b3f5de7: Clean up book replay workspaces when command-wrapper or fixture setup fails.
- b3f5de7: Reject uncommitted package content in publish preflight and revalidate after release preparation before npm publication; document clean-checkout recovery and the automatic Marketplace release path.
- b3f5de7: Let keyboard users clear the website documentation filter with Escape while retaining focus, preserving the article, and respecting IME composition.
- b3f5de7: Keep Enter from submitting playground queries during input-method composition, with a production-browser regression that also verifies ordinary Enter submission.
- b3f5de7: Consume complete HTTP responses in packed smoke checks so early grep exits cannot turn successful responses into curl broken-pipe failures.
- b3f5de7: Contain production-preview asset metadata and stream failures, avoid premature successful headers, and release file streams when clients disconnect.
- b3f5de7: Prevent superseded release retries from publishing missing package versions under latest, while preserving tag recovery for older fully published versions.
- b3f5de7: Make the postmortem playground sample demonstrate multiline confidence filtering and the preserved lower-confidence suspicion.
- b3f5de7: Associate documentation filter results and the unique-match keyboard hint with the input's accessible description.
- b3f5de7: Improve Vite shutdown diagnostics to distinguish completed server close from a process kept alive by a referenced native handle.
- b3f5de7: Document the VSIX packaging gate and its distinction from interactive editor and Marketplace verification.
- b3f5de7: Align architecture and implementation guides with report-scoped arithmetic guards and ordered explanation reuse.
- b3f5de7: Focus the destination documentation heading when a section fragment is missing or malformed, preserving keyboard navigation through stale links.
- b3f5de7: Document the quiet repeated automation cycle verified through the market tutorial on both supported Node majors.
- b3f5de7: Document verified read-only MCP current-export error handling and same-session recovery after an external historical-key repair.
- b3f5de7: Clarify repository-wide compiler coverage and record full integration verification of solver proof validation.
- b3f5de7: Verify documentation routing for encoded filenames, root-relative paths, fragment-only links and GitHub query parameters without discarding URL semantics.
- b3f5de7: Add a local Download claims action to the playground so edited claims can be saved, including unapplied drafts, with wrapping controls on narrow screens. Downloads remain available after runtime failure and reject malformed Unicode instead of silently changing the saved text.
- b3f5de7: Drain CLI output in packed smoke assertions to avoid early-consumer broken pipes while preserving producer exit failures under pipefail.
- b3f5de7: Make overflowing homepage code keyboard-scrollable with a named region and visible focus outline.
- b3f5de7: Use shared repository-path encoding for documentation edit links so filename punctuation remains part of the GitHub file path.
- b3f5de7: Extend VSIX validation to reject packaged host-test harnesses and editor development configuration, independently of the packaging allowlist.
- b3f5de7: Consolidate playground client lifecycle coverage across pending operations, fatal and ordinary errors, late events, and repeated failed sends.
- b3f5de7: Explain the documentation filter's all-words matching rule in visible and accessible search help.
- b3f5de7: Explain when documentation-filter input contains no searchable words, preserving the complete page list and keyboard focus while guiding users back to normal filtering.
- b3f5de7: Explain playground rebuild and append behavior beside the editor controls and associate the guidance with each button for assistive technology.
- b3f5de7: Explain playground claim downloads and result copying in the entry guide and book, and refresh the generated PDF.
- b3f5de7: Explain non-mutating release-plan previews and distinguish raw Changesets output from CAVE version synchronization and committed preflight.
- b3f5de7: Reject non-memory database paths in the website SQLite adapter instead of silently discarding filenames and implying unsupported persistence.
- b3f5de7: Recognize registry absence only from unambiguous npm E404 code records, excluding diagnostic and URL substrings, and force predictable npm output formatting for release probes.
- b3f5de7: Define subsystem completion evidence for the system audit, record exact supported-runtime checks, and retain doctor diagnostic output in failed test assertions.
- b3f5de7: Show clear recovery pages for unknown website and documentation routes instead of silently substituting home or overview content.
- b3f5de7: Expose documentation search controls as a named landmark for assistive-technology navigation.
- b3f5de7: Expose delayed website page downloads as a polite status message and hide their decorative loading pulse from assistive technology.
- b3f5de7: Allow website documentation filtering by navigation group as well as page name, and explain the matching scope.
- b3f5de7: Avoid overflow between finite opposite-sign trajectory endpoints, preserve exact endpoint values during clamped interpolation, and retain finite text when display rounding would overflow.
- b3f5de7: Make website documentation filtering accept reordered words, varied separators and full-width text while preserving accessible results and keyboard navigation.
- b3f5de7: Restore overview-heading focus when documentation-root aliases navigate to their canonical sidebar URL.
- b3f5de7: Focus the release backlog on outstanding hosted verification and move lasting Changesets compatibility details into dependency maintenance.
- b3f5de7: Move keyboard focus to the new documentation heading after page navigation, preserving existing focus behavior for section links and browser history.
- b3f5de7: Clean emitted files and build metadata before release generation so incremental builds cannot preserve altered or obsolete ignored outputs; correct the documented clean-command scope.
- b3f5de7: Put the full remaining system-review scope before the accumulated evidence entries, preserving all findings while making unfinished work immediately visible.
- b3f5de7: Add a task-oriented examples guide and clarify workspace CLI invocation, working directories and optional agent setup.
- b3f5de7: Hide decorative homepage code line numbers from assistive technology while preserving their visual display and accessible source text.
- b3f5de7: Give failed website routes an accurate browser-tab title and preserve correct titles when navigating away or recovering through reload.
- b3f5de7: Keep the submitted query and valid-time context visible in playground results and errors when users edit inputs during execution.
- b3f5de7: Ignore worker error events after playground runtime closure so intentional shutdown stays quiet and fatal failures are reported only once.
- b3f5de7: Use existing runtime-value placeholders for Node and SQLite versions in the book's doctor session so replay works across supported runtimes.
- b3f5de7: Keep inline code intact in documentation tables and verify report command flags remain readable at mobile and desktop widths.
- b3f5de7: Give overflowing documentation code examples named keyboard scrolling targets and visible focus outlines, removing extra stops when examples fit.
- b3f5de7: Link the homepage tutorial section to runnable examples and their setup requirements.
- b3f5de7: Fix website documentation section links and keep links between bundled READMEs on the site. Verify rendered section targets across the documentation and test mobile and desktop deep links, reloads, and browser history.
- b3f5de7: Preserve literal URL punctuation in documentation filenames and source paths while preventing encoded slashes from changing bundled-page path boundaries.
- b3f5de7: Give overflowing homepage capability examples named keyboard scrolling and remove extra tab stops when they fit.
- b3f5de7: Run the reconstruction example directly from its checked-in fixture with the matching query and step budget.
- b3f5de7: Add a compact map from the system review's requested outcomes to implementation, verification evidence, and remaining gates.
- b3f5de7: Measure current entity-view projection construction, cached reads and provenance-only invalidation, and clarify that search reads the source directly.
- b3f5de7: Pair Changesets CLI v3 with action v2, retain single-tag publication ownership, and generate changelog entries for synchronized private workspaces.
- b3f5de7: Use native links for website page destinations so users can copy URLs and open documentation in another tab while retaining existing navigation styling.
- b3f5de7: Remove extra trailing blank lines from reviewed source files.
- b3f5de7: Let documentation readers open a unique filter match with Enter, with a result hint and composition-aware keyboard behavior.
- b3f5de7: Exercise installed CLI backup, independent SHA-256 verification, wrong-checksum rejection, exact-byte restore and complete transaction-history preservation in release smoke checks.
- b3f5de7: Update five compatible VSIX packaging transitive dependencies to patched versions, resolving 16 reported development-tool advisories without changing manifest ranges.
- b3f5de7: Include actual runtime and platform metadata in performance reports and clarify the representative gate's timing and workload scope.
- b3f5de7: Pin VS Code declarations to the supported 1.100 editor baseline so typechecking cannot silently accept newer APIs.
- b3f5de7: Announce pending playground queries and appends, prevent duplicate submissions and conflicting database operations, and restore controls after success or failure.
- b3f5de7: Label playground query results with their submitted valid-time setting so later
  input edits cannot misrepresent the date used for completed results.
- b3f5de7: Add an optional Valid at field and a changing-headcount sample to the website playground. Pass valid-time anchors through the worker to the shared query engine for coverage filtering and trajectory interpolation, with recoverable validation errors and per-sample defaults.
- b3f5de7: Keep the active documentation page visible in mobile navigation after filtering or clearing the filter, without moving keyboard focus or scrolling the page vertically.
- b3f5de7: Preserve apostrophes in compiler project paths when verifying completed builds or reporting pending compilation.
- b3f5de7: Keep the error page title when revisiting a route whose lazy module download failed, resetting error state with the rendered route instead of a competing hashchange listener.
- b3f5de7: Preserve playground dataset-selector focus during loading and prevent competing selections while retaining the chosen dataset and restoring normal switching afterward.
- b3f5de7: Preserve original VS Code extension failures when resource cleanup also fails, retaining all disposal errors in cleanup order.
- b3f5de7: Preserve IPv6 host brackets in source links without decoding brackets elsewhere or accepting invalid authorities.
- b3f5de7: Preserve keyboard focus while copying the website install command, retaining busy feedback and duplicate-request protection without moving focus after users navigate away.
- b3f5de7: Keep playground query and append buttons focused during pending operations while preserving busy feedback, disabled appearance and duplicate-request protection.
- b3f5de7: Preserve playground rebuild focus and announce its busy state while preventing overlapping rebuild requests and respecting focus moved to an editor.
- b3f5de7: Preserve the UUIDv7 ordering boundary when clock validation or randomness fails.
- b3f5de7: Preserve prototype-named SQL result columns in the browser adapter and verify result-name parity with native SQLite.
- b3f5de7: Patch and pin SQL.js to preserve complete UTF-8 text through WASM binding and reads, including embedded NUL claim names in the playground.
- b3f5de7: Preserve existing percent escapes in source-provenance links so encoded paths and query values continue to identify the original URL in reports and other views.
- b3f5de7: Prevent late Vite watched-file additions from reopening Chokidar during shutdown, with a deterministic shutdown-hook regression and natural-exit checks.
- b3f5de7: Give website documentation a print layout with wrapped examples and tables, hidden navigation, and readable page margins.
- b3f5de7: Fix narrow-screen website navigation and content overflow, keep long capability examples scrollable, and verify production layouts with keyboard and touch browser tests.
- b3f5de7: Use native system text, background, caret and selection colors in the browser claims editor under forced-colors mode, hiding the decorative syntax mirror so editable text remains visible.
- b3f5de7: Keep documentation table words and numbers intact on narrow screens and make overflowing tables keyboard-scrollable with responsive focus targets.
- b3f5de7: Refresh system-review evidence with full Node 26 integration and production browser checks for the current arithmetic and playground changes.
- b3f5de7: Record full Node 24 workspace integration evidence for the recent exact-arithmetic and command/server lifecycle improvements, including incremental build and dependency audit checks.
- b3f5de7: Record Node 26 full-workspace integration and compiler evidence after browser highlighting and SQLite adapter changes.
- b3f5de7: Record complete production browser and installed-package checks after scenario capture and documentation accessibility changes.
- b3f5de7: Record clean-build, incremental-gate and regenerated-artifact integration evidence.
- b3f5de7: Record full Node 26 integration of CLI and server lifecycle fixes, fresh dependency advisory results, incremental build verification and remaining kernel review scope.
- b3f5de7: Document verified TypeScript 7 migration blockers and the isolated Tree-sitter 0.27 highlighter compatibility trial.
- b3f5de7: Record workspace and documentation-browser integration checks for connector prefix bounds, pruning configuration, cancellation and prepared-source identity.
- b3f5de7: Record full-workspace integration evidence for connector lifecycle fixes, current performance and build checks, and remaining automation, sync and hosted-release review boundaries.
- b3f5de7: Record current website search, navigation, responsive-layout and documentation browser verification, with visual evidence and remaining review limits.
- b3f5de7: Record production-browser verification of current documentation, navigation and playground recovery.
- b3f5de7: Record browser verification of current documentation navigation, history restoration, internal links and accessible reference tables.
- b3f5de7: Update the system-review verification map with the full Node 24 integration checkpoint covering discovery and historical identity validation.
- b3f5de7: Record full Node 26 integration evidence for the current ingestion and kernel changes.
- b3f5de7: Record full workspace and production browser verification after the action-gate and vocabulary fixes.
- b3f5de7: Record full Node 26 integration coverage for process startup and ingestion source lifecycle.
- b3f5de7: Record production documentation and playground browser verification with current metadata and ingestion guides.
- b3f5de7: Record full Node 24 integration coverage for process cleanup and historical pagination.
- b3f5de7: Record full Node 26 integration verification of current claim metadata, append options, and provenance validation.
- b3f5de7: Record full-workspace and production website verification for the current query and resolution fixes.
- b3f5de7: Record full Node 24 integration coverage for current solver, provenance and ingestion source contracts.
- b3f5de7: Record full Node 26 integration for current store option validation, MCP fixes and sync optimization.
- b3f5de7: Record successful packed-package and production-browser checks for current sync, MCP and ingestion changes.
- b3f5de7: Record the current workspace and production website verification checkpoint and the measured alias health-check query scaling candidate.
- b3f5de7: Record full Node 24 integration verification of current URL ingestion, serialization, and downstream runtime changes.
- b3f5de7: Record full Node 24 integration and browser verification for the current result contracts and viewer snapshots.
- b3f5de7: Record full workspace and production website verification after declaration diagnostics, action listing, and book guidance updates.
- b3f5de7: Record the Node 24 workspace and packed-artifact integration checks after source diagnostics and VSIX validation improvements.
- b3f5de7: Record full Node 24 workspace verification after evaluation and ingestion lifecycle fixes, including the audit-branch release-preflight limitation.
- b3f5de7: Record workspace, installed-package and documentation-browser integration checks for the recent ingestion and evaluation configuration fixes.
- b3f5de7: Record full Node 24 integration for exact predicates, packaging validation and preceding system fixes.
- b3f5de7: Record full production-browser verification after the documentation navigation enhancement.
- b3f5de7: Record the exact prior hosted release run and distinguish its v1 action from the locally migrated release workflow still awaiting hosted verification.
- b3f5de7: Record full Node 26 integration of the recent ingestion, arithmetic and website changes, with incremental build, dependency audit and current hosted-workflow evidence.
- b3f5de7: Record full Node 24 workspace and browser integration checks for the latest shell-adapter, web-source decoding, timeout and URL-validation fixes.
- b3f5de7: Record complete Node 26 integration coverage for ingestion diagnostics, CLI retries and Unicode source identity.
- b3f5de7: Record successful full Node 24 integration for current ingestion and sync changes.
- b3f5de7: Record full Node 26 integration for automation input recovery and current arithmetic and packaging changes.
- b3f5de7: Record the accumulated Node 24 integration, build-freshness and changeset validation checkpoint with its remaining artifact and hosted-release boundaries.
- b3f5de7: Record full Node 26 and production browser verification for current MCP and cleanup fixes.
- b3f5de7: Record complete browser and installed-package verification after local viewer focus and execution-option fixes.
- b3f5de7: Record integration verification for solver numeric budgeting, explanation model capture, and snapshot failure diagnostics across workspace, browser, and performance checks.
- b3f5de7: Record full-workspace and performance-gate integration after legacy migration and provenance validation fixes.
- b3f5de7: Record complete workspace verification after the query, playground, and VSIX review changes.
- b3f5de7: Record full workspace and production browser verification of the latest query, store and HTTP read-boundary fixes.
- b3f5de7: Record visual verification of CAVE semantic highlighting in the real VS Code default dark and light themes.
- b3f5de7: Record integration checks for reconstruction budget, prompt-configuration and cue-limit fixes across workspace, installed packages and documentation browsers.
- b3f5de7: Record workspace and documentation-browser integration checks for reconstruction state consistency, scoped SQLite reads and adapter ordering parity.
- b3f5de7: Record the full Node 24, production browser and performance integration checkpoint after record validation and transaction cleanup improvements.
- b3f5de7: Record full workspace and browser verification of viewer read snapshots and report option capture.
- b3f5de7: Record full workspace integration evidence for report parsing, scoped-view cleanup and performance-baseline validation.
- b3f5de7: Record full workspace and rendered documentation verification of scenario artifact and MCP lifecycle fixes.
- b3f5de7: Record packed-package and production-browser verification of current serialization and store validation changes.
- b3f5de7: Record full Node 26 integration verification of structured serialization validation and downstream consumers.
- b3f5de7: Record integration verification for shape snapshot cleanup, native store initialization, website history restoration, and dependency advisory status.
- b3f5de7: Record current shape integration checks and the reproduced rule prelude diagnostic line-number defect for follow-up.
- b3f5de7: Record full Node 26 integration for the shared solver result contracts and clarify source, browser, and installed verification coverage.
- b3f5de7: Record the full Node 26 source-suite and performance integration checkpoint after solver capture and documentation print improvements.
- b3f5de7: Record full workspace and production website verification after the solver validation review.
- b3f5de7: Record full Node 26 workspace and production browser verification for source-loading boundary fixes and pending-action keyboard focus improvements.
- b3f5de7: Record full Node 26 integration and refreshed dependency advisory checks after source-reporting and documentation-navigation fixes.
- b3f5de7: Record full Node 24 workspace integration for sync and automation lifecycle fixes, incremental build verification, and the remaining coordinated CLI cleanup review.
- b3f5de7: Record the full Node 26 integration checkpoint after transaction callback enforcement and view cleanup improvements.
- b3f5de7: Record the full workspace and browser integration checks covering recent reconstruction parsing, connector ownership, and documentation recovery fixes.
- b3f5de7: Record the 78-test production browser and local-viewer integration checkpoint with documentation projection checks.
- b3f5de7: Record integrated Node 24 and browser verification and distinguish production website coverage from local viewer checks.
- b3f5de7: Record full Node 26 integration and current production browser verification for run-policy validation, worker shutdown, and their documentation.
- b3f5de7: Retry failed documentation rendering when navigating to another article, preserving filter state during normal article navigation.
- b3f5de7: Offer a keyboard-accessible page-content search action when documentation name filtering has no matches, retaining the query and focus.
- b3f5de7: Report playground download failures without losing edited claims, clean up temporary resources, and support retry with accessible request feedback.
- b3f5de7: Improve documentation filtering with an accessible label, result feedback, slug matching, keyboard-friendly clearing, and current-page semantics.
- b3f5de7: Handle unavailable or denied clipboard access with an accessible manual-copy fallback and retry feedback on the website homepage.
- b3f5de7: Catch playground worker-construction failures and allow Rebuild to retry startup without losing edited claims.
- b3f5de7: Keep site navigation available after route download/render failures and provide a reload action to retry failed page loads.
- b3f5de7: Respect reduced-motion preferences by disabling the loading pulse, smooth scrolling and button transitions, with a production-browser check.
- b3f5de7: Refresh full dependency advisory results and distinguish current hosted release evidence from the local Changesets migration.
- b3f5de7: Refresh combined workspace, production-browser and read-only release-workflow review evidence after export snapshot and core input-capture fixes.
- b3f5de7: Refresh the read-only hosted release checkpoint and retain the outstanding v2 migration verification boundary.
- b3f5de7: Refresh monorepo tutorial coverage summaries from an isolated end-to-end workflow replay on both supported Node majors.
- b3f5de7: Reject duplicate or missing workspace names before changeset validation so manifest collisions cannot bypass bundled CLI release requirements.
- b3f5de7: Reject duplicate VSIX archive paths and close the archive reader on validation read failures.
- b3f5de7: Reject invalid or unmatched book replay filters instead of succeeding without checking chapters or silently selecting every chapter.
- b3f5de7: Reject VSIX archives with empty required files or an incorrect executable entry point, with independent archive regressions.
- b3f5de7: Keep the production website test server alive after malformed URLs or percent escapes, and report its actual ephemeral port for isolated HTTP regressions.
- b3f5de7: Reject unpaired source-reference surrogates consistently without interrupting parsing of other references.
- b3f5de7: Free SQLite WASM statements after reads and writes, including failures, while preserving reusable statement wrappers by preparing again on subsequent calls.
- b3f5de7: Release pending playground requests when worker message sending throws, preserving later use of a healthy worker and covering the client in the website test command.
- b3f5de7: Reopen the Vite shutdown finding after the cold-cache regression fails in full Node 26 integration, and correct the verification scope.
- b3f5de7: Report package identity and full compiler output when packed smoke preparation fails, preserving the failing exit status.
- b3f5de7: Report the restored documentation page count in the filter’s live status after clearing a query.
- b3f5de7: Report verified pnpm publications through Changesets output events after registry and tag checks, with empty recovery output and release-failure coverage.
- b3f5de7: Require explicit compiler evidence for every root project before the incremental-build gate reports success.
- b3f5de7: Expose playground worker failures immediately and let Rebuild restart the worker with current edited claims, including cleanup of replacement workers on navigation.
- b3f5de7: Restore article-heading focus when the current documentation sidebar link is activated again, preserving native new-tab navigation.
- b3f5de7: Restore documentation section-disclosure state with each browser history entry before restoring scroll coordinates, keeping readers at the same article position across Back and Forward navigation.
- b3f5de7: Restore each documentation visit's filter with its reading position while new visits inherit the current filter.
- b3f5de7: Restore the documentation tab title when navigation away and back recovers from a temporary page-rendering error.
- b3f5de7: Restore website reading positions per browser history entry, including repeated documentation visits, while preserving fresh-route and section-link navigation.
- b3f5de7: Keep the documentation filter during navigation outside Docs so returning preserves the filtered list and mobile reading layout.
- b3f5de7: Keep keyboard-focused website code and tables clear of the sticky header after queued native focus scrolling.
- b3f5de7: Preserve source-line span validation diagnostics when malformed programmatic endpoints cannot be JSON-serialized.
- b3f5de7: Preserve typed uncertainty validation errors when invalid input cannot be converted to text. Retain the rejected field and original value, with a stable placeholder in the diagnostic message.
- b3f5de7: Preserve existing HTTP source URL fragments as navigable links when no separate source-line span is attached.
- b3f5de7: Write the extension alignment changelog before advancing its version so filesystem failures remain retryable with the correct release entry.
- b3f5de7: Retire playground workers after failed SQLite initialization so Rebuild retries WebAssembly loading in a fresh worker while preserving edited claims.
- b3f5de7: Add an article navigation control that returns keyboard readers to the documentation filter while preserving search state.
- b3f5de7: Reveal the active documentation link when opening a page, including direct routes into the desktop sidebar or horizontal mobile navigation. Preserve article focus and section-link positioning.
- 0b1f150: Keep the first documentation match visible when Arrow Down follows an active smooth page scroll.
- b3f5de7: Add optional documentation content filtering with keyboard navigation and history restoration.
- b3f5de7: Validate manual Marketplace republication against its explicit release tag using the workflow commit's validator, while preserving workflow-SHA equality for normal push releases.
- b3f5de7: Keep the website install-copy button busy until its clipboard request finishes, preventing overlapping attempts from overwriting completion status.
- b3f5de7: Patch Vite shutdown to settle pending dependency transforms after optimizer cancellation, with a cold-cache regression on both Node majors.
- b3f5de7: Extend the automation scaling diagnostic with active exactly-one shape requirements, verifying every generated owner and final shape check.
- b3f5de7: Show control characters as visible escapes in playground query bindings while preserving ordinary CAVE binding text.
- b3f5de7: Use binary search to locate highlights for numbered website examples, avoiding repeated scans of preceding lines.
- b3f5de7: Add a keyboard skip-to-content control that bypasses repeated website navigation and keeps destination headings visible below the header.
- b3f5de7: Preserve the browser playground's last working database when a rebuild fails, retain query access, and test correction and replacement through the production worker.
- b3f5de7: Document balanced Rolldown runtime calls in the remaining Vite shutdown failure and identify the native callback cleanup investigation boundary.
- b3f5de7: Keep trajectories textual when closed and open range contexts are mixed, preserving normal valid-time coverage without choosing an ambiguous interpolation range.
- b3f5de7: Update the pinned Changesets CLI to 3.0.2 and keep live release-toolchain guidance aligned.
- b3f5de7: Update the website browser-test toolchain to Playwright 1.63 with matching Chromium and document verified platform and installation requirements.
- b3f5de7: Update Vite to 8.3.0 and retain a development-server shutdown probe for the Node 24 timeout also observed with 8.2.2.
- b3f5de7: Update the website to React 19.3 with matching React DOM and declaration dependencies.
- b3f5de7: Require arrays for claim context and tag collections before construction, canonical emission, or storage capture can reinterpret malformed inputs.
- b3f5de7: Make the changeset checker reject missing, duplicate, private and unknown fixed-group members before release preparation.
- b3f5de7: Validate playground worker responses and settle pending requests through visible rebuild recovery when a malformed response arrives.
- b3f5de7: Keep malformed HTTP(S) source identities as plain provenance citations instead of exposing invalid navigable links. Preserve stored source identities, line spans, and existing URL escapes.
- b3f5de7: Reject malformed negation and importance flags during claim construction, canonical emission, and atomic structured appends.
- b3f5de7: Apply the existing uppercase-verb lexical rule during canonical emission and structured appends, with controls for extension verbs, terminal separators and CRLF documents.
- b3f5de7: Validate interval half-widths with the shared positive finite uncertainty rule,
  rejecting zero, negative, and nonfinite deltas with `InvalidUncertaintyError`.
- b3f5de7: Reject malformed UTF-8, invalid JSON, and non-object package manifests or language configuration in VSIX archive validation.
- b3f5de7: Reject malformed UTF-8 highlight queries during VSIX validation instead of accepting bytes that change when the extension reads them.
- b3f5de7: Validate the VSIX archive's bundled runtime and grammar WebAssembly payloads, rejecting malformed or truncated binaries before packaging succeeds.
- b3f5de7: Record the full integration checkpoint for connector source handling, sync provenance and website accessibility changes.
- b3f5de7: Record workspace, book-example, packed-consumer and production-browser verification after CSV validation and documentation-link fixes.
- b3f5de7: Verify the editor's real semantic-token provider against Unicode, CRLF input and incomplete edits using the packaged WASM grammar, and document the test's host boundary.
- b3f5de7: Record full workspace, packed-consumer and website documentation verification after ingestion and evaluation fixes.
- b3f5de7: Verify and document repeated article section focus and native middle-click new-tab behavior.
- b3f5de7: Verify fatal pending-request recovery preserves playground edits and runtime shutdown rejects outstanding work without retaining late replies.
- b3f5de7: Document verified playground behavior for blank queries, space-only claim input,
  strict tab-indentation errors and recovery without losing the working database.
- b3f5de7: Verify playground recovery from unsupported dated transitive queries and retention of a non-default valid-time anchor through worker failure and database rebuild. Document the query restriction and recovery behavior.
- b3f5de7: Record packed-consumer and production-browser verification of provenance and report fixes, including the rebuilt website documentation.
- b3f5de7: Record full workspace, executable book, packed consumer and production browser verification of record decoding and documentation navigation changes.
- b3f5de7: Record full workspace, packed consumer and production browser verification of scenario selection and numeric reduction fixes, including executable book examples and the unchanged public API snapshot.
- b3f5de7: Record the full workspace verification of view fixes and published README imports, plus the report and automation substitution review.
- b3f5de7: Record full production-browser verification of text and numeric schema-affinity validation and current documentation.
- b3f5de7: Verify arithmetic benchmark table readability and keyboard scrolling on mobile and desktop production documentation.
- b3f5de7: Record workspace and packed-package integration checks after the atomic-output and sync recovery changes.
- b3f5de7: Verify Gregorian calendar partitions, ISO week-year lengths, edge years and upper transaction boundaries.
- b3f5de7: Record clean/incremental build, packed npm, VSIX and production-browser verification for Changesets CLI 3.0.2.
- b3f5de7: Record clean frozen-install verification of the SQL.js text patch in both optimized runtime bundles.
- b3f5de7: Verify the combined Vite shutdown patch across both supported Node majors, CLI termination and production browsers, and retire the fixed bug record.
- b3f5de7: Clarify combined website/viewer browser checks in CI and record the 47-test integration checkpoint.
- b3f5de7: Record built-CLI connector recovery, pruning and provenance verification on both supported Node majors.
- b3f5de7: Record successful full workspace and grammar integration on both supported Node majors with the current Playwright and patched Vite toolchain.
- b3f5de7: Verify built CLI current-export failure preserves files and repaired seeds replay with correct relationship identity.
- b3f5de7: Record complete production browser verification for the current arithmetic and action guides.
- b3f5de7: Record production browser coverage for current storage index validation and solver guidance.
- b3f5de7: Record full Node 26 integration coverage for current storage recovery and book-runner fixes.
- b3f5de7: Record the current 141-test production browser checkpoint and refresh website verification scope.
- b3f5de7: Record the current clean full dependency audit and verify that the existing TypeScript migration and VS Code API-baseline holds still apply.
- b3f5de7: Record full workspace and browser verification of accumulated historical relationship validation fixes.
- b3f5de7: Record full production-browser verification of current release guidance and documentation artifacts.
- b3f5de7: Record validation of the accumulated changeset metadata and installed-CLI release-plan preview.
- b3f5de7: Record full production-browser verification of current documentation-search help and solver guidance.
- b3f5de7: Record compatibility verification of current core, store, query, fusion, view and WASM tests on Node 22.18.0, 24.0.0 and 24.18.0.
- b3f5de7: Record the current whole-workspace and packed-artifact integration checkpoint for the system review.
- b3f5de7: Record production website navigation and responsive browser verification after the connector documentation updates.
- b3f5de7: Record full Node 24 integration with the updated Node and Emscripten declarations.
- b3f5de7: Record full Node 26 integration with the updated Node and Emscripten declarations.
- b3f5de7: Record the production website build and full browser verification with the updated Node and Emscripten declarations.
- b3f5de7: Verify production documentation navigation releases resize observers for replaced and removed content.
- b3f5de7: Verify documentation example and table keyboard scrolling when text doubles in size on mobile and desktop.
- b3f5de7: Record full Node 26 workspace verification of explanation budgets, immutable replay and accumulated relationship fixes.
- b3f5de7: Record generated-client artifact review, executable book replay, and rebuilt website reference checks after the reader snapshot fix.
- b3f5de7: Record full Node 26 and production-browser verification of historical export statement reuse.
- b3f5de7: Record integrated workspace and production browser verification after hook, fusion, search and documentation changes.
- b3f5de7: Record built HTTP viewer sensitivity isolation and same-process recovery after external database repair on both Node majors.
- b3f5de7: Record full Node 24 and 26 integration covering restricted HTTP claim-identity validation and recovery.
- b3f5de7: Record combined workspace and production-browser verification of ingestion recovery, evaluation scoring, parser scaling, and their rendered documentation.
- b3f5de7: Record complete production-browser verification of updated solver navigation, resource guidance and connector/viewer lifecycle documentation.
- b3f5de7: Verify that leaving delayed Docs and Playground downloads preserves the chosen route and focus after either successful or failed completion.
- b3f5de7: Record full Node 24 workspace verification of text, numeric and STRICT schema-affinity compatibility.
- b3f5de7: Record full Node 24 workspace verification of batched canonical serialization and escaped operand ordering.
- b3f5de7: Record full Node 24 integration with Changesets CLI 3.0.2 and align the active browser inventory count.
- b3f5de7: Record full Node 24 workspace verification of compact enum-string evaluation keys and current runtime changes.
- b3f5de7: Record full Node 24 workspace verification of compact expression-variable keys and current runtime changes.
- b3f5de7: Record full Node 24 integration of complete changeset fixed-group validation and current workspace changes.
- b3f5de7: Record full Node 24 workspace verification of cumulative explanation-work limits and required storage-index validation.
- b3f5de7: Record full Node 24 integration covering current-export target-key validation and recovery.
- b3f5de7: Record full Node 24 integration of historical export-remapping validation and current runtime changes.
- b3f5de7: Record full Node 24 integration of historical export statement reuse and current runtime changes.
- b3f5de7: Record full Node 24 integration coverage for identity collation validation and book recovery.
- b3f5de7: Record the complete Node 24 workspace checkpoint through shared SQL record capture.
- b3f5de7: Record full Node 24 integration covering scoped provenance preservation and recovery.
- b3f5de7: Record full Node 24 integration covering projection-local metadata statement reuse.
- b3f5de7: Record full Node 24 integration covering report citation-key validation and recovery.
- b3f5de7: Record full Node 24 integration covering report transaction-identity validation.
- b3f5de7: Record full Node 24 integration through connector schema capture and store export/migration recovery.
- b3f5de7: Record full Node 24 workspace verification of shared canonical preparation and current runtime changes.
- b3f5de7: Record full Node 24 workspace verification of batched canonical hashing and current runtime changes.
- b3f5de7: Record full Node 24 integration of workspace-name validation and current changeset ownership checks.
- b3f5de7: Record full Node 26 workspace verification of text, numeric and STRICT schema-affinity compatibility.
- b3f5de7: Record full Node 26 workspace verification of batched canonical serialization and escaped operand ordering.
- b3f5de7: Record full Node 26 integration with the updated Changesets CLI 3.0.2 pin.
- b3f5de7: Record full Node 26 workspace verification of compact enum-string evaluation keys and current runtime changes.
- b3f5de7: Record full Node 26 workspace verification of compact expression-variable keys and current runtime changes.
- b3f5de7: Record full Node 26 integration of complete changeset fixed-group validation and current workspace changes.
- b3f5de7: Record full Node 26 workspace verification of cumulative explanation-work limits and required storage-index validation.
- b3f5de7: Record full Node 26 integration through current connector source validation and its verification boundaries.
- b3f5de7: Record full Node 26 integration covering current-export target-key validation and recovery.
- b3f5de7: Record full Node 26 integration coverage for explanation reuse and storage identity collation validation.
- b3f5de7: Record full Node 26 integration of historical export-remapping validation and current runtime changes.
- b3f5de7: Record full Node 26 integration covering projection-local metadata statement reuse.
- b3f5de7: Record full Node 26 integration covering report transaction-identity validation.
- b3f5de7: Record full Node 26 workspace verification of batched canonical hashing and current runtime changes.
- b3f5de7: Record full Node 26 integration of workspace-name validation and current changeset ownership checks.
- b3f5de7: Record full Node 26 workspace and book verification with owned-model canonicalization and Z3 deadline retries.
- b3f5de7: Extend real VS Code host checks to verify packaged file associations, automatic activation and indentation defaults, and require success evidence beyond the launcher exit code.
- b3f5de7: Record source-level integration of CAVE's publication output with the pinned Changesets action, including partial publication, recovery and script failure.
- b3f5de7: Record pinned Changesets action version-summary verification using CAVE workspace manifests, actual CLI versioning and synchronized private-package changelogs.
- b3f5de7: Verify and document that failed playground rebuilds retain appended data and corrected rebuilds replace the working database on mobile and desktop.
- b3f5de7: Verify that the production Book link serves the current PDF artifact and supports successful GET and HEAD requests.
- b3f5de7: Record full Node 26 and production-browser verification for scoped provenance preservation and current documentation.
- b3f5de7: Record clean/incremental builds, packed artifacts and full Node 26 integration with React 19.3.
- b3f5de7: Record full Node 24 integration with React 19.3 and its matching declarations.
- b3f5de7: Extend the real VS Code host smoke test to verify fresh, non-overlapping Unicode token ranges through incomplete edits and correction.
- b3f5de7: Record built CLI report-file recovery on both Node majors and full Node 26 integration for citation-key validation.
- b3f5de7: Record incremental build consistency and full production browser verification after parser, report, and ownership traversal improvements.
- b3f5de7: Record authored-text, row-column and provenance fidelity checks across native SQLite and sql.js on both supported Node majors.
- b3f5de7: Record full Node 26 and production-browser verification of shared canonical preparation and current documentation.
- b3f5de7: Record full production-browser verification of current enum-key and batched canonical hashing documentation.
- b3f5de7: Record full production-browser verification of STRICT-aware schema validation and current documentation.
- b3f5de7: Record clean and incremental builds plus full Node 26 integration for the shared Tree-sitter update and editor type baseline.
- b3f5de7: Record full Node 24 integration for Tree-sitter 0.27 and the corrected editor declaration baseline.
- b3f5de7: Record clean and incremental build verification, installed public package smoke checks, and VSIX validation with the updated browser toolchain.
- b3f5de7: Verify UUID line-terminator rejection and clock isolation, and remove a redundant CLI checksum length check after confirming existing regex behavior.
- b3f5de7: Record full Node 24 workspace and production browser verification for current solver limits and workflow lifecycle handling.
- b3f5de7: Restore the playground dataset selector's visible keyboard focus outline and cover it in the production browser regression.
- b3f5de7: Show unapplied claim edits beside playground queries until a successful rebuild or append, with an accessible query description.
- b3f5de7: Give website pages and documentation articles descriptive browser tab titles,
  including missing destinations and navigation through browser history.
- b3f5de7: Focus route download/render recovery headings so keyboard users can reach Reload
  page with Tab and return to the destination heading after a successful retry.
- b3f5de7: Focus the destination heading on home, playground and missing-page navigation,
  waiting for lazy content and preserving the ordinary keyboard Tab sequence.

## 0.35.0

### Patch Changes

- d64cad8: Add the `pull-requests` skill: the branch, changeset, Codex review loop (fix or answer every finding, resolve every addressed thread), CI and book-PDF commit, and `main` ruleset workflow, plus the instruction that every material finding or conclusion is persisted in a live document rather than left in a conversation.
- 15c38bf: The pull-requests skill and `CLAUDE.md` state that the session which merges a changeset-carrying PR also verifies and merges the resulting `chore(release): version packages` PR before it ends, with the staleness, completeness, derived-manifest and CI checklist that verification runs through.

## 0.34.0

## 0.33.0

### Patch Changes

- cdf4ed9: The storage schema's `cave_edge` role comment lists the roles that are actually stored, `WHEN`, `VIA`, `BECAUSE`, and `QUALIFIES`; an `UNLESS` qualifier is persisted as a `WHEN` edge to a negated child.
- 1320911: Describe CAVE by what it does in the README, website, book, CLI help, and MCP guide instead of leading with the SQLite storage backend; the storage engine remains a documented implementation detail behind the store adapter.
- 0adc7d2: The release script now waits up to about four minutes (8 attempts, 5s doubling to a 60s cap) for a just-published package to become visible on npm before tagging, instead of the 14s probe budget that failed the v0.32.3 run after every package had in fact published. Pre-publish registry probes keep their short budget.

## 0.32.3

### Patch Changes

- 7c1950a: Support Node.js 26 and record reproducible read-only CLI and narrow-screen website follow-up work from an exploratory product pass.
- 9c28743: Rewrite the root README and website home page as a step-by-step tutorial: Tutorial I builds a monorepo knowledge base one idea per step (claims, inverse and transitive queries, attributes, custom verbs, `cave connect`, sources and confidence, rules, shapes, cited reports, serve/MCP) and Tutorial II a market watchlist (theme exposure model, LLM news ingest, sign-aware rules, valid time, actions, automations, the brief), with new runnable fixtures under `examples/monorepo/` and `examples/market/`. The previous feature walkthrough moves unchanged to `examples/family-history/README.md` and joins the website's Learn section.

## 0.32.2

### Patch Changes

- a7397de: Update the release-automation guard test for the chained VS Code Marketplace publish job.
- a1f05bc: Publish the VS Code extension to Marketplace automatically after every npm release, listed as "CAVE Language".

## 0.32.1

### Patch Changes

- af53c4c: Publish the VS Code extension under the `MirekRusin` Marketplace publisher.

## 0.32.0

## 0.31.1

## 0.31.0

## 0.30.0

### Patch Changes

- afce4f3: Reuse immutable sensitivity-scoped view projections and invalidate them when the source store changes.
- 6035063: Exercise the production website's worker and WebAssembly playground flow in a real browser before deployment.
- 26b23cf: Validate packed TypeScript entry points and review public API declaration changes in CI.

## 0.29.1

### Patch Changes

- 3d2f5b9: Document the pnpm-based first-package bootstrap procedure after restoring coherent releases.

## 0.29.0

### Minor Changes

- 03373de: Add stable percent-escaped source-line provenance across ingestion, structured
  connectors, claim APIs, and cited reports.
- 5cd786d: Define claim history as permanent and document safe recovery from accidental sensitive-data ingestion across stores, exports, sync peers, and backups.

### Patch Changes

- 9022a00: Accept valid single-quoted YAML package names during version-PR validation.
- 75ed4cf: Record the project audit findings as prioritized, independently actionable backlog items.
- 8003648: Keep sync dry-runs from advancing the process UUID transaction clock.
- a606db4: Parse offset-less query timestamps as UTC across valid and transaction time.
- 662e6aa: Add MiniZinc to the formal-verification roadmap as the preferred candidate for
  finite-domain, combinatorial, and browser solving before a direct HiGHS adapter.
- 1f5ae77: Complete public package metadata and make bootstrap, clean, and workflow action versions deterministic.
- 3feae4f: Index live documentation and correct stale user, package, book, and website references.
- 27b1dc7: Record the MiniZinc backend decision and keep the TODO backlog limited to remaining work.
- 2f31c8f: Align two-token continuation classification and trailing-hyphen verb tokens across both parsers.
- f13c698: Separate version-PR recovery validation from exact publish validation so pending changesets can repair release identity drift safely.
- a4b41b9: Resolve evidence-gated language and listener proposals as explicit product boundaries and reconcile the active backlog.
- 5a96c95: Validate authoritative release commits and tags before npm setup, align the
  publish runtime with CI, cache the tree-sitter toolchain, and retry registry
  reads without confusing transient failures for unpublished packages.
- 01ca7dc: Classify date-like values with the shared calendar-period parser, including leap-day, month-length, and ISO week-year validation.
- 0ac44fd: Reject zero, negative, non-finite, and malformed uncertainty values consistently across parsing, claim construction, interpretation, and fusion.
- 0021db8: Generate VS Code changelog entries when synchronizing the extension release identity.
- 3526b49: Validate packed VSIX artifacts and add a lockstep, permission-scoped VS Code Marketplace release path.

## 0.28.1

### Patch Changes

- 16344ea: Harden the release publish script against partial publishes: the already-published guard now checks every public package (not a single sentinel), `pnpm -r publish` retries only publish what's missing, the `v<version>` tag is created on a later run if an earlier one published everything but died before tagging, and first-ever packages (which npm trusted publishing cannot cover until they exist on the registry) are called out up front.

## 0.28.0

### Patch Changes

- e2a4fd7: Release automation via changesets: PRs add a `.changeset/*.md` file instead of bumping versions in lockstep (which made every pair of concurrent PRs conflict); an automated Version Packages PR accumulates pending releases, and merging it bumps all version sources, publishes to npm and tags `v<version>`.
- a0a4dd1: Fix the release automation's first run: changesets/action builds the version packages PR body from each changed package's `CHANGELOG.md`, so `changelog: false` crashed it (ENOENT). Changelogs are now generated with the built-in `@changesets/cli/changelog`, and `scripts/sync-versions.mjs` no longer bumps the private website/VS Code manifests (changesets never writes changelogs for them, and the action treated their sync as a package release).
