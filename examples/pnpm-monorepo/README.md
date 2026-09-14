# Ingest a pnpm monorepo through ASTs

This fixture contains a workspace root, `@demo/app` and `@demo/lib`. The app
imports the library and a local source file, then re-exports a library symbol.
The manifests cover dependencies, devDependencies, peerDependencies and
optionalDependencies; exported functions/types carry JSDoc.

## Prepare the runtime

Cave's AST integration uses `mirek/ast` as separately supplied, trusted local
code. Its npm packages are currently private. From the Cave checkout, build
the tested upstream revision (includes the module inventory in AST PR #30):

```sh
git clone https://github.com/mirek/ast.git .tmp/ast
git -C .tmp/ast checkout bbc7cd846a16e4d7803c11cb9e026935a2546c29
pnpm --dir .tmp/ast install --frozen-lockfile
pnpm --dir .tmp/ast --filter @mirek/ast build
```

If the runtime is already built in a sibling checkout, use
`../ast/packages/core/dist/index.js` instead. `--runtime` resolves relative to
the invocation directory. Without that option, Cave looks for the installed
`@mirek/ast` package in the workspace being ingested. No AST source is vendored
into Cave, and this command does not install the target workspace dependencies.

## Extract and query

Run these from the Cave repository root after its normal development install:

```sh
pnpm exec cave ast examples/pnpm-monorepo --name demo \
  --runtime .tmp/ast/packages/core/dist/index.js --db .tmp/demo.db
pnpm exec cave query --db .tmp/demo.db '?package IS workspace-package'
pnpm exec cave query --db .tmp/demo.db '?dependency HAS category: ?category'
pnpm exec cave query --db .tmp/demo.db '?dependency HAS range: ?range'
pnpm exec cave query --db .tmp/demo.db '?file IMPORTS ?target'
pnpm exec cave query --db .tmp/demo.db '?file EXPORTS ?symbol'
pnpm exec cave search --db .tmp/demo.db 'friendly greeting'
```

The fixture produces 19 records: three packages, four dependency declarations,
three source files, three import/re-export occurrences, five exported symbols,
and the workspace itself. Imports include both the app's import and its
re-export of the library. JSDoc is the `EXPORTS` claim's comment: multiline
text, code quotes and tags survive, appear beside query results, and are
searchable. Type-only exports have `HAS type-only: true`.

Useful narrower queries:

```sh
pnpm exec cave query --db .tmp/demo.db '?file IMPORTS+ repo/demo/file/packages/lib/src/index.ts'
pnpm exec cave query --db .tmp/demo.db 'repo/demo/file/packages/app/src/index.ts EXPORTS ?symbol'
pnpm exec cave query --db .tmp/demo.db '?symbol HAS declaration-source: ?source'
pnpm exec cave query --db .tmp/demo.db '?dependency HAS range: "workspace:*"'
```

Run the same extraction again: unchanged records append no history. On a
successful refresh, removed files, dependencies, imports and exports are
retracted only within this inventory's ownership. A syntax error or failed
source read aborts the whole refresh; it cannot prune earlier knowledge.
`--dry-run` exports a complete in-memory preview, including provenance and
connector bookkeeping, without opening `--db`. `--json` emits the refresh
report and adapter diagnostics; it cannot be combined with `--dry-run`.

## Ingest Cave itself

```sh
pnpm exec cave ast . --name cave --runtime .tmp/ast/packages/core/dist/index.js \
  --db .tmp/cave-repository.db --exclude '**/test/**' --exclude '**/bench/**'
pnpm exec cave query --db .tmp/cave-repository.db '?package IS workspace-package'
pnpm exec cave query --db .tmp/cave-repository.db '?file IMPORTS repo/cave/file/packages/connect/src/ast.ts'
pnpm exec cave query --db .tmp/cave-repository.db 'repo/cave/file/packages/core/src/claim.ts EXPORTS ?symbol'
```

`pnpm list --recursive --depth -1 --json` determines membership. A root with a package manifest is also a package;
a manifestless root remains the workspace entity. Manifest values come from AST JSON traversal. Source ownership is the
nearest containing workspace package, or the workspace itself when no package
contains the file. AST walks TypeScript/JavaScript sources,
excluding node_modules, .git, .tmp, dist, build and coverage. Repeat `--exclude`
for additional globs; this does not change pnpm package membership.

The nearest ancestor `tsconfig.json` supplies compiler options and resolution.
AST does not load project references transitively, and files outside the
selected project remain syntax-only. Warnings are printed; each file records
its analysis mode. Imports with no compiler-resolved file retain their original
specifier, and bare package imports still relate to their package. A compiler-resolved
local alias relates to the target workspace package; Node built-ins and local aliases
do not create npm package targets. Dynamic
imports and CommonJS require calls are outside the static inventory. This is
source analysis, not a build or a type-check.

## Identity and provenance

`--name demo` gives entities the `repo/demo/` namespace. Package identities use
package names, file identities use root-relative paths, and export identities
use the exporting file plus its public name. Import occurrence identities use
kind, specifier and duplicate occurrence number; they do not use byte offsets.
Connector keys are SHA-256 digests so punctuation cannot collapse distinct
identities. Internal dependency targets share workspace package identities;
other package names use `npm/`. Dependency ranges are retained as range text,
not replaced with installed versions or expanded catalog values.

By default the namespace includes the root's basename and path digest. Keep an
explicit name stable when moving a repository, and use different names for
independent inventories in one store. File revisions describe adapter-observed
snapshots. Import and dependency claims carry source line spans. Export claims
point to the exporting file; `declaration-source` identifies the declaration
and JSDoc origin, including for re-exports. File observation is not a global
filesystem snapshot, and no operation writes to source documents.

The generic API is `Ast.connect` from `@cavelang/cli/connect`; the workspace API
is `AstWorkspace.connect(store, options)`. Records are buffered before the
atomic store refresh. `--max-records` defaults to 100,000 and bounds emitted
records, not AST parser memory or bytes. Cancellation is cooperative.
