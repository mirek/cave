/**
 * The page (spec §30.1) — one static, self-contained HTML document: no
 * external scripts, styles, fonts or images, so it renders offline and
 * the server's CSP can deny every non-self source. Views are hash
 * routes over the read-only `/api/*` endpoints; claims render from
 * *structured* row data (never by re-parsing text — no second grammar),
 * and every entity name, claim key and row id links onward: entity 360,
 * topic browse, belief-history timeline, lineage, search.
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
  --bar: #cfe3f7; --mark: #fff2c4;
}
@media (prefers-color-scheme: dark) {
  :root {
    --bg: #111417; --fg: #e4e6e8; --dim: #969ca3; --line: #272c31;
    --accent: #6db3f2; --pill: #1c2126; --bad: #ff8078; --warn: #dfb54a;
    --bar: #1f3c5a; --mark: #4a3f14;
  }
}
* { box-sizing: border-box; }
body {
  margin: 0; background: var(--bg); color: var(--fg);
  font: 15px/1.5 system-ui, sans-serif;
}
a { color: var(--accent); text-decoration: none; }
a:hover { text-decoration: underline; }
header {
  position: sticky; top: 0; display: flex; gap: 1rem; align-items: center;
  padding: .55rem 1rem; background: var(--bg); border-bottom: 1px solid var(--line);
}
header .brand { font-weight: 700; color: var(--fg); }
header input[type=search] {
  flex: 1; max-width: 26rem; padding: .3rem .6rem; border: 1px solid var(--line);
  border-radius: .4rem; background: var(--pill); color: var(--fg); font: inherit;
}
header label { color: var(--dim); font-size: .85rem; display: flex; gap: .35rem; align-items: center; }
main { max-width: 64rem; margin: 0 auto; padding: 1rem 1rem 3rem; }
footer {
  max-width: 64rem; margin: 0 auto; padding: .6rem 1rem 1.4rem;
  color: var(--dim); font-size: .8rem; border-top: 1px solid var(--line);
}
h1 { font-size: 1.25rem; margin: .8rem 0 .4rem; word-break: break-word; }
h1 .kind { color: var(--dim); font-weight: 400; font-size: .85rem; }
section { margin: 1.1rem 0; }
section h2 { font-size: .8rem; text-transform: uppercase; letter-spacing: .06em; color: var(--dim); margin: 0 0 .35rem; }
section h2 .n { font-weight: 400; }
.none { color: var(--dim); font-size: .85rem; margin: .2rem 0; }
.err { color: var(--bad); }
.tiles { display: flex; flex-wrap: wrap; gap: .5rem; }
.tile { background: var(--pill); border-radius: .5rem; padding: .45rem .8rem; min-width: 5.4rem; }
.tile b { display: block; font-size: 1.15rem; }
.tile span { color: var(--dim); font-size: .75rem; }
.chips { display: flex; flex-wrap: wrap; gap: .4rem; }
.chip { background: var(--pill); border-radius: 1rem; padding: .15rem .7rem; font-size: .85rem; }
.chip .n { color: var(--dim); }
.claim {
  display: flex; flex-wrap: wrap; gap: .45ch; align-items: baseline;
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: .84rem; padding: .18rem 0; border-bottom: 1px dotted var(--line);
  word-break: break-word;
}
.claim:last-child { border-bottom: 0; }
.claim.dim > :not(.meta) { opacity: .55; }
.v { font-weight: 600; }
.not { color: var(--bad); font-style: normal; font-weight: 700; }
.a { color: var(--dim); }
.lit, .val { }
.ctx, .tag { background: var(--pill); border-radius: .3rem; padding: 0 .35rem; font-size: .78rem; color: var(--dim); }
.ctx.src { color: var(--accent); }
.conf { color: var(--warn); }
.conf.retracted { color: var(--bad); }
.imp { color: var(--bad); font-weight: 700; }
.cmt { color: var(--dim); }
.rel { color: var(--dim); font-size: .78rem; border: 1px solid var(--line); border-radius: .3rem; padding: 0 .3rem; }
.meta { margin-left: auto; white-space: nowrap; font-size: .74rem; }
.meta a, .meta time { color: var(--dim); margin-left: .6ch; }
.meta a:hover { color: var(--accent); }
.bar { display: inline-block; width: 7rem; height: .5rem; background: var(--pill); border-radius: .25rem; overflow: hidden; flex: none; }
.bar i { display: block; height: 100%; background: var(--bar); }
.when { color: var(--dim); font-size: .74rem; width: 6.2rem; flex: none; }
.tree, .tree ul { list-style: none; margin: 0; padding: 0 0 0 1.1rem; border-left: 1px solid var(--line); }
.tree > li, .tree ul > li { margin: .15rem 0; }
.role { color: var(--dim); font-size: .74rem; text-transform: uppercase; }
.rep { color: var(--dim); font-size: .78rem; }
.aka { color: var(--dim); font-size: .85rem; }
mark { background: var(--mark); color: inherit; border-radius: .2rem; }
.linked { font-size: .8rem; color: var(--dim); margin-top: .3rem; }
</style>
</head>
<body>
<header>
  <a class="brand" href="#/">cave</a>
  <input id="q" type="search" placeholder="search claims… (enter)">
  <label><input id="aliases" type="checkbox"> aliases</label>
</header>
<main id="view"></main>
<footer>cave __CAVE_VERSION__ &middot; __CAVE_DB__ &middot; sensitivity &le; __CAVE_SENSITIVITY__ &middot; read-only view</footer>
<script>
'use strict'
var view = document.getElementById('view')
var aliasBox = document.getElementById('aliases')
var searchBox = document.getElementById('q')
var BACKTICK = '\\u0060'

aliasBox.checked = localStorage.getItem('cave-aliases') === '1'
aliasBox.addEventListener('change', function () {
  localStorage.setItem('cave-aliases', aliasBox.checked ? '1' : '0')
  route()
})
searchBox.addEventListener('keydown', function (event) {
  if (event.key === 'Enter' && searchBox.value.trim() !== '') {
    location.hash = '#/s/' + encodeURIComponent(searchBox.value.trim())
  }
})

function esc (value) {
  return String(value).replace(/[&<>"']/g, function (char) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]
  })
}
var enc = encodeURIComponent
function pct (value) { return Math.round(value * 1000) / 10 + '%' }

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
      if (!res.ok) { throw new Error(body.error || ('http ' + res.status)) }
      return body
    })
  })
}

function isLiteral (name) { return name.charAt(0) === '"' || name.charAt(0) === BACKTICK }
function entityHtml (name) {
  return isLiteral(name) ?
    '<span class="lit">' + esc(name) + '</span>' :
    '<a class="e" href="#/e/' + enc(name) + '">' + esc(name) + '</a>'
}

function claimHtml (c, opts) {
  opts = opts || {}
  var parts = []
  if (opts.when) { parts.push('<span class="when" title="' + esc(c.at) + '">' + esc(c.at.slice(0, 10)) + '</span>') }
  if (opts.bar) { parts.push('<span class="bar" title="confidence ' + pct(c.conf) + '"><i style="width:' + (c.conf * 100) + '%"></i></span>') }
  parts.push(entityHtml(c.subject))
  parts.push('<span class="v">' + esc(c.verb) + '</span>' + (c.negated ? ' <em class="not">NOT</em>' : ''))
  if (c.object !== undefined) {
    parts.push(entityHtml(c.object))
  } else if (c.attribute !== undefined) {
    parts.push('<span class="a">' + esc(c.attribute) + ':</span> <span class="val">' + esc(c.value) + '</span>')
  } else if (c.value !== undefined) {
    parts.push('<span class="val">' + esc(c.value) + '</span>')
  }
  if (c.delta !== undefined) { parts.push('<span class="val">+/- ' + esc(c.delta) + '</span>') }
  c.contexts.forEach(function (ctx) {
    var source = (c.sources || []).filter(function (item) { return item.context === ctx })[0]
    var label = '@' + esc(ctx)
    if (source && source.href) {
      label = '<a href="' + esc(source.href) + '" target="_blank" rel="noopener noreferrer" title="' + esc(source.location) + '">' + label + '</a>'
    }
    parts.push('<span class="ctx' + (ctx.indexOf('src:') === 0 ? ' src' : '') + '">' + label + '</span>')
  })
  c.tags.forEach(function (tag) {
    parts.push('<span class="tag">#' + esc(tag.key) + (tag.value !== undefined ? ':' + esc(tag.value) : '') + '</span>')
  })
  if (c.conf === 0) {
    parts.push('<span class="conf retracted" title="retracted">@ 0%</span>')
  } else if (c.conf < 1) {
    parts.push('<span class="conf">@ ' + pct(c.conf) + '</span>')
  }
  if (c.importance) { parts.push('<span class="imp">!</span>') }
  if (c.comment !== undefined) { parts.push('<span class="cmt">; ' + esc(c.comment) + '</span>') }
  var meta = '<span class="meta">' +
    '<a href="#/k/' + enc(c.key) + '" title="belief history of this fact">history</a>' +
    (c.cites > 0 || c.citedBy > 0 ? '<a href="#/l/' + enc(c.id) + '" title="cites ' + c.cites + ', cited by ' + c.citedBy + '">lineage</a>' : '') +
    (opts.when ? '' : '<time title="' + esc(c.at) + '">' + esc(c.at.slice(0, 10)) + '</time>') +
    '</span>'
  return '<div class="claim' + (c.conf === 0 ? ' dim' : '') + '">' + parts.join(' ') + meta + '</div>'
}

function claimList (list, opts) {
  return list.length === 0 ? '<p class="none">none</p>' : list.map(function (c) { return claimHtml(c, opts) }).join('')
}
function section (title, body, count) {
  return '<section><h2>' + title + (count !== undefined ? ' <span class="n">(' + count + ')</span>' : '') + '</h2>' + body + '</section>'
}
function capNote (capped) {
  return capped.items.length < capped.total ?
    '<p class="none">…and ' + (capped.total - capped.items.length) + ' more (see cave check)</p>' : ''
}
function tile (value, label) {
  return '<div class="tile"><b>' + value + '</b><span>' + label + '</span></div>'
}

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

function dashboard (data) {
  var cov = data.coverage
  var html = ''
  html += section('coverage', '<div class="tiles">' +
    tile(cov.rows, 'rows') + tile(cov.facts, 'facts') + tile(cov.current, 'current') +
    tile(cov.entities, 'entities') + tile(cov.typedEntities, 'typed') +
    tile(cov.averageConfidence === null ? '&mdash;' : pct(cov.averageConfidence), 'avg conf') +
    tile(cov.retracted, 'retracted') + tile(cov.negated, 'negated') + tile(cov.lowConfidence, 'low conf') +
    tile(cov.satisfied + '/' + cov.checks, 'shape checks') +
    '</div>')
  if (data.topics.length > 0) {
    html += section('topics', '<div class="chips">' + data.topics.map(function (topic) {
      return '<a class="chip" href="#/t/' + enc(topic.name) + '">' + esc(topic.name) + ' <span class="n">' + topic.members + '</span></a>'
    }).join('') + '</div>')
  }
  if (data.violations.total > 0) {
    html += section('shape violations', data.violations.items.map(function (violation) {
      return '<div class="claim">' + entityHtml(violation.entity) +
        '<span class="cmt">' + esc(shapeProblem(violation)) + '</span>' +
        '<span class="cmt">; ' + esc(violation.entity) + ' IS ' + esc(violation.via) + ', ' + esc(violation.type) + ' EXPECTS ' + esc(violation.name) + '</span></div>'
    }).join('') + capNote(data.violations), data.violations.total)
  }
  if (data.review.total > 0) {
    html += section('review candidates <span class="n">conf 0.3&ndash;0.7</span>', claimList(data.review.items) + capNote(data.review), data.review.total)
  }
  if (data.disagreements.total > 0) {
    html += section('alias disagreements', data.disagreements.items.map(function (disagreement) {
      return '<p class="none">' + esc(disagreement.about) + ' across ' + disagreement.entities.map(entityHtml).join(', ') + '</p>' +
        claimList(disagreement.rows)
    }).join('') + capNote(data.disagreements), data.disagreements.total)
  }
  if (data.stale.total > 0) {
    html += section('stale', data.stale.items.map(function (stale) {
      return claimHtml(stale.row).replace('<span class="meta">', '<span class="meta">' + stale.ageDays + 'd')
    }).join('') + capNote(data.stale), data.stale.total)
  }
  html += section('recent', claimList(data.recent, { when: true }))
  view.innerHTML = html
}

function entityPage (data) {
  var html = '<h1>' + esc(data.name) + ' <span class="kind">entity</span></h1>'
  if (data.types.length > 0) {
    html += '<p class="aka">IS ' + data.types.map(entityHtml).join(', ') + '</p>'
  }
  if (data.aliases.length > 1) {
    html += '<p class="aka">aka ' + data.aliases.slice(1).map(entityHtml).join(', ') + '</p>'
  }
  if (data.topics.length > 0) {
    html += '<div class="chips">' + data.topics.map(function (name) {
      return '<a class="chip" href="#/t/' + enc(name) + '">' + esc(name) + '</a>'
    }).join('') + '</div>'
  }
  html += section('facts', claimList(data.facts))
  html += section('relations — as subject', claimList(data.out))
  html += section('relations — as object', data.in.length === 0 ? '<p class="none">none</p>' : data.in.map(function (c) {
    var rel = c.rel !== undefined ? '<span class="rel" title="declared inverse — same stored fact read from this side">' + esc(c.rel) + '</span> ' : ''
    return claimHtml(c).replace('<div class="claim">', '<div class="claim">' + rel)
  }).join(''))
  html += section('activity', claimList(data.activity, { when: true }), data.total)
  view.innerHTML = html
}

function topicPage (data) {
  var html = '<h1>' + esc(data.name) + ' <span class="kind">topic</span></h1>'
  html += section('members', data.members.length === 0 ? '<p class="none">none</p>' :
    '<div class="chips">' + data.members.map(function (name) {
      return isLiteral(name) ? '<span class="chip">' + esc(name) + '</span>' :
        '<a class="chip" href="#/e/' + enc(name) + '">' + esc(name) + '</a>'
    }).join('') + '</div>', data.members.length)
  view.innerHTML = html
}

function historyPage (data) {
  var current = data.rows[data.rows.length - 1]
  var html = '<h1>' + esc(current.line) + ' <span class="kind">belief history</span></h1>'
  html += '<p class="linked">claim key <code>' + esc(data.key) + '</code> &middot; ' + data.rows.length +
    ' event(s) &middot; oldest first, the last row is current belief</p>'
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
  html += section('cites — why this is believed (BECAUSE premises, VIA rules, WHEN conditions)', treeHtml(data.cites))
  html += section('cited by — what depends on it', treeHtml(data.citedBy))
  view.innerHTML = html
}

function searchPage (text, data) {
  searchBox.value = text
  view.innerHTML = '<h1>' + esc(text) + ' <span class="kind">search</span></h1>' +
    section('matches', claimList(data, { when: true }), data.length)
}

function show (promise, render) {
  view.innerHTML = '<p class="none">loading&hellip;</p>'
  promise.then(render).catch(function (error) {
    view.innerHTML = '<p class="err">' + esc(error.message) + '</p>'
  })
}

function route () {
  var hash = location.hash || '#/'
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
    show(api('search', { q: text }), function (data) { searchPage(text, data) })
  } else {
    show(api('overview'), dashboard)
  }
}
window.addEventListener('hashchange', route)
route()
</script>
</body>
</html>
`
