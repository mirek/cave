// Shared styling helpers for the CAVE book (Typst 0.15.0).

// A callout box with a bold title line.
#let note(title, body) = block(
  fill: luma(246),
  stroke: 0.5pt + luma(170),
  inset: 9pt,
  radius: 2pt,
  width: 100%,
  above: 1em,
  below: 1em,
)[*#title*\ #body]

// The filename caption above a listing. The example runner
// (scripts/book-examples.mjs) reads this marker: the raw block that follows
// it is written to that file before the chapter's sessions run.
#let file(name) = block(
  above: 1em,
  below: 0.35em,
  sticky: true,
  text(font: "DejaVu Sans Mono", size: 8pt, fill: luma(95))[#name],
)

// A part-opening page. Parts are unnumbered level-1 headings so that the
// outline lists them without disturbing chapter numbers.
#let part(title, blurb) = {
  pagebreak(weak: true)
  heading(level: 1, numbering: none, outlined: true)[#title]
  block(width: 70%, text(size: 11pt, fill: luma(60))[#blurb])
  pagebreak()
}

// The short "in one breath" summary that closes a chapter.
#let recap(body) = block(
  above: 1.4em,
  inset: (left: 9pt),
  stroke: (left: 2pt + luma(150)),
  width: 100%,
)[#text(size: 9.5pt)[*In short.* #body]]
