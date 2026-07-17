# CAVE for VSCode

Language support for [CAVE](https://github.com/mirek/cave) (`.cave` files).

Highlighting is a semantic-tokens provider running the
`@cavelang/tree-sitter-cave` grammar (WASM, via web-tree-sitter) with the
grammar's own `queries/highlights.scm` — the exact query Neovim/Helix/Zed
and the `cave highlight` terminal command use. One grammar, every surface;
there is deliberately no TextMate grammar to drift out of sync.

Also contributes `;` line comments, `"`/`` ` `` auto-closing pairs, and the
`cave` language id.

## Build and install

```sh
pnpm install
pnpm package          # → cave-language-<version>.vsix
code --install-extension cave-language-*.vsix
```

For development: `pnpm build`, then F5 (Run Extension) from this directory.

## Version and release policy

The extension is a released Marketplace product under publisher `cavelang`.
Its version follows the repository's lockstep CAVE version: the automated
version-packages PR updates this private manifest after Changesets has updated
the public packages. Never edit the version by hand. A repository release may
omit a Marketplace publication when the extension did not change; versions do
not need to be contiguous in Marketplace.

Extension-facing changes use the same PR changeset as the rest of the
repository. Those changesets and the linked `v<version>` Git history are the
release log; there is deliberately no second extension changelog to maintain
or reconcile.

To publish an existing release, configure the `vscode-marketplace` GitHub
environment with a `VSCE_PAT` secret authorized only for the `cavelang`
publisher, plus any desired reviewer protection. Dispatch **Publish VS Code
extension** from the default branch and enter the version without the `v`.
The workflow checks out that exact tag, validates its release identity and
lockstep manifest, builds and inspects the VSIX, then publishes it. Duplicate
versions are treated as a successful no-op so a failed workflow can be rerun.
