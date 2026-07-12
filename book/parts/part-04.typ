= Deterministic Structured Ingestion
Structured records should not consume language-model tokens. cave connect maps CSV, TSV, JSON, JSONL, SQLite queries, or structured URLs through a CAVE template containing ?field variables.

```cave
; people.map.cave
WORKS-AT IS verb
WORKS-AT REVERSE EMPLOYS

?id IS person
?id HAS name: ?name
?id HAS age: ?age
?id WORKS-AT ?company
```

Blocks without variables form a prelude and append once per run. Blocks with variables instantiate per record. Missing or empty fields drop the affected line and its children. Substituted values are formatted deterministically as numbers, safe atoms, parseable values, or quoted literals.

Each record receives a stable connect identity and digest. Unchanged records skip. Changed records append new claims and retract prior record-owned claims no longer produced. --prune retracts records removed from the source. The lifecycle source stamp makes this ownership explicit.

--watch reruns when a file changes. --query temporarily overlays mapped claims inside a rolled-back transaction, allowing a CAVE-Q query across local and external data without persisting the external rows.


= Evaluation and Quality Control
Extraction quality must be measurable. cave eval runs fixture suites containing a source, expected golden claims, and optional CAVE-Q answers. It can repeat each case against any agent in fresh temporary stores.

Strict scoring compares claim keys, tolerates configured numeric value differences, and ignores actor stamps when appropriate. The report includes precision, recall, F1, misses, extras, and failed query bindings. An optional judge agent may pair semantically equivalent leftovers without replacing the strict score.

```cave
cave eval examples/eval \
  --agent 'claude -p --mcp-config {mcp-config}' \
  --runs 3 --min 90%
```

A minimum score turns the suite into a CI gate. This makes prompt, model, and instruction changes falsifiable instead of anecdotal. Reconstruction policies can be evaluated with the same framework by scoring the claims collected from a loop.


= Rules and Derivation
Rules conclude claims that nobody wrote directly. A rule is a comma-separated conjunction of CAVE-Q premises followed by one conclusion. The only rule-specific token is =>.

```cave
?a PARENT-OF ?b, ?b PARENT-OF ?c => ?a GRANDPARENT-OF ?c
?x HAS age: ?a, ?a < 18 => ?x NEEDS guardian
```

Premises evaluate left to right. They may be patterns or constraints. Variables in a constraint must already be bound. Every conclusion variable must be bound by a premise. Explicit NOT matches negated claims; CAVE does not use negation-as-failure.

Rules are stored in-band as claims under rule/<digest>. Derived rows receive a rule lifecycle source stamp, BECAUSE edges to exact premise rows, and a VIA edge to the rule declaration. Confidence composes from premise confidence and an optional rule factor using noisy-AND.

cave derive is incremental and idempotent. Watermarks avoid reevaluating unaffected rules. Re-running appends only changed conclusions. If support disappears, well-founded support tracking retracts conclusions that no longer have a valid derivation.


= Governed Actions
Rules fire autonomously. Actions let a caller execute a named write path with parameters and validated preconditions. The action body reuses rule syntax but treats bare variables on the left as caller-supplied parameters and permits multiple effects on the right.

```cave
action/mark-deployed HAS action: `?service, ?version,
  ?service IS service =>
  ?service HAS deployed-version: ?version`
```

Execution resolves the current action declaration, validates parameters, evaluates preconditions against current positive beliefs, requires deterministic bindings for effect variables, canonicalizes all effects, and appends them atomically. Effects are stamped @src:action/<name>, linked by BECAUSE and VIA edges, and deduplicated when already current.

Actions run inside the shape gate by default. A failed precondition or introduced violation produces no append. This is the preferred write vocabulary for agents because it replaces unconstrained freeform changes with named operations and explicit schemas.

An action may name an out-of-band hook. Hook commands remain in configuration, never in the store. They run after a successful commit, receive canonical claims on stdin, and cannot roll back recorded knowledge if the external side effect fails.


= Contradiction Resolution
Default reads preserve all coexisting claims. Resolution is an explicit read mode that chooses one stored winner for each contested fact without rewriting history.

Rows enter the same resolution group when they describe the same subject, verb, payload identity, and non-source contexts after removing source contexts and polarity. Source differences and positive versus negative answers therefore compete; production and staging facts do not.

#table(columns: 2, inset: 5pt, stroke: 0.4pt + luma(190),
  [*Priority*],
  [*Rule*],
  [1. Precedence class],
  [Higher source tier wins.],
  [2. Effective confidence],
  [Stored confidence multiplied by source reliability.],
  [3. Transaction],
  [Newest row breaks remaining ties.],
)

Source policy is ordinary knowledge. source/<path> HAS precedence and source/<path> HAS reliability claims use path-prefix matching, with the most specific current declaration applying. A human CLI correction can therefore outrank a newer machine ingest row, while recency still decides within one tier.

```cave
source/cli HAS precedence: 4
source/agent HAS precedence: 3
source HAS precedence: 2
source/rule HAS precedence: 1
source/ingest HAS reliability: 80%
```

cave resolve explains the ranking and cave query --resolve returns only winners. The original candidates remain available through normal queries and full history.
