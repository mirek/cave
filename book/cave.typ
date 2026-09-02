// The CAVE book. Generated and maintained for Typst 0.15.0.
// Build: sh book/build.sh   Test the examples: node scripts/book-examples.mjs

#import "style.typ": note, file, part, recap

#let cave-version = json("../package.json").at("version")

#set document(title: "CAVE: The Complete System Guide", author: "CAVE project")
#set page(paper: "a4", margin: (x: 24mm, y: 22mm), numbering: "1")
#set text(font: ("Libertinus Serif", "New Computer Modern"), size: 10.5pt, lang: "en")
#set par(justify: true, leading: 0.68em)
#set heading(numbering: "1.1")

#show heading.where(level: 1): it => {
  pagebreak(weak: true)
  if it.numbering == none and it.outlined {
    // a part page
    v(28%)
    text(size: 11pt, fill: luma(110), tracking: 0.08em)[PART]
    v(2mm)
    text(size: 26pt, weight: "bold", it.body)
    v(6mm)
  } else if it.numbering == none {
    // front and back matter
    text(size: 20pt, weight: "bold", it.body)
    v(4mm)
  } else {
    text(size: 11pt, fill: luma(110), tracking: 0.08em)[CHAPTER #counter(heading).display("1")]
    v(2mm)
    text(size: 22pt, weight: "bold", it.body)
    v(5mm)
  }
}
#show heading.where(level: 2): set text(size: 13.5pt, weight: "bold")
#show heading.where(level: 2): set block(above: 1.4em, below: 0.7em)
#show heading.where(level: 3): set heading(numbering: none)
#show heading.where(level: 3): set text(size: 11pt, weight: "bold")

#show table: set par(justify: false)
#show raw: set text(font: "DejaVu Sans Mono", size: 8pt)
#show raw.where(block: true): it => block(
  fill: luma(245), inset: 8pt, radius: 2pt, width: 100%, above: 0.9em, below: 1em,
)[#it]

#show outline.entry.where(level: 1): it => {
  if it.element.numbering == none { v(0.7em, weak: true); strong(it) } else { it }
}

// ---------------------------------------------------------------------------
// Title page

#align(center)[
  #v(32mm)
  #text(size: 34pt, weight: "bold")[CAVE]
  #v(4mm)
  #text(size: 18pt)[The Complete System Guide]
  #v(8mm)
  #text(size: 11pt)[Compressed Atomic Verb Expressions]
  #v(28mm)
  #text(size: 10pt)[Repository version #cave-version]
]
#pagebreak()

#heading(level: 1, outlined: false, numbering: none)[About this book]

CAVE is a small plain-text language for writing down what you know, one claim
per line, and a command-line tool that stores those claims and lets you ask
questions across them. This book teaches both, from the first three-word claim
to a store that reads its own inputs, concludes, acts, and explains itself.

The book is organized like a course. Part I is the language: how to write a
claim and everything a claim can carry. Part II is the store: what happens to a
claim once it is recorded, how belief changes, and how to ask. Part III is
about getting knowledge in without typing it. Part IV is about concluding and
acting. Part V covers sharing what a store knows, with people, agents, and
other stores. Part VI looks under the hood. Each chapter introduces a few ideas,
shows them on one running example, and closes with a short summary.

*The running example.* Most chapters follow a small coffee roastery: the
cooperatives it buys from, the lots of green coffee, the blends it roasts, and
the cafes it sells to. It is deliberately ordinary. Nothing in CAVE is specific
to software, and a domain everyone can picture keeps the attention on the
ideas.

*Every session in this book is real.* A block that starts with a `$` prompt was
run against the `cave` command that ships with this repository version, and
its output is what the tool printed; when a command exits with a nonzero
status, the session shows it as a final `[exit N]` line, and a pipeline counts
as failed when its `cave` stage fails (the sessions run with `pipefail` set).
A test replays every such session and fails when the recorded output or exit
status drifts; the few sessions that need a language model, a browser, or a
long-running server are marked in the source and are not replayed. Files
shown with a filename caption are the exact files the sessions use;
`book/fixtures/` in the repository holds the shared ones, so you can copy that
directory and follow along.

*Where the rules live.* The normative specification is split across four
skill files in the repository's `.claude/skills/` directory, with numbered
sections (§). This book explains and motivates; when it names a section, that
section has the last word on exact wording.

Build target: Typst 0.15.0. Project version: #cave-version.

#pagebreak()
#outline(title: [Contents], indent: auto, depth: 2)

// ---------------------------------------------------------------------------

#part([The language], [How to write a claim, and everything a claim can carry:
  names, verbs, attributes, values with units, confidence, context, tags, and
  the indentation that groups related lines.])
#include "chapters/01-a-first-claim.typ"
#include "chapters/02-claims.typ"
#include "chapters/03-verbs.typ"
#include "chapters/04-metadata.typ"
#include "chapters/05-values.typ"
#include "chapters/06-indentation.typ"

#part([The store], [What happens to a claim once it is recorded: belief that
  only ever grows, where each claim came from, how to ask questions, time in
  the world, disagreement, names that mean the same thing, and what a healthy
  store looks like.])
#include "chapters/07-belief.typ"
#include "chapters/08-provenance.typ"
#include "chapters/09-queries.typ"
#include "chapters/10-time.typ"
#include "chapters/11-resolution.typ"
#include "chapters/12-aliases.typ"
#include "chapters/13-shape.typ"

#part([Getting knowledge in], [Three ways to fill a store without typing:
  structured records through a template, prose through a language model, and
  the harness that tells you how good the extraction was.])
#include "chapters/14-connect.typ"
#include "chapters/15-ingest.typ"
#include "chapters/16-eval.typ"

#part([Concluding and acting], [Rules that conclude what nobody wrote, actions
  that record decisions under conditions, automations that react to new
  claims, and reconstruction that walks the graph from a symptom.])
#include "chapters/17-rules.typ"
#include "chapters/18-actions.typ"
#include "chapters/19-automations.typ"
#include "chapters/20-reconstruction.typ"

#part([Sharing what the store knows], [Documents that cite their claims, a
  browser page over the store, agents that read and write through MCP, and
  stores that merge without conflicts.])
#include "chapters/21-reports.typ"
#include "chapters/22-serve.typ"
#include "chapters/23-agents.typ"
#include "chapters/24-sync.typ"

#part([Under the hood], [How claims are stored and normalized, how the
  packages fit together, the optional formal-reasoning layer, and advice for
  running a store for real.])
#include "chapters/25-storage.typ"
#include "chapters/26-architecture.typ"
#include "chapters/27-formal.typ"
#include "chapters/28-operating.typ"

#part([Appendices], [The command reference, the compact syntax card, and a map
  from this book to the specification sections.])
#include "chapters/29-appendix-commands.typ"
#include "chapters/30-appendix-syntax.typ"
#include "chapters/31-appendix-spec-map.typ"
