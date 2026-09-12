# @cavelang/view

## 0.36.9

### Patch Changes

- Align the @cavelang/view workspace with the CAVE 0.36.9 release identity.

## 0.36.8

### Patch Changes

- Align the @cavelang/view workspace with the CAVE 0.36.8 release identity.

## 0.36.7

### Patch Changes

- Align the @cavelang/view workspace with the CAVE 0.36.7 release identity.

## 0.36.6

### Patch Changes

- Align the @cavelang/view workspace with the CAVE 0.36.6 release identity.

## 0.36.5

### Patch Changes

- Align the @cavelang/view workspace with the CAVE 0.36.5 release identity.

## 0.36.4

### Patch Changes

- Align the @cavelang/view workspace with the CAVE 0.36.4 release identity.

## 0.36.3

### Patch Changes

- Align the @cavelang/view workspace with the CAVE 0.36.3 release identity.

## 0.36.2

### Patch Changes

- Align the @cavelang/view workspace with the CAVE 0.36.2 release identity.

## 0.36.1

### Patch Changes

- Align the @cavelang/view workspace with the CAVE 0.36.1 release identity.

## 0.36.0

### Patch Changes

- b3f5de7: Expose local viewer loading, completion and error states to assistive technology while ignoring stale navigation responses.
- b3f5de7: Add synchronous store cleanup hooks and close cached sensitivity projections when their source closes, attempting all resource cleanup even after errors.
- b3f5de7: Wait for input-method composition to finish before Enter starts a read-only view search, and give the search field an explicit accessible name.
- b3f5de7: Prevent sensitivity projections from retaining rolled-back rows or lineage-driven vocabulary changes.
- b3f5de7: Keep local viewer controls and long claim content within narrow screens, with live browser regression coverage.
- b3f5de7: Return HTTP 400 for malformed view request URLs instead of reporting a server failure, preserving error headers and HEAD behavior.
- b3f5de7: Avoid function-argument limits when assembling large report fragments and selecting code-span delimiters for source locators with many backtick runs.
- b3f5de7: Escape source-link labels and destinations in Markdown reports so punctuation and entity-like source text preserve their literal display and navigation target.
- b3f5de7: Substitute HTML page metadata once with callbacks so database labels preserve dollar tokens and template-marker text without duplicating markup.
- b3f5de7: Record measured report parser and CLI import costs, correctness checks, and
  the limits of the existing performance gates.
- b3f5de7: Keep the read-only browser view and alias toggle usable when saved-preference reads or writes fail.
- b3f5de7: Use Markdown's parsed inline code spans for report splices, preserving escaped
  syntax and multiline examples while supporting live multiline queries with
  correct source-line diagnostics.
- b3f5de7: Recognize report query fences through the Markdown tree, keeping malformed
  openers and container examples literal and preserving unclosed-fence diagnostics.
- b3f5de7: Preserve complete ISO transaction dates in report citations for UUID timestamps beyond year 9999.
- b3f5de7: Keep delayed local viewer search responses from overwriting the user's next search draft.
- b3f5de7: Refresh local viewer results when users submit the same search again after store changes.
- b3f5de7: Preserve surrounding spaces in fully bound report bullets by padding Markdown
  code spans so rendering does not trim the stored claim's whitespace.
- b3f5de7: Recognize handwritten footnote containers when detecting report code blocks,
  so continued footnote paragraphs keep live splices and nested examples stay
  literal.
- b3f5de7: Keep report splices inert inside indented Markdown code examples using parsed
  block boundaries, while preserving live paragraph and list continuations.
- b3f5de7: Keep report queries inside raw HTML blocks, comments and inline tag attributes
  literal while rendering splices in surrounding Markdown prose.
- b3f5de7: Display control characters visibly in report source citations so decoded
  newlines cannot split footnotes or link labels, preserving original source
  identities and encoded link destinations.
- b3f5de7: Add a reproducible report benchmark with literal-output and live-splice checks,
  and document current parser measurements for indented, HTML and multiline examples.
- b3f5de7: Reuse the last successful identical query within a report render, preserving
  fresh data/options across reports and per-line errors. Extend the reproducible
  benchmark with repeated live splices and document the measured improvement.
- b3f5de7: Verify interrupted HTTP delivery preserves server usability and caller ownership of the source store.
- b3f5de7: Verify projection cleanup errors do not prevent remaining resource cleanup or rebuilding an explicitly evicted cache.

## 0.29.0

### Minor Changes

- e5ea4df: Add in-band exact-one cardinality and exact-unit constraints to `EXPECTS`,
  with actionable health reports and transactional gate enforcement.

## 0.28.1

### Patch Changes

- Updated dependencies [16344ea]
  - @cavelang/core@0.28.1
  - @cavelang/canonical@0.28.1
  - @cavelang/query@0.28.1
  - @cavelang/shape@0.28.1
  - @cavelang/store@0.28.1

## 0.28.0

### Patch Changes

- Updated dependencies [e2a4fd7]
- Updated dependencies [a0a4dd1]
  - @cavelang/core@0.28.0
  - @cavelang/canonical@0.28.0
  - @cavelang/query@0.28.0
  - @cavelang/shape@0.28.0
  - @cavelang/store@0.28.0
