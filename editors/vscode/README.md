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
