---
"@cavelang/cli": minor
---

Rewrite the book as a 31-chapter course on one running example (a coffee roastery), and replay every session in it against the real CLI: `scripts/book-examples.mjs` extracts `$`-prompt sessions and `#file` listings from `book/chapters/*.typ`, runs them in a scratch directory, and compares recorded output; `packages/cli/test/book.test.ts` runs it under `pnpm test`, and `--update` refreshes recorded output.
