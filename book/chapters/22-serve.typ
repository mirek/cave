#import "../style.typ": note, file, recap

= Looking at the Store

Everything so far serves programs. `cave serve` is for the person: one
self-contained web page over the store, strictly read-only, bound to
localhost, with no build step and no external resource. This chapter walks
through what it shows and what it promises.

== Starting it

// no-test
```sh
$ cave serve --db roastery.db
serving roastery.db at http://127.0.0.1:2283/ (sensitivity <= internal, read-only, ctrl-c to stop)
```

The default port is 2283, which spells "cave" on a phone keypad; `--port 0`
picks a free one and `--host` widens the bind deliberately. The page is a
single HTML document with inline style and script. It loads nothing from
anywhere, so it works offline and under a strict content security policy:
the browser can render the store but cannot call out. Claims are rendered
from the stored columns and side tables, never by re-parsing text, so there
is no second grammar to drift out of sync.

== The views

*Dashboard.* The health report of Chapter 13 on a screen: coverage tiles,
then the frontier, which is shape violations, review candidates, stale
beliefs, and alias disagreements, plus topics and the latest appends. It
answers "what is missing and what needs a look" from the graph itself.

*Entity 360.* One name's current picture: its types, its attributes and
metrics, its relations in both directions with the declared inverse name
annotated on the object side, its topics, and the alias closure on an
explicit toggle, because alias-aware reading is opt-in everywhere.
Underneath, the activity feed of the newest rows about the name, superseded
and retracted included.

*Belief history.* One claim key's series, oldest first, as a timeline with
confidence bars. The last row is current belief; retraction and supersession
are visible instead of destroyed.

*Lineage.* The edge table walked both ways from one row: *cites* (its
`BECAUSE` premises, `VIA` rules and actions, `WHEN` conditions: why this is
believed) and *cited by* (what depends on it). Edges form a graph and the
render is a tree, so a row reached again is restated without children; the
walk is depth-capped and a truncated node says so rather than posing as a
leaf.

*Search.* The store's full-text index over subjects, objects, values,
comments, and raw lines, newest first.

Every entity name, claim key, and row id links onward, so the whole store is
reachable by clicking. Source spans are decoded and, for URLs, linked to the
cited fragment.

== The promises

*Read-only, structurally.* Only `GET` and `HEAD` are answered and no
endpoint writes. Recording knowledge stays with `cave add`, the MCP tools,
and the kinetic layer. Every request reads the live store, so a running
automation's appends show on the next refresh.

*Local by default.* The store is one person's knowledge on one machine.
There is no authentication layer and none is planned; wider serving belongs
behind your own transport, and what it would share is the selected
sensitivity view, read-only.

*Sensitivity-scoped.* The ceiling defaults to `internal` and is raised only
with `--max-sensitivity`. Counts, aliases, history, lineage, and search are
computed from visible rows only; an edge is served only when both endpoints
are visible.

== Scripting it

The page reads plain JSON endpoints, which `curl` can read too: `/api/overview`,
`/api/entity?name=`, `/api/topic?name=`, `/api/history?key=`,
`/api/lineage?id=`, and `/api/search?q=`, with `&aliases=1` where the closure
applies. They serve exactly the views above; CAVE-Q remains the query
language. The same view models are plain functions in the `@cavelang/view`
package, usable without a server.

// no-test
```sh
$ cave add --db roastery.db roastery.cave
$ cave serve --db roastery.db --port 0 > serve.log 2>&1 &
$ until grep -q 'http://' serve.log; do sleep 0.2; done
$ url=$(grep -o 'http://[^ ]*/' serve.log | head -1)
$ curl -s "${url}api/entity?name=lot/huila-26" | jq '.types'
```

The server prints its address only once it is listening, so the loop waits
for the log line before reading the URL.

The view is deliberately not an MCP tool. Agents read through the query and
neighbourhood tools; the page is for the human outside the loop.

#recap[`cave serve` renders a dashboard, entity pages, belief-history
timelines, lineage trees, and search from one self-contained page.
`GET`-only, localhost, `internal` ceiling by default, live reads. JSON
endpoints under `/api/` serve the same views.]
