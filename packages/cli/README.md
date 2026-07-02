# @cave/cli

The `cave` command — the whole stack behind one binary. Runs directly from
TypeScript sources via Node's type stripping; no build step.

```
$ echo 'auth USES jwt @ 90%' | pnpm exec cave parse
ok: 1 claim

$ pnpm exec cave add notes.cave --db knowledge.db
added 12 claim(s), 3 edge(s)

$ pnpm exec cave query '?x USES jwt' --db knowledge.db
?x = auth/middleware
?x = api/gateway

$ pnpm exec cave query '?cause CAUSE app/crash' 'WHERE conf >= 0.7' --db knowledge.db
$ pnpm exec cave export --db knowledge.db --current
$ pnpm exec cave demo
```

## Commands

| Command | Flags | Behavior |
|---|---|---|
| `parse [file]` | `--json` | Lint (stdin by default). Exit 1 when diagnostics exist; `--json` dumps the AST document. |
| `add [file…] --db p` | `--strict`, `--no-prelude` | Ingest. Lenient by default (problems on stderr, valid lines land); `--strict` rolls back on any problem; `--no-prelude` starts from an empty registry instead of the standard §5.5 pairs. |
| `query <pattern…> --db p` | `--json`, `--all` | CAVE-Q. Extra positionals join as lines, so `WHERE` filters ride as separate arguments. Bindings print as `?x = value`; fully bound patterns print matched raw lines. |
| `export --db p` | `--current` | Canonical CAVE text — all rows in tx order, or current beliefs only. |
| `demo` | | The cave-loop multi-hop recovery demo (§18). |

Everything is testable without spawning: each command is a pure function
`(argv) → { code, out, err }` (`@cave/cli` exports them), and `main.ts` is
a four-line dispatcher. Tests cover both layers.
