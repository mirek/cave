# @cave/query

CAVE-Q — the graph-pattern query layer (spec §12), compiled to SQL over an
open `@cave/store`.

```ts
import { open } from '@cave/store'
import { query } from '@cave/query'

const store = open('knowledge.db')
query(store, '?x USES jwt')
// → [{ bindings: { x: 'auth/middleware' }, row: { … } }, …]

query(store, `?cause CAUSE app/crash
  WHERE conf >= 0.7`)

query(store, '?x PART-OF monorepo')     // inverse verb → same physical query
query(store, 'terrier EXTENDS+ animal') // transitive
```

## Pattern language (§12.1)

- `?name` variables bind subject, verb, object or attribute value;
  a variable repeated in two positions forces equality (`?x NEEDS ?x`).
- `_` is a wildcard.
- `attr: ?v` matches attribute claims.
- `@ctx` and `#tag[:value]` on the pattern line filter contexts/tags
  (flat `#tag` matches flat tags only, mirroring `store.byTag`).
- `VERB NOT` matches negated claims; patterns without `NOT` match
  positive ones — direction is always explicit.
- **Inverse verbs** are valid: `?x PART-OF monorepo` compiles to
  `verb = 'CONTAINS' AND subject = 'monorepo'` with `?x` binding on the
  object side — the same physical query as the forward pattern.
- `VERB+` is transitive (one or more hops), compiled to a recursive CTE
  over current, positive, non-retracted edges, depth-capped at 32.
  Transitive works through inverses too (`packages/api PART-OF+ ?c` walks
  `CONTAINS` upward from the object side).

## Filters (§12.2)

```
WHERE conf >= 0.8        (also accepts 80%)
WHERE tag = security     (bare key matches any value; topic:auth is exact)
WHERE context = production
WHERE value > 1000 req/s (numeric column; unit equality when given)
WHERE tx > 2026-01-01    (dates are whole-day UTC intervals)
```

`tx` filters compile a date to the interval `[day-start, next-day-start)`
in UUIDv7 space: `=` means "recorded that day", `<=` includes the boundary
day that `<` excludes, and `>` starts the day after. A timestamp value
covers one second.

## Semantics

- Queries run over **current beliefs** (latest tx per claim key, §9.1) by
  default, and skip retracted (`@ 0%`) ones — a retracted claim has no
  current support (§9.3), and `VERB` must agree with `VERB+` on a one-hop
  path. An explicit `WHERE conf …` filter or `{ all: true }` opts back in.
- Object-position variables bind relational rows only (`object IS NOT
  NULL`) — `?x ?verb ?y` enumerates the relation graph, not attributes. A
  *bound* date/number object additionally matches metric rows
  (`latency IS 30ms` the pattern finds `latency IS 30ms` the claim).
- A repeated variable forces equality in transitive patterns too:
  `?x EXTENDS+ ?x` finds nodes on cycles, not every reachable pair.
- Transitive patterns support endpoint slots only; tag/context/WHERE
  filters on them are rejected rather than silently ignored.

## Tests

```
pnpm --filter @cave/query test
```

Every §12.1 example pattern and every §12.2 filter runs against a live
in-memory store, including inverse and transitive-inverse cases,
current-vs-history semantics and negated patterns.
