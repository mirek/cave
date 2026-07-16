# CAVE package surfaces

CAVE keeps small package boundaries inside the monorepo for ownership,
project references, and focused tests. Those boundaries no longer imply one
npm artifact each. [`package-surfaces.json`](package-surfaces.json) is the
enforced classification and records an independent consumer plus stability
promise for every published package.

## Published packages

The public knowledge-kernel libraries are `@cavelang/core`,
`@cavelang/parser`, `@cavelang/canonical`, `@cavelang/store`,
`@cavelang/query`, and `@cavelang/fusion`. Formal reasoning remains optional
through `@cavelang/solver`, `@cavelang/solver-z3`, and
`@cavelang/scenario`. Public tooling consists of `@cavelang/cli`,
`@cavelang/tree-sitter-cave`, and `@cavelang/highlight`.

The release and smoke-test paths derive publication from each manifest's
`private` flag. Internal modules remain ordinary pnpm workspace packages, but
are bundled into `@cavelang/cli` and covered by that package's semantic
version. This reduces the independently released npm surface from 23 packages
to 12 without collapsing source ownership or TypeScript project boundaries.

## Migration from 0.28 package names

Commands do not change: install `@cavelang/cli` and continue to run `cave`.
Programmatic consumers of implementation packages should change only the
module specifier:

| Before | From the consolidated release onward |
|---|---|
| `@cavelang/act` | `@cavelang/cli/act` |
| `@cavelang/automate` | `@cavelang/cli/automate` |
| `@cavelang/connect` | `@cavelang/cli/connect` |
| `@cavelang/eval` | `@cavelang/cli/eval` |
| `@cavelang/ingest` | `@cavelang/cli/ingest` |
| `@cavelang/loop` | `@cavelang/cli/loop` |
| `@cavelang/mcp` | `@cavelang/cli/mcp` |
| `@cavelang/rules` | `@cavelang/cli/rules` |
| `@cavelang/shape` | `@cavelang/cli/shape` |
| `@cavelang/sync` | `@cavelang/cli/sync` |
| `@cavelang/view` | `@cavelang/cli/view` |

For example:

```ts
// before
import { declareRules, derive } from '@cavelang/rules'

// after
import { declareRules, derive } from '@cavelang/cli/rules'
```

The old 0.28 tarballs remain usable at their existing versions, but the names
above receive no new independent releases. Deep imports were never public and
have no compatibility alias. Workspace contributors continue to import the
internal package names; the replacement table applies to installed npm
artifacts.
