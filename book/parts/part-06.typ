#import "../style.typ": note

= Formal Reasoning and Scenario Inputs
CAVE-Q retrieves beliefs and rules derive claims, but neither searches a space of possible assignments. The optional formal-reasoning layer handles feasibility, optimization, and proved infeasibility without turning a hypothetical model into durable knowledge.

`@cavelang/scenario` binds explicit CAVE-Q inputs against a frozen transaction-time and valid-time snapshot. It applies hypothetical CAVE claims inside a savepoint, converts authored numeric values and units exactly, records the supporting belief row identities, and rolls the overlay back before any evaluator runs. Missing, contested, retracted, and multiple values require declared policies; no integration silently chooses the first match.

`@cavelang/solver` is a dependency-free, solver-neutral TypeScript model for Boolean, bounded integer, exact real, and finite-enum variables. It distinguishes hard constraints, explicitly weighted soft constraints, and lexicographically ordered objectives. Its workflow API gives feasibility, optimization, counterexample, and bounded sensitivity distinct semantics while sharing one validated model, snapshot context, resource limits, and result vocabulary. Results are disjoint: satisfied and optimal carry assignments, unsatisfied requires a proof of infeasibility, and timeout or backend failure remains unknown. CAVE confidence never becomes an optimization weight implicitly.

Workflow assignments are deterministic: variables are ordered by stable ID, with false before true, smaller exact numbers first, and enum values in lexical order. Authored optimization objectives remain first, explicit soft weights follow, and generated tie-break objectives come last. Sensitivity checks only an explicit typed sample list; its report identifies adjacent assignment transitions and contiguous unknown regions rather than interpolating through timeouts.

`@cavelang/solver-z3` is the optional Node.js adapter to the official threaded Z3 WebAssembly package. It loads lazily, queues checks through one process runtime, tracks named hard constraints for unsatisfiable cores, preserves exact rational arithmetic, applies bounded execution, and requires explicit worker shutdown. Its separate `cave-solver-workflow architecture` binary is an allowlisted fixture that accepts bounded typed flags but no raw model or SMT-LIB input. The normal CAVE CLI, MCP server, browser playground, and knowledge kernel do not depend on Z3.

Solver explanations map assignments, evaluated constraints, objective contributions, and non-minimal unsatisfiable cores back to stable model locations, scenario inputs, and exact CAVE evidence rows. Counterexample reports also state the assumptions, bounded domains, and theories in scope. The model digest, solver version, resource limits, and frozen snapshot travel with the report. Rendering an explanation is read-only. An explicit atomic and idempotent record transition can preserve the immutable run, but recommendations, human decisions, action audit records, and external-effect audit records use separate versioned identities. Replay reports model or solver incompatibility instead of silently re-evaluating. `actProposal` still rechecks the current action declaration, parameters, premises, shape gate, and transaction boundary before a proposed decision can write.

#note([Boundary], [A solver proves statements only inside the selected model and snapshot. Optimal means optimal under those declared inputs and objectives, not objectively best in the world.])

= End-to-End Example: Architecture Decision
CAVE can model a decision such as monolith versus microservices by separating inputs, evidence, derived effects, and the decision itself. The system does not need a special decision object; ordinary claims plus rules and an action are enough.

```cave
system/shop HAS team-size: 6 people
system/shop HAS deployment-frequency: 3 /wk
system/shop HAS domain-count: 4
system/shop HAS operational-maturity: low

architecture/monolith ENABLES simple-deploy
architecture/microservices NEEDS platform-team
platform-team NEEDS team-size: 8 people

?sys HAS team-size: ?n, ?n < 8 => ?sys NEEDS low-ops-overhead
?sys NEEDS low-ops-overhead => architecture/monolith FITS ?sys @ 80%
```

A report can query the current inputs, show the rules and evidence that support each option, and cite the exact claims. An action such as action/select-architecture can require that evaluation inputs exist and append the chosen architecture plus rationale lineage.

As circumstances change, new input claims append. Derivation recalculates recommendations, but the prior decision remains historically visible. Resolution can prefer an explicit human selection over a generated recommendation. Valid-time contexts can describe planned future team size without overwriting current staffing. If choices interact through hard capacity or isolation constraints, the same inputs can bind through `@cavelang/scenario` into an exact portable solver model; simple weighted guidance should remain ordinary deterministic evaluation.

#note([Limiting factor], [CAVE can make the reasoning explicit and reproducible, but it cannot create reliable domain weights from nothing. The quality of a decision model is bounded by the declared factors, evidence, and rules. The next concrete step is to encode one narrow decision with measurable inputs and test it against known cases.])


= Operational Guidance
- Keep canonical text under version control; treat SQLite as a working index.
- Declare domain verbs and inverses in a small prelude.
- Use source contexts consistently so resolution policy can distinguish actors.
- Prefer actions over freeform agent appends for consequential writes.
- Run cave check in CI and use cave eval for extraction regressions.
- Use --resolve only where a single winner is required; keep default reads plural.
- Use --as-of and --at explicitly in reports that depend on time.
- Keep hooks and agent commands out of the store; claims may name them but never contain executable configuration.
- Create exact snapshots with cave backup, record their SHA-256, verify them independently, and periodically test cave restore into a fresh path. Use restricted canonical export separately when portable text interchange is required.

Security boundaries are intentionally visible. MCP tool scoping separates reads, ephemeral evaluation, durable recording, and effect-capable actions; exact tool allowlists can narrow further. Actions validate parameters and preconditions. Hook substitution is shell-quoted, but hook configuration remains executable operator-controlled code and should be reviewed accordingly. The read-only server should remain bound to localhost unless placed behind an appropriate access layer; its sensitivity ceiling limits publication but is not authentication or encryption.

Every CLI command enters one awaited dispatcher, whether its implementation is synchronous, asynchronous, or a long-running server. SIGINT and SIGTERM become one abort signal; HTTP servers, protocol readers, watchers, timers, and stores close before the conventional signal exit code is returned. User errors stay stack-free by default, while CAVE_DEBUG=1 preserves a diagnostic stack for operators.

Performance is designed for local SQLite scale. Indexes support direct entity, verb, object, attribute, confidence, context, tag, and full-text access. Transitive graph queries and large alias closures can become the limiting factor before ordinary claim reads. Measure on representative stores before adding distributed infrastructure.

Package boundaries stay fine-grained inside the source workspace, but only independently consumed kernel libraries and tooling publish separately. Command implementation modules such as rules, actions, automation, ingestion, MCP, and views ship as documented `@cavelang/cli/<feature>` subpaths. This keeps focused tests and ownership without multiplying npm version and compatibility surfaces; consumers of the former package names migrate by changing the import specifier only.


= Historical Drafts and Deliberate Boundaries
The specification marks sections as normative, legacy, draft, or non-normative. Implemented rule syntax and temporal trajectories graduated from the unified-grammar draft. The remaining sketches are not active roadmap items: ordinary stored claims stay fully bound, explicit qualifier and provenance structures replace recursively reified claim values, and executable temporal formulas stay in bounded external evaluators.

```cave
[server CAUSE crash] WHEN load EXCEEDS 1000 req/s   ; historical sketch
revenue IS (t -> 20B * 1.25^(t - 2025)) USD/yr ; external model instead
```

The useful part of the unified-grammar idea survives in scoped surfaces: CAVE-Q patterns, connector templates, and rule bodies bind variables, while persisted claims remain concrete facts. A future proposal must demonstrate a workflow that the existing structures cannot express and specify identity, scope, determinism, security, lifecycle, and compatibility before changing these boundaries.

Network push transports follow the same discipline. A transport-specific bridge owns webhook or socket authentication, retry, deduplication, and shutdown, then feeds a bounded connect pass or watched file; the local core does not become a resident integration platform. Active work and suspected bugs are tracked separately in TODO.md and BUGS.md.


= CLI Field Guide
#table(columns: 2, inset: 5pt, stroke: 0.4pt + luma(190),
  [*Command*],
  [*Primary use*],
  [cave parse],
  [Validate and summarize a CAVE document.],
  [cave add / import],
  [Append authored or replayed claims.],
  [cave export],
  [Emit canonical text, current view, or tx-annotated replica.],
  [cave backup / restore],
  [Verify exact SQLite snapshots and recover row and transaction identity.],
  [cave query],
  [Run CAVE-Q with filters, aliases, resolve, as-of, and valid time.],
  [cave check],
  [Knowledge health and shape coverage.],
  [cave generate],
  [Versioned TypeScript readers from current EXPECTS claims.],
  [cave ingest],
  [LLM extraction from prose and web pages.],
  [cave connect],
  [Deterministic structured mapping and watch mode.],
  [cave eval],
  [Extraction and reconstruction evaluation.],
  [cave derive],
  [Incremental rule materialization.],
  [cave act],
  [Execute a governed named write.],
  [cave resolve],
  [Explain contradiction winners.],
  [cave suggest-alias],
  [Find potential duplicate entity names.],
  [cave reconstruct],
  [Best-first related-claim reconstruction.],
  [cave sync],
  [Merge stores or annotated text by row identity.],
  [cave automate],
  [Watch belief events and settle rules/actions/hooks/agents.],
  [cave serve],
  [Read-only local knowledge browser.],
  [cave report],
  [Cited Markdown report rendering.],
  [cave mcp],
  [Serve tools to MCP clients.],
  [cave highlight],
  [Syntax-highlight CAVE text.],
  [cave-solver-workflow],
  [Run the optional allowlisted Z3 architecture fixture.],
)

Run pnpm exec cave help for the exact versioned option set. Package READMEs contain surface-specific examples, while the four specification skills preserve normative section numbering.


= Compact Reference
```cave
subject VERB [NOT] object [@context...] [#tag[:value]...] [@ N%] [!] [; comment]
subject HAS attribute: value [+/- delta [(N sigma)]] [@context...] [#tag...] [@ N%]

VERB REVERSE INVERSE-VERB
OLD-VERB RENAMED-TO NEW-VERB

parent VERB object
  WHEN condition
  BECAUSE evidence
  CONTAINS sibling-object

?x VERB ?y
?x VERB+ ?y
pattern, pattern, constraint => conclusion

@production       context
@ 80%             confidence
@2025..2028       valid-time range
20 -> 40 USD/yr   trajectory
@ 0%              retraction
VERB NOT           explicit negation
#topic:auth        scoped tag
; comment          persisted rationale
```

The central mental model is simple: write one claim, append rather than overwrite, ask with the same shape using variables, and keep provenance and uncertainty explicit. Every larger subsystem in CAVE is built from that foundation.
