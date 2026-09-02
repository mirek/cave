---
"@cavelang/cli": minor
---

Rewrite the book as a 31-chapter course on one running example (a coffee roastery), and replay every runnable session in it against the real CLI (sessions that need a language model, a browser, a long-running server, or the optional Z3 solver package are marked `// no-test` and skipped): `scripts/book-examples.mjs` extracts `$`-prompt sessions and `#file` listings from `book/chapters/*.typ`, runs them in a scratch directory, and compares recorded output; `packages/cli/test/book.test.ts` runs it under `pnpm test`, and `--update` refreshes recorded output.
