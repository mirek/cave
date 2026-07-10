# CAVE website

The Vite/React site for the CAVE landing page, documentation, and browser playground.

```sh
pnpm site:dev
pnpm site:build
pnpm --filter @cavelang/website test
```

Documentation pages import the repository's Markdown sources directly, so package docs and the website stay in sync. The playground aliases `node:sqlite` to a SQL.js adapter and runs the real parser, canonicalizer, store, and query packages against SQLite WebAssembly.

`.github/workflows/pages.yml` publishes `website/dist` to GitHub Pages on changes to the site, packages, or documentation.
