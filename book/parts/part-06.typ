#import "../style.typ": note

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

As circumstances change, new input claims append. Derivation recalculates recommendations, but the prior decision remains historically visible. Resolution can prefer an explicit human selection over a generated recommendation. Valid-time contexts can describe planned future team size without overwriting current staffing.

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
- Back up with canonical export and periodically test restore or sync into a fresh database.

Security boundaries are intentionally visible. MCP tool scoping limits available operations. Actions validate parameters and preconditions. Hook substitution is shell-quoted, but hook configuration remains executable operator-controlled code and should be reviewed accordingly. The read-only server should remain bound to localhost unless placed behind an appropriate access layer.

Performance is designed for local SQLite scale. Indexes support direct entity, verb, object, attribute, confidence, context, tag, and full-text access. Transitive graph queries and large alias closures can become the limiting factor before ordinary claim reads. Measure on representative stores before adding distributed infrastructure.


= Draft and Deliberately Unfinished Areas
The specification marks sections as normative, legacy, draft, or non-normative. Implemented rule syntax and temporal trajectories have graduated from the draft unified grammar. General reification, variables in ordinary stored claim lines, and arbitrary temporal functions remain draft.

```cave
[server CAUSE crash] WHEN load EXCEEDS 1000 req/s   ; draft reification
revenue IS (t -> 20B * 1.25^(t - 2025)) USD/yr ; draft function
```

The unified-grammar idea is that facts, queries, and rules share one triple structure and differ primarily by binding state: all slots bound is a fact, some variables is a query, and variables plus => form a rule. Features graduate only after parser and evaluator implementations prove the semantics.

Open design items and suspected bugs are tracked in TODO.md and BUGS.md. The project treats incompleteness as explicit data rather than filling gaps with unimplemented promises.


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
  [cave query],
  [Run CAVE-Q with filters, aliases, resolve, as-of, and valid time.],
  [cave check],
  [Knowledge health and shape coverage.],
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
)

Run pnpm exec cave help for the exact versioned option set. Package READMEs contain surface-specific examples, while the four specification skills preserve normative section numbering.


= Compact Reference
```cave
subject VERB [NOT] object [@context...] [#tag[:value]...] [@ N%] [!] [; comment]
subject HAS attribute: value [+/- delta [(N sigma)]] [@context...] [#tag...] [@ N%]

VERB REVERSE INVERSE-VERB

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
