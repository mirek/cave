import { test, expect } from '@playwright/test'
import { open } from '@cavelang/store'
import { SourceSpan } from '@cavelang/core'
import { serve } from '../../../packages/view/src/server.ts'

test('local skip link bypasses the header without changing the current route', async ({ page }, testInfo) => {
  const store = open()
  store.ingest('root IS result')
  const server = await serve(store, { port: 0 })
  try {
    for (const width of [390, 1280]) {
      await page.setViewportSize({ width, height: 700 })
      await page.goto('about:blank')
      await page.goto(server.url + '#/e/root')
      await expect(page.getByRole('status')).toHaveText('View loaded.')
      const url = page.url()
      let requests = 0
      const count = () => { requests++ }
      page.on('request', count)
      await page.keyboard.press('Tab')
      const skip = page.getByRole('link', { name: 'Skip to content', exact: true })
      await expect(skip).toBeFocused()
      await expect(skip).toBeInViewport()
      await page.screenshot({ path: testInfo.outputPath(`skip-link-${width}.png`) })
      await page.keyboard.press('Enter')
      await expect(page.locator('#view')).toBeFocused()
      expect(page.url()).toBe(url)
      await expect(page.locator('#view h1')).toContainText('root')
      await page.keyboard.press('Tab')
      expect(await page.locator('#view').evaluate(view => view.contains(document.activeElement))).toBe(true)
      expect(requests).toBe(0)
      page.off('request', count)
    }
  } finally { await server.close(); store.close() }
})

test('local page titles follow navigation, errors and retry while retaining the database label', async ({ page }) => {
  const store = open()
  store.ingest('root IS result')
  const server = await serve(store, { port: 0, label: 'A & B <store>' })
  try {
    await page.goto(server.url)
    await expect(page).toHaveTitle('Overview — cave — A & B <store>')
    await page.goto(server.url + '#/e/root')
    await expect(page).toHaveTitle('root entity — cave — A & B <store>')
    const search = page.getByRole('searchbox', { name: 'Search claims' })
    await search.fill('root')
    await search.press('Enter')
    await expect(page).toHaveTitle('root search — cave — A & B <store>')
    await page.goBack()
    await expect(page).toHaveTitle('root entity — cave — A & B <store>')
    await page.route('**/api/history?**', route => route.fulfill({ status: 503, body: 'Unavailable' }))
    await page.locator('#view').getByRole('link', { name: 'history', exact: true }).first().click()
    await expect(page).toHaveTitle('View error — cave — A & B <store>')
    await page.unroute('**/api/history?**')
    await page.getByRole('button', { name: 'Retry view', exact: true }).click()
    await expect(page).toHaveTitle(/belief history.* — cave — A & B <store>$/)
  } finally { await server.close(); store.close() }
})

test('local view reports HTTP failures with unexpected bodies and retries successfully', async ({ page }) => {
  const store = open()
  store.ingest('root IS result')
  const server = await serve(store, { port: 0 })
  const bodies = ['<html>Unavailable</html>', 'null', '{"error":{"detail":"bad"}}']
  let requests = 0
  try {
    await page.route('**/api/overview', async route => {
      const body = bodies[requests++]
      if (body === undefined) await route.continue()
      else await route.fulfill({ status: 503, contentType: 'text/plain', body })
    })
    await page.goto(server.url)
    for (let index = 0; index < bodies.length; index++) {
      await expect.poll(() => requests).toBe(index + 1)
      await expect(page.getByRole('alert')).toHaveText('HTTP 503')
      await expect(page.locator('#view')).toHaveAttribute('aria-busy', 'false')
      await page.getByRole('button', { name: 'Retry view', exact: true }).click()
    }
    await expect(page.getByRole('status')).toHaveText('View loaded.')
    await expect(page.getByRole('alert')).toHaveCount(0)
    expect(requests).toBe(4)
  } finally { await server.close(); store.close() }
})

for (const kind of ['entity', 'overview'] as const) {
  test(`local ${kind} errors retry the same view and restore keyboard focus`, async ({ page }) => {
    const store = open()
    store.ingest('root IS result')
    const server = await serve(store, { port: 0 })
    let unavailable = true
    let requests = 0
    try {
      await page.route(`**/api/${kind}**`, async route => {
        requests++
        if (unavailable) await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'Temporarily unavailable' }) })
        else await route.continue()
      })
      const hash = kind === 'entity' ? '#/e/root' : '#/'
      await page.goto(server.url + hash)
      const retry = page.getByRole('button', { name: 'Retry view', exact: true })
      await expect(page.getByRole('alert')).toHaveText('Temporarily unavailable')
      await expect(retry).toBeVisible()
      await retry.focus()
      await retry.press('Enter')
      await expect.poll(() => requests).toBe(2)
      await expect(page.getByRole('alert')).toBeFocused()
      unavailable = false
      await retry.focus()
      await retry.press('Enter')
      await expect(page.getByRole('status')).toHaveText('View loaded.')
      await expect(page.getByRole('alert')).toHaveCount(0)
      await expect(retry).toHaveCount(0)
      await expect(page.locator('#view').getByRole('heading').first()).toBeFocused()
      expect(new URL(page.url()).hash).toBe(hash)
      expect(requests).toBe(3)
    } finally { await server.close(); store.close() }
  })
}

test('keyboard claim navigation focuses each new view heading', async ({ page }) => {
  const store = open()
  const ids = store.ingest('root IS result\npremise IS evidence').ids
  store.appendEdges([{ parentId: ids[0]!, role: 'BECAUSE', childId: ids[1]! }])
  const server = await serve(store, { port: 0 })
  try {
    await page.goto(server.url + '#/e/root')
    const history = page.locator('#view').getByRole('link', { name: 'history', exact: true }).first()
    await history.focus()
    await history.press('Enter')
    await expect(page.locator('#view h1')).toContainText('belief history')
    await expect(page.locator('#view h1')).toBeFocused()
    const lineage = page.locator('#view').getByRole('link', { name: 'lineage', exact: true }).first()
    await lineage.focus()
    await lineage.press('Enter')
    await expect(page.locator('#view h1')).toContainText('lineage')
    await expect(page.locator('#view h1')).toBeFocused()
    await page.locator('#view .tree').getByRole('link', { name: 'premise', exact: true }).click()
    await expect(page.locator('#view h1')).toContainText('premise')
    await expect(page.locator('#view h1')).toBeFocused()
  } finally { await server.close(); store.close() }
})

test('failed claim navigation focuses the error and search recovers', async ({ page }) => {
  const store = open()
  store.ingest('root IS result')
  const server = await serve(store, { port: 0 })
  try {
    await page.goto(server.url + '#/e/root')
    await page.route('**/api/history?**', route => route.fulfill({
      status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'Temporarily unavailable' })
    }))
    const history = page.locator('#view').getByRole('link', { name: 'history', exact: true }).first()
    await history.focus()
    await history.press('Enter')
    await expect(page.getByRole('alert')).toHaveText('Temporarily unavailable')
    await expect(page.getByRole('alert')).toBeFocused()
    await expect(page.locator('#view')).toHaveAttribute('aria-busy', 'false')
    const search = page.getByRole('searchbox', { name: 'Search claims' })
    await search.fill('root')
    await search.press('Enter')
    await expect(page.getByRole('status')).toHaveText('View loaded.')
    await expect(page.getByRole('alert')).toHaveCount(0)
    await expect(page.locator('#view .claim')).toHaveCount(1)
    await expect(search).toBeFocused()
  } finally { await server.close(); store.close() }
})

for (const failed of [false, true]) test(`a delayed ${failed ? 'failed' : 'successful'} claim navigation preserves focus moved to search`, async ({ page }) => {
  const store = open()
  store.ingest('root IS result')
  const server = await serve(store, { port: 0 })
  let release!: () => void
  const held = new Promise<void>(resolve => { release = resolve })
  try {
    await page.goto(server.url + '#/e/root')
    await page.route('**/api/history?**', async route => {
      await held
      if (failed) await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'Temporarily unavailable' }) })
      else await route.continue()
    })
    await page.locator('#view').getByRole('link', { name: 'history', exact: true }).first().click()
    await expect(page.getByRole('status')).toHaveText('Loading view.')
    const search = page.getByRole('searchbox', { name: 'Search claims' })
    await search.fill('next draft')
    release()
    if (failed) await expect(page.getByRole('alert')).toHaveText('Temporarily unavailable')
    else await expect(page.locator('#view h1')).toContainText('belief history')
    await expect(search).toBeFocused()
    await expect(search).toHaveValue('next draft')
  } finally { release(); await server.close(); store.close() }
})

test('local lineage retains shared branches and refreshes evidence on browser Back', async ({ page }) => {
  const store = open()
  const ids = store.ingest('root IS result\nleft IS premise\nright IS premise\nshared IS evidence').ids
  store.appendEdges([
    { parentId: ids[0]!, role: 'BECAUSE', childId: ids[1]! },
    { parentId: ids[0]!, role: 'BECAUSE', childId: ids[2]! },
    { parentId: ids[1]!, role: 'BECAUSE', childId: ids[3]! },
    { parentId: ids[2]!, role: 'BECAUSE', childId: ids[3]! }
  ])
  const server = await serve(store, { port: 0 })
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  try {
    await page.goto(server.url + '#/l/' + ids[0])
    await expect(page.getByRole('status')).toHaveText('View loaded.')
    await expect(page.locator('#view h1')).toContainText('root IS result')
    await expect(page.locator('#view .tree .claim')).toHaveCount(4)
    await expect(page.locator('#view .rep')).toHaveText('re-stated — rendered above')
    await page.locator('#view .tree').getByRole('link', { name: 'shared', exact: true }).first().click()
    await expect(page.locator('#view h1')).toContainText('shared')
    const leaf = store.ingest('fresh IS evidence').ids[0]!
    store.appendEdges([{ parentId: ids[3]!, role: 'BECAUSE', childId: leaf }])
    await page.goBack()
    await expect(page.locator('#view h1')).toContainText('root IS result')
    await expect(page.locator('#view .tree .claim')).toHaveCount(5)
    await expect(page.locator('#view .tree').getByRole('link', { name: 'fresh', exact: true })).toHaveCount(1)
    await expect(page.locator('#view .rep')).toHaveText('re-stated — rendered above')
    expect(errors).toEqual([])
  } finally { await server.close(); store.close() }
})

test('local viewer fits narrow screens with long entity names and store labels', async ({ page }, testInfo) => {
  const store = open()
  const name = 'service-' + 'long-name-'.repeat(18)
  const topic = 'topic-' + 'long-topic-'.repeat(18)
  store.ingest(`${name} IS service\n${topic} CONTAINS ${name}\n${name} HAS description: "${'text'.repeat(90)}"`)
  const server = await serve(store, { port: 0, label: '/stores/' + 'knowledge-'.repeat(20) + '.db' })
  try {
    for (const width of [320, 390]) {
      await page.setViewportSize({ width, height: 900 })
      for (const route of ['', `#/e/${encodeURIComponent(name)}`]) {
        await page.goto(server.url + route)
        await expect(page.getByRole('status')).toHaveText('View loaded.')
        await expect(page.getByRole('searchbox', { name: 'Search claims' })).toBeVisible()
        await expect(page.getByRole('checkbox', { name: 'aliases' })).toBeVisible()
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${width}px ${route}`).toBe(true)
      }
    }
    await page.screenshot({ path: testInfo.outputPath('local-view-mobile.png'), fullPage: true })
  } finally { await server.close(); store.close() }
})

test('a delayed local search response preserves the next search draft', async ({ page }) => {
  const store = open()
  store.ingest('worker-first IS service')
  const server = await serve(store, { port: 0 })
  let release!: () => void
  const held = new Promise<void>(resolve => { release = resolve })
  try {
    await page.route('**/api/search?**', async route => { await held; await route.continue() })
    await page.goto(server.url)
    await expect(page.getByRole('status')).toHaveText('View loaded.')
    const search = page.getByRole('searchbox', { name: 'Search claims' })
    await search.fill('worker')
    await search.press('Enter')
    await expect(page.getByRole('status')).toHaveText('Loading view.')
    await search.fill('next search draft')
    release()
    await expect(page.locator('#view')).toContainText('worker-first')
    await expect(search).toHaveValue('next search draft')
    await expect(search).toBeFocused()
    await expect(page.locator('#view h1')).toContainText('worker')
  } finally { release(); await server.close(); store.close() }
})

test('refreshing and retrying a local search preserve drafts while history restores the submitted query', async ({ page }) => {
  const store = open()
  store.ingest('worker-first IS service\nnext-result IS service')
  const server = await serve(store, { port: 0 })
  try {
    await page.goto(server.url)
    await expect(page.getByRole('status')).toHaveText('View loaded.')
    const search = page.getByRole('searchbox', { name: 'Search claims' })
    const aliases = page.getByRole('checkbox', { name: 'aliases' })
    await search.fill('worker')
    await search.press('Enter')
    await expect(page.locator('#view h1')).toHaveText('worker search')
    await expect(page.locator('#view')).toContainText('worker-first')
    await search.fill('next')
    const refreshed = page.waitForResponse(response => response.url().includes('/api/search?'))
    await aliases.check()
    await refreshed
    await expect(page.getByRole('status')).toHaveText('View loaded.')
    await expect(search).toHaveValue('next')
    let fail = true
    await page.route('**/api/search?**', async route => {
      if (fail) { fail = false; await route.fulfill({ status: 503, body: 'unavailable' }) }
      else await route.continue()
    })
    await aliases.uncheck()
    await expect(page.getByRole('alert')).toHaveText('HTTP 503')
    await expect(search).toHaveValue('next')
    await page.getByRole('button', { name: 'Retry view' }).click()
    await expect(page.locator('#view')).toContainText('worker-first')
    await expect(search).toHaveValue('next')
    await search.press('Enter')
    await expect(page.locator('#view')).toContainText('next-result')
    await page.goBack()
    await expect(page.locator('#view')).toContainText('worker-first')
    await expect(search).toHaveValue('worker')
  } finally { await server.close(); store.close() }
})

test('local search uses plain Enter and preserves modified or composing input', async ({ page }) => {
  const store = open()
  store.ingest('worker IS service')
  const server = await serve(store, { port: 0 })
  try {
    await page.setViewportSize({ width: 390, height: 700 })
    await page.goto(server.url)
    await expect(page.getByRole('status')).toHaveText('View loaded.')
    const initial = page.url()
    const search = page.getByRole('searchbox', { name: 'Search claims' })
    await search.fill('worker')
    await search.dispatchEvent('keydown', { key: 'Enter', isComposing: true })
    await expect(page).toHaveURL(initial)
    for (const modifier of ['Control', 'Meta', 'Alt', 'Shift']) {
      await search.press(`${modifier}+Enter`)
      await expect(page).toHaveURL(initial)
      await expect(search).toBeFocused()
    }
    await expect(search).toHaveAttribute('enterkeyhint', 'search')
    await expect(search).toHaveAttribute('aria-keyshortcuts', 'Enter')
    await search.press('Enter')
    await expect(page.locator('#view .claim')).toHaveCount(1)
    await expect(page.locator('#view')).toContainText('worker')
    await expect(search).toBeFocused()
  } finally { await server.close(); store.close() }
})

test('repeating a local viewer search refreshes results after a store append', async ({ page }) => {
  const store = open()
  store.ingest('worker-first IS service')
  const server = await serve(store, { port: 0 })
  try {
    await page.goto(server.url)
    await expect(page.getByRole('status')).toHaveText('View loaded.')
    const search = page.getByRole('searchbox', { name: 'Search claims' })
    await search.fill('worker')
    await search.press('Enter')
    await expect(page.locator('#view .claim')).toHaveCount(1)
    await expect(page.locator('#view')).toContainText('worker-first')
    const url = page.url()
    store.ingest('worker-second IS service')
    await search.press('Enter')
    await expect(page.locator('#view .claim')).toHaveCount(2)
    await expect(page.locator('#view')).toContainText('worker-second')
    expect(page.url()).toBe(url)
    await expect(search).toBeFocused()
  } finally { await server.close(); store.close() }
})

test('an invalid local search is announced and can be corrected without reloading', async ({ page }, testInfo) => {
  const store = open()
  store.ingest('worker-first IS service')
  const server = await serve(store, { port: 0 })
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  try {
    await page.setViewportSize({ width: 390, height: 900 })
    await page.goto(server.url)
    await expect(page.getByRole('status')).toHaveText('View loaded.')
    const search = page.getByRole('searchbox', { name: 'Search claims' })
    await search.fill('worker\u0000ignored')
    const rejected = page.waitForResponse(response => response.url().includes('/api/search?'))
    await search.press('Enter')
    expect((await rejected).status()).toBe(400)
    await expect(page.getByRole('alert')).toHaveText('search query must not contain NUL characters')
    await expect(page.locator('#view')).toHaveAttribute('aria-busy', 'false')
    await expect(search).toBeFocused()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await page.screenshot({ path: testInfo.outputPath('invalid-search-mobile.png') })
    await search.fill('worker')
    await search.press('Enter')
    await expect(page.getByRole('status')).toHaveText('View loaded.')
    await expect(page.getByRole('alert')).toHaveCount(0)
    await expect(page.locator('#view')).toContainText('worker-first')
    await expect(search).toHaveValue('worker')
    await expect(search).toBeFocused()
    expect(errors).toEqual([])
  } finally { await server.close(); store.close() }
})

test('local viewer retains uncertainty sigma levels across entity and history views', async ({ page }, testInfo) => {
  const store = open()
  store.ingest('sensor HAS reading: 1 +/- 0.01 (3σ)')
  const server = await serve(store, { port: 0 })
  try {
    await page.goto(server.url + '#/e/sensor')
    const claim = page.locator('#view .claim').first()
    await expect(claim).toContainText('+/- 0.01')
    await expect(claim).toContainText('(3σ)')
    await claim.screenshot({ path: testInfo.outputPath('uncertainty-sigma.png') })
    await claim.getByRole('link', { name: 'history', exact: true }).click()
    await expect(page.locator('#view h1')).toContainText('belief history')
    await expect(page.locator('#view .claim').first()).toContainText('(3σ)')
  } finally { await server.close(); store.close() }
})

test('local confidence display distinguishes rounding boundaries from retraction and certainty', async ({ page }) => {
  const store = open()
  store.ingest('sensor HAS low: 1 @ 0.001%\nsensor HAS high: 2 @ 99.999%\nsensor HAS gone: 3 @ 0%\nsensor HAS certain: 4')
  const server = await serve(store, { port: 0 })
  try {
    await page.goto(server.url + '#/e/sensor')
    const claims = page.locator('#view .claim')
    const low = claims.filter({ hasText: 'low:' }).first()
    const high = claims.filter({ hasText: 'high:' }).first()
    await expect(low.locator('.conf')).toHaveText('@ <0.1%')
    await expect(high.locator('.conf')).toHaveText('@ >99.9%')
    await expect(claims.filter({ hasText: 'gone:' }).first().locator('.conf.retracted')).toHaveText('@ 0%')
    await expect(claims.filter({ hasText: 'certain:' }).first().locator('.conf')).toHaveCount(0)
    await high.getByRole('link', { name: 'history', exact: true }).click()
    await expect(page.locator('#view .bar')).toHaveAttribute('title', 'confidence >99.9%')
    store.ingest('sensor HAS low: 1 @ 0.001%\nsensor HAS high: 2 @ 0.001%\nsensor HAS gone: 3 @ 0.001%\nsensor HAS certain: 4 @ 0.001%')
    await page.goto(server.url)
    await expect(page.locator('.tile').filter({ hasText: 'avg conf' }).locator('b')).toHaveText('<0.1%')
  } finally { await server.close(); store.close() }
})


test('local source citations preserve invalid identities and open valid encoded links by keyboard', async ({ page, context }, testInfo) => {
  const store = open()
  const invalid = SourceSpan.context('https://example.test:99999/design notes', { startLine: 2, endLine: 3 })
  const source = 'https://example.test/design%20notes/a%2Fb?q=%25&raw=x y'
  const valid = SourceSpan.context(source, { startLine: 4, endLine: 5 })
  const href = 'https://example.test/design%20notes/a%2Fb?q=%25&raw=x%20y#L4-L5'
  store.ingest(`root IS evidence @${invalid} @${valid}`)
  const before = store.exportText()
  const server = await serve(store, { port: 0 })
  await context.route('https://example.test/**', route => route.fulfill({
    contentType: 'text/html', body: '<h1>Source fixture</h1>',
  }))
  try {
    for (const [width, colorScheme] of [[320, 'light'], [320, 'dark'], [1280, 'light'], [1280, 'dark']] as const) {
      await page.emulateMedia({ colorScheme })
      await page.setViewportSize({ width, height: 900 })
      await page.goto(server.url + '#/e/root')
      const claim = page.locator('#view .claim').first()
      const invalidLabel = claim.locator('.ctx').filter({ hasText: '@' + invalid })
      const validLink = claim.getByRole('link', { name: '@' + valid, exact: true })
      await expect(invalidLabel).toHaveText('@' + invalid)
      await expect(invalidLabel.getByRole('link')).toHaveCount(0)
      await expect(validLink).toHaveAttribute('href', href)
      await expect(validLink).toHaveAttribute('title', source + '#L4-L5')
      await expect(validLink).toHaveAttribute('rel', 'noopener noreferrer')
      await page.keyboard.press('Tab')
      await validLink.focus()
      await expect(validLink).toBeFocused()
      await page.screenshot({ path: testInfo.outputPath(`source-focus-${width}-${colorScheme}.png`), fullPage: true })
      const opened = page.waitForEvent('popup')
      await validLink.press('Enter')
      const popup = await opened
      try {
        await expect(popup.getByRole('heading')).toHaveText('Source fixture')
        expect(popup.url()).toBe(href)
      } finally { await popup.close() }
      await claim.getByRole('link', { name: 'history', exact: true }).click()
      await expect(page.locator('#view h1')).toContainText('belief history')
      await expect(invalidLabel).toHaveText('@' + invalid)
      await expect(invalidLabel.getByRole('link')).toHaveCount(0)
      await expect(validLink).toHaveAttribute('href', href)
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
      await page.screenshot({ path: testInfo.outputPath(`source-citations-${width}-${colorScheme}.png`), fullPage: true })
    }
    expect(store.exportText()).toBe(before)
  } finally { await server.close(); store.close() }
})

test('history navigation reveals the start of a tall focused heading below the sticky header', async ({ page }, testInfo) => {
  const store = open()
  store.ingest(`root HAS description: "${'long evidence text '.repeat(150)}"`)
  const server = await serve(store, { port: 0 })
  try {
    await page.setViewportSize({ width: 320, height: 600 })
    await page.goto(server.url + '#/e/root')
    const history = page.locator('#view .claim').first().getByRole('link', { name: 'history', exact: true })
    await history.focus()
    await history.press('Enter')
    const heading = page.locator('#view h1')
    await expect(heading).toContainText('belief history')
    await expect(heading).toBeFocused()
    expect(await heading.evaluate(element => element.getBoundingClientRect().height)).toBeGreaterThan(600)
    await expect.poll(() => heading.evaluate(element =>
      element.getBoundingClientRect().top - document.querySelector('header')!.getBoundingClientRect().bottom
    )).toBeGreaterThanOrEqual(0)
    await page.screenshot({ path: testInfo.outputPath('history-heading-visible.png') })
  } finally { await server.close(); store.close() }
})
