import { test } from 'node:test'
import * as assert from 'node:assert/strict'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { open } from '@cavelang/store'
import { Files, run, Web } from '@cavelang/ingest'

for (const phase of ['fetch', 'body']) test(`URL selection reports unprintable ${phase} errors and permits retry`, async () => {
  const store = open()
  const bad = 'https://example.test/bad', good = 'https://example.test/good'
  const unreadable = new Error('unreadable')
  Object.defineProperty(unreadable, 'message', { get() { throw new Error('message unavailable') } })
  try {
    for (const failure of [Object.create(null), unreadable]) {
      const selected = await Web.select(store, [bad, good], { fetchImpl: async url => {
        if (String(url) === bad && phase === 'fetch') throw failure
        const response = new Response('source material')
        if (String(url) === bad) Object.defineProperty(response, 'arrayBuffer', { value: async () => { throw failure } })
        return response
      } })
      assert.deepEqual(selected.failures, [{ path: bad, kind: 'network', retryable: true,
        message: `fetch ${bad} failed: [unprintable thrown value]` }])
      assert.deepEqual(selected.files.map(file => file.path), [good])
      assert.equal(store.currentBeliefs().length, 0)
      const recovered = await Web.select(store, [bad, good], { fetchImpl: async () => new Response('recovered') })
      assert.deepEqual(recovered.failures, [])
      assert.deepEqual(recovered.files.map(file => file.path), [bad, good])
    }
  } finally { store.close() }
})

test('URL failures escape control-bearing labels and retain structured identity', async () => {
  const store = open()
  try {
    for (const control of ['\n', '\r', '\t', '\x1b', '\x7f', '\u0085', '\u2028', '\u2029']) {
      const url = `https://example.test/a${control}b`
      for (const phase of ['fetch', 'body', 'http']) {
        const selected = await Web.select(store, [url], { fetchImpl: async () => {
          if (phase === 'fetch') throw new Error(`failed${control}detail`)
          const response = new Response('body', { status: phase === 'http' ? 503 : 200 })
          if (phase === 'body') Object.defineProperty(response, 'arrayBuffer', {
            value: async () => { throw new Error(`failed${control}detail`) }
          })
          if (phase === 'http') Object.defineProperty(response, 'statusText', { value: `failed${control}detail` })
          return response
        } })
        assert.equal(selected.failures[0]!.path, url)
        assert.equal(selected.failures[0]!.kind, phase === 'http' ? 'http' : 'network')
        assert.equal(selected.failures[0]!.retryable, true)
        assert.doesNotMatch(selected.failures[0]!.message, /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/)
        assert.match(selected.failures[0]!.message, /failed.*detail/)
        assert.deepEqual(selected.files, [])
      }
    }
  } finally { store.close() }
})

test('URL selection retains force policy while fetching unchanged content', async () => {
  const store = open()
  const url = 'https://example.com/source'
  const response = () => new Response('unchanged content', { headers: { 'content-type': 'text/plain' } })
  try {
    Files.recordDigests(store, (await Web.select(store, [url], { fetchImpl: async () => response() })).files)
    for (const force of [true, false]) {
      const options = { force, fetchImpl: async () => {
        await Promise.resolve()
        options.force = !force
        return response()
      } }
      const selected = await Web.select(store, [url], options)
      assert.equal(selected.files.length, force ? 1 : 0)
      assert.deepEqual(selected.skipped, force ? [] : [url])
    }
  } finally { store.close() }
})

test('URL selection retains cancellation when fetch callbacks replace the signal', async () => {
  const store = open()
  try {
    const controller = new AbortController()
    const reason = new Error('cancel URL selection')
    const options = {
      signal: controller.signal as AbortSignal | undefined,
      fetchImpl: async (): Promise<Response> => {
        await Promise.resolve()
        options.signal = undefined
        controller.abort(reason)
        throw reason
      }
    }
    await assert.rejects(Web.select(store, ['https://example.com/source'], options), error => error === reason)
  } finally { store.close() }
})

const paragraph = (text: string): string =>
  `<p>${text} ${'This sentence pads the article far enough past the readability character threshold to make extraction deterministic. '.repeat(3)}</p>`

const page = (title: string, body: string): string =>
  `<html><head><title>${title}</title></head><body>
    <nav>Home | About | chrome-to-drop</nav>
    <article><h1>${title}</h1>${body}</article>
    <footer>copyright footer-to-drop</footer>
    <script>console.log('script-to-drop')</script>
  </body></html>`

/** Fake fetch serving canned responses, no network. */
const fetchFrom = (routes: Record<string, { body: string, type?: string, status?: number }>): Web.FetchLike =>
  async url => {
    const route = routes[url]
    if (route === undefined) {
      return new Response('missing', { status: 404, statusText: 'Not Found' })
    }
    return new Response(route.body, {
      status: route.status ?? 200,
      headers: { 'content-type': route.type ?? 'text/html' }
    })
  }

test('isUrl recognizes http(s) sources only', () => {
  assert.ok(Web.isUrl('https://example.com/notes'))
  assert.ok(Web.isUrl('http://localhost:8080/'))
  assert.ok(!Web.isUrl('src/**/*.ts'))
  assert.ok(!Web.isUrl('https.md'))
  assert.ok(!Web.isUrl('file:///etc/hosts'))
})

test('readableTextOf keeps the article, drops chrome, prefixes the title', () => {
  const text = Web.readableTextOf(page('Design Notes', [
    paragraph('The store is append-only.'),
    '<h2>Fusion</h2>',
    paragraph('Beliefs fuse via noisy-OR.'),
    '<pre>cave  query</pre>'
  ].join('')))
  assert.match(text, /^# Design Notes\n/)
  assert.match(text, /The store is append-only\./)
  assert.match(text, /## Fusion/)
  assert.match(text, /Beliefs fuse via noisy-OR\./)
  assert.match(text, /cave  query/, 'pre blocks keep their whitespace')
  assert.doesNotMatch(text, /chrome-to-drop|footer-to-drop|script-to-drop/)
  assert.ok(text.includes('.\n\n'), 'blocks are separated by blank lines')
})

test('readableTextOf falls back to body text when no article is found', () => {
  const text = Web.readableTextOf(
    '<html><head><title>Tiny</title><style>p{color:red}</style></head><body><p>Just one short line.</p></body></html>')
  assert.match(text, /^# Tiny/)
  assert.match(text, /Just one short line\./)
  assert.doesNotMatch(text, /color:red/)
})

test('HTML line breaks separate words and preserve preformatted lines', () => {
  for (const tag of ['p', 'div', 'pre']) {
    const text = Web.readableTextOf(`<html><head><title>Breaks</title></head><body><${tag}>First<br>Second<br/>Third</${tag}></body></html>`)
    assert.equal(text, `# Breaks\n\n${tag === 'pre' ? 'First\nSecond\nThird' : 'First Second Third'}`, tag)
  }
})

test('HTML extraction retains text surrounding recognized blocks in document order', async () => {
  for (const body of [
    '<article><span>Before</span><p>Middle</p><span>After</span></article>',
    '<article>Before<p>Middle</p>After</article>',
    '<article><div><b>Be</b>fore</div><p>Middle</p><div>Af<i>ter</i></div></article>',
  ]) {
    const html = `<html><body>${body}</body></html>`
    const expected = 'Before\n\nMiddle\n\nAfter'
    assert.equal(Web.readableTextOf(html), expected)
    const selected = await Web.fetchDocument('https://example.test/mixed', async () =>
      new Response(html, { headers: { 'content-type': 'text/html' } }))
    assert.equal(selected.content, expected)
    assert.equal(selected.digest, Files.digestOf(expected))
  }
})

test('HTML structural containers preserve boundaries without flattening nested blocks', async () => {
  for (const tag of ['section', 'article', 'main', 'aside', 'figure', 'details', 'div']) {
    const html = `<html><body><${tag}>First</${tag}><${tag}>Second</${tag}></body></html>`
    const expected = 'First\n\nSecond'
    assert.equal(Web.readableTextOf(html), expected, tag)
    const fetched = await Web.fetchDocument('https://example.test/sections', async () =>
      new Response(html, { headers: { 'content-type': 'text/html' } }))
    assert.equal(fetched.content, expected)
    assert.equal(fetched.digest, Files.digestOf(expected))
  }
  assert.equal(Web.readableTextOf('<html><body><section>Before<h2>Title</h2><pre><code>  code\n  next</code></pre>After</section></body></html>'),
    'Before\n\n## Title\n\n  code\n  next\n\nAfter')
  assert.equal(Web.readableTextOf('<html><body><blockquote><section>First</section><section>Second</section></blockquote></body></html>'), 'First Second')
  assert.equal(Web.readableTextOf('<html><body><section>Sup<span>port</span></section><section>team</section></body></html>'),
    'Support\n\nteam')
})

test('empty HTML list items do not add markers or change source digests', async () => {
  const store = open()
  const url = 'https://example.test/list'
  try {
    for (const empty of ['', '<li></li>', '<li>   </li>', '<li><span></span></li>']) {
      const html = `<html><body><ul>${empty}<li>Content</li>${empty}</ul></body></html>`
      assert.equal(Web.readableTextOf(html), '- Content')
      const selected = await Web.select(store, [url], { fetchImpl: async () =>
        new Response(html, { headers: { 'content-type': 'text/html' } }) })
      if (empty === '') {
        assert.deepEqual(selected.files, [{ path: url, content: '- Content', digest: Files.digestOf('- Content') }])
        Files.recordDigests(store, selected.files)
      } else {
        assert.deepEqual(selected.files, [])
        assert.deepEqual(selected.skipped, [url])
      }
    }
  } finally { store.close() }
})

test('title-only HTML has stable content identity across empty bodies and matching headings', async () => {
  const store = open()
  const url = 'https://example.test/title-only'
  try {
    for (const body of ['', '<script>ignored()</script>', '<section></section>', '<h1>Title</h1>']) {
      const html = `<html><head><title>Title</title></head><body>${body}</body></html>`
      assert.equal(Web.readableTextOf(html), '# Title')
      const selected = await Web.select(store, [url], { fetchImpl: async () =>
        new Response(html, { headers: { 'content-type': 'text/html' } }) })
      if (body === '') {
        assert.deepEqual(selected.files, [{ path: url, content: '# Title', digest: Files.digestOf('# Title') }])
        Files.recordDigests(store, selected.files)
      } else {
        assert.deepEqual(selected.files, [])
        assert.deepEqual(selected.skipped, [url])
      }
    }
  } finally { store.close() }
})

test('HTML title suppression requires a complete matching line', () => {
  for (const code of ['# API Reference', '# APIs', '# API']) {
    const html = `<html><head><title>API</title></head><body><pre>${code}</pre></body></html>`
    assert.equal(Web.readableTextOf(html), code === '# API' ? code : `# API\n\n${code}`)
  }
})

test('HTML preformatted extraction retains boundary indentation and blank lines', async () => {
  for (const content of ['    first\n        second  ', '\n\n    first\n\n', '    ']) {
    // A literal newline directly after <pre> has HTML parsing semantics; use an
    // inline code child so the fixture supplies the intended text explicitly.
    const html = `<html><body><pre><code>${content}</code></pre></body></html>`
    assert.equal(Web.readableTextOf(html), content)
    const selected = await Web.fetchDocument('https://example.test/code', async () =>
      new Response(html, { headers: { 'content-type': 'text/html' } }))
    assert.equal(selected.content, content)
    assert.equal(selected.digest, Files.digestOf(content))
  }
})

test('HTML articles without selected block elements retain their body text', () => {
  for (const tag of ['span', 'b']) {
    assert.equal(Web.readableTextOf(`<html><body><${tag}>Contact support</${tag}></body></html>`), 'Contact support')
  }
})

test('HTML address blocks retain boundaries and unchanged-source skipping', async () => {
  const store = open()
  try {
    for (const [body, expected] of [
      ['<address>One</address><address>Two</address>', 'One\n\nTwo'],
      ['<p>Before</p><address><b>Sup</b>port</address><address>Operations</address><p>After</p>', 'Before\n\nSupport\n\nOperations\n\nAfter'],
      ['<blockquote><address>One</address><address>Two</address></blockquote>', 'One Two'],
    ] as const) {
      const html = `<html><body>${body}</body></html>`
      assert.equal(Web.readableTextOf(html), expected)
      const url = 'https://example.test/contacts'
      const fetchImpl = async () => new Response(html, { headers: { 'content-type': 'text/html' } })
      const selected = await Web.select(store, [url], { fetchImpl })
      assert.deepEqual(selected.files, [{ path: url, content: expected, digest: Files.digestOf(expected) }])
      Files.recordDigests(store, selected.files)
      assert.deepEqual((await Web.select(store, [url], { fetchImpl })).skipped, [url])
    }
  } finally { store.close() }
})

test('HTML definition lists retain terms and values through article extraction', () => {
  assert.equal(Web.readableTextOf('<html><body><dl><dt>Service</dt><dd>API</dd><dt>Port</dt><dd>8080</dd></dl></body></html>'), 'Service\n\nAPI\n\nPort\n\n8080')
})

test('HTML table extraction retains captions and column and row headers', async () => {
  const html = '<html><body><table><caption>Service configuration</caption>' +
    '<tr><th><p>Service</p></th><th>Port</th></tr>' +
    '<tr><th>API</th><td>8080</td></tr>' +
    '<tr><th>Admin</th><td><p>9090</p><p>Internal only</p></td></tr></table></body></html>'
  const expected = 'Service configuration\n\nService\n\nPort\n\nAPI\n\n8080\n\nAdmin\n\n9090 Internal only'
  assert.equal(Web.readableTextOf(html), expected)
  const result = await Web.fetchDocument('https://example.test/table', async () =>
    new Response(html, { headers: { 'content-type': 'text/html' } }))
  assert.equal(result.content, expected)
  assert.equal(result.digest, Files.digestOf(expected))
})

test('HTML nested blocks separate words without duplicating text or splitting inline words', async () => {
  const cases = [
    ['<blockquote><p>First paragraph.</p><p>Second paragraph.</p></blockquote>', 'First paragraph. Second paragraph.'],
    ['<ul><li>Parent<ul><li>Child one</li><li>Child two</li></ul></li></ul>', '- Parent Child one Child two'],
    ['<blockquote><p><b>inter</b>face</p><blockquote><p>Nested</p><p>quote</p></blockquote><p>After</p></blockquote>', 'interface Nested quote After'],
  ] as const
  const store = open()
  try {
    for (const [body, expected] of cases) {
      const html = `<html><body>${body}</body></html>`
      assert.equal(Web.readableTextOf(html), expected)
      const url = 'https://example.test/nested'
      const fetchImpl = async () => new Response(html, { headers: { 'content-type': 'text/html' } })
      const selection = await Web.select(store, [url], { fetchImpl })
      assert.deepEqual(selection.files, [{ path: url, content: expected, digest: Files.digestOf(expected) }])
      Files.recordDigests(store, selection.files)
      assert.deepEqual((await Web.select(store, [url], { fetchImpl })).skipped, [url])
    }
  } finally { store.close() }
})

test('fetchDocument rejects malformed URL Unicode before issuing a request', async () => {
  const requests: string[] = []
  const server = createServer((request, response) => {
    requests.push(request.url!)
    response.end('source text')
  })
  try {
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    const root = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
    for (const surrogate of ['\ud800', '\udc00']) {
      await assert.rejects(Web.fetchDocument(`${root}/${surrogate}`), /URL must contain well-formed Unicode/)
    }
    assert.deepEqual(requests, [])
    const url = `${root}/café-😀`
    const document = await Web.fetchDocument(url)
    assert.equal(document.path, url)
    assert.equal(document.content, 'source text')
    assert.deepEqual(requests, ['/caf%C3%A9-%F0%9F%98%80'])
  } finally {
    server.closeAllConnections()
    await new Promise<void>(resolve => server.close(() => resolve()))
  }
})

test('fetchDocument converts whole-millisecond decimal timeouts and rejects invalid settings before fetch', async () => {
  let calls = 0
  const fetchImpl = async () => { calls++; return new Response('ok') }
  const document = await Web.fetchDocument('https://k.test/timeouts', fetchImpl, 1.001)
  assert.equal(document.content, 'ok')
  assert.equal(calls, 1)
  for (const timeout of [NaN, Infinity, -1, 0.0001, 1.0001, 2147483.648]) {
    await assert.rejects(Web.fetchDocument('https://k.test/timeouts', fetchImpl, timeout),
      error => error instanceof TypeError && /timeout must resolve to whole milliseconds/.test(error.message))
  }
  assert.equal(calls, 1)
})

test('fetchDocument extracts HTML, passes markdown through, digests the content', async () => {
  const fetchImpl = fetchFrom({
    'https://k.test/post': { body: page('Post', paragraph('Auth uses JWT.')) },
    'https://k.test/notes.md': { body: '# Notes\n\ncave IS append-only\n', type: 'text/markdown' }
  })
  const post = await Web.fetchDocument('https://k.test/post', fetchImpl)
  assert.equal(post.path, 'https://k.test/post')
  assert.match(post.content!, /^# Post/)
  assert.doesNotMatch(post.content!, /<p>|chrome-to-drop/)
  assert.match(post.digest, /^[0-9a-f]{12}$/)

  const notes = await Web.fetchDocument('https://k.test/notes.md', fetchImpl)
  assert.equal(notes.content, '# Notes\n\ncave IS append-only\n', 'non-HTML bodies pass through verbatim')

  await assert.rejects(Web.fetchDocument('https://k.test/gone', fetchImpl), /404 Not Found/)
})

test('plain URL content preserves a leading UTF-8 BOM in content and digest', async () => {
  const store = open()
  const url = 'https://k.test/notes'
  let content = '\ufeffsource material'
  try {
    const fetchImpl: Web.FetchLike = async () => new Response(new TextEncoder().encode(content),
      { headers: { 'content-type': 'text/plain' } })
    const first = await Web.select(store, [url], { fetchImpl })
    assert.equal(first.files[0]!.content, content)
    assert.equal(first.files[0]!.digest, Files.digestOf(content))
    Files.recordDigests(store, first.files)
    assert.deepEqual((await Web.select(store, [url], { fetchImpl })).skipped, [url])
    content = 'source material'
    const changed = await Web.select(store, [url], { fetchImpl })
    assert.equal(changed.files[0]!.content, content)
    assert.notEqual(changed.files[0]!.digest, first.files[0]!.digest)
    assert.ok(Files.isIngested(store, url, first.files[0]!.digest))
  } finally { store.close() }
})

test('HTML URL extraction keeps content identity across a leading BOM and absent media type', async () => {
  const body = page('Article', paragraph('Durable source facts.'))
  const expected = Web.readableTextOf(body)
  for (const type of ['text/html', 'application/xhtml+xml', undefined]) {
    for (const prefix of ['', '\ufeff']) {
      const document = await Web.fetchDocument('https://k.test/article', async () =>
        new Response(new TextEncoder().encode(prefix + body), {
          headers: type === undefined ? {} : { 'content-type': type }
        }))
      assert.equal(document.content, expected, `${type}: ${JSON.stringify(prefix)}`)
      assert.equal(document.digest, Files.digestOf(expected))
    }
  }
})

test('URL extraction uses the media type rather than HTML text in parameters', async () => {
  const body = '<html><head><title>Source</title></head><body><p>Keep this text.</p></body></html>'
  for (const type of ['text/plain; profile="html"', 'application/json; profile="https://example.test/html"', 'application/nothtml']) {
    const document = await Web.fetchDocument('https://k.test/source', async () =>
      new Response(body, { headers: { 'content-type': type } }))
    assert.equal(document.content, body, type)
    assert.equal(document.digest, Files.digestOf(body), type)
  }
  for (const type of ['text/html; charset=utf-8', 'Application/XHTML+XML; charset=utf-8', 'TEXT/HTML']) {
    const document = await Web.fetchDocument('https://k.test/source', async () =>
      new Response(body, { headers: { 'content-type': type } }))
    assert.equal(document.content, '# Source\n\nKeep this text.', type)
    assert.equal(document.digest, Files.digestOf(document.content!), type)
  }
})

test('failed URL responses cancel unread bodies without hiding HTTP failures', async () => {
  for (const cleanupThrows of [false, true]) {
    let cancelled = 0
    const fetchImpl: Web.FetchLike = async () => new Response(new ReadableStream({
      cancel() {
        cancelled++
        if (cleanupThrows) throw new Error('cleanup failed')
      }
    }), { status: 503, statusText: 'Unavailable' })
    await assert.rejects(Web.fetchDocument('https://k.test/busy', fetchImpl), /503 Unavailable/)
    assert.equal(cancelled, 1)
  }
})

test('URL selection rejects malformed UTF-8 without replacing source text and can recover', async () => {
  const store = open()
  try {
    store.ingest('local IS retained')
    const before = store.exportText({ tx: true, maxSensitivity: 'restricted' })
    let malformed = true
    const fetchImpl: Web.FetchLike = async url => new Response(
      url.endsWith('/bad') && malformed ? new Uint8Array([0x61, 0xff]) : '�café 😀',
      { headers: { 'content-type': 'text/plain' } }
    )
    const urls = ['https://k.test/bad', 'https://k.test/good']
    const selected = await Web.select(store, urls, { fetchImpl })
    assert.deepEqual(selected.files.map(file => [file.path, file.content]), [[urls[1], '�café 😀']])
    assert.equal(selected.failures.length, 1)
    assert.equal(selected.failures[0]!.path, urls[0])
    assert.match(selected.failures[0]!.message, /invalid UTF-8/)
    assert.equal(selected.failures[0]!.kind, 'network')
    assert.equal(selected.failures[0]!.retryable, true)
    assert.equal(store.exportText({ tx: true, maxSensitivity: 'restricted' }), before)
    malformed = false
    const recovered = await Web.select(store, urls, { fetchImpl })
    assert.deepEqual(recovered.failures, [])
    assert.deepEqual(recovered.files.map(file => file.content), ['�café 😀', '�café 😀'])
  } finally { store.close() }
})

test('URL selection isolates failures and classifies retryable network/HTTP outcomes', async () => {
  const store = open()
  const fetchImpl: Web.FetchLike = async url => {
    if (url.endsWith('/network')) throw new TypeError('socket reset')
    if (url.endsWith('/busy')) return new Response('busy', { status: 503, statusText: 'Unavailable' })
    if (url.endsWith('/gone')) return new Response('gone', { status: 404, statusText: 'Not Found' })
    return new Response('healthy', { headers: { 'content-type': 'text/plain' } })
  }
  const selected = await Web.select(store, [
    'https://k.test/ok', 'https://k.test/network', 'https://k.test/busy', 'https://k.test/gone'
  ], { fetchImpl })
  assert.deepEqual(selected.files.map(file => file.path), ['https://k.test/ok'])
  assert.deepEqual(selected.failures.map(failure => ({
    path: failure.path.split('/').at(-1),
    kind: failure.kind,
    retryable: failure.retryable,
    status: failure.status
  })), [
    { path: 'network', kind: 'network', retryable: true, status: undefined },
    { path: 'busy', kind: 'http', retryable: true, status: 503 },
    { path: 'gone', kind: 'http', retryable: false, status: 404 }
  ])
  store.close()
})

test('mixed URL failures roll strict runs back while lenient runs preserve healthy sources', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'cave-ingest-web-failure-'))
  try {
    writeFileSync(join(dir, 'local.md'), 'healthy local source')
    const ok = 'https://k.test/ok'
    const gone = 'https://k.test/gone'
    const fetchImpl = fetchFrom({
      [ok]: { body: 'healthy remote source', type: 'text/plain' },
      [gone]: { body: 'gone', status: 404 }
    })

    const strictStore = open()
    let strictCalls = 0
    const strict = await run({
      db: ':memory:', store: strictStore, patterns: ['local.md', ok, gone], cwd: dir,
      mode: 'stdout', embed: true, fetchImpl,
      agent: async () => {
        strictCalls += 1
        return 'unexpected IS call'
      }
    })
    assert.equal(strictCalls, 0)
    assert.equal(strict.applied, false)
    assert.equal(strict.added, 0)
    assert.deepEqual(strict.sources.map(source => source.status), ['not-run', 'not-run', 'rejected'])
    assert.equal(strict.sources[2]!.failure, 'http')
    assert.equal(strict.sources[2]!.retryable, false)
    assert.equal(strict.sources[2]!.httpStatus, 404)
    assert.equal(strictStore.currentBeliefs().length, 0)
    strictStore.close()

    const lenientStore = open()
    let lenientCalls = 0
    const lenient = await run({
      db: ':memory:', store: lenientStore, patterns: ['local.md', ok, gone], cwd: dir,
      mode: 'stdout', embed: true, fetchImpl, policy: 'lenient',
      agent: async () => {
        lenientCalls += 1
        return 'local IS accepted\nremote IS accepted'
      }
    })
    assert.equal(lenientCalls, 1)
    assert.equal(lenient.applied, true)
    assert.equal(lenient.failed, 1)
    assert.deepEqual(lenient.sources.map(source => source.status), ['accepted', 'accepted', 'rejected'])
    assert.equal(lenientStore.currentBeliefs().filter(row => row.attribute === 'ingest-digest').length, 2)
    lenientStore.close()
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

for (const policy of ['strict', 'lenient'] as const) {
  test(`real HTTP malformed UTF-8 respects ${policy} ingestion and recovers without poisoned digests`, async () => {
    const dir = mkdtempSync(join(tmpdir(), 'cave-ingest-http-utf8-'))
    const store = open()
    let malformed = true
    const server = createServer((request, response) => {
      response.setHeader('content-type', 'text/plain; charset=utf-8')
      response.end(request.url === '/bad' && malformed ?
        Buffer.concat([Buffer.from('DO-NOT-INGEST'), Buffer.from([0xff])]) :
        request.url === '/bad' ? 'repaired source text' : 'healthy source text')
    })
    try {
      await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
      const root = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
      const urls = [`${root}/good`, `${root}/bad`]
      store.ingest('local IS retained')
      const before = store.exportText({ tx: true, maxSensitivity: 'restricted' })
      const prompts: string[] = []
      const options = {
        db: ':memory:', store, patterns: urls, cwd: dir, mode: 'stdout' as const, policy,
        agent: async (prompt: string) => { prompts.push(prompt); return `run${prompts.length} IS accepted` }
      }
      const first = await run(options)
      assert.deepEqual(first.sources.map(source => source.status), [policy === 'strict' ? 'not-run' : 'accepted', 'rejected'])
      assert.equal(first.sources[1]!.failure, 'network')
      assert.equal(first.sources[1]!.retryable, true)
      assert.equal(prompts.length, policy === 'strict' ? 0 : 1)
      assert.equal(store.currentBeliefs().filter(row => row.attribute === 'ingest-digest').length, policy === 'strict' ? 0 : 1)
      assert.equal(store.currentBeliefs().filter(row => row.subject === urls[1] && row.attribute === 'ingest-digest').length, 0)
      if (policy === 'strict') assert.equal(store.exportText({ tx: true, maxSensitivity: 'restricted' }), before)
      assert.ok(prompts.every(prompt => !prompt.includes('DO-NOT-INGEST')))
      malformed = false
      const recovered = await run(options)
      assert.equal(recovered.failed, 0)
      assert.equal(recovered.applied, true)
      assert.deepEqual(recovered.skipped, policy === 'strict' ? [] : [urls[0]])
      assert.match(prompts.at(-1)!, /repaired source text/)
      assert.equal(store.currentBeliefs().filter(row => row.attribute === 'ingest-digest').length, 2)
      const calls = prompts.length
      const again = await run(options)
      assert.deepEqual(again.skipped, urls)
      assert.equal(prompts.length, calls)
      assert.ok(store.currentBeliefs().some(row => row.subject === 'local' && row.object === 'retained'))
    } finally {
      server.closeAllConnections()
      await new Promise<void>(resolve => server.close(() => resolve()))
      store.close()
      rmSync(dir, { recursive: true, force: true })
    }
  })
}

test('run over a URL: readable text embedded in the prompt, digest recorded, rerun skips', async () => {
  const url = 'https://k.test/blog/design'
  const routes = { [url]: { body: page('Design', paragraph('The parser is hand-written.')) } }
  const store = open()
  const prompts: string[] = []
  const options = {
    db: ':memory:', store, patterns: [url], mode: 'stdout' as const,
    fetchImpl: fetchFrom(routes),
    agent: async (prompt: string): Promise<string> => {
      prompts.push(prompt)
      return 'cave/parser HAS style: hand-written'
    }
  }
  const report = await run(options)
  assert.equal(report.matched, 1)
  assert.equal(report.added, 1)
  assert.match(prompts[0]!, /### https:\/\/k\.test\/blog\/design/, 'URL heads its embedded block')
  assert.match(prompts[0]!, /The parser is hand-written\./, 'extracted text is embedded')
  assert.doesNotMatch(prompts[0]!, /<article>|chrome-to-drop/, 'markup and chrome stay out')

  const again = await run(options)
  assert.deepEqual(again.skipped, [url], 'unchanged page is skipped')

  routes[url] = { body: page('Design', paragraph('The parser is table-driven now.')) }
  const changed = await run({ ...options, fetchImpl: fetchFrom(routes) })
  assert.equal(changed.batches.length, 1, 'changed readable content re-ingests')
  store.close()
})

test('run mixes file globs and URLs in one selection', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'cave-ingest-web-'))
  try {
    writeFileSync(join(dir, 'local.md'), 'Local notes about billing.')
    const store = open()
    const prompts: string[] = []
    const report = await run({
      db: ':memory:', store, patterns: ['*.md', 'https://k.test/page'], cwd: dir,
      mode: 'stdout', embed: true, batchSize: 8,
      fetchImpl: fetchFrom({ 'https://k.test/page': { body: page('Remote', paragraph('Remote notes about auth.')) } }),
      agent: async prompt => {
        prompts.push(prompt)
        return 'billing USES stripe\nauth USES jwt'
      }
    })
    assert.equal(report.matched, 2)
    assert.equal(report.batches.length, 1)
    assert.match(prompts[0]!, /Local notes about billing\./)
    assert.match(prompts[0]!, /Remote notes about auth\./)
    store.close()
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('URL cancellation interrupts a real response body and preserves its reason', async () => {
  const server = createServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'text/plain' })
    res.write('unfinished document')
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const controller = new AbortController()
  const reason = new Error('stop reading response')
  let received!: () => void
  const ready = new Promise<void>(resolve => { received = resolve })
  const fetchImpl: Web.FetchLike = async (url, init) => {
    const response = await fetch(url, init)
    received()
    return response
  }
  try {
    const pending = Web.fetchDocument(`http://127.0.0.1:${(server.address() as AddressInfo).port}/`, fetchImpl, 60, controller.signal)
    const rejected = assert.rejects(pending, error => error === reason)
    await ready
    controller.abort(reason)
    await rejected
  } finally {
    server.closeAllConnections()
    await new Promise<void>(resolve => server.close(() => resolve()))
  }
})

test('URL timeout interrupts a stalled real response body and permits a fresh fetch', async () => {
  let complete = false
  let headersReceived = false
  let requestSignal: AbortSignal | undefined
  const timers = new Set<ReturnType<typeof setTimeout>>()
  const server = createServer((_req, response) => {
    response.writeHead(200, { 'content-type': 'text/plain' })
    if (complete) { response.end('complete source'); return }
    response.write('unfinished source')
    // Bound the fixture even if a regression drops the timeout after headers.
    const timer = setTimeout(() => { timers.delete(timer); response.end(' late') }, 3000)
    timers.add(timer)
    response.on('close', () => { clearTimeout(timer); timers.delete(timer) })
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const fetchImpl: Web.FetchLike = async (url, init) => {
    requestSignal = init.signal ?? undefined
    const response = await fetch(url, init)
    headersReceived = true
    return response
  }
  try {
    const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/`
    await assert.rejects(Web.fetchDocument(url, fetchImpl, 0.5), error =>
      error instanceof Error && (error.name === 'AbortError' || error.name === 'TimeoutError'))
    assert.equal(headersReceived, true, 'the timeout must occur after receiving headers')
    assert.equal(requestSignal?.aborted, true)
    assert.equal(requestSignal?.reason.name, 'TimeoutError')
    complete = true
    const recovered = await Web.fetchDocument(url, fetchImpl, 3)
    assert.equal(recovered.content, 'complete source')
    assert.equal(recovered.digest, Files.digestOf('complete source'))
    assert.equal(requestSignal?.aborted, false)
  } finally {
    for (const timer of timers) clearTimeout(timer)
    server.closeAllConnections()
    await new Promise<void>(resolve => server.close(() => resolve()))
  }
})

test('fetchDocument works against a real http server with the built-in fetch', async () => {
  const server = createServer((_, response) => {
    response.setHeader('content-type', 'text/html; charset=utf-8')
    response.end(page('Served', paragraph('Served over real http.')))
  })
  await new Promise<void>(resolvePromise => server.listen(0, '127.0.0.1', resolvePromise))
  try {
    const { port } = server.address() as AddressInfo
    const document = await Web.fetchDocument(`http://127.0.0.1:${port}/post`)
    assert.match(document.content!, /^# Served/)
    assert.match(document.content!, /Served over real http\./)
  } finally {
    server.close()
  }
})

test('URL selection bounds active fetches and preserves source order and failures', async () => {
  const store = open()
  const urls = Array.from({ length: 25 }, (_, i) => `https://example.test/${i}`)
  let active = 0, peak = 0, calls = 0
  try {
    const result = await Web.select(store, [...urls, urls[0]!], { fetchImpl: async url => {
      active++; calls++; peak = Math.max(peak, active)
      await new Promise<void>(resolve => setTimeout(resolve, 25 - Number(new URL(String(url)).pathname.slice(1))))
      active--
      return new Response('source material', { status: String(url) === urls[5] ? 503 : 200 })
    } })
    assert.equal(peak, 8)
    assert.equal(calls, 25)
    assert.deepEqual(result.files.map(file => file.path), urls.filter((_, i) => i !== 5))
    assert.deepEqual(result.failures.map(failure => [failure.path, failure.status]), [[urls[5], 503]])
    assert.equal(store.currentBeliefs().length, 0)
  } finally { store.close() }
})

test('URL selection cancellation prevents queued fetches from starting', async () => {
  const store = open(), controller = new AbortController()
  const reason = new Error('stop queued URL work')
  let calls = 0
  let release!: () => void
  const gate = new Promise<void>(resolve => { release = resolve })
  try {
    const pending = Web.select(store, Array.from({ length: 25 }, (_, i) => `https://example.test/${i}`), {
      signal: controller.signal,
      fetchImpl: async () => { calls++; await gate; return new Response('source material') }
    })
    const rejected = assert.rejects(pending, error => error === reason)
    controller.abort(reason)
    release()
    await rejected
    assert.equal(calls, 8)
    assert.equal(store.currentBeliefs().length, 0)
  } finally { release(); store.close() }
})

test('real HTTP selection holds concurrency slots until response bodies finish', async () => {
  const store = open()
  let active = 0, peak = 0, received = 0
  const timers = new Set<ReturnType<typeof setTimeout>>()
  const server = createServer((request, response) => {
    active++; received++; peak = Math.max(peak, active)
    response.writeHead(200, { 'content-type': 'text/plain' })
    response.write('source ')
    const timer = setTimeout(() => {
      timers.delete(timer)
      active--
      response.end(request.url)
    }, 50)
    timers.add(timer)
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  try {
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
    const urls = Array.from({ length: 25 }, (_, index) => `${base}/${index}`)
    const result = await Web.select(store, urls)
    assert.equal(received, 25)
    assert.ok(peak > 1 && peak <= 8, `peak active response bodies: ${peak}`)
    assert.equal(active, 0)
    assert.deepEqual(result.failures, [])
    assert.deepEqual(result.files.map(file => [file.path, file.content]),
      urls.map((url, index) => [url, `source /${index}`]))
    assert.equal(store.currentBeliefs().length, 0)
  } finally {
    for (const timer of timers) clearTimeout(timer)
    server.closeAllConnections()
    await new Promise<void>(resolve => server.close(() => resolve()))
    store.close()
  }
})
