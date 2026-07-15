# CAVE website

The Vite/React site for the CAVE landing page, documentation, and browser playground.

```sh
pnpm site:dev
pnpm site:build
pnpm --filter @cavelang/website test
```

Documentation pages import every package README plus the repository's primary
guides directly, so package docs and the website share one source. The site
version is read from the root package manifest. The playground aliases
`node:sqlite` to a SQL.js adapter and runs the real parser, canonicalizer,
store, and query packages against SQLite WebAssembly.

CAVE examples and the playground editor are highlighted in-browser by the
Tree-sitter WASM grammar and its shared `queries/highlights.scm` captures.

`.github/workflows/pages.yml` publishes `website/dist` to GitHub Pages on changes to the site, packages, or documentation.
