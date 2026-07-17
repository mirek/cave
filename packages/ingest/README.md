# @cavelang/ingest

LLM-driven knowledge ingestion: point `cave ingest` at files (globs
supported) and web pages (http(s) URLs) and it drives an agent of your
choosing — headless Claude Code, Copilot CLI, or your own SDK script — to
read them and record the important knowledge as CAVE claims in a database.
The motivating use case: sweep a monorepo and build up its knowledge base.

```sh
cave ingest 'packages/**/*.ts' 'docs/**/*.md' https://example.com/design-notes \
  --db knowledge.db \
  --instructions ingest-notes.md \
  --agent 'claude -p --mcp-config {mcp-config} --allowedTools "mcp__cave__*"'
```

## How it works

1. **Select** — globs expand (`fs.globSync`; the library API additionally
   takes `files`, literal paths selected without glob expansion — for
   discovered names, which may contain `[]?*`), URLs are fetched with the
   built-in `fetch` (HTML is reduced to its readable article text with
   [@mozilla/readability](https://github.com/mozilla/readability) over
   linkedom; markdown/plain/JSON bodies pass through verbatim), and
   sources whose content was already ingested are skipped: after each
   successful batch the orchestrator records `<path-or-url> HAS
   ingest-digest: <sha256/12> @src:cave-ingest` — provenance as ordinary
   CAVE claims, so incremental re-runs come free and live in the same
   append-only store. Paths that are not valid entity atoms (for example,
   names containing spaces or syntax delimiters) are preserved as literal
   subjects through programmatic claim construction, so arbitrary supported
   paths and URLs participate in incremental skipping as well. Digest write
   errors fail the run with the affected source names instead of being
   discarded. A URL's digest is taken over
   the *extracted* text, so a page re-ingests only when its readable content
   changes.
   Each URL is selected independently: a failed request is reported without
   discarding healthy file or URL sources. Network errors and retryable HTTP
   statuses (408, 425, 429, and 5xx) are distinguished from permanent HTTP
   failures in the source manifest.
2. **Batch & prompt** — files are batched (`--batch`, default 8) and each
   batch gets a prompt built from: the CAVE writing card (shared with the
   MCP server), the spec §14 extraction rules, your `--instructions`
   markdown verbatim, a **relevant slice of existing knowledge** (store
   stats, most-connected entities as naming anchors, FTS matches for the
   batch's path tokens), and the file list (`--embed` inlines contents for
   agents without file access; URL sources always embed their extracted
   text). Prompts are built lazily, so batch N sees what batches 1…N−1
   recorded.
3. **Run the agent** — the `--agent` shell template runs once per batch:
   the prompt is piped to stdin and `{prompt-file}`, `{mcp-config}`,
   `{db}` are substituted. Each value is shell-quoted — paths with spaces
   or metacharacters stay single arguments — so write placeholders bare,
   without wrapping quotes. Strict mode is the default: every generated MCP
   config and `{db}` substitution points at an isolated staging store, and
   the complete run merges into the requested database only after every batch
   succeeds. Failed batches keep their files eligible for the next run; the
   report shows per-batch deltas and one status for every source.

## API access: context slice + full tools

Neither extreme works — dumping the whole database into prompts stops
scaling, and tools-only leaves the model blind to naming conventions. So
ingestion injects the small relevant slice described above **and** hands
the agent the full engine through MCP: `{mcp-config}` points at a
generated client configuration for `cave mcp --db …`, giving `cave_query`
/ `cave_search` / `cave_about` (check before writing), `cave_lint`
(validate), `cave_add` (record), and even `cave_reconstruct`.

## Recipes

**Claude Code (headless):**

```sh
cave ingest 'src/**/*.ts' --db k.db \
  --agent 'claude -p --mcp-config {mcp-config} --allowedTools "mcp__cave__*" --permission-mode acceptEdits'
```

**Copilot CLI** (no stdin prompt — pass the prompt file):

```sh
cave ingest 'docs/**/*.md' --db k.db \
  --agent 'copilot -p "$(cat {prompt-file})" --allow-tool cave'
```

(Register the MCP server once with your client if it doesn't take a
per-run config; the generated `{mcp-config}` file shows the exact
command.)

**Web pages** — URLs mix freely with file globs; the page is fetched,
readability-extracted, and embedded into the prompt:

```sh
cave ingest https://example.com/blog/architecture 'docs/**/*.md' --db k.db \
  --agent 'claude -p --mcp-config {mcp-config} --allowedTools "mcp__cave__*"'
```

**Any command, no MCP** — `--stdout` mode: the agent prints only CAVE
text (optionally in a ```` ```cave ```` fence); the orchestrator lints and
stores it:

```sh
cave ingest 'notes/*.md' --db k.db --stdout --embed \
  --agent 'llm -m your-model'
```

**Explicit partial progress** — `--lenient` commits valid output batch by
batch and continues after agent or parse failures. It still exits 1 when any
source is rejected, and rejected sources receive no digest so the next run
retries them. This also preserves healthy sources when another URL fails to
fetch. `--json` emits the complete manifest (`accepted`, `rejected`,
`skipped`, or `not-run` for every matched source), including URL failure kind,
HTTP status, and retryability:

```sh
cave ingest 'notes/*.md' --db k.db --stdout --lenient --json \
  --agent 'llm -m your-model'
```

**Claude/Copilot SDK scripts** — two options:

- `--plan` emits the batches as NDJSON (`{ files, prompt, mcpConfig, db }`
  per line); your script drives the SDK and writes via MCP or `cave add`.
- The library API takes a function agent:

  ```ts
  import { run } from '@cavelang/ingest'
  import { open } from '@cavelang/store'

  const store = open('k.db')
  await run({
    db: 'k.db', store, patterns: ['docs/**/*.md'],
    mode: 'stdout', embed: true, // policy defaults to strict
    agent: async prompt => (await anthropic.messages.create({
      model: 'claude-sonnet-5', max_tokens: 2048,
      messages: [{ role: 'user', content: prompt }]
    })).content[0].text
  })
  ```

## Design decisions

- **Agent-agnostic by construction.** The orchestrator never links an LLM
  SDK; agents are shell commands or injected functions. This is what makes
  Claude Code, Copilot CLI, both SDKs, and anything else all first-class.
- **Hybrid context** (relevant slice + tools) over full-dump or
  tools-only, for the reasons above.
- **Provenance as claims** rather than a sidecar state file — the store
  remains the single source of truth, and digest history is queryable
  (`?f HAS ingest-digest: ?d`).
- **Extraction output carries source spans** (spec §9.5, §9.8). Embedded
  content is line-numbered in the prompt, and the extraction rules ask the
  model for the smallest supporting `@src:path#Lx-Ly` anchor using a printed,
  percent-escaped source identity. Claims
  arriving without one are stamped anyway — in MCP mode by the `cave mcp`
  server (`@src:agent/<client-name>`), in stdout mode by the orchestrator
  (`@src:ingest`, the stable ingestion-surface identity, so a fact
  without authored provenance keep one stable ingestion series across source
  revisions). A line span remains a pointer into the digested source version;
  retain or version that source when immutable evidence is required.
- **Strict unless lenient is named.** Strict mode snapshots current knowledge
  into an isolated store, lets earlier successful batches inform later
  prompts there, and performs one identity-preserving merge only if the whole
  run succeeds. A fatal fetch/input error, agent exception/non-zero exit, or
  stdout parse problem commits no claims or digests. Strict stops at the first
  failed batch, avoiding later paid-agent calls; its manifest marks untouched
  sources `not-run`. `--lenient` is the deliberate partial-progress mode: it
  attempts every batch, commits valid lines even from a rejected stdout batch
  (spec §1.6), and records digests only for accepted sources.
  URL selection is source-isolated under both policies: any failed URL rolls
  the strict run back before an agent call, while lenient mode continues with
  healthy files and URLs.

## Exit codes, retries, and agent calls

- Exit 0 means every attempted source was accepted or skipped unchanged.
- Exit 1 means at least one source was rejected or left `not-run`. In strict
  mode `applied: false` and `added: 0` guarantee the requested store did not
  receive the staged run. In lenient mode accepted claims may have committed;
  inspect the source manifest rather than treating exit 1 as “nothing wrote.”
- Accepted sources get digest claims and skip on an unchanged rerun. Rejected
  and strict `not-run` sources get no new digest and remain eligible. `--force`
  also retries accepted unchanged sources explicitly.
- Strict mode stops invoking the agent after the first fatal batch. Lenient
  mode invokes it for every selected batch, which can incur paid calls even
  after an earlier rejection. Selection/fetch failures happen before calls.

## Tests

```
pnpm --filter @cavelang/ingest test
```

Glob/batch/digest units, context slices, prompt assembly for both modes,
readability extraction and URL selection (fake fetch plus a real local
http server), and end-to-end runs with fake shell and function agents:
incremental skips, growing staged context between batches, strict rollback,
lenient source manifests and retry behavior, paid-call stopping, MCP-mode
delta reporting, CLI exit codes, and fence extraction.
