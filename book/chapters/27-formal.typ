#import "../style.typ": note, file, recap

= Formal Reasoning

CAVE-Q retrieves beliefs and rules derive claims, but neither searches a
space of possible assignments. The optional formal-reasoning layer handles
feasibility, optimization, counterexamples, and bounded sensitivity over
inputs taken from the store, without turning a hypothetical model into
durable knowledge. It is a library layer, not a CLI feature, and nothing
else in CAVE depends on it.

== Scenario inputs

`@cavelang/scenario` binds explicit CAVE-Q inputs against a frozen
transaction-time and valid-time snapshot. Its `asOf` boundary follows CAVE-Q:
UTC years, months, and days include their whole period, and a UUID includes
that exact append. Invalid dates are rejected. A definition names the queries,
the variable each one selects, the expected kind and unit, the cardinality,
and a policy for every awkward case: what to do when a value is missing,
contested, retracted, or unresolved. Nothing silently chooses the first
match. Unknown policy names are rejected before database access. A definition
may also overlay hypothetical CAVE claims, applied
inside a savepoint that is rolled back before any evaluator runs, so
"what if the team were twelve people" binds an exact integer while the
store still says eight. The returned record is plain immutable data that
remembers the supporting belief rows. If the store changes while those inputs
are being read, binding fails with `snapshot-changed`; retry before evaluating.
Backdated imports also invalidate the attempt. The evaluator never receives
a record assembled across different database states.

== Solver-neutral models

`@cavelang/solver` is a dependency-free TypeScript model for Boolean,
bounded-integer, exact-real, and finite-enum variables. It distinguishes
hard constraints, explicitly weighted soft constraints, and lexicographically
ordered objectives. Exact reals are decimal strings or rationals normalized
with big integers; no decimal is routed through floating point. CAVE
confidence never becomes an optimization weight implicitly: confidence,
probability, cost, and preference remain different concepts.
Division always returns an exact real, including for integer operands, so
capability checks require rational support before calling the backend.

The workflow API gives feasibility, optimization, counterexample, and
bounded sensitivity distinct semantics over one validated model, one
snapshot context, one set of resource limits, and one result vocabulary.
Results are disjoint: *satisfied* and *optimal* carry assignments,
*unsatisfied* requires a proof of infeasibility, and a timeout or backend
failure remains *unknown*. Assignments are deterministic, ordered by stable
variable id with false before true, smaller numbers first, and enum values
in lexical order; authored objectives come first, soft weights next, and
generated tie-breaks last. Sensitivity checks an explicit typed sample list
and reports adjacent transitions and contiguous unknown regions rather than
interpolating through timeouts.

== The Z3 adapter

`@cavelang/solver-z3` is the optional Node.js adapter to the official
threaded Z3 WebAssembly package. It loads lazily, queues checks through one
process runtime, tracks named hard constraints for unsatisfiable cores,
preserves exact rational arithmetic, applies bounded execution, and requires
explicit worker shutdown. Its separate `cave-solver-workflow` binary is an
allowlisted fixture that accepts bounded typed flags for one architecture
example and no raw model or SMT-LIB input:

// no-test
```sh
$ cave-solver-workflow architecture optimization --team-size 10 --deployment-frequency 6
$ cave-solver-workflow architecture sensitivity --team-size 10 --from 1 --to 12
```

The normal CAVE CLI, the MCP server, the browser playground, and the
knowledge kernel do not depend on Z3.

== Explanations and recording

Solver explanations map assignments, evaluated constraints, objective
contributions, and unsatisfiable cores back to model locations, scenario
inputs, and exact CAVE evidence rows. Counterexample reports also state the
assumptions, bounded domains, and theories in scope. Theories account for
expressions and literals as well as declared variable sorts. The model digest,
solver version, resource limits, and frozen snapshot travel with the report.

Solve calls copy and freeze the model before backend execution. Explanation
calls also copy their context and reject mismatched replay digests before
solving, preserving submitted identity and evidence across later caller edits.
Workflows capture options and context for the whole operation; sensitivity
also captures its request, keeping later samples independent of caller edits.
Unknown option or limit names, non-Boolean core flags, and invalid sensitivity
modes fail before solving.
Configured size limits also apply during hashing and replay checks; they do
not change model identity.
Linear-subset recognition excludes division by computed zero constants,
using exact rational arithmetic rather than floating-point approximations.

Rendering an explanation is read-only.
Constraint evaluation uses an explicit stack and preserves short-circuiting,
so deep valid expressions do not become indeterminate from call-stack exhaustion.
The `maxExplanationBits` limit conservatively bounds local fraction sizes before
allocation. Exceeding it makes the affected constraint indeterminate while
preserving the backend result; a larger budget permits retry. This per-operation
guard is complemented by `maxExplanationWork`, which accumulates estimated-bit
charges across local arithmetic in one report (default: 10,000,000). Exhaustion
marks affected evaluations indeterminate; a fresh report resets the allowance.
Neither guard is a wall-clock or process-memory limit, and preparation and
formatting remain outside the arithmetic counter.

The workflow CLI flags are `--max-explanation-bits` and `--max-explanation-work`.
Historical reports retain their
recorded limits without adding newer defaults during replay.
Scenario input records retain a digest of the complete binding definition.
Explanation conversion checks it together with the record's content digest,
so changed queries or policies cannot be attached to older evidence. Older
records without that definition digest must be rebound before this conversion.

Solver output is not a write. An explicit, atomic, idempotent record
transition can preserve an immutable run, but recommendations, human
decisions, action audit records, and external-effect audit records use
separate versioned identities. IDs must form exactly one namespaced entity;
syntax that changes its spelling or introduces another claim is rejected
without recording anything. Retracting a record makes it unavailable but does
not free its ID: only identical content can be explicitly restored, and changed
content requires a new ID. Artifact data must be ordinary JSON: sparse arrays,
cycles, and objects such as dates or maps are rejected before writing, rather
than silently losing their contents. Replay reports model or solver
incompatibility instead of silently re-evaluating. Passing proposed
parameters into an action still rechecks the current declaration,
parameters, premises, shape gate, and transaction boundary before the
governed write engine appends anything.

#note([What a solver proves], [A solver proves statements only inside the
selected model and snapshot. *Optimal* means optimal under the declared
inputs and objectives, not objectively best in the world. Encode one narrow
decision with measurable inputs and test it against known cases before
trusting the number.])

#recap[Scenario bindings turn CAVE-Q answers into typed, replayable inputs
with explicit policies for missing and contested values. The solver
package is an exact, backend-neutral model with disjoint result states;
Z3 is an opt-in adapter. Explanations trace back to evidence rows, and
recording a run is an explicit step separate from any decision.]
