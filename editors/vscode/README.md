# CAVE for VSCode

Language support for [CAVE](https://github.com/mirek/cave) (`.cave` files).

Highlighting is a semantic-tokens provider running the
`@cavelang/tree-sitter-cave` grammar (WASM, via web-tree-sitter) with the
grammar's own `queries/highlights.scm` — the exact query Neovim/Helix/Zed
and the `cave highlight` terminal command use. One grammar, every surface;
there is deliberately no TextMate grammar to drift out of sync. Explicit
`@claim` markers use keyword tokens; reserved and numeric-looking subjects retain
entity tokens,
and trailing `@claim` contexts retain context highlighting.

The extension owns one parser and compiled query for its activation lifetime.
Disposal unregisters the token provider and frees both native resources;
failed activation frees any resources already allocated. Each document tree
is freed after token generation, including when querying or building tokens fails.
Cleanup still attempts to free the query if parser disposal throws; subsequent
provider calls return no tokens without reading the document.
If activation or token generation and cleanup both fail, an `AggregateError`
retains the original error as its cause and first entry, followed by the cleanup
error. Multiple disposal failures are retained in provider, parser, then query
cleanup order. A single failure is propagated unchanged. Disposal is attempted
once per resource; a failed cleanup is not retried automatically.
Requests already cancelled by the editor return no tokens before reading or
parsing the document; later active requests use the same provider normally.
Parsing remains synchronous, so this entry check does not interrupt a parse
already in progress.

Also contributes `;` line comments, `"`/`` ` `` auto-closing pairs, and the
`cave` language id.

CAVE files default to two-space indentation with automatic indentation detection
disabled. Tab inserts spaces rather than introducing tab indentation that the
CAVE parser rejects. These are language-specific defaults; explicit `[cave]`
user or workspace settings can override them. Existing file contents are not
rewritten. See VS Code's [indentation settings](https://code.visualstudio.com/docs/editing/codebasics#_indentation)
for the editor controls.

## Build and install

The extension supports VS Code 1.100 and newer. Its `@types/vscode` dependency
is pinned exactly to 1.100.0 so typechecking uses the minimum supported editor's
API. A caret range can resolve newer declarations while leaving the declared
minimum unchanged; VSIX packaging alone does not detect that drift. Raise the
type pin and `engines.vscode` together when deliberately adopting a newer API,
and exercise the extension in the corresponding editor host.

```sh
pnpm install
pnpm package          # → cave-language-<version>.vsix
code --install-extension cave-language-*.vsix
```

For development, open `editors/vscode` itself as the VS Code workspace folder
after installing the workspace dependencies. Select **Run CAVE extension** in
Run and Debug and press F5. The checked-in launch configuration runs `pnpm build`
from that folder before starting an Extension Development Host, with source maps
from `dist/` available to the debugger. Open a `.cave` file in the new window to
activate the provider. Stop and restart debugging after source changes to rebuild;
this launch task is not a watch process. VS Code's
[extension debugging guide](https://code.visualstudio.com/api/get-started/your-first-extension)
describes the development-host workflow.

`pnpm test` typechecks and builds the extension, then checks its resource
lifecycle and packaged grammar. A provider integration test uses the real WASM
runtime with a small VS Code host double to verify single-line, non-overlapping
UTF-16 token ranges for Unicode, CRLF input and incomplete edits. It does not
replace an interactive extension-host check of theme rendering.

An installed VS Code can also run the real host smoke test from this directory:

```sh
pnpm build
test_profile="$(mktemp -d /tmp/cave-vscode.XXXXXX)"
trap 'rm -rf "$test_profile"' EXIT
CAVE_VSCODE_HOST_RESULT="$test_profile/result.json" code --user-data-dir "$test_profile/profile" \
  --extensions-dir "$test_profile/extensions" \
  --extensionDevelopmentPath "$PWD" \
  --extensionTestsPath "$PWD/test-host/index.cjs" \
  --disable-workspace-trust --skip-welcome --skip-release-notes
node -e 'const fs = require("node:fs"); const assert = require("node:assert/strict"); assert.equal(JSON.parse(fs.readFileSync(process.argv[1], "utf8")).active, true)' "$test_profile/result.json"
```

The test opens a temporary `.cave` file containing Unicode and CRLF lines,
checks automatic language detection, two-space indentation and spaces, waits
up to ten seconds for automatic activation, and requests the legend and tokens through VS Code's
[semantic-token commands](https://code.visualstudio.com/api/references/commands).
It checks non-overlapping UTF-16 token ranges, keywords, Unicode strings, and the
trajectory operator. It then replaces the document with an unfinished string
and corrects it, checking version changes, fresh tokens, and an astral-character
identifier before the test host exits. Set `CAVE_VSCODE_HOST_RESULT` to a file
path to retain the initial and edited tokens and host version as JSON. The temporary profile keeps normal editor
settings and installed extensions separate. This requires a graphical VS Code
installation; it supplements the ordinary Node tests and does not verify theme
colors. The test passed locally with VS Code 1.126.0-insider on macOS arm64.
The success JSON is written only after all assertions pass. Check it from a
fresh profile as shown above: the local `code` launcher can return zero even
when the test host reports an assertion failure.
Keep the profile path short: on macOS, a long temporary directory can exceed
the IPC socket path limit and fail with `listen EINVAL` before the extension
loads. The command above uses a short `/tmp` path for that reason.
If the macOS shell launcher exits without a result file or usable diagnostics,
invoke the application executable directly with the same arguments and
`CAVE_VSCODE_HOST_RESULT`, for example
`"/Applications/Visual Studio Code - Insiders.app/Contents/MacOS/Code - Insiders"`.
Unset `ELECTRON_RUN_AS_NODE` for this direct application launch. Check the
success JSON again; a zero exit code alone still does not prove the test passed.

For an artifact check, run `pnpm package`, extract the generated VSIX, and point
`--extensionDevelopmentPath` at its extracted `extension` directory. Keep
`--extensionTestsPath` pointing at this repository's test module. The host test
also passed against the extracted artifact, verifying its file association,
automatic activation, defaults and semantic-token behavior.

A separate visual review in that host checked **Default Dark Modern** and
**Default Light Modern** with comments, Unicode strings, contexts, trajectory
numbers/operators/units, confidence, and tags. Both rendered legibly with
distinct token colors and no clipped text. This is evidence for those built-in
themes; custom themes retain control over their semantic-token colors.

`pnpm package` builds the extension and validates the resulting VSIX archive:
extension identity and version, the expected executable entry point, and required
manifest/readme/license/configuration, bundle, WASM, and highlight-query files.
Every required file must be nonempty, including the executable JavaScript bundle.
The package manifest and language configuration must decode as strict UTF-8 and
parse as JSON objects; malformed bytes, invalid JSON, and non-object roots fail
with the archive path in the error. This checks their encoding and structure,
not the complete VS Code configuration schema.
Both bundled WASM payloads must pass WebAssembly validation, so malformed or
truncated binaries cannot pass merely by occupying a nonempty archive entry.
This checks binary validity; the provider and extension-host tests exercise
grammar loading and editor behavior separately.
The highlight query must decode as strict UTF-8; malformed bytes cannot silently
become replacement characters when the extension loads it. Authored Unicode,
including a literal replacement character, remains valid. This encoding check
does not compile the query or establish grammar compatibility.
Duplicate archive paths are rejected, so entry order cannot select a different
manifest or executable. Archive read failures close the reader before rejection.
It rejects packaged `node_modules`, `src`, `test`, `test-host`, and `.vscode`
directories, independently of the packaging allowlist. This archive
check complements the provider tests; it does not launch VS Code or publish to
Marketplace.

## Version and release policy

The extension is a released Marketplace product under publisher `MirekRusin`.
Its version follows the repository's lockstep CAVE version: the automated
version-packages PR updates this private manifest after Changesets has updated
the public packages. Never edit the version by hand. Every repository release
publishes the extension to Marketplace (listed as **CAVE Language**, id
`MirekRusin.cave-language`) from the `vscode` job of
`.github/workflows/publish.yml`, which runs after the npm publish.

Extension-facing changes use the same PR changeset as the rest of the
repository. Those changesets and the linked `v<version>` Git history are the
release log; there is deliberately no second extension changelog to maintain
or reconcile.

Both publication paths use the `vscode-marketplace` GitHub environment, which
holds a `VSCE_PAT` secret authorized only for the `MirekRusin` publisher plus
any desired reviewer protection. To republish an older release manually,
dispatch **Publish VS Code extension** (`.github/workflows/vscode.yml`) from
the default branch and enter the version without the `v`. Either path checks
out the exact tagged release, validates its release identity and lockstep
manifest, builds and inspects the VSIX, then publishes it. Duplicate versions
are treated as a successful no-op so a failed workflow can be rerun.

The `VSCE_PAT` is an Azure DevOps personal access token created at
`https://dev.azure.com/<org>/_usersSettings/tokens` with organization scope
*All accessible organizations* and the single scope *Marketplace → Manage*.
Azure DevOps retires all-organization tokens on 1 December 2026; set the
expiry no later than that date and migrate the workflow to the Entra-based
authentication `vsce` supports (`--azure-credential`) before then.
