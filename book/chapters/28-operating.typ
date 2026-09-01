#import "../style.typ": note, file, recap

= Running a Store for Real

The earlier chapters explain what each surface does. This one is advice:
habits that keep a store trustworthy over months, the security boundaries
to know about, what to expect from performance, and the command that checks
an installation.

== Habits

- *Keep canonical text under version control and treat SQLite as a working
  index.* The annotated export is a complete replica; a store can be
  rebuilt from it on any machine (Chapter 24).
- *Declare domain verbs and their inverses in a small prelude* that every
  file starts from, and keep extensions rare.
- *Use source contexts consistently*, so that resolution policy can tell
  actors apart and reports can cite them.
- *Prefer actions over free-form appends for consequential writes*, from
  people and agents alike.
- *Run `cave check` in continuous integration*, and `cave eval` whenever an
  extraction prompt, model, or instruction set changes.
- *Use `--resolve` only where a single winner is required*; keep default
  reads plural.
- *Use `--as-of` and `--at` explicitly in any report that depends on time*,
  so re-rendering it later gives the same answer.
- *Keep hooks and agent commands out of the store.* Claims may name them;
  they never contain executable configuration.
- *Take exact snapshots with `cave backup`*, record their hash, verify them
  independently, and periodically test `cave restore` into a fresh path.
- *Decide what not to record.* History is permanent; secrets and
  selectively erasable data stay out (Chapter 8).

== Security boundaries

The boundaries are intentionally visible rather than implicit. The MCP
server separates read, ephemeral evaluation, durable recording, and
effect-capable action classes, and exact tool allowlists narrow further.
Actions validate parameters and preconditions, and run inside the shape
gate. Hook substitution is shell-quoted, but hook configuration is
executable operator-controlled code and deserves review like any script.
The read-only server should stay bound to localhost unless placed behind
your own access layer; its sensitivity ceiling limits publication but is
not authentication or encryption. Sensitivity labels are routing metadata,
and a lower ceiling is a view, never a sanitizer.

== Performance

Everything is designed for local SQLite scale: one file, one machine,
indexes on every field a pattern can touch, and full-text search for the
rest. Ordinary claim reads and appends are fast well past a hundred
thousand rows. The costs that grow faster are transitive queries over deep
graphs and large alias closures, which are recursive walks, and the health
check over a store with many expectations. Query pages are bounded at a
thousand matches so that an agent cannot ask for the whole store in one
call. Measure on a representative store before reaching for distributed
infrastructure; the repository keeps a deterministic performance benchmark
with recorded budgets for exactly this reason.

== Checking an installation

`cave doctor` is a read-only diagnostic for the runtime, the installed
package layout, optional configuration, and a store's health. Its output
never includes paths, hook contents, URLs, or environment values, so it is
safe to paste into an issue:

```sh
$ cave add --db roastery.db roastery.cave
added 33 claim(s), 0 edge(s)

$ cave doctor --db roastery.db
cave doctor <any>
PASS Node <any>
PASS SQLite <any>
PASS Grammar WASM and highlight query are installed
PASS pnpm is not required for this installed CLI
PASS CAVE schema 1 is compatible (33 claim(s))
PASS SQLite integrity and foreign-key checks passed
PASS No optional hooks file was configured
result: ready
```

Warnings such as a database that does not exist yet exit 0; an unsupported
runtime, a broken grammar asset, a malformed hooks file, or a corrupt store
exit 1. `--hooks <file>` validates a hook configuration without running it,
and `--json` emits a versioned report.

== Signals, exit codes, and errors

Every command exits 0 on success and 1 on a user-level problem, with the
problem on standard error in one line; a command-line usage error, such as
an unknown command or an unknown option, exits 2, and an unknown command
also prints the usage text. Commands that report violations or
step failures, such as `cave check`, `cave eval --min`, `cave report`, and
`cave automate --once`, use the exit code to carry that result so they
compose with shell pipelines and CI. Interrupting a long-running command
with `SIGINT` or `SIGTERM` closes servers, watchers, and stores before the
process exits with the conventional signal code. `CAVE_DEBUG=1` adds the
stack trace to unexpected errors. For commands that open a store, `--db`
defaults to `$CAVE_DB`, then to `cave.db` in the current directory, except
`cave restore`, which always requires an explicit destination; `$CAVE_HOOKS`
supplies a default hook configuration.

#recap[Commit the annotated export, keep a prelude, stamp sources, prefer
actions, gate with `cave check` and `cave eval`, resolve only on purpose,
anchor reports in time, keep executable configuration out of the store, and
back up with verified snapshots. `cave doctor` checks an installation
without exposing anything private.]
