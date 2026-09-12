# @cavelang/solver

## 0.36.2

No changes in this release.

## 0.36.1

No changes in this release.

## 0.36.0

### Minor Changes

- b3f5de7: Add configurable maxNumericDigits model validation to reject excessive exact-number expansion before BigInt arithmetic and backend execution.
- b3f5de7: Add a report-scoped cumulative explanation-work limit and workflow CLI option, preserving backend outcomes and historical recorded limits.
- b3f5de7: Add maxExplanationBits to conservatively bound local constraint arithmetic before fraction allocation, preserving backend status and historical report metadata.
- b3f5de7: Allow explicit validation limits in linear-model analysis so larger models can be classified under their configured bounds without changing classification semantics.
- b3f5de7: Accept explicit validation limits in canonical serialization and hashing, and preserve configured limits through solver explanations and workflow reports without changing model identity.
- b3f5de7: Expose optional local failure reasons for indeterminate hard and soft constraints in structured explanations and rendered reports.
- b3f5de7: Validate authored and normalized explanation input payloads before solving, rejecting cyclic or lossy non-JSON values while preserving shared records and optional object properties.
- b3f5de7: Snapshot and freeze solver submissions before adapter execution, preserve explanation context across asynchronous solves, and reject mismatched replay digests before running the backend.
- b3f5de7: Expose Exact.fromBigInts for exact normalization of integer intermediates and reuse it in scenario arithmetic, replacing duplicate Euclidean reduction without intermediate decimal serialization.
- b3f5de7: Snapshot workflow inputs across asynchronous solver calls and reject replay mismatches before backend execution, keeping sensitivity bindings, options, and evidence consistent across samples.
- b3f5de7: Reject coercible non-integer input types and trailing line breaks in exact numerals, and normalize decimal zero without expanding unused powers of ten.
- b3f5de7: Add shared unknown-reason validation and enforce it for solver results, explanations, and recorded scenario outcomes.
- b3f5de7: Expose shared explanation-context validation and enforce recorded run policies and declared limits without rewriting historical metadata.
- b3f5de7: Add shared result-metadata validation for solver boundaries and scenario records, rejecting malformed backend identity, elapsed time, and diagnostics.
- b3f5de7: Reject ambiguous explanation input IDs and malformed input/source-reference lists before solving or building reports.
- b3f5de7: Reject invalid explanation snapshot policies, confidence thresholds, and scenario metadata before solving or constructing reports.
- b3f5de7: Reject unknown solver options and limits, malformed option values, and unsupported sensitivity modes before backend execution instead of silently applying defaults.

### Patch Changes

- b3f5de7: Include expression and literal requirements in workflow scope theories so constant arithmetic and integer division do not appear as Boolean-only reasoning.
- b3f5de7: Add an accessible, collapsible section navigator to website documentation using rendered heading anchors. Improve narrow-screen article title sizing. Give the solver's exact arithmetic and resource guidance a directly navigable section, and document keyboard, mobile, route and print behavior.
- b3f5de7: Add topic navigation and anchored subsections to the solver provenance and explanations guide.
- b3f5de7: Add anchored topic navigation to the solver arithmetic guide for numeric limits, cancellation, normalization costs and independent checks.
- b3f5de7: Add task-based navigation and a direct quick-start anchor to the solver guide and its website reference page.
- b3f5de7: Add anchored topic navigation to the solver validation and identity guide for limits, capture, evaluation reuse, calibration and canonical identity.
- b3f5de7: Apply rational container validation consistently to zero checks and verify fraction budgets across model fields.
- b3f5de7: Verify decimal exponent size estimates, exact normalization, zero expansion and raised-budget recovery with independent Python references.
- b3f5de7: Add a reproducible optional exact-arithmetic audit against Python Fraction, covering 600 seeded input cases and 3,000 result/error comparisons per Node runtime. Document the independent evidence and its coverage limits.
- b3f5de7: Extend the independent Python Fraction audit to public exact comparison, covering signed large operands and invalid denominators alongside normalization and arithmetic checks.
- b3f5de7: Extend the independent Python Fraction audit through explanation arithmetic, checking signed rational results and indeterminate division by assigned zero after bigint normalization changes.
- b3f5de7: Check explanation size estimates against independent Python integer bit lengths across wide signed and cancellation fixtures.
- b3f5de7: Extend the independent Python Fraction audit to exact product constants used by linear analysis, covering two- and four-factor signed, zero and cancelling products. Preserve reproducible runtime reports and document the expanded 9,216 checks.
- b3f5de7: Add a seeded independent Python Fraction oracle for mixed explanation arithmetic, unreduced assignments and division-by-zero propagation.
- b3f5de7: Report invalid solver limit objects and functions without invoking caller-defined coercion, retaining the named limit validation error for malformed values.
- b3f5de7: Avoid unnecessary cross-products for equal-denominator exact comparison and addition/subtraction in linear analysis and explanations. Preserve normalized exact results and zero-divisor detection, and add a reproducible isolated benchmark with measured results.
- b3f5de7: Avoid unnecessary products in local explanation comparisons when normalized signs, zero values, or shared components determine the order. Compare remaining cross-products directly, and verify all comparison operators against an independent rational-order oracle.
- b3f5de7: Recognize zero products after all explanation operands are evaluated and type-checked, avoiding unnecessary nonzero intermediates while retaining arithmetic errors. Add bounded measurements and hard/soft constraint regressions.
- b3f5de7: Detect exact zero from validated integer fields or decimal coefficients without reducing fractions or expanding decimal magnitudes, retaining denominator and exponent checks.
- b3f5de7: Avoid redundant model copying and validation during explanation identity generation while retaining captured-model validation and public canonicalization checks.
- b3f5de7: Avoid redundant reductions when multiplying normalized explanation fractions, including direct squaring of equal operands, while preserving exact results.
- b3f5de7: Preserve reduced fractions directly during explanation negation and division, avoiding redundant GCD work while retaining sign and zero-divisor checks.
- b3f5de7: Avoid rational comparison cross-products when numerator and denominator order already determines the result.
- b3f5de7: Avoid cross-products when exact fraction order follows from signs or equal numerators, retaining normalization and validation of both operands.
- b3f5de7: Balance n-ary explanation products to reduce repeated work on growing fractions while preserving exact results and local arithmetic failures.
- b3f5de7: Use shared balanced exact addition in explanation evaluation, preserving operand evaluation order and extending cancellation tests and benchmarks.
- b3f5de7: Balance exact rational constant-sum reductions during linear classification to avoid repeatedly normalizing a growing accumulator; add cancellation regressions and a reproducible benchmark.
- b3f5de7: Batch large exact GCD reductions using guarded Lehmer steps shared by rational normalization and product cross-cancellation. Preserve exact results and existing limits, with signed differential regressions and reproducible adversarial and ordinary-input benchmarks.
- b3f5de7: Reduce canonical serialization token-array overhead by joining the same complete-token batches used for hashing.
- b3f5de7: Bound invalid option and limit text diagnostics while preserving short messages and rejection before adapter execution.
- b3f5de7: Bound long malformed exact-input diagnostics with beginning/end previews and original lengths while preserving short errors.
- b3f5de7: Apply a cumulative numeric-digit budget to sensitivity samples and fixed bindings before exact normalization, preventing padded values from bypassing input-size protection.
- b3f5de7: Cancel decimal coefficient trailing zeros against the scale before constructing bigint operands, avoiding large denominators and GCD work for compact rational values.
- b3f5de7: Cancel common rational factors before multiplying or dividing constants in linear analysis and explanations. Preserve exact signs, zeros and undefined-arithmetic behavior; add cancelling/coprime benchmarks and signed-arithmetic regression matrices.
- b3f5de7: Capture direct explanation limits once before validation, so changing getters cannot make model validation and the completed report use different limits.
- b3f5de7: Capture direct explanation models before validation, digest generation and constraint evaluation so changing getters cannot produce inconsistent reports.
- b3f5de7: Capture canonicalization and linear-analysis limits once so changing getters cannot alter the configuration between initial validation and validation of the copied model.
- b3f5de7: Capture solver and workflow option fields once so validated core requests and supplied limits remain consistent.
- b3f5de7: Capture backend results before explanation construction so displayed assignments and constraint evaluations agree.
- b3f5de7: Capture workflow inputs before scope analysis so analysis and execution observe the same model.
- b3f5de7: Extend the independent expression-tree oracle with nested conditionals, branch-selection failures and retained cross-runtime results.
- b3f5de7: Add a reproducible independent Python Fraction oracle for decimal normalization across signs, exponents and long trailing-zero suffixes.
- b3f5de7: Strengthen rational product benchmarks with untimed analytic magnitude and wrong-value controls, preserving timed workloads and recording results on both supported Node majors.
- b3f5de7: Strengthen rational addition and subtraction benchmarks with untimed exact-value and wrong-value controls, recording both supported runtimes and measurement limits.
- b3f5de7: Distinguish historical arithmetic baselines from implemented guards and the remaining resource-review scope.
- b3f5de7: Clarify the verified distinction between budgeted model entrypoints and unrestricted standalone exact arithmetic in the system review.
- b3f5de7: Document and verify explanation syntax-key cache ownership separately from key construction cost and garbage collection timing.
- b3f5de7: Clarify capture and validation ordering at solver entrypoints and distinguish model preflight from total copying costs.
- b3f5de7: Intern enum domain names and values in report-scoped evaluation keys to avoid repeated long-string expansion.
- b3f5de7: Use report-scoped compact variable references in evaluation keys to avoid repeatedly serializing long identifiers.
- b3f5de7: Compare normalized integer text before allocating bigint magnitudes, avoiding reparsing in exact-order shortcuts while retaining operand validation and cross-products where needed.
- b3f5de7: Compare exact rational cross-products directly instead of allocating their difference, with a reproducible large-fraction benchmark and unchanged operand validation.
- b3f5de7: Compare normalized explanation fractions directly for equality and inequality, avoiding cross-products while retaining ordering semantics. Add sign/zero/scaling regressions and bounded before/after measurements.
- b3f5de7: Require primitive strings matching the entire solver declaration identifier grammar, rejecting trailing line breaks and coercible objects before backend execution.
- b3f5de7: Detach completed solver explanations from backend results and caller metadata so later mutations cannot rewrite recorded evidence.
- b3f5de7: Render deeply nested explanation input and authored values without overflowing Node 22's native JSON serializer.
- b3f5de7: Include child-process limits, sample count, and timing/RSS interpretation in exact-product benchmark JSON. Share limits and sample count with the actual execution settings so exported results describe how they were measured.
- b3f5de7: Clarify the plain-text explanation rendering contract and record coverage of fields, JSON recovery and output-size boundaries.
- b3f5de7: Document expression-key traversal and storage costs and record the reviewed identity, cache lifetime and measured reuse boundaries.
- b3f5de7: Clarify conservative structural linearity with examples and record classifier correctness, cache and cost review evidence.
- b3f5de7: Record the model-validation contract audit and distinguish covered structural requirements from remaining resource review.
- b3f5de7: Audit capture ownership and recovery evidence and distinguish covered requirements from remaining resource review.
- b3f5de7: Clarify exact zero-check versus normalization costs and record standalone numeric correctness and resource review evidence.
- b3f5de7: Add ordinary rational-sum benchmark controls and document measured tradeoffs alongside distinct-denominator improvements.
- b3f5de7: Verify deep native capture failure and portable retry, and document whole-graph fallback limits.
- b3f5de7: Document solver limit defaults, distinguish capture from validation budgets, and organize ownership guidance.
- b3f5de7: Align the implementation guide with solver structural and count validation, and record verification of the installed public artifacts.
- b3f5de7: Document the measured unshared-model preparation tradeoff and add a reproducible unshared serialization control.
- b3f5de7: Enforce expression node and depth budgets during validation traversal, preventing over-budget expressions from exhausting traversal resources before rejection.
- b3f5de7: Enforce declaration and enum-value count limits before inspecting over-budget entries, avoiding unnecessary validation work on oversized models.
- b3f5de7: Escape C1 controls and Unicode line separators consistently in hard and soft constraint reasons while retaining structured diagnostics.
- b3f5de7: Preserve explanation line boundaries across header metadata, identifiers, provenance, queries and nested input JSON without changing structured reports.
- b3f5de7: Keep assignment and objective display strings on their labeled lines by escaping controls and Unicode separators without changing structured backend values.
- b3f5de7: Escape control characters and line separators in rendered unknown-result messages while preserving structured reasons and ordinary single-line text.
- b3f5de7: Require rational backend support for all portable division expressions, including integer-only operands, before invoking an adapter.
- b3f5de7: Exclude computed zero and undefined constant divisors from linear-model recognition using exact rational arithmetic, while retaining tiny nonzero constants.
- b3f5de7: Extend the bounded denominator-factor probe to six steps, avoiding squared shared factors in measured rational sums while retaining exactness and recording coprime tradeoffs.
- b3f5de7: Keep both validation-cost timing columns visible on narrow screens by moving the repeated size into the table introduction.
- b3f5de7: Reduce temporary allocation when classifying wide sums and products by folding operand results while preserving complete traversal and affine semantics.
- b3f5de7: Honor inherited and non-enumerable solver limit overrides and retain resolved values through workflow input capture.
- b3f5de7: Canonicalize deep solver models iteratively and compare commutative operands lazily, preserving established digests while allowing raised-depth models to produce identities and explanations.
- b3f5de7: Discover capabilities without recursive stack growth or repeated nonlinear subtree scans, while preserving shared-factor semantics and rejecting cycles explicitly.
- b3f5de7: Evaluate deep explanation constraints with an explicit stack, preserving short-circuit logic instead of reporting valid expressions as indeterminate after call-stack exhaustion.
- b3f5de7: Validate deep expressions with an explicit traversal stack while preserving early resource limits, occurrence counts, and per-path diagnostics.
- b3f5de7: Analyze deep affine expressions and exact constant divisors without exhausting the JavaScript call stack. Cache shared expression results while preserving nonlinear classification of repeated variable-bearing factors.
- b3f5de7: Copy portable solver and workflow inputs iteratively so deep validated models reach adapters as independent frozen submissions without native clone stack overflow.
- b3f5de7: Keep the capture-order guide table readable on narrow screens by moving long API names into its introduction, with responsive browser coverage.
- b3f5de7: Normalize explanation arithmetic directly as bigints, avoiding repeated decimal serialization and parsing while preserving exact fraction, sign and zero behavior.
- b3f5de7: Add an isolated adversarial GCD benchmark that retains completed samples on timeout. Document multi-second normalization within the numeric-digit budget and track the concrete performance work without changing exact semantics or limits.
- b3f5de7: Measure cumulative explanation work near default model limits and document why fraction-size guards do not bound full report cost.
- b3f5de7: Measure cumulative rational-sum explanation costs near the default model limit and document the remaining work-budget gap.
- b3f5de7: Measure classifier and explanation costs near the default numeric input budget and verify the rejection boundary.
- b3f5de7: Extend capture measurements to distinct expression objects and record complete solver source provenance.
- b3f5de7: Add isolated exact-decimal expansion measurements and document the numeric resource-budget gap and proposed preflight enhancement.
- b3f5de7: Document and benchmark bounded arithmetic intermediate growth when explanations repeatedly use large assignment values under the existing model-input budget.
- b3f5de7: Measure exponent-padding costs and clarify that numeric expansion limits do not bound authored numeric text or syntax-key storage.
- b3f5de7: Record fraction comparison controls for canonical text ordering and retain complete benchmark samples with matching timing boundaries.
- b3f5de7: Measure malformed enum collection costs and document why value-count and preview limits do not bound aggregate diagnostics.
- b3f5de7: Add an isolated comparison trial distinguishing reinforcing-order shortcuts from direct cross-product reference arithmetic.
- b3f5de7: Add isolated backend diagnostic capture measurements with ownership and output equality checks.
- b3f5de7: Add a reproducible sensitivity workflow benchmark and document measured batch overhead and generated-limit rejection on both supported Node versions.
- b3f5de7: Add a reproducible explanation benchmark comparing shared graphs with equivalent trees, retain full observations, and verify operand multiplicity, assignment isolation, and short-circuit behavior before considering evaluator caching.
- b3f5de7: Record reproducible shared-product explanation trials demonstrating intermediate arithmetic growth within default input limits.
- b3f5de7: Measure malformed-text and provenance validation costs and document their relationship to model limits.
- b3f5de7: Select native cloning before evaluating accessors or copying nonportable data, preserving getter count/order and proxy rejection alongside iterative portable-input copying.
- b3f5de7: Separate enum benchmark comparisons from solver input rules and add direct topic navigation.
- b3f5de7: Normalize exact decimal expansions with nonpositive scales directly as integer
  text, preserving validation, signs and zero while avoiding BigInt conversion
  and powers of ten. Fractional scales retain exact rational reduction.
- b3f5de7: Normalize Boolean and enum sensitivity values before duplicate detection so property order and extra fields cannot cause redundant sample runs.
- b3f5de7: Normalize BigInt intermediates directly in linear analysis and explanation arithmetic, avoiding redundant decimal serialization and reparsing. Record before/after benchmark samples, including cancelling controls and the limits of the measured improvement.
- b3f5de7: Normalize validated integer-string numerators over denominators 1 or -1 directly
  from text, avoiding a large BigInt parse/serialization round trip while
  preserving signs, leading-zero normalization and input validation.
- b3f5de7: Normalize zero rational numerators with string denominators using validated text
  without allocating the denominator BigInt. Keep invalid and zero denominator
  rejection, and document the measured improvement and nonzero control.
- b3f5de7: Separate reinforcing-order timing evidence from the arithmetic contract and link its reproduction guide directly.
- b3f5de7: Separate solver capture ordering from benchmark guidance and clarify report-assembly comparisons.
- b3f5de7: Validate every generated sensitivity model before backend execution so a later sample exceeding model limits cannot cause partial batch execution.
- b3f5de7: Preserve declaration columns without line numbers in text explanations while retaining structured provenance and model identity.
- b3f5de7: Preserve classified validation errors when expressions reference malformed variable sorts.
- b3f5de7: Preserve classified validation errors for malformed identifiers and expression tags without invoking JSON hooks.
- b3f5de7: Preserve execution order in rational benchmark timing samples and explicitly report warm-up and memory scope, with verified median calculations on both Node majors.
- b3f5de7: Avoid redundant fraction reduction when explanation arithmetic adds an integer or zero, retaining exact reduction for general sums.
- b3f5de7: Preserve named maxRuns validation errors for malformed sensitivity request objects instead of failing during string conversion, before backend execution.
- b3f5de7: Measure experimental cumulative bit accounting on distinct explanation predicates without changing runtime limits.
- b3f5de7: Avoid repeated large denominator factors in exact addition and subtraction when a bounded Euclidean probe finds them. Preserve normalization and zero-divisor behavior, with signed identity regressions and full-operation benchmarks covering shared and coprime inputs.
- b3f5de7: Avoid large rational intermediates when constant signs prove a linear divisor is nonzero, retaining exact evaluation for cancellation.
- b3f5de7: Use conservative constant sign proofs for explanation comparisons with zero while preserving undefined arithmetic, assignment checks and exact cancellation fallback.
- b3f5de7: Record full integration and packed-package verification of balanced arithmetic and current runtime validation changes.
- b3f5de7: Record exact-product correctness and timing observations on the refreshed supported runtimes, preserving full samples and distinguishing them from performance-gate thresholds and general arithmetic resource bounds.
- b3f5de7: Record complete Node 26 workspace integration validation for exact-zero
  normalization and recent claim-capture fixes, retaining separate benchmark,
  browser and hosted-release verification boundaries.
- b3f5de7: Record the rejected primitive-preflight capture trial and its measured tradeoffs.
- b3f5de7: Record full workspace and rendered documentation verification for solver capture and explanation ownership changes.
- b3f5de7: Reduce temporary descriptor and entry allocations during portable model/result copying while preserving native fallback and graph semantics.
- b3f5de7: Reject callable and non-object rational containers before field access so they cannot bypass numeric preflight.
- b3f5de7: Reject missing declaration slots before reading inherited getters, preserving classified errors and corrected-array retries.
- b3f5de7: Reject sparse expression operand arrays whose missing slots are supplied by inherited entries.
- b3f5de7: Validate model and expression containers before traversal, rejecting sparse declaration lists and malformed operand arrays with field-specific model errors.
- b3f5de7: Keep malformed backend boolean assignments indeterminate in hard and soft constraint explanations instead of coercing them through JavaScript truthiness.
- b3f5de7: Keep explanation text usable for malformed backend assignment and objective values, marking invalid shapes while retaining the structured values.
- b3f5de7: Preserve authored input values and evidence/scenario references in text explanations, and distinguish missing values from explicit JSON null.
- b3f5de7: Add an isolated, reproducible denominator-probe comparison driver with balanced variant order, source fingerprints, exact controls and automatic cleanup.
- b3f5de7: Add a guarded baseline mode for isolated product-chain measurements that restores the recorded prior linear implementation inside benchmark children without editing runtime files. Document commands and preserve a second paired run on both supported Node versions.
- b3f5de7: Retain bigint intermediates across constant multiplication chains in linear analysis, preserving cross-cancellation and operand evaluation while avoiding repeated growing decimal serialization. Add exact-chain regressions and paired resource measurements on both supported Node versions.
- b3f5de7: Reuse per-validation enum membership sets to avoid repeated domain scans while preserving duplicate and occurrence limits.
- b3f5de7: Reuse verified explanation digests in workflow reports and sensitivity summaries, avoiding redundant model copying and canonical serialization while retaining validation.
- b3f5de7: Reuse identical ordered constraint evaluations within each explanation report while preserving declaration metadata and failure semantics.
- b3f5de7: Reuse normalized assigned values within each explanation report's hard and soft constraints, preserving fresh assignments across reports. Add isolation coverage and bounded performance measurements.
- b3f5de7: Avoid copying completed explanation reports again after capturing their inputs, while preserving caller isolation.
- b3f5de7: Reuse canonical expression preparation across shared nodes within one model while preserving occurrence-based limits and fresh-call identity.
- b3f5de7: Reuse completed evaluations for identical captured expression roots before rebuilding syntax keys, preserving structural reuse and declaration metadata.
- b3f5de7: Reuse fixed control-character escapes in solver text rendering and add exact-output performance measurements for large diagnostics.
- b3f5de7: Share bounded escaped text previews across exact-input and model-field diagnostics while preserving short messages.
- b3f5de7: Hash canonical model tokens in batches for digest-only operations while preserving serialized identity and validation.
- b3f5de7: Validate assignment kinds and integer integrality before evaluating hard and soft constraints, preserving exact numeric compatibility.
- b3f5de7: Prevent overridden array methods from bypassing declaration and operand validation.
- b3f5de7: Validate copied context in direct explanation reports so changing getters cannot bypass JSON input validation.
- b3f5de7: Capture and revalidate explanation input JSON before text serialization so changing nested getters cannot print unvalidated values.
- b3f5de7: Copy solver models before validation so validation and adapter submission observe the same model data.
- b3f5de7: Keep malformed and out-of-domain enum assignments indeterminate during hard and soft constraint explanation.
- b3f5de7: Build enum membership and duplicate checks from validated indexed entries instead of caller-defined iterators.
- b3f5de7: Validate provenance references by their own indexed entries so custom iterators cannot hide duplicates or fill holes.
- b3f5de7: Validate numeric assignment bounds exactly before explaining constraints and cache successful and failed assignment validation per report.
- b3f5de7: Validate Boolean sensitivity samples and fixed values before any backend call, preventing an invalid later sample from triggering partial batch execution.
- b3f5de7: Validate sensitivity sample values and fixed bindings, including sparse array holes, with contextual errors before backend execution.
- b3f5de7: Require arrays for supplied sensitivity fixed-binding and observation lists, rejecting null and iterable strings instead of silently changing request meaning.
- b3f5de7: Validate sensitivity request objects and sample arrays explicitly before solving, replacing incidental property and method errors with named workflow validation diagnostics.
- b3f5de7: Reject malformed model descriptions before solver execution and explanation generation while preserving valid labels and semantic identity.
- b3f5de7: Reject missing or invalid objective directions before canonicalization and adapter execution.
- b3f5de7: Reject sparse reference arrays and malformed provenance locations as model validation errors before solver execution.
- b3f5de7: Capture solver results and require explicit proof markers for optimal and unsatisfied outcomes before returning results or constructing explanations.
- b3f5de7: Reject malformed enum-domain containers and non-string or missing members before backend execution, preserving valid string members unchanged.
- b3f5de7: Reject unknown variable and literal sorts and non-Boolean Boolean literal values before solver execution, eliminating literal-to-variable validation fallthrough.
- b3f5de7: Verify bounded numeric, model-field and option diagnostics through installed packages and both supported Node workspace suites.
- b3f5de7: Verify that cancelling rational sums retain undefined operands in hard and soft constraint explanations.
- b3f5de7: Verify canonical operand ordering and digest identity for escaped Unicode values and long common prefixes.
- b3f5de7: Verify that canonicalization, digests and linear analysis reject copied bounds exceeding the initial numeric budget even when both bound and limit getters change. Document the enforced budget across copying.
- b3f5de7: Verify the classifier fold in full Node 24 integration and refresh the system review's current evidence map without changing historical records.
- b3f5de7: Verify current enum and validation guidance across the complete production-browser suite.
- b3f5de7: Record current variable and enum syntax-key workloads on both supported Node majors, preserving cost and memory measurement boundaries.
- b3f5de7: Retain current independent arithmetic and preflight oracle results on both supported Node majors with complete solver source fingerprints.
- b3f5de7: Verify current solver review guidance and responsive documentation against the full production Chromium suite.
- b3f5de7: Record successful diagnostic compatibility checks for 36 solver workload cases on both supported Node majors.
- b3f5de7: Verify enum membership reuse and current guidance across both supported Node workspace suites.
- b3f5de7: Document and verify runtime rejection of unrepresentable nonzero decimal expansions without affecting later exact arithmetic.
- b3f5de7: Document and verify exact rational normalization and ordering across signs, decimal forms, and integers beyond floating-point precision.
- b3f5de7: Record independent arithmetic checks and current GCD workload measurements on both supported Node runtimes.
- b3f5de7: Compare combined and isolated explanation evaluations across operators, assignments and size limits to guard report-cache semantics.
- b3f5de7: Record installed-package verification and exact text-expansion checks for solver control-escape reuse.
- b3f5de7: Verify indexed provenance and declaration/operand validation across both supported Node workspace suites.
- b3f5de7: Verify indexed enum membership and custom-iterator rejection across both supported Node workspace suites.
- b3f5de7: Verify installed declaration and operand validation cannot be skipped through overridden array methods.
- b3f5de7: Verify installed solver assignment validation, skipped branches and fresh-report recovery through public solve and explanation APIs.
- b3f5de7: Verify bounded diagnostic previews, short-message compatibility and escaped text through installed solver exports.
- b3f5de7: Verify installed exact decimal normalization against direct bigint arithmetic across signs, scales and trailing-zero cancellation, including long decimal suffixes.
- b3f5de7: Verify installed declaration validation rejects holes before inherited getters and accepts repaired own entries across all five lists.
- b3f5de7: Verify per-call enum membership and repaired retries through installed packages and downstream solver consumers.
- b3f5de7: Verify installed enum validation rejects iterator-substituted members and preserves indexed-entry retries.
- b3f5de7: Verify installed provenance validation rejects hidden duplicates and inherited entries while preserving repaired retries.
- b3f5de7: Verify folded linear classification through installed public packages and record the reviewed model-capture resource boundary.
- b3f5de7: Verify exact 18-factor product cancellation through installed linear analysis, including signed and zero products and zero/nonzero divisor classification with large rational factors.
- b3f5de7: Verify objective-direction rejection and corrected retries through installed solver exports.
- b3f5de7: Verify report mutation isolation through installed explanation and solve entrypoints.
- b3f5de7: Verify installed solver proof checks before workflow outcome normalization and verify corrected results retain their declared status.
- b3f5de7: Verify malformed-field diagnostics and callable-rational budget rejection through installed solver exports.
- b3f5de7: Verify cached assignment failures preserve short-circuit evaluation and corrected assignments recover in fresh explanation reports.
- b3f5de7: Verify folded linear classification in full Node 26 integration and record current temporal and export review coverage.
- b3f5de7: Record independent exact-arithmetic and linear-classification audit results after constant sign analysis.
- b3f5de7: Verify native capture behavior for mutating and failing getters, shared container references, and corrected retries; document caller-side effects.
- b3f5de7: Verify owned explanation-report assembly across both supported Node workspace suites.
- b3f5de7: Exercise asynchronous cleanup rejection, generated sensitivity preflight and digest identity, and MCP hook setup diagnostics through installed package exports.
- b3f5de7: Verify packaged explanation arithmetic preserves normalized equality, zero-product errors, hard/soft evaluations and fresh assignments across reports.
- b3f5de7: Exercise sensitivity request validation and numeric-budget recovery through installed package exports in packed smoke checks.
- b3f5de7: Verify solver input capture, programmatic limit overrides and explanation ownership through the installed public package.
- b3f5de7: Extend installed-package smoke coverage for shadowed transaction promises, malformed Boolean samples and semantic duplicate sensitivity samples.
- b3f5de7: Verify installed rational zero checks and current solver guidance in the production browser suite.
- b3f5de7: Record full workspace verification of rendering optimization and solver/loop recovery regressions on both supported Node majors.
- b3f5de7: Verify original capture errors and same-result recovery across solve and explanation boundaries, with detached successful diagnostics.
- b3f5de7: Verify occurrence-counted report node limits for shared expression graphs, exact-boundary retry and fresh evaluation after caller changes.
- b3f5de7: Verify exact shared-input JSON expansion and cycle repair recovery, and document the output-size boundary.
- b3f5de7: Verify shared expression-root reuse through scenario and Z3 suites on both Node majors and installed public-package smoke checks.
- b3f5de7: Verify shared expression-root reuse and current solver recovery regressions across full workspace runs on both supported Node majors.
- b3f5de7: Refresh independent exact arithmetic, explanation, classification and size-estimate evidence after shared-root evaluation reuse.
- b3f5de7: Verify that shared repeated-squaring expressions cannot bypass the numeric budget in serialization, digests, or linear analysis.
- b3f5de7: Record full Node 24 and Node 26 integration checks for six-step denominator probing, viewer listener cleanup and current workspace regressions.
- b3f5de7: Record Z3, scenario and installed-package verification for solver explanation ownership and result capture.
- b3f5de7: Record full Node 24 and 26 integration and installed-package verification for solver text rendering fixes.
- b3f5de7: Verify same-adapter recovery after invalid result metadata and detached diagnostic snapshots across subsequent solves.
- b3f5de7: Verify objective directions, malformed-sort diagnostics and own operand slots across both supported Node workspace suites.
- b3f5de7: Verify current validation guidance and the mobile cost table across the complete production-browser suite.
- b3f5de7: Verify exact diagnostic paths and deferred child inspection at the expression-depth boundary, and document path construction costs.
- b3f5de7: Verify malformed-field diagnostics and rational-container guards across both supported Node workspace suites.
- b3f5de7: Verify packed viewer listener cleanup and record unequal-denominator comparison measurements with analytic correctness checks on both supported Node majors.
- b3f5de7: Verify portable-copy allocation reduction in full workspace runs on both Node majors and installed public-package smoke checks.
- b3f5de7: Show snapshot policies, confidence thresholds, and scenario overlay identity in text explanations so differing evidence scopes remain visible.

## 0.35.0

## 0.34.0

## 0.33.0

## 0.32.3

## 0.32.2

## 0.32.1

## 0.32.0

## 0.31.1

## 0.31.0

## 0.30.0

## 0.29.1

## 0.29.0

### Minor Changes

- 7d2d992: Add versioned solver explanations mapped to model declarations, CAVE evidence,
  scenario inputs, frozen snapshots, objective values, and unsatisfiable cores.
- 1b0fd3c: Add bounded verification workflows, an allowlisted Z3 CLI fixture, and governed execution of solver action proposals.

### Patch Changes

- 4c009e9: Record the measured direct HiGHS backend decision and its exactness and runtime gates.

## 0.28.1

## 0.28.0

### Minor Changes

- dda4cc9: Add the solver-neutral formal reasoning model, validation, canonical identity,
  capability negotiation, resource limits, result contracts, and linear-subset
  analysis.
