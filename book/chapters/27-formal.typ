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
transaction-time and valid-time snapshot. A definition names the queries,
the variable each one selects, the expected kind and unit, the cardinality,
and a policy for every awkward case: what to do when a value is missing,
contested, retracted, or unresolved. Nothing silently chooses the first
match. A definition may also overlay hypothetical CAVE claims, applied
inside a savepoint that is rolled back before any evaluator runs, so
"what if the team were twelve people" binds an exact integer while the
store still says eight. The returned record is plain immutable data that
remembers the supporting belief rows.

== Solver-neutral models

`@cavelang/solver` is a dependency-free TypeScript model for Boolean,
bounded-integer, exact-real, and finite-enum variables. It distinguishes
hard constraints, explicitly weighted soft constraints, and lexicographically
ordered objectives. Exact reals are decimal strings or rationals normalized
with big integers; no decimal is routed through floating point. CAVE
confidence never becomes an optimization weight implicitly: confidence,
probability, cost, and preference remain different concepts.

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
assumptions, bounded domains, and theories in scope. The model digest,
solver version, resource limits, and frozen snapshot travel with the report.
Rendering an explanation is read-only.

Solver output is not a write. An explicit, atomic, idempotent record
transition can preserve an immutable run, but recommendations, human
decisions, action audit records, and external-effect audit records use
separate versioned identities. Replay reports model or solver
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
