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

1. **Select** — globs expand (`fs.globSync`), URLs are fetched with the
   built-in `fetch` (HTML is reduced to its readable article text with
   [@mozilla/readability](https://github.com/mozilla/readability) over
   linkedom; markdown/plain/JSON bodies pass through verbatim), and
   sources whose content was already ingested are skipped: after each
   successful batch the orchestrator records `<path-or-url> HAS
   ingest-digest: <sha256/12> @src:cave-ingest` — provenance as ordinary
   CAVE claims, so incremental re-runs come free and live in the same
   append-only store. A URL's digest is taken over the *extracted* text,
   so a page re-ingests only when its readable content changes.
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
   `{db}` are substituted. Failed batches keep their files eligible for
   the next run; the report shows per-batch claim deltas.

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
    mode: 'stdout', embed: true,
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
- **Failed batches record nothing**, so a re-run retries exactly the
  files that didn't make it.

## Tests

```
pnpm --filter @cavelang/ingest test
```

Glob/batch/digest units, context slices, prompt assembly for both modes,
readability extraction and URL selection (fake fetch plus a real local
http server), and end-to-end runs with fake shell and function agents:
incremental skips, growing context between batches, failure retry,
MCP-mode delta reporting, fence extraction.
