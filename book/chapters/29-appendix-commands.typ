#import "../style.typ": note, file, recap

= Command Reference

Every command answers `--help`, and `cave help <command>` prints the same
text with examples. `--db` is optional everywhere and defaults to
`$CAVE_DB`, then `cave.db` in the current directory. This table is the map;
the chapters are the territory.

#table(columns: (auto, auto, auto), inset: 5pt, stroke: 0.4pt + luma(190),
  [*Command*], [*Purpose*], [*Chapter*],
  [`cave parse`], [Lint CAVE text; `--json` dumps the parsed document.], [2],
  [`cave highlight`], [Print CAVE text with ANSI colours from the tree-sitter grammar.], [26],
  [`cave add`], [Append authored claims; `--strict`, `--check` (shape gate), `--no-src`.], [2, 13],
  [`cave import`], [Replay exported text without provenance stamping.], [7, 8],
  [`cave query`], [Run a CAVE-Q pattern; `--all`, `--aliases`, `--as-of`, `--at`, `--resolve`, `--limit`, `--cursor`, `--json`.], [9],
  [`cave resolve`], [List contested facts with ranked candidates; `--policy` shows the effective policy.], [11],
  [`cave derive`], [Declare and fire rules; `--dry-run`, `--full`, `--list`, `--retract`.], [17],
  [`cave act`], [Execute, `--declare`, `--list`, or `--retract` actions; `--hooks`, `--dry-run`, `--no-check`.], [18],
  [`cave automate`], [The event loop; `--once`, `--declare`, `--list`, `--retract`, `--hooks`, `--agent`.], [19],
  [`cave check`], [Knowledge health report; exit 1 on violations; `--stale`, `--json`.], [13],
  [`cave backup`], [Exact verified SQLite snapshot; `--verify`, `--sha256`.], [8],
  [`cave restore`], [Verify and atomically restore a snapshot; `--force`.], [8],
  [`cave generate`], [Versioned TypeScript client from `EXPECTS` claims.], [13],
  [`cave suggest-alias`], [Propose same-entity candidates; `--min`, `--agent`, `--write`.], [12],
  [`cave sync`], [Merge a store or annotated text by row identity; `--as`, `--into`, `--no-record`.], [24],
  [`cave export`], [Canonical text; `--current`, `--tx`, `--max-sensitivity`, `--out`.], [7, 8, 24],
  [`cave serve`], [Read-only local browser page; `--port`, `--host`, `--max-sensitivity`.], [22],
  [`cave report`], [Render a cited Markdown template; `--resolve`, `--as-of`, `--at`, `--aliases`.], [21],
  [`cave mcp`], [Serve the store to MCP clients; `--read-only`, `--permissions`, `--tools`, `--hooks`, `--src`.], [23],
  [`cave ingest`], [Model-driven ingestion of files and URLs; `--agent`, `--stdout`, `--instructions`, `--lenient`.], [15],
  [`cave eval`], [Golden-fixture extraction and reconstruction evals; `--agent`, `--runs`, `--judge`, `--min`.], [16],
  [`cave connect`], [Deterministic structured ingestion; `--map`, `--key`, `--prune`, `--watch`, `--query`.], [14],
  [`cave reconstruct`], [Best-first reconstruction from seed cues; `--trace`, `--steps`, `--agent`.], [20],
  [`cave doctor`], [Runtime, installation, configuration, and store diagnostics.], [28],
  [`cave demo`], [Narrate the reconstruction demo on an in-memory store.], [20],
  [`cave version`], [Print the version.], [],
  [`cave help`], [The overview, or one command's options and examples.], [],
)

Two environment variables matter: `CAVE_DB` sets the default store and
`CAVE_HOOKS` the default hook configuration. `CAVE_DEBUG=1` keeps stack
traces on unexpected errors. `NO_COLOR` disables the colours `cave export`
prints on a terminal.

The optional `cave-solver-workflow` binary from the Z3 adapter package runs
the allowlisted architecture fixture (Chapter 27).
