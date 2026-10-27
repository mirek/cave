/**
 * The page (spec §30.1) — one static, self-contained HTML document: no
 * external scripts, styles, fonts or images, so it renders offline and
 * the server's CSP can deny every non-self source. Views are hash
 * routes over the read-only `/api/*` endpoints; claims render from
 * *structured* row data (never by re-parsing text — no second grammar),
 * and every entity name, claim key and row id links onward: entity 360,
 * relation graphs, topic browse, belief-history timeline, lineage, search.
 *
 * Each claim row leads with its statement and confidence; contexts, tags,
 * comments, dates and the history/lineage links sit one click away in a
 * native disclosure. Graphs are inline SVG laid out in the page by a small
 * deterministic force simulation — still no library and no external fetch.
 *
 * `__CAVE_DB__`, `__CAVE_VERSION__`, and `__CAVE_SENSITIVITY__` are stamped by the server
 * (HTML-escaped) when the page is requested.
 */

export const page: string = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark">
<link rel="icon" href="data:,">
<title>cave — __CAVE_DB__</title>
<style>
:root {
  --bg: #ffffff; --fg: #1c1e21; --dim: #71767c; --line: #e5e7ea;
  --accent: #0b62b8; --pill: #f1f3f5; --bad: #b3261e; --warn: #8a6100;
  --bar: #cfe3f7; --mark: #fff2c4; --edge: #9aa1a8; --node: #c3c8cd;
  --c0: #4f8fd9; --c1: #d9774f; --c2: #4fae7a; --c3: #b56fd0;
  --c4: #c9a43a; --c5: #d05f87; --c6: #4fb3b8; --c7: #7f8ad6;
}
@media (prefers-color-scheme: dark) {
  :root {
    --bg: #111417; --fg: #e4e6e8; --dim: #969ca3; --line: #272c31;
    --accent: #6db3f2; --pill: #1c2126; --bad: #ff8078; --warn: #dfb54a;
    --bar: #1f3c5a; --mark: #4a3f14; --edge: #5d656d; --node: #4a525a;
    --c0: #5d9de6; --c1: #e68a63; --c2: #5fc08b; --c3: #c483de;
    --c4: #d8b54d; --c5: #e07299; --c6: #5ec4c9; --c7: #929ce6;
  }
}
* { box-sizing: border-box; }
body {
  margin: 0; background: var(--bg); color: var(--fg);
  font: 15px/1.5 system-ui, sans-serif; overflow-wrap: anywhere;
}
a { color: var(--accent); text-decoration: none; }
a:hover { text-decoration: underline; }
a:focus-visible, input:focus-visible, button:focus-visible, summary:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
a:focus-visible { text-decoration: underline; }
header {
  position: sticky; top: 0; z-index: 5; display: flex; gap: 1rem; align-items: center;
  padding: .55rem 1rem; background: var(--bg); border-bottom: 1px solid var(--line);
}
header .brand { font-weight: 700; color: var(--fg); }
header nav { display: flex; gap: .8rem; font-size: .9rem; }
header input[type=search] {
  flex: 1; min-width: 0; max-width: 26rem; padding: .3rem .6rem; border: 1px solid var(--line);
  border-radius: .4rem; background: var(--pill); color: var(--fg); font: inherit;
}
header label { color: var(--dim); font-size: .85rem; display: flex; gap: .35rem; align-items: center; }
#trail { max-width: 64rem; margin: 0 auto; padding: .35rem 1rem 0; font-size: .8rem; color: var(--dim); }
#trail:empty { display: none; }
#trail a { margin-left: .6ch; }
main { max-width: 64rem; margin: 0 auto; padding: 1rem 1rem 3rem; }
footer {
  max-width: 64rem; margin: 0 auto; padding: .6rem 1rem 1.4rem;
  color: var(--dim); font-size: .8rem; border-top: 1px solid var(--line);
}
h1 { font-size: 1.35rem; margin: .6rem 0 .3rem; word-break: break-word; }
h1 .kind { color: var(--dim); font-weight: 400; font-size: .85rem; }
section { margin: 1.3rem 0; }
section h2 { font-size: .8rem; text-transform: uppercase; letter-spacing: .06em; color: var(--dim); margin: 0 0 .35rem; }
section h2 .n, summary .n { font-weight: 400; color: var(--dim); }
.lede { color: var(--dim); margin: .1rem 0 .6rem; }
.none { color: var(--dim); font-size: .85rem; margin: .2rem 0; }
.err { color: var(--bad); }
button, .btn {
  padding: .2rem .6rem; border: 1px solid var(--line); border-radius: .4rem; background: var(--pill);
  color: var(--fg); font: inherit; font-size: .8rem; cursor: pointer;
}
button[aria-pressed=true] { border-color: var(--accent); color: var(--accent); }
.retry { padding: .35rem .7rem; font-size: inherit; }
.tiles { display: flex; flex-wrap: wrap; gap: .5rem; margin-top: .5rem; }
.tile { background: var(--pill); border-radius: .5rem; padding: .45rem .8rem; min-width: 5.4rem; }
.tile b { display: block; font-size: 1.15rem; }
.tile span { color: var(--dim); font-size: .75rem; }
.chips { display: flex; flex-wrap: wrap; gap: .4rem; }
.chip { background: var(--pill); border-radius: 1rem; padding: .15rem .7rem; font-size: .85rem; }
.chip .n { color: var(--dim); }
.chip.type { border: 1px solid var(--line); background: transparent; }
.fold { margin: .5rem 0; border-top: 1px solid var(--line); padding-top: .4rem; }
.fold > summary { cursor: pointer; font-size: .8rem; text-transform: uppercase; letter-spacing: .06em; color: var(--dim); }
.fold > summary b { color: var(--fg); font-weight: 600; }
.fold[open] > summary { margin-bottom: .35rem; }
.claim {
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: .84rem; border-bottom: 1px dotted var(--line); word-break: break-word;
}
.claim:last-child { border-bottom: 0; }
.claim > summary { list-style: none; cursor: pointer; padding: .2rem 0; }
.claim > summary::-webkit-details-marker { display: none; }
.claim .line { display: flex; flex-wrap: wrap; gap: .45ch; align-items: baseline; }
.claim .more { margin-left: auto; color: var(--dim); font-size: .74rem; padding: 0 .3rem; border-radius: .3rem; }
.claim > summary:hover .more { background: var(--pill); color: var(--accent); }
.claim[open] .more { color: var(--accent); }
.claim.dim .line > :not(.more) { opacity: .55; }
.claim .meta {
  display: flex; flex-wrap: wrap; gap: .3rem .9ch; align-items: baseline;
  margin: 0 0 .4rem 1.2rem; padding: .3rem .6rem; border-left: 2px solid var(--line); font-size: .78rem;
}
.claim .meta a, .claim .meta time { color: var(--dim); }
.claim .meta a:hover { color: var(--accent); }
.claim .meta .key { flex-basis: 100%; color: var(--dim); font-size: .72rem; }
.v { font-weight: 600; }
.not { color: var(--bad); font-style: normal; font-weight: 700; }
.a { color: var(--dim); }
.self { color: var(--dim); }
.ctx, .tag { background: var(--pill); border-radius: .3rem; padding: 0 .35rem; font-size: .78rem; color: var(--dim); }
.ctx.src { color: var(--accent); }
.conf { color: var(--warn); }
.conf.retracted { color: var(--bad); }
.imp { color: var(--bad); font-weight: 700; }
.cmt { color: var(--dim); }
.hint { color: var(--dim); font-size: .74rem; }
.rel { color: var(--dim); font-size: .78rem; border: 1px solid var(--line); border-radius: .3rem; padding: 0 .3rem; }
.bar { display: inline-block; width: 7rem; height: .5rem; background: var(--pill); border-radius: .25rem; overflow: hidden; flex: none; }
.bar i { display: block; height: 100%; background: var(--bar); }
.when { color: var(--dim); font-size: .74rem; width: 6.2rem; flex: none; }
.tree, .tree ul { list-style: none; margin: 0; padding: 0 0 0 1.1rem; border-left: 1px solid var(--line); }
.tree > li, .tree ul > li { margin: .15rem 0; }
.role { color: var(--dim); font-size: .74rem; text-transform: uppercase; }
.rep { color: var(--dim); font-size: .78rem; }
.aka { color: var(--dim); font-size: .85rem; margin: .2rem 0; }
.neighbors { display: grid; grid-template-columns: max-content 1fr; gap: .3rem .8rem; align-items: baseline; }
.neighbors .vb { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: .78rem; color: var(--dim); text-align: right; }
mark { background: var(--mark); color: inherit; border-radius: .2rem; }
.linked { font-size: .8rem; color: var(--dim); margin-top: .3rem; }
.panel { border: 1px solid var(--line); border-radius: .6rem; overflow: hidden; position: relative; }
.panel .tools {
  display: flex; flex-wrap: wrap; gap: .35rem; align-items: center; padding: .35rem .5rem;
  border-bottom: 1px solid var(--line); font-size: .8rem; color: var(--dim);
}
.panel .tools .grow { flex: 1; }
.graph { display: block; width: 100%; height: 22rem; touch-action: none; user-select: none; cursor: grab; }
.graph.tall { height: min(70vh, 40rem); }
.graph .ed path { fill: none; stroke: var(--edge); stroke-width: 1.3; }
.graph .ed.neg path { stroke: var(--bad); stroke-dasharray: 4 3; }
.graph .ed text, .graph .n text {
  font-size: 11px; fill: var(--dim); paint-order: stroke; stroke: var(--bg); stroke-width: 3px; stroke-linejoin: round;
}
.graph .ed.neg text { fill: var(--bad); }
.graph .n text { fill: var(--fg); font-size: 12px; }
.graph .n circle { fill: var(--node); stroke: var(--bg); stroke-width: 2; }
.graph .n.focus circle { stroke: var(--accent); stroke-width: 3; }
.graph .n.focus text { font-weight: 700; }
.graph .n { cursor: pointer; }
.graph .n:focus-visible circle { stroke: var(--accent); stroke-width: 3; }
.graph .n:focus { outline: none; }
.graph.dense .ed text { display: none; }
.graph.dense .ed.on text { display: inline; }
.graph.hl .n:not(.on), .graph.hl .ed:not(.on) { opacity: .15; }
.graph .ed.on path { stroke: var(--accent); stroke-width: 2; }
.graph .arrow { fill: var(--edge); }
.graph .c0 circle { fill: var(--c0); } .graph .c1 circle { fill: var(--c1); }
.graph .c2 circle { fill: var(--c2); } .graph .c3 circle { fill: var(--c3); }
.graph .c4 circle { fill: var(--c4); } .graph .c5 circle { fill: var(--c5); }
.graph .c6 circle { fill: var(--c6); } .graph .c7 circle { fill: var(--c7); }
.legend { display: flex; flex-wrap: wrap; gap: .3rem .9rem; padding: .35rem .6rem; font-size: .78rem; color: var(--dim); border-top: 1px solid var(--line); }
.legend:empty { display: none; }
.legend i { display: inline-block; width: .65rem; height: .65rem; border-radius: 50%; margin-right: .3rem; vertical-align: -.05rem; background: var(--node); }
.legend .c0 { background: var(--c0); } .legend .c1 { background: var(--c1); } .legend .c2 { background: var(--c2); }
.legend .c3 { background: var(--c3); } .legend .c4 { background: var(--c4); } .legend .c5 { background: var(--c5); }
.legend .c6 { background: var(--c6); } .legend .c7 { background: var(--c7); }
kbd { font: .75rem ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; border: 1px solid var(--line); border-radius: .25rem; padding: 0 .3rem; }
.sr-only { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; border: 0; }
.skip-link { position: fixed; top: .5rem; left: .5rem; z-index: 10; padding: .6rem .9rem; background: var(--bg); border: 2px solid var(--accent); border-radius: .3rem; transform: translateY(-200%); }
.skip-link:focus { transform: translateY(0); }
@media (max-width: 40rem) {
  header { gap: .6rem; flex-wrap: wrap; }
  header input[type=search] { order: 5; flex-basis: 100%; max-width: none; }
  .graph { height: 18rem; }
  .neighbors { grid-template-columns: 1fr; }
  .neighbors .vb { text-align: left; }
}
</style>
</head>
<body>
<a class="skip-link" href="#view">Skip to content</a>
<header>
  <a class="brand" href="#/">cave</a>
  <nav aria-label="Views"><a href="#/">overview</a><a href="#/g">graph</a></nav>
  <input id="q" type="search" aria-label="Search claims by phrase" aria-keyshortcuts="Enter /" enterkeyhint="search" placeholder="search phrase… (press / )">
  <label><input id="aliases" type="checkbox"> aliases</label>
</header>
<nav id="trail" aria-label="Recently visited entities"></nav>
<div id="loading-status" class="sr-only" role="status"></div>
<main id="view" tabindex="-1" aria-busy="false"></main>
<footer>cave __CAVE_VERSION__ &middot; __CAVE_DB__ &middot; sensitivity &le; __CAVE_SENSITIVITY__ &middot; read-only view</footer>
<script>
'use strict'
var view = document.getElementById('view')
var loadingStatus = document.getElementById('loading-status')
var aliasBox = document.getElementById('aliases')
var searchBox = document.getElementById('q')
var baseTitle = document.title
var BACKTICK = '\\u0060'

document.querySelector('.skip-link').addEventListener('click', function (event) {
  event.preventDefault()
  focusViewElement(view)
})

try {
  aliasBox.checked = localStorage.getItem('cave-aliases') === '1'
} catch (_) {
  aliasBox.checked = false
}
aliasBox.addEventListener('change', function () {
  try {
    localStorage.setItem('cave-aliases', aliasBox.checked ? '1' : '0')
  } catch (_) { /* Persistence is optional; the current toggle still applies. */ }
  route()
})
searchBox.addEventListener('keydown', function (event) {
  if (event.key === 'Enter' && !event.isComposing &&
      !event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey && searchBox.value.trim() !== '') {
    event.preventDefault()
    var destination = '#/s/' + encodeURIComponent(searchBox.value.trim())
    if (location.hash === destination) route()
    else location.hash = destination
  }
})

function esc (value) {
  return String(value).replace(/[&<>"']/g, function (char) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]
  })
}
var enc = encodeURIComponent
function pct (value) {
  var rounded = Math.round(value * 1000) / 10
  if (value > 0 && rounded === 0) { return '<0.1%' }
  if (value < 1 && rounded === 100) { return '>99.9%' }
  return rounded + '%'
}

function api (path, params) {
  var pairs = []
  Object.keys(params || {}).forEach(function (key) {
    var value = params[key]
    if (value !== undefined && value !== false) {
      pairs.push(enc(key) + '=' + enc(value === true ? '1' : value))
    }
  })
  return fetch('/api/' + path + (pairs.length ? '?' + pairs.join('&') : '')).then(function (res) {
    return res.json().then(function (body) {
      if (!res.ok) {
        var message = body && typeof body.error === 'string' && body.error
        throw new Error(message || ('HTTP ' + res.status))
      }
      return body
    }, function () {
      throw new Error(res.ok ? 'Could not read JSON response (HTTP ' + res.status + ')' : 'HTTP ' + res.status)
    })
  })
}

function isLiteral (name) { return name.charAt(0) === '"' || name.charAt(0) === BACKTICK }
function entityHtml (name, self) {
  if (isLiteral(name)) return '<span class="lit">' + esc(name) + '</span>'
  if (self !== undefined && name === self) return '<span class="self">' + esc(name) + '</span>'
  return '<a class="e" href="#/e/' + enc(name) + '">' + esc(name) + '</a>'
}

/*
 * One claim: the statement and its confidence lead; provenance, tags, the
 * comment, the date and the history/lineage links open from the row.
 * opts.when/bar add a timeline date and confidence bar, opts.self dims the
 * page's own entity, opts.rel and opts.note prefix an annotation.
 */
function claimHtml (c, opts) {
  opts = opts || {}
  var parts = []
  if (opts.rel !== undefined) { parts.push('<span class="rel" title="declared inverse — same stored fact read from this side">' + esc(opts.rel) + '</span>') }
  if (opts.when) { parts.push('<span class="when" title="' + esc(c.at) + '">' + esc(c.at.slice(0, 10)) + '</span>') }
  if (opts.bar) { parts.push('<span class="bar" title="confidence ' + esc(pct(c.conf)) + '"><i style="width:' + (c.conf * 100) + '%"></i></span>') }
  if (opts.note !== undefined) { parts.push('<span class="hint">' + esc(opts.note) + '</span>') }
  parts.push(entityHtml(c.subject, opts.self))
  parts.push('<span class="v">' + esc(c.verb) + '</span>' + (c.negated ? ' <em class="not">NOT</em>' : ''))
  if (c.object !== undefined) {
    parts.push(entityHtml(c.object, opts.self))
  } else if (c.attribute !== undefined) {
    parts.push('<span class="a">' + esc(c.attribute) + ':</span> <span class="val">' + esc(c.value) + '</span>')
  } else if (c.value !== undefined) {
    parts.push('<span class="val">' + esc(c.value) + '</span>')
  }
  if (c.delta !== undefined) { parts.push('<span class="val">+/- ' + esc(c.delta) + '</span>') }
  if (c.sigmaLevel !== undefined) { parts.push('<span class="val">(' + esc(c.sigmaLevel) + 'σ)</span>') }
  if (c.conf === 0) {
    parts.push('<span class="conf retracted" title="retracted">@ 0%</span>')
  } else if (c.conf < 1) {
    parts.push('<span class="conf">@ ' + esc(pct(c.conf)) + '</span>')
  }
  if (c.importance) { parts.push('<span class="imp" title="important">!</span>') }
  var meta = []
  if (c.comment !== undefined) { meta.push('<span class="cmt">; ' + esc(c.comment) + '</span>') }
  c.contexts.forEach(function (ctx) {
    var source = (c.sources || []).filter(function (item) { return item.context === ctx })[0]
    var label = '@' + esc(ctx)
    if (source && source.href) {
      label = '<a href="' + esc(source.href) + '" target="_blank" rel="noopener noreferrer" title="' + esc(source.location) + '">' + label + '</a>'
    }
    meta.push('<span class="ctx' + (ctx.indexOf('src:') === 0 ? ' src' : '') + '">' + label + '</span>')
  })
  c.tags.forEach(function (tag) {
    meta.push('<span class="tag">#' + esc(tag.key) + (tag.value !== undefined ? ':' + esc(tag.value) : '') + '</span>')
  })
  meta.push('<time title="' + esc(c.at) + '">' + esc(c.at.slice(0, 19).replace('T', ' ')) + '</time>')
  meta.push('<a href="#/k/' + enc(c.key) + '" title="belief history of this fact">history</a>')
  if (c.cites > 0 || c.citedBy > 0) {
    meta.push('<a href="#/l/' + enc(c.id) + '" title="cites ' + c.cites + ', cited by ' + c.citedBy + '">lineage</a>')
  }
  var hints = (c.comment !== undefined ? 'note ' : '') + (c.cites > 0 ? 'why ' : '') + '…'
  return '<details class="claim' + (c.conf === 0 ? ' dim' : '') + '"><summary><span class="line">' + parts.join(' ') +
    '<span class="more" aria-hidden="true" title="details">' + esc(hints) + '</span></span></summary>' +
    '<div class="meta">' + meta.join(' ') + '</div></details>'
}

function claimList (list, opts) {
  return list.length === 0 ? '<p class="none">none</p>' : list.map(function (c) { return claimHtml(c, opts) }).join('')
}
function section (title, body, count) {
  return '<section><h2>' + title + (count !== undefined ? ' <span class="n">(' + count + ')</span>' : '') + '</h2>' + body + '</section>'
}
function fold (title, body, count, open) {
  return '<details class="fold"' + (open ? ' open' : '') + '><summary><b>' + title + '</b>' +
    (count !== undefined ? ' <span class="n">(' + count + ')</span>' : '') + '</summary>' + body + '</details>'
}
function capNote (capped) {
  return capped.items.length < capped.total ?
    '<p class="none">…and ' + (capped.total - capped.items.length) + ' more (see cave check)</p>' : ''
}
function tile (value, label) {
  return '<div class="tile"><b>' + value + '</b><span>' + label + '</span></div>'
}
function plural (n, word, many) { return n + ' ' + (n === 1 ? word : many || word + 's') }

function shapeProblem (violation) {
  if (violation.actualCount === 0) return 'missing ' + violation.kind + ' ' + violation.name
  var problems = []
  if (violation.cardinality === 'one' && violation.actualCount !== 1) {
    problems.push('has ' + violation.actualCount + ' ' + violation.kind + 's ' + violation.name + '; expected exactly one')
  }
  if (violation.unit !== undefined && violation.actualUnits.some(function (unit) { return unit !== violation.unit })) {
    var units = violation.actualUnits.map(function (unit) { return unit === null ? '(none)' : unit }).join(', ')
    problems.push('attribute ' + violation.name + ' has unit' + (violation.actualUnits.length === 1 ? '' : 's') + ' ' + units + '; expected ' + violation.unit)
  }
  return problems.join('; ')
}

/*
 * Relation graphs — inline SVG, laid out here; nodes are links onward.
 * Dictionaries keyed by stored names are prototype-free: an entity may be
 * called __proto__ or constructor.
 */

function hashOf (text) {
  var hash = 0
  for (var i = 0; i < text.length; i++) hash = (hash * 31 + text.charCodeAt(i)) | 0
  return Math.abs(hash)
}
/* The eight most common first types in this graph get distinct colours. */
function typeColors (nodes) {
  var counts = Object.create(null)
  nodes.forEach(function (node) { if (node.types.length) counts[node.types[0]] = (counts[node.types[0]] || 0) + 1 })
  var colors = Object.create(null)
  Object.keys(counts).sort(function (a, b) { return counts[b] - counts[a] || (a < b ? -1 : 1) }).slice(0, 8).forEach(function (type, i) {
    colors[type] = ' c' + i
  })
  return colors
}

function layoutGraph (data, width, height) {
  var nodes = data.nodes
  var n = nodes.length
  var index = Object.create(null)
  nodes.forEach(function (node, i) { index[node.name] = i })
  // One spring per linked pair, however many relations it carries.
  var seen = Object.create(null)
  var links = []
  var degree = nodes.map(function () { return 0 })
  data.edges.forEach(function (edge) {
    var s = index[edge.source], t = index[edge.target]
    if (s === undefined || t === undefined || s === t) return
    var id = Math.min(s, t) + ':' + Math.max(s, t)
    if (seen[id]) return
    seen[id] = true
    links.push([s, t])
    degree[s]++; degree[t]++
  })
  var cx = width / 2
  var cy = height / 2
  // Deterministic start: the focus centred, the rest on a golden-angle spiral.
  var pos = nodes.map(function (node, i) {
    if (node.name === data.focus) return { x: cx, y: cy }
    var r = 24 * Math.sqrt(i + 1)
    var angle = i * 2.39996 + (hashOf(node.name) % 100) / 100
    return { x: cx + r * Math.cos(angle), y: cy + r * Math.sin(angle) }
  })
  // Velocity simulation: pairwise charge, springs on relations, mild gravity.
  var span = Math.min(90, Math.max(36, Math.sqrt(width * height / Math.max(n, 1)) * 0.55))
  var charge = span * span * 1.2
  var vel = pos.map(function () { return { x: 0, y: 0 } })
  var alpha = 1
  for (var step = 0; step < 320; step++) {
    for (var a = 0; a < n; a++) {
      for (var b = a + 1; b < n; b++) {
        var dx = pos[b].x - pos[a].x
        var dy = pos[b].y - pos[a].y
        var d2 = Math.max(dx * dx + dy * dy, 16)
        var push = charge * alpha / d2
        vel[a].x -= dx * push / Math.sqrt(d2); vel[a].y -= dy * push / Math.sqrt(d2)
        vel[b].x += dx * push / Math.sqrt(d2); vel[b].y += dy * push / Math.sqrt(d2)
      }
    }
    // Springs weaken with degree and move the less connected end more (as in
    // d3-force), so a hub's many springs cannot add up and fling it.
    links.forEach(function (link) {
      var s = pos[link[0]], t = pos[link[1]]
      var dx = t.x - s.x, dy = t.y - s.y
      var d = Math.sqrt(dx * dx + dy * dy) || 1
      var pull = (d - span) / d * alpha * 0.5 / Math.min(degree[link[0]], degree[link[1]])
      var bias = degree[link[0]] / (degree[link[0]] + degree[link[1]])
      vel[link[0]].x += dx * pull * (1 - bias); vel[link[0]].y += dy * pull * (1 - bias)
      vel[link[1]].x -= dx * pull * bias; vel[link[1]].y -= dy * pull * bias
    })
    for (var i = 0; i < n; i++) {
      // Gravity keeps disconnected clusters close enough to share the frame.
      vel[i].x += (cx - pos[i].x) * 0.02 * alpha
      vel[i].y += (cy - pos[i].y) * 0.02 * alpha * width / height
      if (nodes[i].name === data.focus) { vel[i].x = 0; vel[i].y = 0; continue }
      // Bound each step; a non-finite velocity is discarded rather than spread.
      var speed = Math.sqrt(vel[i].x * vel[i].x + vel[i].y * vel[i].y)
      if (!(speed < Infinity)) { vel[i].x = 0; vel[i].y = 0; speed = 0 }
      if (speed > span) { vel[i].x *= span / speed; vel[i].y *= span / speed }
      pos[i].x += vel[i].x; pos[i].y += vel[i].y
      vel[i].x *= 0.6; vel[i].y *= 0.6
    }
    alpha *= 0.985
  }
  // Fit the result into the viewport, leaving room for labels.
  var minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  pos.forEach(function (p) {
    minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x)
    minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y)
  })
  var padX = 70, padY = 30
  // Each axis fills the frame, within a bounded stretch so shapes stay readable.
  var scaleX = Math.min((width - 2 * padX) / Math.max(maxX - minX, 1), 2.5)
  var scaleY = Math.min((height - 2 * padY) / Math.max(maxY - minY, 1), 2.5)
  scaleX = Math.min(scaleX, scaleY * 3)
  scaleY = Math.min(scaleY, scaleX * 3)
  var offsetX = (width - (maxX - minX) * scaleX) / 2
  var offsetY = (height - (maxY - minY) * scaleY) / 2
  return pos.map(function (p) { return { x: offsetX + (p.x - minX) * scaleX, y: offsetY + (p.y - minY) * scaleY } })
}

function radiusOf (node, focus) {
  return node.name === focus ? 11 : Math.min(5 + Math.sqrt(node.degree) * 1.8, 13)
}

function drawGraph (target, data, opts) {
  opts = opts || {}
  if (data.nodes.length === 0) {
    target.innerHTML = '<p class="none" style="padding:.6rem">no relations between entities to draw</p>'
    return
  }
  var width = Math.max(target.clientWidth || 0, 320)
  var height = opts.tall ? Math.max(Math.min(window.innerHeight * 0.7, 640), 320) : (width < 640 ? 288 : 352)
  var pos = layoutGraph(data, width, height)
  var colors = typeColors(data.nodes)
  function colorOf (node) { return node.types.length ? colors[node.types[0]] || '' : '' }
  var index = Object.create(null)
  data.nodes.forEach(function (node, i) { index[node.name] = i })
  // One path per ordered pair; verbs on the same pair share a label.
  var pairs = Object.create(null)
  var order = []
  data.edges.forEach(function (edge) {
    if (edge.source === edge.target) return
    var id = edge.source + '\\u0000' + edge.target
    if (!pairs[id]) { pairs[id] = { source: edge.source, target: edge.target, edges: [] }; order.push(id) }
    pairs[id].edges.push(edge)
  })
  var dense = order.length > 40
  var svg = '<svg class="graph' + (opts.tall ? ' tall' : '') + (dense ? ' dense' : '') + '" viewBox="0 0 ' + width + ' ' + height +
    '" role="group" aria-label="' + esc(opts.label || 'relation graph') + '" style="height:' + height + 'px">' +
    '<defs><marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">' +
    '<path class="arrow" d="M0,0L10,5L0,10z"/></marker></defs><g class="vp">'
  order.forEach(function (id, i) {
    var pair = pairs[id]
    var negated = pair.edges.every(function (edge) { return edge.negated })
    var label = pair.edges.map(function (edge) {
      return (edge.negated ? 'NOT ' : '') + edge.verb + (edge.conf < 1 ? ' ' + pct(edge.conf) : '')
    }).join(', ')
    var opacity = Math.max(0.35, Math.max.apply(null, pair.edges.map(function (edge) { return edge.conf })))
    svg += '<g class="ed' + (negated ? ' neg' : '') + '" data-i="' + i + '" data-s="' + index[pair.source] + '" data-t="' + index[pair.target] +
      '" data-back="' + (pairs[pair.target + '\\u0000' + pair.source] ? 1 : 0) + '" style="opacity:' + opacity + '">' +
      '<title>' + esc(pair.source + ' ' + label + ' ' + pair.target) + '</title>' +
      '<path marker-end="url(#arrow)"/><text text-anchor="middle">' + esc(label) + '</text></g>'
  })
  data.nodes.forEach(function (node, i) {
    var r = radiusOf(node, data.focus)
    var title = node.name + (node.types.length ? ' — IS ' + node.types.join(', ') : '') + ' — ' + plural(node.degree, 'relation')
    svg += '<a class="n' + colorOf(node) + (node.name === data.focus ? ' focus' : '') + '" href="#/e/' + esc(enc(node.name)) +
      '" data-i="' + i + '" data-r="' + r + '"><title>' + esc(title) + '</title><circle r="' + r + '"/>' +
      '<text dy="' + (r + 13) + '" text-anchor="middle">' + esc(node.name.length > 28 ? node.name.slice(0, 27) + '…' : node.name) + '</text></a>'
  })
  svg += '</g></svg>'
  var legendHtml = Object.keys(colors).map(function (type) {
    return '<span><i class="' + colors[type].trim() + '"></i>' + esc(type) + '</span>'
  }).join('')
  target.innerHTML = svg + '<div class="legend">' + legendHtml + '</div>'
  wireGraph(target.querySelector('svg'), data, pos)
}

function wireGraph (svg, data, pos) {
  var nodeEls = Array.prototype.slice.call(svg.querySelectorAll('.n'))
  var edgeEls = Array.prototype.slice.call(svg.querySelectorAll('.ed'))
  var view0 = svg.getAttribute('viewBox').split(' ').map(Number)
  var box = view0.slice()
  function placeEdge (el) {
    var s = pos[+el.getAttribute('data-s')]
    var t = pos[+el.getAttribute('data-t')]
    var rs = +nodeEls[+el.getAttribute('data-s')].getAttribute('data-r')
    var rt = +nodeEls[+el.getAttribute('data-t')].getAttribute('data-r')
    var dx = t.x - s.x, dy = t.y - s.y
    var d = Math.sqrt(dx * dx + dy * dy) || 1
    // Opposite directions on one pair bow apart instead of overlapping.
    var bend = el.getAttribute('data-back') === '1' ? Math.min(28, d / 4) : 0
    var mx = (s.x + t.x) / 2 - dy / d * bend
    var my = (s.y + t.y) / 2 + dx / d * bend
    var sx = s.x + (mx - s.x) / (Math.sqrt((mx - s.x) * (mx - s.x) + (my - s.y) * (my - s.y)) || 1) * rs
    var sy = s.y + (my - s.y) / (Math.sqrt((mx - s.x) * (mx - s.x) + (my - s.y) * (my - s.y)) || 1) * rs
    var tl = Math.sqrt((t.x - mx) * (t.x - mx) + (t.y - my) * (t.y - my)) || 1
    var tx = t.x - (t.x - mx) / tl * (rt + 2)
    var ty = t.y - (t.y - my) / tl * (rt + 2)
    el.querySelector('path').setAttribute('d', 'M' + sx.toFixed(1) + ',' + sy.toFixed(1) + 'Q' + mx.toFixed(1) + ',' + my.toFixed(1) + ' ' + tx.toFixed(1) + ',' + ty.toFixed(1))
    var text = el.querySelector('text')
    text.setAttribute('x', ((s.x + t.x) / 2 - dy / d * bend / 2).toFixed(1))
    text.setAttribute('y', ((s.y + t.y) / 2 + dx / d * bend / 2 - 3).toFixed(1))
  }
  function placeNode (el) {
    var p = pos[+el.getAttribute('data-i')]
    el.setAttribute('transform', 'translate(' + p.x.toFixed(1) + ',' + p.y.toFixed(1) + ')')
  }
  nodeEls.forEach(placeNode)
  edgeEls.forEach(placeEdge)

  function highlight (i) {
    if (i === undefined) {
      svg.classList.remove('hl')
      nodeEls.concat(edgeEls).forEach(function (el) { el.classList.remove('on') })
      return
    }
    svg.classList.add('hl')
    nodeEls[i].classList.add('on')
    edgeEls.forEach(function (el) {
      var s = +el.getAttribute('data-s'), t = +el.getAttribute('data-t')
      if (s === i || t === i) {
        el.classList.add('on')
        nodeEls[s === i ? t : s].classList.add('on')
      }
    })
  }
  nodeEls.forEach(function (el, i) {
    el.addEventListener('mouseenter', function () { highlight(i) })
    el.addEventListener('mouseleave', function () { highlight() })
    el.addEventListener('focus', function () { highlight(i) })
    el.addEventListener('blur', function () { highlight() })
  })

  function toGraph (event) {
    var rect = svg.getBoundingClientRect()
    return {
      x: box[0] + (event.clientX - rect.left) / rect.width * box[2],
      y: box[1] + (event.clientY - rect.top) / rect.height * box[3]
    }
  }
  function applyBox () { svg.setAttribute('viewBox', box.map(function (v) { return v.toFixed(1) }).join(' ')) }
  var drag
  var handled = false
  svg.addEventListener('pointerdown', function (event) {
    // Modified clicks keep the browser's own link handling (new tab, window).
    if (event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return
    var node = event.target.closest ? event.target.closest('.n') : null
    var start = toGraph(event)
    drag = { node: node, start: start, client: { x: event.clientX, y: event.clientY }, box: box.slice(), moved: false }
    svg.setPointerCapture(event.pointerId)
  })
  svg.addEventListener('pointermove', function (event) {
    if (!drag) return
    if (Math.abs(event.clientX - drag.client.x) + Math.abs(event.clientY - drag.client.y) > 4) drag.moved = true
    if (!drag.moved) return
    if (drag.node) {
      var point = toGraph(event)
      var i = +drag.node.getAttribute('data-i')
      pos[i].x = point.x; pos[i].y = point.y
      placeNode(drag.node)
      edgeEls.forEach(function (el) {
        if (+el.getAttribute('data-s') === i || +el.getAttribute('data-t') === i) placeEdge(el)
      })
    } else {
      var rect = svg.getBoundingClientRect()
      box[0] = drag.box[0] - (event.clientX - drag.client.x) / rect.width * box[2]
      box[1] = drag.box[1] - (event.clientY - drag.client.y) / rect.height * box[3]
      applyBox()
    }
  })
  function endDrag (event) {
    if (!drag) return
    var moved = drag.moved
    var node = drag.node
    drag = undefined
    if (svg.hasPointerCapture(event.pointerId)) svg.releasePointerCapture(event.pointerId)
    handled = moved || !!node
    // A pointer capture retargets the click; follow the node link explicitly.
    if (!moved && node && event.type === 'pointerup') location.hash = node.getAttribute('href')
  }
  svg.addEventListener('pointerup', endDrag)
  svg.addEventListener('pointercancel', endDrag)
  // Pointer navigation happened on pointerup; keyboard Enter still clicks the link.
  svg.addEventListener('click', function (event) {
    if (handled) event.preventDefault()
    handled = false
  })
  var panel = svg.parentNode.parentNode
  function zoom (factor) {
    var cx = box[0] + box[2] / 2, cy = box[1] + box[3] / 2
    box[2] = Math.min(Math.max(box[2] * factor, view0[2] / 8), view0[2] * 4)
    box[3] = box[2] * view0[3] / view0[2]
    box[0] = cx - box[2] / 2; box[1] = cy - box[3] / 2
    applyBox()
  }
  Array.prototype.forEach.call(panel.querySelectorAll('[data-zoom]'), function (button) {
    button.onclick = function () {
      var action = button.getAttribute('data-zoom')
      if (action === 'reset') { box = view0.slice(); applyBox() } else zoom(action === 'in' ? 0.8 : 1.25)
    }
  })
}

function graphPanel (id, tools) {
  return '<div class="panel"><div class="tools">' + tools + '<span class="grow"></span>' +
    '<button type="button" data-zoom="in" aria-label="Zoom in">+</button>' +
    '<button type="button" data-zoom="out" aria-label="Zoom out">&minus;</button>' +
    '<button type="button" data-zoom="reset">reset</button></div>' +
    '<div id="' + id + '"><p class="none" style="padding:.6rem">drawing graph&hellip;</p></div></div>'
}
function depthButtons (depth) {
  return '<span>hops</span>' + [1, 2, 3].map(function (d) {
    return '<button type="button" data-depth="' + d + '" aria-pressed="' + (d === depth) + '">' + d + '</button>'
  }).join('')
}
function graphCount (data) {
  return plural(data.nodes.length, 'entity', 'entities') +
    (data.total > data.nodes.length ? ' of ' + data.total + ' (most connected shown)' : '') +
    ' &middot; ' + plural(data.edges.length, 'relation')
}
/* Fetches a neighborhood after its page renders; depth buttons redraw in place. */
function neighborhood (name, depth, opts) {
  opts = opts || {}
  var id = opts.id || 'egraph'
  var target = view.querySelector('#' + id)
  if (!target) return
  var panel = target.parentNode
  Array.prototype.forEach.call(panel.querySelectorAll('[data-depth]'), function (button) {
    button.setAttribute('aria-pressed', String(+button.getAttribute('data-depth') === depth))
    button.onclick = function () { neighborhood(name, +button.getAttribute('data-depth'), opts) }
  })
  var link = panel.querySelector('.open-graph')
  if (link) link.setAttribute('href', '#/g/' + depth + '/' + enc(name))
  later('#' + id, api('graph', { name: name, depth: depth, aliases: aliasBox.checked }), function (el, data) {
    var count = panel.querySelector('.count')
    if (count) count.innerHTML = graphCount(data)
    drawGraph(el, data, { tall: opts.tall, label: 'relation graph around ' + name })
  })
}

/*
 * Loads a secondary panel for the current view. Superseded navigation drops
 * it, and so does a newer request for the same panel (a hop change while the
 * previous graph is still loading), whatever order the responses arrive in.
 */
var panelRequests = Object.create(null)
function later (selector, promise, render) {
  var current = navigation
  var ticket = panelRequests[selector] = (panelRequests[selector] || 0) + 1
  function live () { return current === navigation && panelRequests[selector] === ticket }
  promise.then(function (data) {
    var target = view.querySelector(selector)
    if (live() && target) render(target, data)
  }).catch(function (error) {
    var target = view.querySelector(selector)
    if (live() && target) target.innerHTML = '<p class="err" style="padding:.6rem">' + esc(error.message) + '</p>'
  })
}

/* Recently visited entities — this page session only, never stored. */
var trail = []
function visit (name) {
  trail = trail.filter(function (item) { return item !== name })
  trail.push(name)
  if (trail.length > 8) trail.shift()
  var nav = document.getElementById('trail')
  if (!nav) return
  var earlier = trail.slice(0, -1).reverse()
  nav.innerHTML = earlier.length === 0 ? '' : 'visited' + earlier.map(function (item) {
    return '<a href="#/e/' + enc(item) + '">' + esc(item) + '</a>'
  }).join('<span aria-hidden="true"> &middot;</span>')
}

function dashboard (data) {
  var cov = data.coverage
  var html = '<h1>Overview</h1>'
  html += '<p class="lede">' + plural(cov.entities, 'entity', 'entities') + ' &middot; ' +
    plural(cov.current, 'current belief') + ' &middot; ' + plural(data.topics.length, 'topic') +
    (cov.averageConfidence === null ? '' : ' &middot; average confidence ' + esc(pct(cov.averageConfidence))) + '</p>'
  html += fold('all coverage stats', '<div class="tiles">' +
    tile(cov.rows, 'rows') + tile(cov.facts, 'facts') + tile(cov.current, 'current') +
    tile(cov.entities, 'entities') + tile(cov.typedEntities, 'typed') +
    tile(cov.averageConfidence === null ? '&mdash;' : esc(pct(cov.averageConfidence)), 'avg conf') +
    tile(cov.retracted, 'retracted') + tile(cov.negated, 'negated') + tile(cov.lowConfidence, 'low conf') +
    tile(cov.satisfied + '/' + cov.checks, 'shape checks') +
    '</div>')
  html += section('map', graphPanel('map', '<span class="count"></span>') +
    '<p class="linked">The most connected entities and the current relations between them. Drag to rearrange, click an entity to open it, or <a href="#/g">open the full graph</a>.</p>')
  if (data.topics.length > 0) {
    html += section('topics', '<div class="chips">' + data.topics.map(function (topic) {
      return '<a class="chip" href="#/t/' + enc(topic.name) + '">' + esc(topic.name) + ' <span class="n">' + topic.members + '</span></a>'
    }).join('') + '</div>')
  }
  var attention = ''
  if (data.violations.total > 0) {
    attention += fold('shape violations', data.violations.items.map(function (violation) {
      return '<p class="claim" style="padding:.2rem 0;margin:0">' + entityHtml(violation.entity) +
        ' <span class="cmt">' + esc(shapeProblem(violation)) + '</span>' +
        ' <span class="hint">; ' + esc(violation.entity) + ' IS ' + esc(violation.via) + ', ' + esc(violation.type) + ' EXPECTS ' + esc(violation.name) + '</span></p>'
    }).join('') + capNote(data.violations), data.violations.total)
  }
  if (data.review.total > 0) {
    attention += fold('review candidates <span class="n">conf 0.3&ndash;0.7</span>', claimList(data.review.items) + capNote(data.review), data.review.total)
  }
  if (data.disagreements.total > 0) {
    attention += fold('alias disagreements', data.disagreements.items.map(function (disagreement) {
      return '<p class="none">' + esc(disagreement.about) + ' across ' + disagreement.entities.map(function (name) { return entityHtml(name) }).join(', ') + '</p>' +
        claimList(disagreement.rows)
    }).join('') + capNote(data.disagreements), data.disagreements.total)
  }
  if (data.stale.total > 0) {
    attention += fold('stale', data.stale.items.map(function (stale) {
      return claimHtml(stale.row, { note: stale.ageDays + 'd' })
    }).join('') + capNote(data.stale), data.stale.total)
  }
  if (attention !== '') html += section('needs attention', attention)
  var recent = data.recent
  html += section('recent', claimList(recent.slice(0, 10), { when: true }) +
    (recent.length > 10 ? fold('older appends', claimList(recent.slice(10), { when: true }), recent.length - 10) : ''))
  view.innerHTML = html
  later('#map', api('graph', {}), function (el, graph) {
    var count = view.querySelector('.panel .count')
    if (count) count.innerHTML = graphCount(graph)
    drawGraph(el, graph, { label: 'map of the most connected entities' })
  })
}

/* Neighbors grouped by relation, both directions — the quick way onward. */
function neighborsHtml (data) {
  var groups = Object.create(null)
  var order = []
  function add (label, name) {
    if (isLiteral(name) || name === data.name) return
    if (!groups[label]) { groups[label] = []; order.push(label) }
    if (groups[label].indexOf(name) < 0) groups[label].push(name)
  }
  data.out.forEach(function (c) { if (c.conf > 0) add((c.negated ? 'NOT ' : '') + c.verb + ' →', c.object) })
  data.in.forEach(function (c) {
    if (c.conf > 0) add(c.rel !== undefined ? (c.negated ? 'NOT ' : '') + c.rel + ' →' : '← ' + (c.negated ? 'NOT ' : '') + c.verb, c.subject)
  })
  if (order.length === 0) return ''
  return section('related', '<div class="neighbors">' + order.map(function (label) {
    return '<span class="vb">' + esc(label) + '</span><div class="chips">' + groups[label].map(function (name) {
      return '<a class="chip" href="#/e/' + enc(name) + '">' + esc(name) + '</a>'
    }).join('') + '</div>'
  }).join('') + '</div>')
}

function entityPage (data) {
  var html = '<h1>' + esc(data.name) + ' <span class="kind">entity</span></h1>'
  var badges = data.types.map(function (name) {
    return '<a class="chip type" href="#/e/' + enc(name) + '" title="' + esc(data.name) + ' IS ' + esc(name) + '">' + esc(name) + '</a>'
  }).concat(data.topics.map(function (name) {
    return '<a class="chip" href="#/t/' + enc(name) + '" title="topic">' + esc(name) + '</a>'
  }))
  if (badges.length > 0) html += '<div class="chips">' + badges.join('') + '</div>'
  if (data.aliases.length > 1) {
    html += '<p class="aka">aka ' + data.aliases.slice(1).map(function (name) { return entityHtml(name) }).join(', ') + '</p>'
  }
  var relations = data.out.length + data.in.length
  if (relations > 0) {
    html += section('neighborhood', graphPanel('egraph', depthButtons(1) + ' <span class="count"></span> <a class="open-graph" href="#/g/1/' + enc(data.name) + '">full screen</a>'))
  }
  html += neighborsHtml(data)
  html += section('facts', claimList(data.facts, { self: data.name }), data.facts.length || undefined)
  html += section('relations', fold('as subject', claimList(data.out, { self: data.name }), data.out.length, data.out.length <= 12) +
    fold('as object', data.in.length === 0 ? '<p class="none">none</p>' : data.in.map(function (c) {
      return claimHtml(c, { self: data.name, rel: c.rel })
    }).join(''), data.in.length, data.in.length <= 12))
  html += fold('activity <span class="n">all rows about ' + esc(data.name) + ', newest first</span>', claimList(data.activity, { when: true, self: data.name }) +
    (data.total > data.activity.length ? '<p class="none">showing the newest ' + data.activity.length + ' of ' + data.total + '</p>' : ''), data.total)
  view.innerHTML = html
  visit(data.name)
  if (relations > 0) neighborhood(data.name, 1)
}

function topicPage (data) {
  var html = '<h1>' + esc(data.name) + ' <span class="kind">topic</span></h1>'
  html += '<p class="lede"><a href="#/e/' + enc(data.name) + '">open as entity</a></p>'
  html += section('members', data.members.length === 0 ? '<p class="none">none</p>' :
    '<div class="chips">' + data.members.map(function (name) {
      return isLiteral(name) ? '<span class="chip">' + esc(name) + '</span>' :
        '<a class="chip" href="#/e/' + enc(name) + '">' + esc(name) + '</a>'
    }).join('') + '</div>', data.members.length)
  if (data.members.length > 0) {
    html += section('graph', graphPanel('egraph', depthButtons(1) + ' <span class="count"></span>'))
  }
  view.innerHTML = html
  if (data.members.length > 0) neighborhood(data.name, 1)
}

function graphPage (data) {
  var focus = data.focus
  var html = focus === undefined ?
    '<h1>Graph <span class="kind">most connected entities</span></h1>' :
    '<h1>' + esc(focus) + ' <span class="kind">graph</span></h1>'
  html += '<p class="lede">' + (focus === undefined ? '' : '<a href="#/e/' + enc(focus) + '">back to entity</a> &middot; ') +
    'Current relations between entities; negated ones dashed. Drag to rearrange or pan, hover to trace, click to open.</p>'
  var depth = Math.max.apply(null, data.nodes.map(function (node) { return node.depth || 0 }).concat([1]))
  var hops = location.hash.match(/^#\\/g\\/([1-3])\\//)
  if (hops) depth = +hops[1]
  html += graphPanel('fgraph', (focus === undefined ? '' : depthButtons(depth)) + ' <span class="count">' + graphCount(data) + '</span>')
  html += fold('as a list', data.nodes.length === 0 ? '<p class="none">none</p>' : '<div class="neighbors">' + data.nodes.map(function (node) {
    var out = data.edges.filter(function (edge) { return edge.source === node.name })
    return '<span class="vb"><a href="#/e/' + enc(node.name) + '">' + esc(node.name) + '</a></span><span class="hint">' +
      (out.length === 0 ? '&mdash;' : out.map(function (edge) {
        return (edge.negated ? 'NOT ' : '') + esc(edge.verb) + ' ' + esc(edge.target)
      }).join(', ')) + '</span>'
  }).join('') + '</div>', data.nodes.length)
  view.innerHTML = html
  Array.prototype.forEach.call(view.querySelectorAll('[data-depth]'), function (button) {
    button.onclick = function () { location.hash = '#/g/' + button.getAttribute('data-depth') + '/' + enc(focus) }
  })
  drawGraph(view.querySelector('#fgraph'), data, { tall: true, label: focus === undefined ? 'map of the most connected entities' : 'relation graph around ' + focus })
}

function historyPage (data) {
  var latest = data.rows[data.rows.length - 1]
  var html = '<h1>' + esc(latest.line) + ' <span class="kind">belief history</span></h1>'
  html += '<p class="linked">claim key <code>' + esc(data.key) + '</code> &middot; ' + data.rows.length +
    ' event(s) &middot; oldest first, the last row is the latest visible event</p>'
  if (latest.conf === 0) {
    html += '<p>This series is retracted in the selected audience.</p>'
  }
  html += claimList(data.rows, { when: true, bar: true })
  view.innerHTML = html
}

function treeHtml (nodes) {
  if (nodes.length === 0) { return '<p class="none">none</p>' }
  return '<ul class="tree">' + nodes.map(function (node) {
    return '<li><span class="role">' + esc(node.role || '') + '</span>' +
      claimHtml(node.row) +
      (node.repeat ? '<span class="rep">re-stated — rendered above</span>' :
        node.truncated ? '<span class="rep">depth cap reached — deeper rows exist, continue from this row&#39;s lineage</span>' :
          treeHtml0(node.children)) +
      '</li>'
  }).join('') + '</ul>'
}
function treeHtml0 (nodes) { return nodes.length === 0 ? '' : treeHtml(nodes) }

function lineagePage (data) {
  var html = '<h1>' + esc(data.row.line) + ' <span class="kind">lineage</span></h1>'
  html += claimHtml(data.row)
  html += '<p>These links show recorded evidence. Later changes to premises do not rewrite this claim’s original evidence.</p>'
  html += section('cites — recorded evidence (BECAUSE premises, VIA rules, WHEN conditions)', treeHtml(data.cites))
  html += section('cited by — what depends on it', treeHtml(data.citedBy))
  view.innerHTML = html
}

function searchPage (text, data) {
  view.innerHTML = '<h1>' + esc(text) + ' <span class="kind">search</span></h1>' +
    '<div id="names"></div>' +
    '<p>Search includes earlier revisions and retracted claims, newest first. Open a claim’s history to follow its changes.</p>' +
    (data.length === 100 ? '<p>Showing the newest 100 matches. More may exist; refine the search phrase to narrow the results.</p>' : '') +
    section('matches', claimList(data, { when: true }), data.length)
}
/* Entity names matching the phrase, offered above the claim matches. */
function namesFor (text) {
  later('#names', api('names', { q: text }), function (el, list) {
    el.innerHTML = list.length === 0 ? '' : section('entities', '<div class="chips">' + list.map(function (name) {
      return '<a class="chip" href="#/e/' + enc(name) + '">' + esc(name) + '</a>'
    }).join('') + '</div>', list.length)
  })
}

var navigation = 0
var renderedHash

function focusViewElement (destination) {
  destination.setAttribute('tabindex', '-1')
  destination.focus({ preventScroll: true })
  destination.scrollIntoView({ block: 'start', behavior: 'instant' })
  var header = document.querySelector('header')
  var overlap = (header ? header.getBoundingClientRect().bottom : 0) + 12 - destination.getBoundingClientRect().top
  if (overlap > 0) window.scrollBy({ top: -overlap, behavior: 'instant' })
}

function focusDestination (restoreFocus) {
  if (restoreFocus && document.activeElement === document.body) {
    var destination = view.querySelector('h1, [role="alert"]') || view.querySelector('h2')
    if (destination) {
      focusViewElement(destination)
    }
  }
}

function show (promise, render) {
  var current = navigation
  document.title = 'Loading view — ' + baseTitle
  var restoreFocus = view.contains(document.activeElement)
  view.setAttribute('aria-busy', 'true')
  loadingStatus.textContent = 'Loading view.'
  view.innerHTML = '<p class="none">loading&hellip;</p>'
  promise.then(function (data) {
    if (current === navigation) {
      render(data)
      var heading = view.querySelector('h1')
      document.title = (heading ? heading.textContent : 'Overview') + ' — ' + baseTitle
      view.setAttribute('aria-busy', 'false')
      loadingStatus.textContent = 'View loaded.'
      focusDestination(restoreFocus)
    }
  }).catch(function (error) {
    if (current === navigation) showError(error, restoreFocus)
  })
}

function showError (error, restoreFocus) {
  document.title = 'View error — ' + baseTitle
  view.setAttribute('aria-busy', 'false')
  loadingStatus.textContent = ''
  view.innerHTML = '<p class="err" role="alert">' + esc(error.message) + '</p>' +
    '<button class="retry" type="button">Retry view</button>'
  view.querySelector('.retry').addEventListener('click', route)
  focusDestination(restoreFocus)
}

function route () {
  navigation++
  var restoreFocus = view.contains(document.activeElement)
  try {
    renderRoute()
  } catch (error) {
    showError(error, restoreFocus)
  }
}

function renderRoute () {
  var hash = location.hash || '#/'
  var changedRoute = hash !== renderedHash
  renderedHash = hash
  var aliases = aliasBox.checked
  var match
  if ((match = hash.match(/^#\\/e\\/(.+)$/))) {
    show(api('entity', { name: decodeURIComponent(match[1]), aliases: aliases }), entityPage)
  } else if ((match = hash.match(/^#\\/t\\/(.+)$/))) {
    show(api('topic', { name: decodeURIComponent(match[1]), aliases: aliases }), topicPage)
  } else if ((match = hash.match(/^#\\/k\\/(.+)$/))) {
    show(api('history', { key: decodeURIComponent(match[1]) }), historyPage)
  } else if ((match = hash.match(/^#\\/l\\/(.+)$/))) {
    show(api('lineage', { id: decodeURIComponent(match[1]) }), lineagePage)
  } else if ((match = hash.match(/^#\\/s\\/(.+)$/))) {
    var text = decodeURIComponent(match[1])
    if (changedRoute) searchBox.value = text
    show(api('search', { q: text }), function (data) { searchPage(text, data); namesFor(text) })
  } else if ((match = hash.match(/^#\\/g\\/([1-3])\\/(.+)$/))) {
    show(api('graph', { name: decodeURIComponent(match[2]), depth: match[1], aliases: aliases }), graphPage)
  } else if (/^#\\/g\\/?$/.test(hash)) {
    show(api('graph'), graphPage)
  } else {
    show(api('overview'), dashboard)
  }
}
window.addEventListener('hashchange', route)
// "/" jumps to search from anywhere outside a text field.
document.addEventListener('keydown', function (event) {
  var target = event.target
  var typing = target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)
  if (event.key === '/' && !typing && !event.ctrlKey && !event.metaKey && !event.altKey) {
    event.preventDefault()
    searchBox.focus()
    searchBox.select()
  }
})
route()
</script>
</body>
</html>
`
