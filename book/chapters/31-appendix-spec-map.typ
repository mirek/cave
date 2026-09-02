#import "../style.typ": note, file, recap

= Where the Rules Live

The normative specification is split across four skill files in the
repository's `.claude/skills/` directory, and section numbers are preserved
there. This book explains; the sections decide. Sections are normative
unless marked legacy, draft, or non-normative.

#table(columns: (auto, auto, auto), inset: 5pt, stroke: 0.4pt + luma(190),
  [*Skill*], [*Sections*], [*Covers*],
  [`cave-writing`], [§3–§8, §11, §16, §22],
    [Syntax, lexical rules, verbs, `REVERSE` and `RENAMED-TO`, metadata, values and units, indentation, tags and topics, the grammar, the spec card.],
  [`cave-extraction`], [§14–§15, §21, §23],
    [Extraction rules, granularity, operating modes, the worked example, deterministic structured ingestion.],
  [`cave-storage-query`], [§9, §12–§13, §20, §24–§32],
    [Belief evolution, claim keys, provenance, sensitivity, source spans, CAVE-Q, storage, shapes, rules, actions, resolution, alias discovery, sync, automations, the read surface, reports, valid time.],
  [`cave-design`], [§0–§2, §10, §17–§19],
    [Status conventions, design goals, the claim model, the probabilistic layer, the historical draft grammar, the agent layer, rationale.],
)

== Chapter to section

#table(columns: (auto, auto), inset: 5pt, stroke: 0.4pt + luma(190),
  [*Chapter*], [*Sections*],
  [1 A First Claim], [§1, §2],
  [2 Claims], [§3, §4],
  [3 Verbs], [§5],
  [4 Context, Tags, and Confidence], [§6, §11],
  [5 Values, Units, and Uncertainty], [§7, §10],
  [6 Indentation], [§8],
  [7 Belief That Only Grows], [§9.1–§9.4, §12.3],
  [8 Provenance], [§9.5–§9.8, §13.2.2],
  [9 Asking Questions], [§12, §13.5],
  [10 Time in the World], [§32],
  [11 When Sources Disagree], [§26],
  [12 One Entity, Many Names], [§13.6, §27],
  [13 Shape and Health], [§20],
  [14 Structured Data Without a Model], [§23],
  [15 Letting a Model Read], [§14, §15],
  [16 Measuring an Extraction], [§18 (evals), the `eval` package],
  [17 Rules], [§24],
  [18 Actions], [§25],
  [19 Automations], [§29],
  [20 Reconstruction], [§18],
  [21 Documents That Cite Their Claims], [§31],
  [22 Looking at the Store], [§30],
  [23 Agents Over MCP], [§9.5, §25.5, the `mcp` package],
  [24 Two Stores Become One], [§28],
  [25 How Claims Are Stored], [§13],
  [26 How the Pieces Fit], [§19, `ARCHITECTURE.md`],
  [27 Formal Reasoning], [the `scenario`, `solver`, and `solver-z3` packages],
  [28 Running a Store for Real], [§9.6, §9.7, §25.4],
)

The root `README.md` is a step-by-step tutorial on two other examples, a
monorepo and a market watchlist, and `examples/family-history/README.md`
pushes one set of notes through every surface. Package READMEs under
`packages/` are the reference for each command and library.
