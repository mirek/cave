# CAVE book

`cave.typ` is the source for the checked-in website artifact at
`website/public/cave-book.pdf`. The book is a course in six parts: the
language, the store, getting knowledge in, concluding and acting, sharing
what the store knows, and under the hood, plus appendices. One chapter per
file under `chapters/`, shared styling in `style.typ`, and the files the
chapters' sessions use under `fixtures/`.

## Building

The build is pinned to Typst 0.15.0:

```sh
sh book/build.sh
```

The PDF is intentionally committed so the GitHub Pages site can link to a stable
artifact without a runtime document build. Source and PDF must change together.
The build fixes `SOURCE_DATE_EPOCH`, so repeated builds from the same source are
byte-for-byte reproducible. The book workflow rebuilds and validates the PDF
whenever its source changes.

## Every example is tested

Every `$`-prompt session and every CAVE listing in the book is replayed
against the real `cave` CLI by `scripts/book-examples.mjs`, and
`packages/cli/test/book.test.ts` runs it as part of `pnpm test`, so recorded
output cannot drift from the shipped tool. The exception is a session marked
`// no-test` (one that needs a language model, a browser, a long-running
server, or the optional Z3 solver package): it is skipped, so re-run it by
hand whenever the commands it shows change.

```sh
node scripts/book-examples.mjs            # check every chapter (exit 1 on drift)
node scripts/book-examples.mjs --update   # rewrite recorded output in place
node scripts/book-examples.mjs --only 17  # one chapter, by file-name fragment
```

The conventions the runner reads from `chapters/*.typ`:

- A ```` ```sh ```` raw block is a *session*. Lines starting with `$ ` are
  commands (a trailing `\` continues a command on the next line); the lines
  after a command, up to the next `$ `, are its recorded output, compared
  after trailing blank lines are trimmed; a command that exits with a
  nonzero status has `[exit N]` as the last line of its output, so exit
  statuses are shown to the reader and checked by the runner. Commands run in order in one
  scratch directory per chapter, so a chapter is self-contained and chapters
  are independent. Each command runs under `sh -c` (or `bash -c` where `sh`
  lacks the option) with `set -o pipefail`, so a `cave` stage that fails
  inside a `| sed` or `| grep` pipeline still records its `[exit N]`; `cave`
  is on the path, `CAVE_DB` and `CAVE_HOOKS` are unset, `NO_COLOR=1`,
  `TZ=UTC`, and `LC_ALL=C` (so git and the other tools a session calls
  print English messages under any locale); standard output and standard
  error are both captured.
- Recorded output may contain placeholders for values that legitimately
  vary: `<date>`, `<time>`, `<uuid>`, `<hex>`, `<n>`, `<path>`, `<token>`,
  and `<any>` (the rest of a line). A line consisting of `…` or `...` matches
  any number of lines.
- `#file("name")` on the line immediately before a raw block writes that
  block to `name` in the chapter's scratch directory before later sessions
  run. Writing the same name again later in the chapter overwrites it, which
  is how a chapter edits an input file. When `fixtures/<name>` exists the
  block must be identical to it (`--update` refreshes the fixture from the
  book); the fixtures directory is the copy a reader can `cd` into. `.cave`
  file blocks must lint under `cave parse`, except eval query fixtures
  (`*.queries.cave`).
- A `// no-test` comment on the line before a ```` ```sh ```` block excludes
  it. Use it only for commands that need a language model, a browser, a
  long-running server, or the optional Z3 solver package
  (`cave-solver-workflow`); everything else should be replayed.
- Every other ```` ```cave ```` block is linted with `cave parse`. Use
  ```` ```text ```` for grammar skeletons and other non-CAVE listings.
- A raw block that itself contains triple-backtick fences (a Markdown report
  template) uses a four-backtick fence.

When the CLI's output changes, run `--update`, review the diff, and restore
any placeholders the update replaced with concrete values (the updater keeps
a recorded block verbatim when it still matches, and otherwise writes the
actual output). Then rebuild the PDF.

## Writing a chapter

Each chapter starts from `fixtures/roastery.cave` (loaded with
`cave add --db roastery.db roastery.cave`) unless it needs no store, adds a
few claims or files of its own, and closes with a `#recap[...]` summary.
Chapters reference each other by number, so renumbering a chapter means
updating the references and the appendix spec map. Keep sessions short,
prefer showing one real output over describing three, and mark spec sections
(§) where the book explains a rule the specification decides.
