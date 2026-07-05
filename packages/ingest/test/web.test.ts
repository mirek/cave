import { test } from 'node:test'
import * as assert from 'node:assert/strict'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { open } from '@cavelang/store'
import { run, Web } from '@cavelang/ingest'

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
