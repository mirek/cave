# CAVE website

The Vite/React site for the CAVE landing page, documentation, and browser playground.

```sh
pnpm site:dev
pnpm site:build
pnpm --filter @cavelang/website test
pnpm --filter @cavelang/website test:browser
```

Documentation pages import every package README plus the repository's primary
guides directly, so package docs and the website share one source. The site
version is read from the root package manifest. The playground explicitly
injects its SQL.js adapter through `@cavelang/store/adapter` and runs the real
parser, canonicalizer, store, and query packages in a module worker against
SQLite WebAssembly.
No source-module alias or custom Node test loader selects the runtime.

CAVE examples and the playground editor are highlighted in-browser by the
Tree-sitter WASM grammar and its shared `queries/highlights.scm` captures.

The playground intentionally does not bundle a formal solver. The optional
threaded Z3 backend remains Node-only because this GitHub Pages deployment does
not provide the cross-origin isolation and worker-asset contract it requires.
CI verifies that ordinary website builds contain no Z3 package or Wasm asset.

The production browser smoke serves `website/dist` from `/cave/`, fails on
browser or request errors, and exercises the lazy playground chunk, module
worker, SQL.js, Tree-sitter, and grammar Wasm assets before deployment.

`.github/workflows/pages.yml` publishes `website/dist` to GitHub Pages on changes to the site, packages, or documentation.
