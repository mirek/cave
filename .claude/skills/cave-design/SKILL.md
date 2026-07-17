---
name: cave-design
description: CAVE background and rationale (spec §0–§2, §10, §17–§19) — status conventions, design goals, the claim model and language layers, the probabilistic implementation layer (Bayesian fusion, noisy-AND, competing hypotheses), the Draft unified grammar (variables, reification, rules, temporal values), the agent layer (cave-loop), and rejected alternatives. Use when asking why CAVE is shaped the way it is, evolving the spec, or exploring the Draft layer.
---

# CAVE — Model, Rationale, Draft Layer

Part of the CAVE specification. Sections keep their spec numbers. The language reference lives in the `cave-writing` skill (§3–§8, §11, §16, §22); extraction in `cave-extraction` (§14–§15, §21); persistence/query/storage in `cave-storage-query` (§9, §12–§13).

## 0. How to Read the Specification

Every section carries one of four statuses:

| Status | Meaning |
|---|---|
| **Normative** | The committed language. Parsers MUST accept it; emitters MUST produce it. |
| **Legacy** | Superseded early forms. Parsers SHOULD accept them; emitters MUST NOT produce them. |
| **Draft** | Exploratory unified-grammar history. Rules and temporal trajectories graduated; ordinary-claim variables, reification, and temporal functions are not planned core features. |
| **Non-normative** | System context, rationale, rejected alternatives. Informs but does not constrain implementations. |

Unless marked otherwise, a section is **Normative**.

Keyword usage follows the usual convention: MUST / SHOULD / MAY.

---

## 1. Design Goals

CAVE is:

1. **Caveman-simple.** Short, direct, low ceremony. "Thing does thing to thing."
2. **Atomic.** One claim per line. Complex knowledge decomposes into small claims.
3. **Composable.** Claims qualify other claims; claims can be linked, grouped, updated, contradicted, or superseded.
4. **Queryable.** Every claim has a stable structure: subject, verb, object or attribute/value, negation, confidence, contexts, tags, transaction time.
5. **Persistent.** Append-only by default. New evidence creates new claims or new versions of old claims. History is preserved.
6. **LLM-friendly.** Robust under extraction from messy text; tolerates partial confidence, estimates, uncertainty, and comments.

A hard constraint across all versions: **no new core syntax unless the semantics strictly require it.** Where a feature can be built from the bootstrap verbs and existing conventions, it MUST be.

---

## 2. The Model

### 2.1 Claims

Every CAVE line denotes a **claim**:

```text
claim = ⟨ subject, verb, object-or-attribute/value, negated, metadata ⟩
```

Formally, c = ⟨s, v, o, n, m⟩ where m carries confidence, contexts, tags, value uncertainty, importance, comment, and transaction identity.

Claims are **immutable**. Belief changes by appending, never by mutating (§9).

### 2.2 Language layers

| Layer | Purpose | Example |
|---|---|---|
| **CAVE-Lite** | Bare triples | `auth USES jwt` |
| **CAVE-Core** | Triples plus metadata | `auth USES jwt @production #security @ 90%` |
| **CAVE-Full** | Qualified claims, uncertainty, continuation, versioning | indented `WHEN`, `+/-`, transactions, inverse reads |

The minimum valid line is `entity VERB object`.

### 2.3 One fact, possibly two names

A central structural feature: a relation may declare an **inverse name** (§5.5). A stored fact then has one canonical row but is readable — and writable — under either name. Forward and inverse readings share one claim key, one belief series, one row. Inverses are query-time views, never materialized (§13.3).

---

## 10. Probabilistic Layer

The math below is an **implementation layer**, not required syntax. CAVE itself only stores claims and metadata.

### 10.1 Bayesian fusion of numeric estimates

Given two estimates of the same quantity:

```cave
revenue IS 18B USD/yr +/- 3B USD/yr @ 60% @src:analyst
revenue IS 20B USD/yr +/- 0.5B USD/yr @ 95% @src:filing
```

For normally distributed estimates with `+/- Δ` at kσ: σ = Δ/k, precision = 1/σ², confidence acts as a weight multiplier.

- Weighted precision: wᵢ = pᵢ / σᵢ²
- Posterior mean: μ = Σ wᵢxᵢ / Σ wᵢ
- Posterior σ: 1 / √(Σ wᵢ)

Worked: A gives σ=1.5B, w=0.444×0.60=0.267; B gives σ=0.25B, w=16.0×0.95=15.2. Posterior μ ≈ 19.97B, σ ≈ 0.25B. The filing dominates — more precise and higher confidence.

The engine serves this computation by name: the MCP `cave_fuse` tool fuses estimates selected by CAVE-Q pattern, by entity (`about` — the reach into metric `IS` series, whose values CAVE-Q variables never bind), or from literal CAVE lines, so agents delegate the arithmetic instead of doing it in tokens. Fused estimates must agree on one quantity — one claim key modulo `@src:` contexts (§26.1's group identity, widened through the §13.6 alias closure on request) — and one unit; selections that span quantities or mix units fail loudly.

### 10.2 Conditional confidence (noisy-AND)

```cave
server CAUSE crash @ 80%
  WHEN memory-leak EXISTS @ 60%
```

Treating conditions as independent: p_effective = p_claim × p_condition = 0.8 × 0.6 = 0.48.

The independence assumption MUST be explicit in the query engine — never silently assumed for all domains.

### 10.3 Competing hypotheses

Prefer **distinct cause entities**, so hypotheses don't collide on one claim key:

```cave
memory-leak CAUSE app/crash @ 50%
deadlock CAUSE app/crash @ 30%
oom-killer CAUSE app/crash @ 20%
```

Confidences of an exhaustive hypothesis set should sum to ~100%. When evidence arrives, redistribute by appending:

```cave
memory-leak EXISTS @ 95% ; heap dump confirms leak

memory-leak CAUSE app/crash @ 75% ; was 50%
deadlock CAUSE app/crash @ 15% ; was 30%
oom-killer CAUSE app/crash @ 10% ; was 20%
```

If subject/object genuinely coincide, differentiate by context — never by bare repetition:

```cave
app CAUSE crash @hyp:memory-leak @ 50%
app CAUSE crash @hyp:deadlock @ 30%
```

---

## 17. Draft Layer — Unified Grammar (Variables, Reification, Rules, Temporal)

**Status: historical Draft, except §17.4 and the §17.5 layer-2 subset.** The **rules subset (§17.4) graduated in 0.12.0**: `@cavelang/rules` parses and fires `premises => conclusion` lines, with the committed semantics (in-band storage, `BECAUSE`/`VIA` lineage, noisy-AND confidence, watermark incrementality, well-founded support) normative as spec §24 (`cave-storage-query` skill). **Temporal layer 2 (§17.5) graduated in 0.24.0**: trajectory values and time-range contexts with interpolation in query, normative as spec §32. The remaining notation is retained to explain the design exploration, not as planned syntax: ordinary stored claims stay fully bound, qualifier and provenance structures replace reified claim values, and executable temporal functions stay in bounded external evaluators. `PROJECT-BOUNDARIES.md` records the alternatives and evidence required for any new proposal. Nothing here invalidates a normative line above.

### 17.1 The binding-state insight

The unifying principle: **facts, queries, and rules are the same triple structure**, distinguished only by whether slots are bound or contain variables.

| Binding state | Reading |
|---|---|
| all slots bound | fact |
| some slots are variables | query |
| variables + `=>` | rule |

One grammar covers storage, querying, and inference. (Same shape as Gherkin's given/when/then and LLM inference's context/query/result.)

### 17.2 Variables — `?x`

`?` alone is anonymous; `?x` is named and binds across a rule:

```cave
?x USES jwt
? CAUSE performance-regression @production      ; open query
```

This notation is committed only inside contexts that own a binding scope:
CAVE-Q patterns (§12), rule premises/conclusions (§24), and connector mapping
templates (§23). The ordinary claim grammar does not store a partially bound
claim; keeping rows fully bound avoids inventing persistence, equality, and
compatibility semantics for unresolved slots.

### 17.3 Reification — `[S V O]`

The draft explored making a triple into a term:

```cave
[server CAUSE crash] WHEN load EXCEEDS 1000 req/s
[auth/token IS jwt] ENABLES [api YIELDS 200]
```

Brackets nest, but rarely beyond depth 2 in practice. In this layer, **indentation is reification sugar**: a child line under parent T desugars to use `[T]` as its subject —

```cave
server CAUSE crash                 ; ≡  [server CAUSE crash] WHEN load > 1000 req/s
  WHEN load > 1000 req/s           ;    [server CAUSE crash] WHEN NOT cache/enabled
  WHEN NOT cache/enabled
```

— which keeps the grammar context-free while preserving readable nesting, and gives the normative `cave_edge` qualifier semantics (§8.2) a precise algebraic reading. Reconciliation note: continuation lines (§8.3) are **not** reification — they desugar to sibling claims with inherited endpoints. The three-kind indentation taxonomy of §8 carries over unchanged.

This algebraic reading does not define executable core syntax. Implemented
indentation persists explicit `cave_edge` rows; row IDs, claim keys, source
provenance, and typed scenario artifacts provide non-recursive ways to address
records and their relationships. General `[S V O]` terms would require a second
identity/equality system without a demonstrated workflow that those structures
cannot express.

### 17.4 Rules — `=>`

**Committed as spec §24** (the `cave-storage-query` skill) and implemented by `@cavelang/rules` / `cave derive`; the text below is the original design sketch.

Left side: comma-separated conjunction of patterns. Right side: the asserted triple. Rules are just triples with variables — same file, same graph, no separate parser path. `=>` is the only rule-specific token.

```cave
; Transitivity
?x NEEDS ?y, ?y NEEDS ?z => ?x NEEDS ?z

; Constraints in premises — rules can test values, not just match patterns
?x HAS age: ?a, ?a < 18 => ?x NEEDS guardian

; Conditional generation
?svc HAS errors: ?e, ?e > 100, ?svc HAS no-owner => ?svc NEEDS oncall-review !
```

### 17.5 Temporal values — three layers

**Layers 1–2 committed as spec §32** (the `cave-storage-query` skill) and implemented by `@cavelang/core`/`query` / `cave query --at` in 0.24.0. Layer 3 remains a design sketch, not planned executable data syntax.

Progressive complexity; most claims never leave Layer 1.

| Layer | Syntax | Use |
|---|---|---|
| 1 | `revenue IS 20B USD/yr @2025` | point observation (existing CAVE, no change) |
| 2 | `revenue IS 20B -> 40B USD/yr @2025..2028` | trajectory; linear interpolation between endpoints |
| 3 | `revenue IS (t -> 20B * 1.25^(t - 2025)) USD/yr` | historical function sketch; not core syntax |

Layer 3 examples:

```cave
users IS (t -> Logistic(900M, 1.2B, 0.3, 2026)) users/wk
cost IS (t -> Step(10B @..2025, 14B @2025..2026, 18B @2026..))
```

Layer 2 covers the ordinary "it was X, it'll be Y" case. Step behavior is
expressible as tiled scalar ranges. Nonlinear or domain-specific models belong
in a bounded external evaluator or solver input with explicit versions,
resource limits, evidence, and recorded outputs; CAVE does not execute a lambda
stored as knowledge. Time ranges use `..`: `@2025..2028`, open-ended
`@..2025`, `@2026..`.

### 17.6 Iterative coverage

The payoff of unification: start with a query (triple with holes), add facts, rules fire, watch coverage converge.

```cave
; Query
? CAUSE performance-regression

; Observations
deploy/v2.3 PRECEDES regression @2026-04-10
deploy/v2.3 CONTAINS db/index-removal

; Rule fires
?x PRECEDES ?event, ?x CONTAINS ?change => ?change CAUSE ?event @ 50%

; Generated claim
db/index-removal CAUSE performance-regression @ 50%

; Confirming evidence, then confidence update
db/query-time IS 5ms -> 800ms @2026-04-10..04-11
  WHEN db/index-removal
db/index-removal CAUSE performance-regression @ 85%
```

Coverage is measurable: what fraction of `?` variables have bindings, at what aggregate confidence? Low-confidence claims and unbound variables *are* the frontier — the graph tells you what's missing.

### 17.7 Draft grammar sketch (PEG excerpts)

```peg
Arg         <- Expr TimeAnno?
TimeAnno    <- "@" TimeRange
TimeRange   <- TimePoint? ".." TimePoint? / TimePoint
TimePoint   <- [0-9][0-9-]*                    # 2025, 2026-Q1, 2026-04-16

Qualifier   <- ValueDelta / Confidence / Tag / Context / Bang / Comment
ValueDelta  <- "+/-" Quantity Sigma?
Sigma       <- "(" [0-9]+ "σ" ")"
Confidence  <- "@" " "+ Number "%"             # SPACED: @ 70%
Context     <- "@" [a-zA-Z0-9._:-]+            # UNSPACED: @production
Tag         <- "#" Identifier (":" Identifier)?
Bang        <- "!"
Comment     <- ";" (!NL .)*

Identifier  <- [a-zA-Z_][a-zA-Z0-9_-]*
```

**Known hard part:** the expression sub-grammar inside `(t -> ...)`. Everything else parses by trivial recursive descent; `Expr` needs real operator precedence, named functions (`Logistic`, `Step`, `Exp`), comparisons, and time-annotated arguments. If a corner must be cut, cut elsewhere — keep this precise.

---

## 18. System Context — Agent Layer (Non-normative)

**The agent layer is deliberately outside the language specification.** Active reconstruction is a *policy* over the graph; keeping CAVE a clean substrate means the policy can evolve or be swapped without spec churn.

**`cave-loop`** (TypeScript, strict mode) implements Ji et al.'s Algorithm 1 as a functional reconstruction loop:

- Injectable `CaveStore` and `Policy` interfaces (plus the `AsyncPolicy` twin, run by the async loop)
- In-memory store with inverse-aware reverse traversal (built directly on §5.5 / §13.3), and a SQLite adapter over the §13 store — the same contract behind the MCP `cave_reconstruct` tool and the CLI `cave reconstruct` command
- A deterministic heuristic policy for dependency-free testing — and the eval baseline every learned policy is measured against
- The LLM-driven policy (spec §18): per step, the model reads the query, the collected claims as canonical CAVE text and the scored frontier, and replies with the cue to expand or `STOP` — one completion per step (stop rides on select; budgets stay local), scoring stays the local heuristic arithmetic, and unparseable replies degrade to the strongest cue rather than ending the reconstruction. The model itself stays out-of-band (§19.5): a shell-agent command template (the `--agent` contract shared with `cave ingest`/`cave eval`) adapts any headless agent, and no LLM SDK enters the package
- A runnable demo exercising the multi-hop recovery pattern central to the paper's thesis

The store contract the language guarantees the agent: forward reads via the subject index, named inverse reads via the object index plus `inverse_of()`, current-belief resolution via claim keys, and topic expansion via `CONTAINS` in both directions.

Policies are falsifiable through the evals harness: a reconstruction fixture (`<stem>.loop.cave` — seeds, optional query, budgets, all ordinary CAVE lines about the entity `loop`) scores what a policy collects against a golden by claim key; `cave eval` without an agent runs the heuristic baseline, with `--agent` the LLM policy — same budgets, same scoring, comparable like for like.

---

## 19. Design Rationale and Rejected Alternatives (Non-normative)

### 19.1 Colon-in-verb notation — rejected

`HAS:TOPIC`-style verbs are off-limits. The `:` character already carries exactly one payload meaning (attribute/value split) — a deliberate disambiguation. Putting `:` inside verbs reintroduces the problem. Facets belong in the two lanes of §11.1.

### 19.2 Materialized inverse rows — rejected

Same-key over linked-keys: "one fact, two names" keeps belief evolution coherent — an update through either name updates one series. Linked distinct keys would let the two directions drift in confidence, incoherent for what is physically one edge. And materialization would double rows, fork belief series, and double contradiction-resolution work. Inverses are lazy views, always.

### 19.3 Explicit episodic/semantic layering — rejected

The distinction is real but already expressible: `@time:` / `@src:` contexts anchor episodes; their absence marks semantic knowledge. An explicit layer would add machinery without adding expressiveness.

### 19.4 Single classification mechanism — rejected

Entity facets and claim facets answer different questions with different lifetimes. Collapsing them forces either spurious history onto claim tags or history loss for entity memberships. Hence two lanes, kept distinct on purpose.

### 19.5 Standing principles

- New syntax only when semantics strictly demand it; build on the bootstrap otherwise (`REVERSE`, extension verbs, topics all follow this).
- Specifications evolve as strict additive deltas — no wholesale rewrites; no existing line becomes invalid.
- Prefer conventions (topic entities, context prefixes) over grammar.
- The agent stays out of the language.
