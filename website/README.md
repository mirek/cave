# CAVE website

The Vite/React site for the CAVE landing page, documentation, and browser playground.

The development server uses the pinned Vite dependency and its checked-in
shutdown patch, which settles optimizer work and prevents late watched-file
additions from reopening a closed watcher. Install through the workspace's pnpm
lockfile so the patch applies. The cold-cache and shutdown-hook regressions run
with `pnpm test`; see
[dependency maintenance](../DEPENDENCY-MAINTENANCE.md#vite-build-and-development-server-checks)
for the patch rationale and upgrade checks.

Inline documentation code keeps short tokens such as `--prune` together when
they reach a line boundary. Long identifiers still wrap within the article
width, so narrow screens do not overflow. Fenced code retains its separate
scrollable presentation.

Playground query output preserves ordinary binding text and its existing CAVE
quotes. A binding containing control characters is shown as a quoted, escaped
string, so embedded NUL, newlines and other invisible controls remain visible.
This affects display only; the stored and queried values retain their bytes.

Browser tab titles identify the current page or documentation article, including
missing-page destinations and failed page downloads. A failed route identifies
the load error in its tab title; navigating home or reloading successfully
restores the destination title. Returning to a page after a transient rendering
error also restores its title when the page renders successfully. Error state
resets with the rendered route; revisiting a cached failed module keeps the
error title, without a later hashchange reset erasing the failure report.
Navigating to another documentation article retries rendering after an error;
ordinary article navigation preserves the documentation filter. Section links
within the same article do not reset the error boundary.
Article section links retain the article's title;
reloads and browser history restore the destination title. Primary navigation
marks the active Docs or Playground area with `aria-current="location"`,
so assistive technology receives the same route state as the visual highlight.
Home and unknown top-level routes have neither area marked current.
The homepage tutorial section also links to the examples guide, where readers
can choose a smaller workflow and check its CLI, agent or solver requirements.
Home, playground and missing-page destinations focus their main heading when
their content is ready, including after keyboard navigation and browser Back.
Fresh navigation starts at the top; history restores the visit's saved reading
position. Lazy playground loading completes before focus and position restoration.
These headings stay outside the ordinary Tab sequence; documentation retains
its article and section focus behavior described below.
Delayed page downloads expose a polite loading status; the decorative pulse is
hidden from assistive technology, and the status disappears when the destination
loads.
Leaving a delayed Docs or Playground download keeps the new route active:
late success or failure does not replace its content, title or keyboard focus.

A “Skip to content” button precedes the site navigation in keyboard order and
becomes visible when focused. Activating it focuses and reveals the main heading
below the sticky header, bypassing the documentation sidebar as well as the
header links. It measures the current header height so enlarged headers do not
cover the focused heading. It preserves the current URL and browser history. While a route
is loading, it targets the main loading region until a heading is available.
When that download finishes, focus moves to the loaded page heading or, if the
download fails, to the recovery heading. From the recovery heading, Tab reaches
the Reload page button. Delayed Docs and Playground downloads exercise both
outcomes without changing the current URL.

Reference tables preserve whole words and numeric values. Wide tables scroll
horizontally within the article; only overflowing tables enter the Tab sequence
and announce “Scrollable documentation table”. Arrow keys scroll the focused
table. Resizing recalculates overflow and removes the extra stop when it fits.
When a table receives keyboard-visible focus, it reveals its heading below the
measured sticky site header, including when the header
grows beyond the default anchor offset. This keeps column headings visible in
short viewports while retaining horizontal scroll position. Pointer clicks on
cells and focus moving to links inside a table retain their normal behavior.
The report-table checks cover 320 px and 390 px screens, a 600 px-tall viewport,
and desktop layout, including lower-row pointer clicks after keyboard use.
Inline code inside reference tables stays on one line, keeping command flags
such as `--as-of` intact. A table that needs more width uses the same horizontal
scrolling and keyboard access instead of splitting those tokens.

Homepage capability cards use the same code wrapper as the hero example, so
long shell commands and rules support arrow-key scrolling with a visible focus
outline. Examples that fit their card do not add a Tab stop; resizing updates
that decision. The source remains selectable and retains its highlighting.

Documentation and homepage code examples follow the same overflow rule: wide examples expose
“Scrollable code example” as a focusable region with a visible inset outline.
Keyboard-visible focus reveals the beginning of a tall example below the
measured sticky header, even when the page was scrolled into its middle, while
preserving horizontal scrolling. Tables and code examples share this behavior.
A next-frame clearance check handles native focus scrolling queued after the
focus handler; it only acts while the same connected region retains keyboard-visible
focus. Route and history scrolling use their existing immediate behavior.
Arrow keys scroll the focused example. Examples that fit have no additional
Tab stop or region label. Container and code-width changes recalculate overflow,
including resizing and font loading; source text remains selectable.

```sh
pnpm site:dev
pnpm site:build
pnpm --filter @cavelang/website test
pnpm --filter @cavelang/website test:browser
```

The production browser suite follows the Book link's resolved URL and checks
that GET serves the current checked-in PDF byte for byte with a PDF content
type. HEAD must succeed with the same content type and no response body. A stale
build containing an older book therefore fails this check; rebuild the site
after updating `public/cave-book.pdf`.

Documentation pages import every package README plus the repository's primary
guides directly, so package docs and the website share one source. Relative
links to bundled documents stay on the site, including package-directory links
that resolve to a README. Encoded filenames and repository-root paths are matched
against the same document list, including literal `#`, `?` and `%` in filenames.
Source paths are encoded before resolving relative links; encoded slashes do
not become directory separators when matching bundled pages.
The “Edit on GitHub” footer uses the same path encoding so filename punctuation
cannot turn into a query string or fragment in the edit URL.
Links carrying query parameters stay on GitHub
so options such as `?plain=1` are preserved. Other repository files also open on
GitHub. Section links
use `#/docs/<page>#<section>` and work on direct load, reload, and browser Back.
Articles with second-level headings include a collapsed “On this page” navigator
after the main heading, so keyboard readers arriving at the title can Tab to it.
A “Find another page” button follows that navigator (or the main heading when
there are no sections). It reveals and focuses the existing page filter without
changing its query, contents scope or article route, and is omitted from print.
Opening the section navigator lists the rendered headings in document order, using their
actual IDs rather than a separate Markdown slug parser. The section selected by
the URL fragment has a bold link marked `aria-current="location"`, including
encoded fragments and browser Back/Forward navigation. Missing or malformed
fragments select no link. The marker follows explicit navigation, not scrolling.
Native disclosure and
anchor controls support keyboard use; section links retain the same focus,
history and repeated-click behavior as links in the article. Following a link
to a different document replaces the section list and closes the disclosure. Back and Forward
restore the disclosure state saved for that visit before restoring its scroll
coordinates, so an expanded navigator does not shift the returning reader’s
article position. Separate visits to the same page retain independent states. It wraps on narrow screens
and is omitted from printed documentation. Missing documents have no section
navigator. Production tests cover these behaviors at 320 px and desktop widths.
Headings receive GitHub-compatible slugs with an internal `cave-doc-` prefix;
section navigation scrolls below the sticky header and moves keyboard focus to
the target. A missing section or malformed fragment escape falls back to
scrolling and focusing the destination document heading. Navigation to a
fragment only considers targets inside the article; sidebar control IDs cannot
redirect focus or change those controls' keyboard tab order. Navigation to a
documentation page without a section focuses its
main heading, so keyboard reading continues in the new content. The heading is
not added to the ordinary Tab sequence. Production tests check section targets
across every bundled document and page/section focus through browser history.
Back and Forward restore each entry's reading position after the destination
renders, including separate visits to the same documentation page. Fresh links
still start at their page or section heading. Positions are held in memory for
the current app session; reloading does not promise to restore them. History
entry identifiers do not require cryptographic UUID support, and tagging entries
preserves unrelated properties already present in history state. Route focus
continues to identify the destination heading without overriding restored scroll.
Mobile and desktop browser tests cover Back, Forward, and repeated visits.
Repeated article section clicks restore heading focus even when the URL does
not change. Selecting the current page again in the documentation sidebar also
returns to its main heading, by mouse or keyboard, including when the overview
was opened through `#/docs` or `#/docs/`. Selecting its sidebar link then uses
the canonical `#/docs/overview` URL. Modified clicks retain native browser behavior; the browser suite
also verifies middle-click opens the section in a separate tab.
Unknown documentation paths show a document-not-found message with an overview
link and the documentation navigation. Other unknown routes show a page-not-found
message with home/docs recovery links. Invalid URLs remain visible instead of
silently displaying unrelated content; recovery links preserve browser history.
When a name/group search has no matches, “Search page contents” broadens that
same query to the bundled articles and returns focus to the filter. It updates
the existing scope checkbox without changing the current article. The action
is absent for an empty query and when content search is already enabled.
The filter, contents-scope checkbox, help, live status and recovery actions
share a named “Documentation” search landmark. Assistive-technology landmark
navigation can reach these controls independently of the results navigation.
The live filter status reports the total page count when the query is empty,
including after clearing with the button or Escape. The count follows the
bundled documentation index.

Escape clears a focused documentation filter without changing the article or
moving focus. The input exposes this shortcut to assistive technology and
ignores Escape during IME composition or when Control, Meta, Alt or Shift is
held, leaving modified shortcuts unconsumed.
Down Arrow stops any pending smooth page scroll and moves focus from the filter
to the first matching page, revealing it immediately without
navigating. A next-frame correction catches deferred browser scrolling only
while that link remains connected and focused. Enter then opens that focused link, and Tab continues through the
remaining links normally. Visible help and the input's accessible shortcut list
describe this browsing action. With no matches, during IME composition, or with
modifiers, Down Arrow keeps its normal input behavior.
When exactly one page matches, Enter opens that page and focuses its article
heading. The result status announces this shortcut. Enter leaves the page
unchanged for zero or multiple matches, during IME composition, or with modifiers.
Browser checks exercise empty-result recovery and unique-match keyboard selection
at 320, 390, and 1280 pixels, covering narrow mobile and desktop layouts.

The documentation filter matches words across page labels, slugs and navigation groups in any
order, ignoring case and separators. For example, `solver z3`, `z3 solver`
and `solver-z3` find the Z3 adapter; Unicode compatibility normalization also
accepts full-width text such as `ＳＯＬＶＥＲ　Ｚ３`. Every query word must match the same page; visible help and the filter's accessible description explain this rule. `integrations` lists that group, while
`reference z3` narrows the Reference group to the Z3 adapter. Filtering changes
the navigation list. By default it searches page names and groups. Checking
**Include page contents** also matches the bundled Markdown, including API names
and code examples: `runProcessSync` finds Reconstruction loop. All query words
must still match, and existing Enter, Down Arrow and Escape behavior applies to
the resulting page list. This locates pages; it does not highlight occurrences
or jump to an individual match. The optional content search uses only bundled
documents, requires no network request, and prepares normalized text when its
scope changes instead of reprocessing each page on every keystroke. Clearing the
filter preserves the selected scope.
It has an explicit
accessible name, a polite result-status message associated with the input as its
accessible description, and a Clear filter action that
restores all pages and returns keyboard focus to the input. The current document
is marked with `aria-current="page"` in navigation.
Punctuation or symbols that normalize to no searchable words keep all pages
visible; the status explains this and asks for letters or numbers. Entering
words afterward resumes normal filtering without moving focus.
Opening a document reveals its active entry in the scrolling navigation, both
in the desktop sidebar and the horizontal mobile list. Article heading focus
and section-link scrolling remain the reading destination.
Section links measure the current sticky header and leave space above the
focused heading, including when the header grows beyond the default anchor
offset. They share the same scroll adjustment as focused code blocks and tables.
Scrollable documentation tables and code blocks disconnect their resize
observers when content is replaced or unmounted. The production browser suite
checks repeated page changes for observers retaining detached elements and
verifies that leaving documentation releases all observed content.
The browser suite also doubles example and table text from 14px to 28px at
mobile and desktop widths, checks named keyboard scrolling without page-wide
overflow, and checks that focus targets follow actual overflow after restoring
the original size. This exercises text enlargement independently of a window
resize; it is not a claim of complete browser-zoom accessibility coverage.

Printing a documentation page or saving it as PDF hides site navigation and
uses the page width for the article. Code examples and table cells wrap instead
of retaining horizontal scroll areas; the version footer remains visible. The
browser suite checks print overflow on the CLI reference, writes an A4 PDF for
visual inspection, and verifies that screen navigation returns afterward.

When filtering changes the mobile list, its horizontal scroll keeps the current
page visible if it still matches. Clearing the filter restores that visibility
while keeping focus in the filter and preserving vertical page position.

Route download/render failures show a recovery message and Reload page action
while keeping the site header available. Switching to another route can still
open it; reloading retries a failed lazy module download. Ordinary documentation
navigation preserves the filter state, including leaving for Home or Playground
and returning during the same app session. New visits inherit the current filter.
Back and Forward restore the filter and content-search scope recorded for that history entry together
with its reading position, including an empty filter. This restores the mobile
sidebar layout before scrolling. These saved filters live in memory for the
current app session; a full reload starts with an empty filter and content search off.
Browser checks cover API discovery, scope changes, focus, clearing, and history
restoration at 320 and 1280 pixels.
The recovery screen focuses its heading when it appears. The next Tab reaches
Reload page, and Enter retries the download; after a successful reload, focus
moves to the destination heading.

The site version is read from the root package manifest. The playground explicitly
injects its SQL.js adapter through `@cavelang/store/adapter` and runs the real
parser, canonicalizer, store, and query packages in a module worker against
SQLite WebAssembly. Runtime tests round-trip claim/query records from this
adapter through the shared decoders, covering uncertainty, trajectories,
literals, oversized values and rounded interpolation. They also verify rejection
of a corrupted numeric projection inside query evidence.
A rebuild loads into a separate in-memory database and swaps
it in only after strict ingestion succeeds. Malformed Unicode strings containing
unpaired UTF-16 surrogates are rejected before storage can replace their text.
If edited claims are invalid, the
error is shown while the last working database and its belief count remain
available for queries; fixing the editor and rebuilding replaces that database.
Empty claims or lines containing only spaces rebuild to an empty database;
appending them adds no claims and preserves existing beliefs. Tabs in indentation
still fail strict ingestion, including on otherwise blank lines. A blank query
reports `CAVE-Q: empty query` and leaves the database available. Correcting the
claims or query allows the next operation to run normally.
Malformed Unicode in a query reports its source line instead of silently matching
replacement characters. Production browser tests exercise both surrogate halves
through the editor and worker, then verify successful queries for explicitly
authored replacement characters, accented text and emoji without rebuilding.
The query prompt marker aligns with the first query line, including when the
multiline editor is resized vertically.

In the browser claims editor, Tab moves focus to Rebuild database; type spaces
for indentation. The editor keeps ordinary keyboard navigation available.
Claims, CAVE-Q and valid-time inputs request no spell checking, automatic
capitalization, correction or completion, so browser typing assistance does not
intentionally rewrite entity names, verbs or timestamps. These are browser input
hints; device keyboards and user settings may still affect entered text.
A production-browser regression checks alignment between the input and its
highlighted text after horizontal and vertical scrolling, mobile resizing,
source replacement, and keyboard navigation to the end of a long document.
The optional **Valid at** query field passes a date-like period or timestamp to
the shared valid-time query engine. It filters time contexts and interpolates
trajectories; blank leaves valid-time filtering off. The **Changing headcount**
sample starts at 2026, halfway from 100 people in 2025 to 400 in 2027. Invalid
dates report query errors without replacing the database, and changing datasets
restores that sample's anchor (blank for the original samples). Enter runs the
query from either query field outside IME composition. The CAVE-Q editor retains
multiline patterns, comments, and WHERE filters when pasted. Shift+Enter inserts
a newline; Enter runs without inserting one. The editor can be resized vertically
and its keyboard instructions are available to screen readers. Filter parse
errors preserve query line numbers and can be corrected without rebuilding the
database.
The **Postmortem graph** sample starts with a multiline `WHERE conf >= 70%`
filter, returning two stronger causal claims. Lowering it to `30%` includes the
earlier CDN suspicion, demonstrating that confidence filtering changes the view
without removing claims from the database.
Successful results, including empty results, and query errors show the submitted
query together with its anchor or `Valid time: unfiltered`. Editing either input
while a query runs or after it finishes does not relabel the previous result;
the next run uses the edited inputs.
**Copy result** copies the currently displayed output, including the submitted
query and valid-time context, without reading later edits from the query fields.
Only one clipboard request can be pending. Its feedback belongs to the captured
output, so completion after a new result arrives does not label the new result
as copied. Clipboard failure leaves the output intact and offers **Select result
text** for manual copying; that explicit action focuses and selects the result.
Copy feedback does not move keyboard focus. Loading and active database
operations prevent copying transient output.
Valid-time anchors follow the engine's current restriction on transitive
patterns: clear the anchor to run a transitive query. Rebuilding after a worker
failure preserves the edited claims, query and chosen anchor; selecting another
sample applies its defaults.
When the editor differs from the claims last successfully rebuilt or appended,
the query panel shows an unapplied-edits notice and describes it to assistive
technology through the query input. Queries still read the last working
database. Failed rebuilds retain the notice; successful rebuilds/appends or
restoring the last applied text clear it.
Failed rebuilds also preserve claims added with Append again, even when those
claims are no longer in the editor. A successful rebuild replaces the entire
working database with the current editor text. Browser regressions verify both
transitions at mobile and desktop widths, including corrected retry and query
results from the retained or replacement database.
Visible guidance beside the editor controls explains that rebuild removes
claims absent from the editor, while append keeps existing data. Each button
references its own guidance as an accessible description.
Download claims saves the current editor text as a UTF-8 `.cave` file named for
the selected sample, including unapplied or syntactically invalid edits. It does
not rebuild, append, or export database history and remains available during
runtime failures. Downloads stay local to the browser. Unpaired Unicode
surrogates are rejected instead of being silently replaced in the saved file.
If the browser cannot create or start a download, the result panel explains how
to retry or copy the draft. The editor and database remain unchanged, temporary
download resources are released, and a successful retry replaces the error with
a download-request confirmation. This confirms the request, not that the browser
has finished saving the file.
The result panel is a named, polite live region so asynchronous results and
worker failures can be announced. It also announces when a query or append is
running. The active button exposes its busy state, and query, append, rebuild
and dataset selection wait until the request finishes. Repeated Enter presses
cannot enqueue duplicate requests during this time. The text editors remain
usable, and controls recover after both successful replies and errors.
Query and append buttons retain keyboard focus while waiting, with an
unavailable state and appearance. If users move to an editor during the
request, completion leaves focus there. An unavailable runtime still disables
these controls until recovery.
The rebuild button also retains focus while loading and exposes its busy
state. Repeated activation cannot queue another rebuild. Success and ordinary
rebuild failures restore availability without taking focus from an editor.
The dataset selector retains focus during a load, with its options unavailable
until the pending operation finishes. Repeated selection cannot queue a second
load or change the displayed choice; switching samples works again afterward.
Recovery tests also fail a pending request fatally, edit claims while it is
waiting, rebuild into a replacement worker and query the preserved edits.
While a query is running, Stop query terminates its worker without waiting for
the query to finish. This closes the in-memory database and retains the claims,
query and valid-time editor values. Visible help beside the control explains
the loss of the database and appended history before stopping; the button
references that help as its accessible description. Focus moves to Rebuild database, which loads
the current claims into a fresh worker. Previously appended history is not
restored automatically. Browser tests check stopping and rebuilding by keyboard
at 320 px and desktop widths, including preserved edits and worker termination.
A separate production test waits for the worker to enter synchronous work,
stops it, observes the native worker close event, then rebuilds and queries the
replacement database. Its injected workload has a finite fallback; the close
must arrive within five seconds, before that workload can finish normally.
Closing a runtime rejects all outstanding open, append and query requests;
late replies cannot restore their cleared bookkeeping or reopen that runtime.
Late worker error events are ignored after closure as well: intentional
shutdown does not report a new failure, and fatal shutdown reports its original
failure only once.
Client lifecycle tests cover explicit close, worker errors, unreadable messages
and fatal replies with open, append and query requests pending together.
Replies are checked for a valid request ID, Boolean status, string error, and
the result fields required by the pending operation, including nonnegative safe
integer counts. Malformed replies retire the worker, reject pending operations,
and use the same rebuild recovery path. Late replies after closure are ignored.
Production browser checks exercise a malformed envelope, a non-finite query
count and a non-string query output. Each preserves the editor's draft, disables
querying the failed runtime and permits a successful query after rebuilding.
Ordinary request errors reject only that request; other pending work and later
queries continue on the same worker. Repeated send failures retain neither
failed request entries nor an extra worker shutdown.
A failed worker moves the playground to an
error state and disables queries/appends. Rebuild database starts a replacement
worker and loads the current edited claims; leaving the playground terminates
the active replacement as well. Ordinary ingestion errors still retain the last
working database when its worker remains healthy.
Database replacement loads the candidate before closing the previous store.
Ordinary load failures close the candidate and retain the previous store. If
either database's cleanup fails, the reply preserves all error messages and
retires the worker; Rebuild starts a fresh runtime from the retained editor text.
Failure replies use `[unprintable thrown value]` when diagnostic conversion fails,
including throwing message getters. Cleanup aggregates keep the original values
and remain fatal; an unclassifiable revoked Proxy also retires the runtime.
Node tests check that these replies can be structured-cloned and that ordinary
query errors retain their nonfatal classification.
Replacement lifecycle tests cover load/close failure combinations, and a browser
test injects the fatal reply to verify visible diagnostics, disabled queries and
successful rebuilding with the edits intact.
Synchronous worker-construction failures use the same visible error/rebuild
path, including initial startup when no runtime exists yet. Retrying preserves
the current editor contents.
Failed SQLite WebAssembly initialization retires the worker as well. SQL.js
caches its initialization promise, including failures, so Rebuild uses a fresh
worker to retry the download instead of reusing a rejected module instance.
Store startup failures after WebAssembly initialization also retire the worker,
including failures whose database cleanup throws. Their diagnostics and original
cause chain are retained. Rebuild starts a fresh runtime from the edited claims;
ordinary claim-validation failures after startup still retain the working store.
WASM fault tests cover startup failure with successful or failed cleanup, one
close attempt, preserved causes and a successful later open/query.
If sending a worker request throws synchronously, the client rejects that
operation and removes its pending entry. Later requests can still use a healthy
worker; repeated failed sends do not retain unresolved request bookkeeping.
Enter without Shift in the query input, and Enter in Valid at, run a query only
outside an active text composition, so confirming an input-method candidate does
not submit unfinished text. Browser regressions cover both controls: composing
Enter sends no worker query, ordinary Enter submits once, and focus stays in the
field after the result arrives.

Reduced-motion preferences disable the route-loading pulse, smooth page scrolling
and button transitions. Loading text stays visible, and navigation and query
controls retain their normal behavior.

The result panel follows the query controls in
the keyboard tab order, with a visible focus outline for scrolling long output.
The dataset selector, claims editor and query input retain visible keyboard
focus; focus outlines inside clipped editor and result surfaces are inset so
they remain visible.
No source-module alias or custom Node test loader selects the runtime.

Page destinations in the header, homepage, footer and documentation sidebar
are native links. They preserve hash-route navigation while supporting copied
URLs, browser link menus and opening another tab. Commands such as copying the
install command, clearing a filter and running a query remain buttons.
The install-command button reports copy success through a live status message.
While clipboard access is pending, the button shows its busy state and prevents
overlapping attempts; it becomes available again after success or failure.
It retains keyboard focus while pending. Users can still move to another
control, and completing the copy does not move focus back.
If clipboard access is denied or unavailable, it shows a read-only command
field that selects its full contents on keyboard focus for manual copying.
Retrying the button can recover without reloading the page.

CAVE examples and the playground editor are highlighted in-browser by the
Tree-sitter WASM grammar and its shared `queries/highlights.scm` captures.
The homepage's visual line numbers are hidden from assistive technology, so
its accessible example contains source text without decorative numbering.
Numbered examples locate each line's first capture with binary search over the
highlighter's ordered, non-overlapping spans. Rendering later lines therefore
does not repeatedly scan all earlier captures; range tests enforce a logarithmic
lookup bound for 5,000 lines and 20,000 captures without relying on wall-clock
timing.
Concurrent code blocks share the same initialization. Failed loads leave plain
source visible and clear the failed promise; a later code-block mount or source
edit retries loading. Successful initialization remains shared for the page's
lifetime. There is no background retry loop for permanently unavailable assets.

The SQLite adapter contract checks write-result counts for `INSERT`, `UPDATE` and `DELETE` with
`RETURNING`. The browser's `run()` drains returned rows before reading SQLite's
final change count, including reused statements and writes matching no rows.
The same contract verifies that reused statements clear omitted positional
bindings, recover after excess-parameter errors without partial writes, and
preserve empty and binary blobs after the caller changes its input buffer.
The search checks cover literal full-text phrases containing quotes,
historical search, limits and rollback against the browser's FTS4
engine and native SQLite's FTS5 engine. Raw search syntax remains engine-specific.
It also verifies sensitivity-scoped search and export: malformed or mixed labels
remain restrictive, historical visibility is retained, and hidden current
beliefs never resurrect older public values.
The pinned SQL.js 1.14.2 dependency carries a pnpm patch for complete UTF-8
TEXT binding and reading. Its original string binding uses a terminating NUL
and its reader truncates at that same character. The patch passes explicit
UTF-8 byte lengths on bind and decodes complete TEXT bytes on read, preserving
embedded NULs, Unicode and a leading BOM while retaining blob/number/null types.
Both the Node test bundle and production browser bundle are patched. Runtime
and browser regressions verify stored bytes and queried claim names. Patch
maintenance is documented in `DEPENDENCY-MAINTENANCE.md`.

WASM result rows are built from SQL column names and values into objects with
no prototype. Names such as `__proto__`, `constructor` and `toString` remain
own data properties; duplicate result names keep the last column's value,
matching native SQLite. The shared adapter contract verifies get/all and JSON
serialization of these names.

The WASM adapter calls statement cleanup after successful or failed execution.
If execution and release both throw, it preserves both errors in an aggregate,
with execution as the cause and both messages available to the caller. A release
failure after successful execution retains the release error itself. All three
statement methods (`all`, `get`, `run`) discard the consumed handle and prepare
a fresh statement for a later call, including after either failure path.
Closed database wrappers reject execution and preparation with an explicit
closed-database error, including calls through retained statement wrappers,
instead of exposing SQL.js's misleading out-of-memory error. Repeated close
is harmless; a failed native close remains retryable.
Preparing again trades preparation work for bounded native statement retention
during long playground sessions when cleanup succeeds.
Write results report SQLite's affected-row count and `last_insert_rowid()`;
updates and ignored inserts retain the previous insertion ID, as on native
SQLite. The shared adapter contract checks these results on both engines.
The WASM runtime tests also exercise shape and health read snapshots through
the real shape library, including gated rollback, caller-owned transactions,
and cleanup after malformed declarations. These are adapter compatibility
checks; they do not add a shape-checking control to the playground.

The WASM runtime tests compare bounded query pages with unbounded query records
across revisions, retractions and historical boundaries. Valid-time and exact-value
filters skip an entire candidate batch before finding results; continuations must
still terminate, retain one snapshot and return the complete expected records
without changing history. This verifies tuple-membership selection on sql.js;
native SQLite benchmark gains do not establish browser performance.

The browser adapter accepts only `:memory:` database paths. Filenames and SQLite
file URIs fail explicitly rather than silently creating a temporary database;
each successful open creates a separate in-memory store.

In forced-colors mode, the claims editor uses native system text, background,
caret and selection colors and hides its decorative highlighting mirror. The
editable textarea stays visible and keeps the same input and keyboard behavior.

The playground intentionally does not bundle a formal solver. The optional
threaded Z3 backend remains Node-only because this GitHub Pages deployment does
not provide the cross-origin isolation and worker-asset contract it requires.
CI verifies that ordinary website builds contain no Z3 package or Wasm asset.

The preview test server rejects malformed request URLs and percent escapes with
HTTP 400 while remaining usable for subsequent requests. Its startup message
reports the actual bound port, including when `PORT=0` selects a free port. A
subprocess HTTP regression exercises this independently of built assets. Missing
or unreadable assets return 404 or 500 before streaming starts; failures during
streaming terminate only that response. File streams close when clients disconnect,
and a failed request does not terminate the server. Fault-injection tests cover
metadata failure, stream-open failure and failure after a partial response.

The Playwright configuration runs these checks in its version-matched Chromium
build. After updating the lockfile, install that browser with
`pnpm --dir website exec playwright install chromium`; the
[dependency guide](../DEPENDENCY-MAINTENANCE.md#playwright-browser-test-updates)
records the current compatibility review. Responsive widths,
touch and accessibility media emulation exercise that engine; the suite does not
establish Firefox, WebKit or screen-reader behavior.

The documentation link audit visits every bundled page and checks rendered
article links to documentation pages, with or without section fragments. It
waits for the generated section navigation to cover every level-two heading
before capturing links, so deferred rendering cannot omit table-of-contents links.
It verifies destination pages and fragment IDs, checks the whole page for duplicate
IDs that could make anchors or accessible descriptions ambiguous, and writes
`documentation-link-inventory.json` under the test's `test-results` directory
with source pages, links, missing destinations and duplicate IDs. It does not check external
GitHub URLs or other remote sites. Run it against an existing production build:
`pnpm --dir website test:browser production.spec.ts --grep 'all bundled documentation links'`.

The production browser smoke serves `website/dist` from `/cave/`, fails on
browser or request errors, and exercises the lazy playground chunk, module
worker, SQL.js, Tree-sitter, and grammar Wasm assets before deployment.
It also checks home, docs, and playground for page-level horizontal overflow at
320, 375, 390, 720, 768, 1024, and 1280 px, verifies primary navigation visibility
and keyboard order, and exercises touch navigation at 320 px. Screenshots at
320 and 1280 px are saved in `test-results` for visual inspection.

The browser suite also starts an ephemeral local HTTP viewer from the view
package to check its dashboard and entity pages at 320 and 390 px. Long entity
names, topic labels, values and store paths must fit without page overflow;
the fixture server and store close after the test.
Source-citation coverage in light and dark themes at 320 and 1280 px retains invalid HTTP destinations as
plain text, opens valid encoded links by keyboard through a local intercepted
fixture, and preserves both references after history navigation. It checks
that viewing and following citations leaves the stored export unchanged, and
saves focused-link screenshots for visual inspection.
It also verifies that repeating a search includes newly appended claims while
preserving the URL and search focus.
Lineage navigation retains both branches of shared evidence, marks the repeated
branch, and loads newly appended evidence when browser Back returns to the tree.
Claim navigation focuses destination headings after history, lineage and entity
links. A long-claim history regression checks that even a heading taller than
the mobile viewport starts below the sticky header. A delayed response preserves focus and draft text moved to search.
Failed link navigation focuses its error and allows recovery through search;
delayed failures also preserve focus already moved to the search field.
A held search response must preserve a new draft typed before it completes,
while its result heading continues to identify the submitted query.
An invalid NUL-bearing search must receive HTTP 400, announce its error in an
alert, clear the busy state and retain search focus. Correcting the query restores
results without reloading; the mobile error layout is captured for inspection.

The minimum supported viewport is 320 px. Below 381 px, the primary navigation
uses a second header row so all destinations remain visible. Grid content can
shrink to its container; long prose wraps, and code examples and tables scroll
inside their own surfaces. Avoid hiding page overflow: that would conceal
unreachable content instead of fixing its layout.

`.github/workflows/pages.yml` publishes `website/dist` to GitHub Pages on changes to the site, packages, or documentation.
