// Generated and maintained for Typst 0.15.0.

#set document(title: "CAVE: The Complete System Guide", author: "CAVE project")
#set page(paper: "a4", margin: (x: 24mm, y: 22mm), numbering: "1")
#set text(font: ("Libertinus Serif", "New Computer Modern"), size: 10.5pt, lang: "en")
#set par(justify: true, leading: 0.68em)
#set heading(numbering: "1.")
#show heading.where(level: 1): it => { pagebreak(weak: true); set text(size: 20pt, weight: "bold"); it }
#show heading.where(level: 2): set text(size: 14pt, weight: "bold")
#show raw: set text(font: ("DejaVu Sans Mono", "Liberation Mono"), size: 8pt)
#show raw.where(block: true): it => block(fill: luma(245), inset: 8pt, radius: 2pt, width: 100%)[#it]
#let note(title, body) = block(fill: luma(246), stroke: 0.5pt + luma(170), inset: 9pt, radius: 2pt, width: 100%)[*#title*\ #body]

#align(center)[
  #v(32mm)
  #text(size: 30pt, weight: "bold")[CAVE]
  #v(4mm)
  #text(size: 18pt)[The Complete System Guide]
  #v(8mm)
  #text(size: 11pt)[Compressed Atomic Verb Expressions]
  #v(24mm)
  #text(size: 10pt)[Repository version 0.25.1\ 2026-07-12]
]
#pagebreak()
= About this book
This book consolidates the implemented CAVE system and its normative repository specification into one continuous technical guide. The specification skills remain authoritative for exact normative wording and section numbers; this book explains how the pieces work together.

Build target: Typst 0.15.0. Project version: 0.25.1.
#pagebreak()
= Contents
#outline(indent: auto)
#pagebreak()
#include "parts/part-01.typ"
#include "parts/part-02.typ"
#include "parts/part-03.typ"
#include "parts/part-04.typ"
#include "parts/part-05.typ"
#include "parts/part-06.typ"
