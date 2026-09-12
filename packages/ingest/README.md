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

Direct `Web.select` calls capture force-refresh policy, the fetch implementation
and cancellation signal before starting requests. Mutating caller options during
parallel fetches cannot turn a forced refresh into a skip or convert cancellation
into an ordinary source failure. Cancellation is checked again before results
are returned. Selection fetches at most eight URLs concurrently, retaining the
first occurrence order of unique URL strings in its results. A failed request
releases its slot for the next source; cancellation prevents queued requests
from starting. This bounds active fetches, not total response sizes or the
selected content retained for subsequent batches.

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
   append-only store. Digest comparisons use the exact text, including leading
   zeros when all 12 hexadecimal characters happen to be decimal digits;
   provenance export/import preserves that spelling. Paths that are not valid entity atoms (for example,
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
   failures in the source manifest. HTTP error responses release their unread
   bodies before reporting failure; cleanup errors do not replace the HTTP
   status or its retry classification.
   Unprintable fetch or body-read exceptions remain retryable network failures,
   with `[unprintable thrown value]` in the diagnostic. Healthy sources remain
   selectable and corrected requests can be retried. Selection does not record
   digest claims; applying sources follows the selected strict or lenient policy.
2. **Batch & prompt** — `selectBatches` captures its validated batch size,
   cancellation signal, source lists and selection settings before reading
   sources. Changes to caller options during URL fetching cannot alter the
   resulting batch plan. Direct `buildPrompt` calls capture their instructions,
   context and mode before formatting, and read each file's path and content
   once. Getter-backed inputs therefore cannot make a displayed filename differ
   from its source citation or lose content between checking and numbering it.
   A later call reads fresh values. The exported `promptFor` wrapper likewise
   captures file paths, selected content and prompt settings before context
   lookup or file reads, so those stages use the same source selection.
   Files are batched (`--batch`, default 8) and each
   batch gets a prompt built from: the CAVE writing card (shared with the
   MCP server), the spec §14 extraction rules, your `--instructions`
   markdown verbatim, a **relevant slice of existing knowledge** (store
   stats, most-connected entities as naming anchors, FTS matches for the
   batch's path tokens), and the file list (`--embed` inlines contents for
   agents without file access; URL sources always embed their extracted
   text). Local file digests and path-based drift checks hash the original bytes;
   invalid UTF-8 bytes cannot collapse to the same replacement text and appear
   unchanged. Path-reading agents can still receive binary files. Embedded local
   sources must decode as valid UTF-8, with a source-specific error on invalid
   bytes. Existing valid-UTF-8 file digests stay compatible; non-UTF-8 files whose
   older digest was based on replacement text become eligible for ingestion.
   Prompt file labels also quote control-bearing names on one line, using the
   same JSON escaping as decoding diagnostics. The encoded source context keeps
   the exact path, and embedded content retains its source line numbers. Ordinary
   file labels remain unchanged in both MCP and stdout prompts.
   Human-readable dry-run and source-status path labels use the same escaping,
   so control characters do not split their labels. JSON reports and plan records
   retain the original path values for programmatic use.
   Changed-source and read-failure diagnostics use the same path escaping;
   control-bearing filesystem error details are quoted too, so they do not
   reintroduce line breaks inside a source-failure message.
   Instruction files also require valid UTF-8. A decoding failure reports the
   instruction path before the agent is called for that batch; correcting the
   file permits a normal retry.
   Decoding-error paths containing control characters or Unicode line/paragraph
   separators use a quoted JSON-escaped label, keeping the diagnostic on one
   line while preserving the exact path. Ordinary path labels remain literal.
   Shell agents enable strict UTF-8 stdout validation before interpreting claims
   or evaluation output. Malformed captured stdout fails the batch; its decoded
   text is diagnostic output and cannot become accepted claims or digests.
   Embedded local text is retained at selection alongside its digest,
   so edits or removal before a later batch cannot substitute different text
   under the old digest. Changed files remain eligible on the next run. This
   snapshot applies to embedded input; agents reading paths directly still
   control their own file reads. Path-based batches recheck the selected digest
   before and after the agent call. A changed or unreadable source rejects its
   batch without a new digest; a pre-call failure avoids the agent call. Strict
   mode discards the staged run. Lenient mode continues with later batches and
   retains earlier work and any direct agent writes, but rejects that batch's
   stdout. These checks detect observed drift; they cannot prove what an agent
   read between checks. Use `--embed` to supply the selected text itself. Store
   context is built lazily, so batch N sees what batches 1…N−1 recorded. URL
   context lookup decodes valid percent escapes before deriving search tokens,
   so encoded names such as `caf%C3%A9` can match `café`. Malformed URL escapes
   stay literal; NUL separates tokens. Literal file names, source identities and
   digest bookkeeping retain their original spelling.
3. **Run the agent** — the `--agent` shell template runs once per batch:
   the prompt is piped to stdin and `{prompt-file}`, `{mcp-config}`,
   `{db}` are substituted. Each value is shell-quoted — paths with spaces
   or metacharacters stay single arguments — so write placeholders bare,
   without wrapping quotes. Templates run explicitly through `/bin/sh` on
   POSIX and PowerShell 7 (`pwsh`) on Windows; the shared process boundary bounds
   stdout/stderr and kills the whole child tree on timeout. Strict mode is the default: every generated MCP
   config and `{db}` substitution points at an isolated staging store, and
   the complete run merges into the requested database only after every batch
   succeeds. Failed batches keep their files eligible for the next run; the
   report shows per-batch deltas and one status for every source.

Programmatic `run` accepts only `mcp` or `stdout` as its output mode; omission
defaults to `mcp`. Other values, including null or a misspelling, throw `TypeError`
before staging or agent calls. An invalid mode cannot certify source digests
while silently ignoring stdout claims.

The exported `runShellAgent` adapter captures its cancellation signal and stdout/
stderr byte limits once before forwarding them to the process runner. Changing
getters cannot drop an already-requested cancellation or enlarge an output limit.

It rejects unpaired Unicode surrogates in
prompt strings before starting a process, returning `code: null`, empty stdout,
and an encoding diagnostic. Valid Unicode, including an explicit replacement
character, is transmitted unchanged. This keeps direct JavaScript callers from
silently changing prompts during UTF-8 stdin encoding.

## API access: context slice + full tools

Neither extreme works — dumping the whole database into prompts stops
scaling, and tools-only leaves the model blind to naming conventions. So
ingestion injects the small relevant slice described above **and** hands
the agent the full engine through MCP: `{mcp-config}` points at a
generated client configuration for `cave mcp --db …`, giving `cave_query`
/ `cave_search` / `cave_about` (check before writing), `cave_lint`
(validate), `cave_add` (record), and even `cave_reconstruct`.

Existing-knowledge context searches each distinct path token once per batch and
stops searching when its related-claim limit is reached. Shared directory names
do not cause repeated lookups; the first-seen token and claim order is retained.
`Context.contextFor(store, paths, limit)` defaults to 40 related claims and
requires a non-negative safe integer, validated before store reads even for an
empty store. Zero retains statistics and naming anchors without related claims.
This limits the related-claim count, not the size of individual claims or the
work required to collect store statistics and naming anchors.
Multiline comments remain comment lines within each indented related-claim
block. Their line endings are normalized in the prompt without changing stored
comments; one commented claim still counts as one related claim.
Context statistics, naming anchors and related claims exclude retractions.
Related claims also exclude superseded rows, so historical matches cannot
replace a current value in the prompt. Each token retrieves at most five current
search results; historical rows are filtered before the limit so repeated
revisions cannot crowd out other current matches.

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

URL failure diagnostics quote and escape control characters in source URLs,
network error details, and HTTP status text. This keeps each diagnostic readable
on one line. Structured failure paths and JSON plan source fields retain the
original URL; failure classification and retry policy are unchanged.

HTML extraction applies to `text/html` and `application/xhtml+xml`, ignoring
media-type casing and parameters. Other declared types pass through as text;
an HTML-looking body is detected only when the media type is empty. A parameter
containing the word `html` does not change how the source is extracted or digested.
Non-HTML responses preserve a leading UTF-8 BOM in their content and digest,
matching embedded local-file decoding. Adding or removing that character makes
the source eligible for ingestion again. Previously recorded URL digests that
omitted a BOM will also cause one new selection when the source still has it.

HTML line breaks separate words in ordinary text and remain line breaks inside
preformatted blocks. Empty ordinary blocks do not generate heading or list
markers, so adding an empty list item does not change the extracted digest.
Outermost preformatted blocks also retain leading
indentation, trailing spaces and blank boundary lines. A title is omitted only when the extracted text
already starts with the complete matching title line; a longer line with the
same prefix does not suppress it. A title-only page emits just its heading,
without trailing blank lines, so an empty body and a matching body heading
have the same extracted content and digest. Nested paragraphs, quotes and list items retain word
separators when their containing block is flattened; inline markup does not
split words. Table captions, header cells and data cells are retained in document
order, so column and row labels are not discarded. Definition terms, definition values,
and address elements are also retained as separate blocks. Adjacent address
blocks keep their word boundaries; nested addresses stay within their containing
block, and inline markup within a name does not split it. Structural containers
such as sections, articles and figures also separate adjacent text. They retain
nested headings and preformatted blocks rather than flattening the whole
container; inside an already flattened block, their boundaries separate words.
Articles without recognized blocks or containers fall back to their body text. When recognized blocks are present,
text before, between and after them is retained in document order too; inline
markup within that text does not split words. This is flattened text, not a
reconstruction of table spans or grid layout. Correcting omitted text or
a formerly joined block boundary changes the extracted
text and makes that URL eligible for ingestion again. This readable text supplies
both the content digest and the
numbered lines shown to the agent; those line numbers refer to extracted text,
not the original HTML markup.

Embedded source prompts number LF, CRLF and CR line endings consistently,
including blank lines. Prompt formatting does not rewrite the selected source
content or its digest.

**Any command, no MCP** — `--stdout` mode: the agent prints only CAVE
text (optionally in a ```` ```cave ```` fence with LF or CRLF line endings);
the orchestrator extracts the fenced claims, lints and stores them.

Complete `cave` and unlabelled backtick or tilde fences are extracted in order;
blocks labelled with another language are skipped. Closing fences must match
the opening character and use at least as many markers, so shorter backtick
runs inside a wider fence remain content. LF, CRLF and CR line endings are
preserved inside extracted bodies. If no complete eligible block exists, the
whole reply goes through ordinary CAVE validation.


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

`--json` applies to execution results and cannot be combined with `--plan` or
`--dry-run`. These combinations fail before opening the store or fetching
sources. Use `--plan` by itself for machine-readable planning output.

**Claude/Copilot SDK scripts** — two options:

- `--plan` emits the batches as NDJSON (`{ files, prompt, mcpConfig, db }`
  per line); your script drives the SDK and writes via MCP or `cave add`.
  The shared configuration is created only after the first batch prompt is
  ready. Empty plans and first-prompt preparation failures allocate no configuration.
  An emitted plan retains its configuration for the external driver, which owns
  cleanup of that file and its containing temporary directory after use.
- The library API takes a function agent:

  ```ts
  import { run } from '@cavelang/cli/ingest'
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

## Cancellation and source fetching

Programmatic `run` and `selectBatches` accept an `AbortSignal`. Cancellation
stops URL requests and shell-agent processes, prevents later batches and
withholds pending stdout results and strict staged publication. A cancelled
operation rejects with the signal's reason unless an agent also throws another
exception. An agent exception that already contains the reason through its cause
or aggregate members keeps its identity and diagnostics. Otherwise cancellation
and the agent exception are combined in an `AggregateError`, with the reason
first and as cause. Later cleanup failures retain that exception chain. Without
cancellation, agent exceptions continue to produce failed-batch reports.
Strict runs discard staged claims
and digests; lenient runs retain previously accepted batches and any direct
agent writes already made to the target store.

In-process agents receive the same signal as `AgentContext.signal` and should
pass it to their own asynchronous work. An adapter that ignores it must settle
before ingestion can clean up its stage; cancellation does not forcibly stop
arbitrary JavaScript or undo external side effects. Synchronous file reads and
database operations finish before the event loop can observe cancellation.
`Web.select` also accepts a signal, and `Web.fetchDocument` accepts it as the
optional fourth argument, combined with its existing request timeout. With the
built-in fetch, that timeout covers receipt of the response body as well as
headers; a server that sends headers and then stalls cannot keep the read open
indefinitely. Each call receives a fresh timeout signal, so a timed-out request
does not cancel a later retry.
URLs must contain well-formed Unicode. Unpaired UTF-16 surrogates reject before
fetching, so the requested resource cannot silently change through replacement
encoding. Valid accented and emoji URL paths remain supported.
Its timeout argument uses seconds resolving to whole milliseconds in
0..2147483647; decimal values such as `1.001` are accepted as 1001 ms.
Invalid settings reject before fetching, without classifying the configuration
error as a retryable network failure. Zero requests an immediate timeout.
Response bodies must be valid UTF-8 before text extraction or digesting.
Malformed bytes are reported as retryable network failures instead of being
silently replaced in source content. Valid Unicode, including an explicitly
encoded replacement character, is preserved. Other healthy sources remain
selectable, and a corrected response can be selected on a later attempt.
A leading UTF-8 byte-order mark is removed, retaining the previous text-decoding
behavior.
Strict ingestion rejects a selection containing malformed response bytes before
calling the agent. Lenient ingestion can accept healthy sources from the same
selection. A rejected response gets no completion digest: once corrected, it
can be ingested normally, and subsequent unchanged responses are skipped.

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
- **Strict unless lenient is named.** The programmatic `policy` accepts only
  `strict` or `lenient`; omission defaults to `strict`. Other values, including
  null or a misspelling, throw `TypeError` before staging or agent calls.
  Strict mode takes an exact SQLite snapshot, preserving stored claim data
  and explicit provenance in an isolated store, lets earlier successful batches inform later
  prompts there, and performs one identity-preserving merge only if the whole
  run succeeds. The run captures its target store, cancellation signal and other
  settings before staging, and copies the source pattern and literal-file lists.
  Replacing caller options during an agent call cannot redirect the final merge
  to another store or change the run's configuration.
  A conflicting existing identity at commit throws and leaves
  the target unchanged; success is reported only after the merge succeeds.
  Staging requires the adapter's exact-snapshot capability and no caller-owned
  transaction; it fails before invoking an agent if either requirement fails.
  A fatal fetch/input error, agent exception/non-zero exit, or
  stdout parse problem commits no claims or digests. Strict stops at the first
  failed batch, avoiding later paid-agent calls; its manifest marks untouched
  sources `not-run`. `--lenient` is the deliberate partial-progress mode: it
  attempts every batch, commits valid lines even from a rejected stdout batch
  (spec §1.6), and records digests only for accepted sources.
  URL selection is source-isolated under both policies: any failed URL rolls
  the strict run back before an agent call, while lenient mode continues with
  healthy files and URLs.

## Resource cleanup

Prompt files and the generated MCP configuration share one run-owned temporary
directory; removal is attempted on completion or failure, including configuration
setup failure. The standalone `writeMcpConfig` helper attempts to remove a directory it allocated
if configuration creation fails; a supplied `dir` remains caller-owned and is
never removed by the helper. The helper reads `dir` once and retains that
ownership decision through failure cleanup, including getter-backed options.
After a successful standalone call, the caller
owns cleanup of the returned file and any allocated directory.

Cleanup preserves in-flight exceptions. If prompt-directory removal, strict-stage
close/removal, or standalone configuration cleanup also throws, the new
`AggregateError` retains the prior exception and cleanup exception in that order,
with the prior exception as `cause`. Nested cleanup failures retain the earlier
aggregate and include all diagnostics in the message. Unreadable message getters
or failing string conversions use `[unprintable thrown value]` without replacing
the original errors; combined cancellation/work failures use the same formatter.
Cancellation traversal reads each cause once. If a cause or aggregate-member
accessor throws, the original error remains intact and cancellation is retained
separately unless another readable branch already contains its reason.
Ordinary function-agent failures also use this formatter for batch notes, so
unreadable diagnostics do not bypass strict/lenient batch handling. Strict mode
stops after the failed batch with staged writes isolated; lenient mode retains
its direct writes and continues later batches. Selected-source read diagnostics
use the same fallback text.
A single failure keeps its original identity. Outer cleanup is still attempted after inner cleanup fails.
This combines thrown exceptions, not unsuccessful batch reports returned as
values. A strict-stage close failure prevents the merge; a stage-directory
removal failure after a successful merge does not undo committed claims. Lenient
claims committed before prompt cleanup also remain committed. Cleanup attempts
do not guarantee release when the underlying filesystem or database operation
fails.

`runIngest` reads its context's cancellation signal once before opening the store.
Planning, source selection, agent execution and the final cancellation check all
use that captured signal, including when the context exposes a getter or changes
during awaited work. Cancellation of the original signal continues to govern the
command for its full lifetime.

Command diagnostics use the same safe formatter for simultaneous output and
final-close failures. An unreadable message cannot replace their original
aggregate members or operation cause.

The command entry point owns its final database handle and attempts to close it
once after planning, execution or output rendering settles. If command work and
that final close both throw, `runIngest` rejects with an `AggregateError` whose
ordered `errors` are the original failure and the close failure, with the
original failure as `cause`; its message includes both diagnostics. A single
failure retains its original identity. Completed output and previously committed
claims are not undone by a final close failure. A close-only failure still
rejects instead of returning a successful exit code. This contract concerns the
command's final store handle; the staging and temporary-file lifetimes remain
separate boundaries.

## Options and limits

Batch sizes (`--batch`, `Options.batchSize`, and `Files.batch`) must be positive
safe integers. Source selection validates the size before reading files or
fetching URLs, including when no sources match. The CLI rejects invalid sizes
before opening the database.

Programmatic `force`, `embed` and `noPrelude` flags must be booleans when
supplied; omission means false. `run` validates them before staging or source
handling. `selectBatches` validates its source-selection flags (`force` and
`embed`) before reading inputs. The lower-level `Files.select` and `Web.select`
APIs apply the same flag validation before reads or fetches. File selection
captures `force` and `embed` once for the entire batch, so changing getters
cannot alter refresh or embedding behavior between files. `writeMcpConfig` validates `noPrelude` before
creating a directory or replacing a configuration file. Malformed values return
errors rather than silently selecting false; corrected calls can be retried.
Generated configs locate the MCP executable beside its exported module, so the
same configuration writer works in the source workspace and the installed
consolidated CLI package.

`--timeout` and the ingestion API's `timeoutSeconds` accept 0.001 through
2147483.647 seconds in whole-millisecond increments (default 600 seconds).
Programmatic timeout values must be numbers; strings, booleans and objects
are rejected without numeric coercion. Explicit null is invalid; only omission
selects the default timeout. The same rule applies to `batchSize`, which must
be a positive safe integer when supplied (default 8). Both `run` and
`selectBatches` validate these limits before source selection, and `run` also
validates batch size before creating its staging database. CLI numeric text is
parsed separately.
Invalid limits fail before database opening in the CLI and before staging or
source reads in the API. Decimal values such as 1.001 seconds are converted to
1001 milliseconds without floating-point rounding rejection. The timeout bounds
shell-agent processes; function agents remain responsible for their own deadline
and receive the cancellation signal.

## Source identity

Source and instruction-file reads, glob expansion, and matched-file inspection
escape control characters in the displayed path and filesystem error message. The original filesystem error remains available
as `error.cause`, including its code and exact path, for programmatic diagnosis.
Corrected selections can be retried; a failed read records no source digest.

Source collections must be arrays of primitive strings: `patterns` and optional
`files` on `run`/`selectBatches`, patterns on `Files.expand`, paths on
`Files.select`, and URLs on `Web.select`. Each complete list is captured and
validated before selection reads files or fetches URLs. Later caller mutations
do not replace queued URLs, batch source paths, or run-manifest identities.
Strings, sets, sparse
arrays and non-string entries throw `TypeError`; a string is never interpreted
as individual source characters. Omitted `files` defaults to an empty list,
while an explicit null is invalid. Empty arrays remain valid.

Source strings, instruction paths and explicit working directories must contain
well-formed Unicode. Unpaired UTF-16 surrogates throw `TypeError` before
source access or URL fetching instead of being replaced with `�` and
reading a different source. Literal replacement characters, accented names and
emoji remain valid. Working-directory options must be strings when supplied;
omission selects the current directory. `run` captures and validates `cwd`
before creating a strict staging database or temporary prompt directory, so
invalid options fail without that setup work.

Run-level selection removes identical path strings after combining expanded
globs and literal `files`; URL selection likewise removes identical URL strings.
Different spellings remain separate source identities: `source.md`,
`./source.md` and an absolute path can each be selected and digested even when
they read the same file. Selection does not resolve those identities through
real paths or inode equality. Use consistent path spellings across calls when
the intent is one source and one incremental digest history.

New digest provenance for filenames containing a newline uses a deterministic
percent-encoded code literal, keeping each exported claim on one line. Lookup
uses the same identity, including after strict export/import. A filename that
literally spells the encoded text retains a separate entity identity. Existing
historical claims are not rewritten; a previously recorded raw-newline digest
is no longer used as the skip key and the source is selected again. This does
not repair exportability of already stored raw-newline claims.

## Source revisions and removal

An ingestion digest records successful processing of a source version. It is
not an ownership list for the claims extracted from that source. When a changed
source is extracted again, a new value for the same claim key supersedes the
previous value normally. Claims omitted from the new output remain current:
for example, extracting a revised timeout without the earlier `service USES
redis` relation does not retract that relation. An accepted empty extraction
records the new digest and leaves existing knowledge in place.

A file that disappears from a glob produces no selected source and causes no
retraction or digest removal. Restoring the same bytes under the same source
identity can therefore skip extraction using the retained digest. A missing
explicit literal `files` path is still a read error. These rules apply to both
strict and lenient ingestion; strict staging governs application of a run,
without adding ownership reconciliation.

Use explicit retractions when an extraction should withdraw earlier knowledge.
For deterministic mappings that must reconcile changed or disappeared records,
use [structured source reconciliation](../connect/README.md), including its
`--prune` behavior. Keep source spans and retained source versions when claims
need durable evidence; the digest alone does not identify which output claims
belong exclusively to a file.

## Exit codes, retries, and agent calls

Successful MCP-mode batch notes contain the agent's final output line after
trimming surrounding whitespace. LF, CRLF and CR line endings are recognized;
earlier progress lines are omitted. Empty output adds no note. The recorded
claim count comes from database changes, not the number stated in the note.

The final source manifest indexes completed batch membership once per run,
instead of rescanning every batch for each source. Source-to-batch association
therefore takes linear work in the selected and reported paths, with one index
entry per reported path. This does not bound agent, database or source-reading
costs. Files in one batch share its number and failure note; strict unrun sources
have no batch number. Function agents receive a separate file-list array, so
adapter mutation cannot relabel completed batches, turn their sources into
`not-run`, or alter an already returned report. The recorded membership and
digest selection use the original selected paths.

- Batch `added` counts claims appended during the batch, including direct agent
  writes in stdout mode as well as parsed stdout claims, before digest bookkeeping.
  A strict rejected run can expose discarded direct writes in its batch count
  while the top-level `added` remains zero. Direct writes alone do not set `partial`.
- Batch `partial: true` identifies valid stdout claims accepted alongside parse
  problems in lenient mode. Source and agent failures never carry this flag,
  even if a direct agent committed writes before failing.
- Exit 0 means every attempted source was accepted or skipped unchanged.
- Exit 1 means at least one source was rejected or left `not-run`. In strict
  mode `applied: false` and `added: 0` guarantee the requested store did not
  receive the staged run. In lenient mode accepted claims may have committed;
  inspect the source manifest rather than treating exit 1 as “nothing wrote.”
- Source `accepted` describes its batch outcome, not publication to the target.
  A later failure in strict mode discards earlier accepted batches and their
  staged digests too: check top-level `applied` before treating them as committed.
  Text output explicitly says that no staged claims or source digests were
  applied when a strict run is discarded.
- Top-level `failed` counts unsuccessful batches plus failed URL selections,
  not rejected source entries. Several files can share one failed batch; count
  `sources` with status `rejected` when a per-source total is needed.
- Committed accepted sources get digest claims and skip on an unchanged rerun.
  A discarded strict run leaves all its newly selected sources eligible,
  including those reported as accepted. Rejected and strict `not-run` sources
  get no new digest. `--force` also retries accepted unchanged sources explicitly.
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
