import { readFile, writeFile } from 'node:fs/promises'
import { expect, test } from '@playwright/test'

test('inline documentation code keeps short options together and wraps long identifiers', async ({ page }, testInfo) => {
  for (const width of [320, 1280]) {
    await page.setViewportSize({ width, height: 900 })
    await page.goto('./#/docs/connect#refresh-failures-and-recovery')
    const item = page.locator('.docs-article li').filter({ hasText: 'Missing or unusable key, or an unkeyed record fails:' })
    const option = item.locator('code')
    await expect(option).toHaveText('--prune')
    const lines = await option.evaluate(element => {
      const range = document.createRange()
      range.selectNodeContents(element)
      return Array.from(range.getClientRects()).filter(rect => rect.width > 0).length
    })
    expect(lines, `short option at ${width}px`).toBe(1)
    await item.scrollIntoViewIfNeeded()
    await page.screenshot({ path: testInfo.outputPath(`inline-option-${width}.png`) })
    await page.locator('.docs-article').evaluate(article => {
      const paragraph = document.createElement('p')
      const code = document.createElement('code')
      code.dataset.testid = 'long-inline-code'
      code.textContent = 'long_identifier_without_separators'.repeat(30)
      paragraph.append(code)
      article.append(paragraph)
    })
    const long = page.getByTestId('long-inline-code')
    expect(await long.evaluate(element => {
      const range = document.createRange()
      range.selectNodeContents(element)
      return range.getClientRects().length
    })).toBeGreaterThan(1)
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width)
    await long.evaluate(element => element.parentElement?.remove())
  }
})

test('the book link serves the current PDF artifact', async ({ page, request }) => {
  await page.goto('./')
  const link = page.getByRole('navigation', { name: 'Primary navigation' })
    .getByRole('link', { name: 'Book', exact: true })
  await expect(link).toBeVisible()
  const url = await link.evaluate(element => (element as HTMLAnchorElement).href)
  const response = await request.get(url)
  expect(response.status()).toBe(200)
  expect(response.headers()['content-type']).toContain('application/pdf')
  const body = await response.body()
  expect(body.subarray(0, 5).toString()).toBe('%PDF-')
  expect(body.equals(await readFile(new URL('../../public/cave-book.pdf', import.meta.url)))).toBe(true)
  const head = await request.head(url)
  expect(head.status()).toBe(200)
  expect(head.headers()['content-type']).toContain('application/pdf')
  expect((await head.body()).length).toBe(0)
})

test('claims downloads preserve unapplied editor text without changing the database', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 320, height: 900 })
  await page.goto('./#/playground')
  await expect(page.getByRole('button', { name: 'Run query', exact: true })).toBeEnabled()
  const status = page.locator('.runtime-status')
  const before = await status.textContent()
  const source = '; unsaved café 😀 �\nnew-person HAS note: `draft`\nunfinished HAS\n'
  await page.getByLabel('CAVE claims', { exact: true }).fill(source)
  const pending = page.waitForEvent('download')
  const save = page.getByRole('button', { name: 'Download claims', exact: true })
  await save.focus()
  await save.press('Enter')
  await expect(save).toBeFocused()
  const download = await pending
  expect(download.suggestedFilename()).toBe('family.cave')
  expect(await readFile((await download.path())!, 'utf8')).toBe(source)
  await expect(status).toHaveText(before!)
  await expect(page.getByLabel('CAVE claims', { exact: true })).toHaveValue(source)
  await expect(page.locator('#unapplied-claims')).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }))
  await page.screenshot({ path: testInfo.outputPath('download-claims-mobile.png'), fullPage: true })
  await page.getByRole('button', { name: 'Run query', exact: true }).click()
  await expect(page.getByRole('status', { name: 'Result' })).toContainText('?ancestor =')
})

for (const failure of ['create', 'click'] as const) {
  test(`claims download recovers after a browser ${failure} failure`, async ({ page }) => {
    const errors: string[] = []
    page.on('pageerror', error => errors.push(error.message))
    await page.goto('./#/playground')
    await expect(page.getByRole('button', { name: 'Run query', exact: true })).toBeEnabled()
    const source = '; retained café 😀\ndraft HAS note: unfinished\n'
    const claims = page.getByLabel('CAVE claims', { exact: true })
    await claims.fill(source)
    const before = await page.locator('.runtime-status').textContent()
    await page.evaluate(mode => {
      let pending = true
      const create = URL.createObjectURL
      const revoke = URL.revokeObjectURL
      const resources = { created: [] as string[], revoked: [] as string[] }
      Object.assign(window, { downloadResources: resources })
      const click = HTMLAnchorElement.prototype.click
      URL.createObjectURL = function(blob) {
        if (mode === 'create' && pending) {
          pending = false
          throw new Error('download fixture failure')
        }
        const url = create.call(this, blob)
        resources.created.push(url)
        return url
      }
      URL.revokeObjectURL = function(url) {
        resources.revoked.push(url)
        revoke.call(this, url)
      }
      HTMLAnchorElement.prototype.click = function() {
        if (mode === 'click' && pending && this.download) {
          pending = false
          throw new Error('download fixture failure')
        }
        click.call(this)
      }
    }, failure)
    const save = page.getByRole('button', { name: 'Download claims', exact: true })
    await save.focus()
    await save.press('Enter')
    await expect(page.getByRole('status', { name: 'Result' })).toContainText('Could not start the download')
    await expect(save).toBeFocused()
    await expect(claims).toHaveValue(source)
    await expect(page.locator('.runtime-status')).toHaveText(before!)
    await expect(page.locator('a[download]')).toHaveCount(0)
    const resources = () => page.evaluate(() =>
      (window as typeof window & { downloadResources: { created: string[], revoked: string[] } }).downloadResources)
    await expect.poll(async () => {
      const { created, revoked } = await resources()
      return { created: created.length, revoked: revoked.length }
    }).toEqual({ created: failure === 'click' ? 1 : 0, revoked: failure === 'click' ? 1 : 0 })
    expect(errors).toEqual([])
    const pending = page.waitForEvent('download')
    await save.press('Enter')
    const download = await pending
    expect(await readFile((await download.path())!, 'utf8')).toBe(source)
    await expect(page.getByRole('status', { name: 'Result' })).not.toContainText('Could not start the download')
    await expect.poll(async () => {
      const { created, revoked } = await resources()
      return JSON.stringify(created) === JSON.stringify(revoked)
    }).toBe(true)
  })
}

test('postmortem sample demonstrates editable multiline confidence filtering', async ({ page }) => {
  await page.goto('./#/playground')
  const dataset = page.getByLabel('Sample dataset')
  await expect(dataset).toBeEnabled()
  await dataset.selectOption('postmortem')
  const run = page.getByRole('button', { name: 'Run query', exact: true })
  const query = page.getByLabel('CAVE query', { exact: true })
  const output = page.getByRole('status', { name: 'Result' })
  await expect(run).toBeEnabled()
  await expect(query).toHaveValue('?thing CAUSE ?effect\nWHERE conf >= 70%')
  await run.click()
  await expect(output).toContainText('2 matches')
  await expect(output).not.toContainText('?thing = cdn')
  await query.fill('?thing CAUSE ?effect\nWHERE conf >= 30%')
  await query.press('Enter')
  await expect(output).toContainText('3 matches')
  await expect(output).toContainText('?thing = cdn')
})

test('multiline playground queries retain filters, explain errors and recover', async ({ page }, testInfo) => {
  const pageErrors: string[] = []
  page.on('pageerror', error => pageErrors.push(error.message))
  await page.setViewportSize({ width: 390, height: 900 })
  await page.goto('./#/playground')
  const dataset = page.getByLabel('Sample dataset')
  await expect(dataset).toBeEnabled()
  await dataset.selectOption('timeline')
  const run = page.getByRole('button', { name: 'Run query', exact: true })
  await expect(run).toBeEnabled()
  const query = page.getByLabel('CAVE query', { exact: true })
  const output = page.getByRole('status', { name: 'Result' })
  await query.fill('acme HAS headcount: ?people')
  await query.press('End')
  await query.press('Shift+Enter')
  await expect(query).toHaveValue('acme HAS headcount: ?people\n')
  const invalid = 'acme HAS headcount: ?people\n; confidence threshold\n\nWHERE conf >= Infinity'
  await query.fill(invalid)
  await query.press('Enter')
  await expect(output).toContainText('CAVE-Q line 4: cannot parse confidence "Infinity"')
  await expect(query).toHaveValue(invalid)
  await expect(query).toBeFocused()
  await expect(run).toBeEnabled()
  await page.locator('.query-panel').screenshot({ path: testInfo.outputPath('multiline-query-mobile.png') })
  await query.fill(invalid.replace('Infinity', '0.7'))
  await query.press('Enter')
  await expect(output).toContainText('?people = 250 people')
  await expect(output).not.toContainText('Error:')
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390)
  await page.setViewportSize({ width: 1280, height: 900 })
  await page.locator('.query-panel').screenshot({ path: testInfo.outputPath('multiline-query-desktop.png') })
  expect(pageErrors).toEqual([])
})

test('playground valid-time queries interpolate, reject bad dates and recover', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 900 })
  await page.goto('./#/playground')
  const dataset = page.getByLabel('Sample dataset')
  await expect(dataset).toBeEnabled()
  await dataset.selectOption('timeline')
  const run = page.getByRole('button', { name: 'Run query', exact: true })
  const at = page.getByLabel('Valid at (optional)', { exact: true })
  const output = page.getByRole('status', { name: 'Result' })
  await expect(run).toBeEnabled()
  await expect(at).toHaveValue('2026')
  await run.click()
  await expect(output).toContainText('?people = 250 people')
  for (const [date, expected] of [['2025', '?people = 100 people'], ['2027', '?people = 400 people'],
    ['2024', 'No matches.'], ['', '?people = 100 -> 400 people']]) {
    await at.fill(date!)
    await at.press('Enter')
    await expect(output).toContainText(expected!)
    await expect(output).toContainText(date ? `Valid at: ${date}` : 'Valid time: unfiltered')
  }
  await at.fill('2026-02-30')
  await run.click()
  await expect(output).toContainText('2026-02-30')
  await at.fill('2026')
  await run.click()
  await expect(output).toContainText('?people = 250 people')
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390)
  await page.screenshot({ path: testInfo.outputPath('valid-time-mobile.png'), fullPage: true })
  await dataset.selectOption('family')
  await expect(at).toHaveValue('')
  await expect(run).toBeEnabled()
  await run.click()
  await expect(output).toContainText('?ancestor =')
  await at.fill('2026')
  await run.click()
  await expect(output).toContainText('at does not compose with transitive patterns')
  await at.clear()
  await run.click()
  await expect(output).toContainText('?ancestor =')
})

test('query results retain their submitted query and time while inputs change', async ({ page }, testInfo) => {
  await page.addInitScript(() => {
    Worker.prototype.postMessage = new Proxy(Worker.prototype.postMessage, {
      apply(target, receiver, args) {
        if (args[0]?.operation !== 'query') return Reflect.apply(target, receiver, args)
        Object.assign(window, { releaseTimedQuery: () => Reflect.apply(target, receiver, args) })
      }
    })
  })
  await page.goto('./#/playground')
  const dataset = page.getByLabel('Sample dataset')
  await expect(dataset).toBeEnabled()
  await dataset.selectOption('timeline')
  const run = page.getByRole('button', { name: 'Run query', exact: true })
  const at = page.getByLabel('Valid at (optional)', { exact: true })
  const output = page.getByRole('status', { name: 'Result' })
  await expect(run).toBeEnabled()
  await run.click()
  await at.fill('2027')
  const query = page.getByLabel('CAVE query', { exact: true })
  await query.fill('acme HAS headcount: ?changed')
  await page.evaluate(() => (window as unknown as { releaseTimedQuery: () => void }).releaseTimedQuery())
  await expect(output).toContainText('Valid at: 2026')
  await expect(output).toContainText('Query: acme HAS headcount: ?people')
  await expect(query).toHaveValue('acme HAS headcount: ?changed')
  await expect(output).toContainText('?people = 250 people')
  await at.clear()
  await run.click()
  await page.evaluate(() => (window as unknown as { releaseTimedQuery: () => void }).releaseTimedQuery())
  await expect(output).toContainText('Valid time: unfiltered')
  await expect(output).toContainText('100 -> 400 people')
  await expect(output).toContainText('Query: acme HAS headcount: ?changed')
  await at.fill('2026-02-30')
  await run.click()
  await query.fill('acme IS service')
  await at.clear()
  await page.evaluate(() => (window as unknown as { releaseTimedQuery: () => void }).releaseTimedQuery())
  await expect(output).toContainText('Query: acme HAS headcount: ?changed')
  await expect(output).toContainText('Valid at: 2026-02-30')
  await expect(output).toContainText('Error:')
  await expect(run).toBeEnabled()
  await page.setViewportSize({ width: 390, height: 900 })
  await page.screenshot({ path: testInfo.outputPath('submitted-query-mobile.png'), fullPage: true })
})

test('reduced motion disables loading pulses, smooth scrolling and button transitions', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  let releaseDownload!: () => void
  const download = new Promise<void>(resolve => { releaseDownload = resolve })
  await page.route(/\/assets\/Playground-[^/]+\.js$/, async route => {
    await download
    await route.continue()
  })
  try {
    await page.goto('./#/playground')
    await expect(page.locator('.route-loading')).toBeVisible()
    await expect(page.locator('.route-loading').getByRole('status')).toHaveText('Loading CAVE…')
    await expect(page.locator('.route-loading i')).toHaveCSS('animation-name', 'none')
    await expect(page.locator('html')).toHaveCSS('scroll-behavior', 'auto')
  } finally {
    releaseDownload()
  }
  const run = page.getByRole('button', { name: 'Run query' })
  await expect(run).toBeEnabled()
  await expect(page.locator('.route-loading')).toHaveCount(0)
  await expect(run).toHaveCSS('transition-duration', '0s')
  await run.click()
  await expect(page.getByRole('status', { name: 'Result' })).toContainText('match')
})

for (const width of [320, 1280]) test(`a pending query can be stopped and rebuilt without losing editor text at ${width}px`, async ({ page }, testInfo) => {
  await page.addInitScript(() => {
    const state = window as unknown as { stoppedWorkers: number }
    state.stoppedWorkers = 0
    Worker.prototype.terminate = new Proxy(Worker.prototype.terminate, {
      apply(target, receiver, args) {
        state.stoppedWorkers++
        return Reflect.apply(target, receiver, args)
      },
    })
    Worker.prototype.postMessage = new Proxy(Worker.prototype.postMessage, {
      apply(target, receiver, args) {
        if (args[0]?.operation === 'query' && args[0]?.pattern === '?ancestor PARENT-OF+ me') return
        return Reflect.apply(target, receiver, args)
      },
    })
  })
  await page.setViewportSize({ width, height: 900 })
  await page.goto('./#/playground')
  const run = page.getByRole('button', { name: 'Run query', exact: true })
  const stop = page.getByRole('button', { name: 'Stop query', exact: true })
  const rebuild = page.getByRole('button', { name: 'Rebuild database', exact: true })
  const claims = page.getByRole('textbox', { name: 'CAVE claims' })
  const query = page.getByRole('textbox', { name: 'CAVE query' })
  const time = page.getByLabel('Valid at (optional)')
  const output = page.getByRole('status', { name: 'Result' })
  await expect(run).toBeEnabled()
  await expect(stop).toBeDisabled()
  await run.click()
  await expect(output).toHaveText('Running query…')
  await claims.fill('saved-draft IS service')
  await query.fill('?entity IS service')
  await time.fill('2026')
  await expect(stop).toBeEnabled()
  await page.locator('.query-panel').screenshot({ path: testInfo.outputPath('stop-query.png') })
  await stop.focus()
  await stop.press('Enter')
  await expect(output).toContainText('Query stopped')
  await expect(page.locator('.runtime-status')).toHaveText('Query stopped')
  await expect(output).toContainText('database was closed')
  await expect(rebuild).toBeEnabled()
  await expect(rebuild).toBeFocused()
  await expect(run).toBeDisabled()
  await expect(stop).toBeDisabled()
  expect(await page.evaluate(() => (window as unknown as { stoppedWorkers: number }).stoppedWorkers)).toBe(1)
  await expect(claims).toHaveValue('saved-draft IS service')
  await expect(query).toHaveValue('?entity IS service')
  await expect(time).toHaveValue('2026')
  await rebuild.press('Enter')
  await expect(run).toBeEnabled()
  await run.click()
  await expect(output).toContainText('?entity = saved-draft')
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width)
})

test('Stop query terminates an executing worker and rebuilds a usable runtime', async ({ page }) => {
  await page.route('**/assets/worker-*.js', async route => {
    const response = await route.fetch()
    const source = await response.text()
    // Exercise native termination during synchronous work, with a finite fallback
    // so a failing regression cannot leave an unbounded fixture running.
    await route.fulfill({ response, body: `
      self.addEventListener('message', event => {
        if (event.data.operation !== 'query' || event.data.pattern !== '?ancestor PARENT-OF+ me') return;
        console.log('cave-test-query-executing');
        const deadline = performance.now() + 20000;
        while (performance.now() < deadline) {}
      });
      ${source}
    ` })
  })
  const created = page.waitForEvent('worker')
  await page.goto('./#/playground')
  const worker = await created
  const run = page.getByRole('button', { name: 'Run query', exact: true })
  const rebuild = page.getByRole('button', { name: 'Rebuild database', exact: true })
  await expect(run).toBeEnabled()
  const executing = page.waitForEvent('console', { predicate: message => message.text() === 'cave-test-query-executing' })
  await run.click()
  await executing
  const closed = worker.waitForEvent('close', { timeout: 5000 })
  await page.getByRole('button', { name: 'Stop query', exact: true }).click()
  await closed
  await expect(rebuild).toBeFocused()
  await expect(page.getByRole('status', { name: 'Result' })).toContainText('Query stopped')
  await page.getByRole('textbox', { name: 'CAVE claims' }).fill('busy-recovery IS service')
  await page.getByRole('textbox', { name: 'CAVE query' }).fill('?entity IS service')
  await rebuild.click()
  await expect(run).toBeEnabled()
  await run.click()
  await expect(page.getByRole('status', { name: 'Result' })).toContainText('?entity = busy-recovery')
})

test('pending playground operations announce progress and prevent duplicate submissions', async ({ page }) => {
  await page.addInitScript(() => {
    const state = window as unknown as { submitted: number, release: (fail?: boolean | 'fatal') => void }
    state.submitted = 0
    const queued: ((fail?: boolean | 'fatal') => void)[] = []
    state.release = fail => queued.shift()?.(fail)
    Worker.prototype.postMessage = new Proxy(Worker.prototype.postMessage, {
      apply(target, receiver, args) {
        if (args[0]?.operation !== 'query' && args[0]?.operation !== 'append') return Reflect.apply(target, receiver, args)
        state.submitted++
        queued.push(fail => {
          if (fail) receiver.dispatchEvent(new MessageEvent('message', { data: {
            id: args[0].id, ok: false, error: 'Controlled request failure', fatal: fail === 'fatal'
          } }))
          else Reflect.apply(target, receiver, args)
        })
      }
    })
  })
  await page.goto('./#/playground')
  const run = page.getByRole('button', { name: 'Run query' })
  const append = page.getByRole('button', { name: 'Append again' })
  const input = page.getByRole('textbox', { name: 'CAVE query' })
  const output = page.getByRole('status', { name: 'Result' })
  await expect(run).toBeEnabled()
  for (const [index, operation] of ['query', 'append', 'failure'].entries()) {
    const button = operation === 'append' ? append : run
    await button.click()
    await expect(button).toHaveAttribute('aria-busy', 'true')
    await expect(button).toBeFocused()
    await expect(output).toHaveText(operation === 'append' ? 'Appending claims…' : 'Running query…')
    await expect(run).toBeDisabled()
    await expect(append).toBeDisabled()
    await expect(page.getByRole('button', { name: 'Rebuild database' })).toBeDisabled()
    await expect(page.getByRole('combobox', { name: 'Sample dataset' })).toBeDisabled()
    await page.keyboard.press('Enter')
    await page.keyboard.press('Space')
    await input.press('Enter')
    await input.press('Enter')
    expect(await page.evaluate(() => (window as unknown as { submitted: number }).submitted)).toBe(index + 1)
    await page.evaluate(fail => (window as unknown as { release: (fail: boolean) => void }).release(fail), operation === 'failure')
    await expect(run).toBeEnabled()
    await expect(append).toBeEnabled()
    await expect(button).toHaveAttribute('aria-busy', 'false')
    await expect(input).toBeFocused()
    await expect(output).toContainText(operation === 'failure' ? 'Controlled request failure' : operation === 'append' ? 'Appended' : 'match')
  }
  await run.click()
  await expect(run).toHaveAttribute('aria-busy', 'true')
  const claims = page.getByRole('textbox', { name: 'CAVE claims' })
  await claims.fill('pending-recovery IS service')
  await page.evaluate(() => (window as unknown as { release: (fail: 'fatal') => void }).release('fatal'))
  await expect(output).toContainText('Rebuild the database to restart')
  await expect(run).toHaveAttribute('aria-busy', 'false')
  await expect(run).toBeDisabled()
  await expect(append).toBeDisabled()
  const rebuild = page.getByRole('button', { name: 'Rebuild database' })
  await expect(rebuild).toBeEnabled()
  await rebuild.click()
  await expect(run).toBeEnabled()
  await expect(claims).toHaveValue('pending-recovery IS service')
  await input.fill('?entity IS service')
  await run.click()
  await page.evaluate(() => (window as unknown as { release: () => void }).release())
  await expect(output).toContainText('?entity = pending-recovery')
  await expect(run).toBeEnabled()
})

test('pending rebuilds preserve focus and reject repeated activation through success and failure', async ({ page }) => {
  await page.addInitScript(() => {
    const state = window as unknown as { holdRebuild: boolean, rebuilds: number, releaseRebuild: (fail: boolean) => void }
    state.holdRebuild = false
    state.rebuilds = 0
    Worker.prototype.postMessage = new Proxy(Worker.prototype.postMessage, {
      apply(target, receiver, args) {
        if (!state.holdRebuild || args[0]?.operation !== 'open') return Reflect.apply(target, receiver, args)
        state.rebuilds++
        state.releaseRebuild = fail => {
          if (fail) receiver.dispatchEvent(new MessageEvent('message', { data: {
            id: args[0].id, ok: false, error: 'Controlled rebuild failure'
          } }))
          else Reflect.apply(target, receiver, args)
        }
      }
    })
  })
  await page.goto('./#/playground')
  const rebuild = page.getByRole('button', { name: 'Rebuild database', exact: true })
  const claims = page.getByRole('textbox', { name: 'CAVE claims', exact: true })
  const output = page.getByRole('status', { name: 'Result', exact: true })
  await expect(rebuild).toBeEnabled()
  await page.evaluate(() => { (window as unknown as { holdRebuild: boolean }).holdRebuild = true })
  for (const [index, fail] of [false, true].entries()) {
    await rebuild.click()
    await expect(rebuild).toBeDisabled()
    await expect(rebuild).toBeFocused()
    await expect(rebuild).toHaveAttribute('aria-busy', 'true')
    await page.keyboard.press('Enter')
    await page.keyboard.press('Space')
    await rebuild.dispatchEvent('click')
    expect(await page.evaluate(() => (window as unknown as { rebuilds: number }).rebuilds)).toBe(index + 1)
    if (fail) await claims.focus()
    await page.evaluate(fail => (window as unknown as { releaseRebuild: (fail: boolean) => void }).releaseRebuild(fail), fail)
    await expect(rebuild).toBeEnabled()
    await expect(rebuild).toHaveAttribute('aria-busy', 'false')
    await expect(output).toContainText(fail ? 'Controlled rebuild failure' : 'Ready. Loaded')
    await expect(fail ? claims : rebuild).toBeFocused()
    await expect(page.getByRole('button', { name: 'Run query', exact: true })).toBeEnabled()
  }
})

test('dataset selection retains focus and its chosen value during a delayed load', async ({ page }) => {
  await page.addInitScript(() => {
    const state = window as unknown as { holdDataset: boolean, loads: number, releaseDataset: () => void }
    state.holdDataset = false
    state.loads = 0
    Worker.prototype.postMessage = new Proxy(Worker.prototype.postMessage, {
      apply(target, receiver, args) {
        if (!state.holdDataset || args[0]?.operation !== 'open') return Reflect.apply(target, receiver, args)
        state.loads++
        state.releaseDataset = () => { Reflect.apply(target, receiver, args) }
      }
    })
  })
  await page.goto('./#/playground')
  const dataset = page.getByRole('combobox', { name: 'Sample dataset', exact: true })
  await expect(dataset).toBeEnabled()
  await page.evaluate(() => { (window as unknown as { holdDataset: boolean }).holdDataset = true })
  await dataset.focus()
  await dataset.selectOption('incident')
  await expect(dataset).toBeDisabled()
  await expect(dataset).toBeFocused()
  await page.keyboard.press('ArrowDown')
  await page.keyboard.press('End')
  await expect(dataset).toHaveValue('incident')
  await dataset.evaluate(element => {
    (element as HTMLSelectElement).value = 'timeline'
    element.dispatchEvent(new Event('change', { bubbles: true }))
  })
  await expect(dataset).toHaveValue('incident')
  expect(await page.evaluate(() => (window as unknown as { loads: number }).loads)).toBe(1)
  await page.evaluate(() => (window as unknown as { releaseDataset: () => void }).releaseDataset())
  await expect(dataset).toBeEnabled()
  await expect(dataset).toBeFocused()
  await expect(page.getByRole('status', { name: 'Result', exact: true })).toContainText('Ready. Loaded')
  await page.evaluate(() => { (window as unknown as { holdDataset: boolean }).holdDataset = false })
  await dataset.selectOption('timeline')
  await expect(page.getByRole('button', { name: 'Run query', exact: true })).toBeEnabled()
  await expect(dataset).toHaveValue('timeline')
})

for (const field of ['CAVE query', 'Valid at (optional)']) {
  test(`Enter during input composition in ${field} does not run an unfinished query`, async ({ page }) => {
    await page.addInitScript(() => {
      const state = window as unknown as { queryRequests: number }
      state.queryRequests = 0
      Worker.prototype.postMessage = new Proxy(Worker.prototype.postMessage, {
        apply(target, receiver, args) {
          if (args[0]?.operation === 'query') state.queryRequests++
          return Reflect.apply(target, receiver, args)
        }
      })
    })
    await page.goto('./#/playground')
    await expect(page.getByRole('button', { name: 'Run query' })).toBeEnabled()
    await page.getByLabel('Sample dataset').selectOption('timeline')
    await expect(page.getByRole('button', { name: 'Run query' })).toBeEnabled()
    const input = page.getByRole('textbox', { name: field, exact: true })
    await input.focus()
    await input.dispatchEvent('keydown', { key: 'Enter', code: 'Enter', isComposing: true, bubbles: true })
    expect(await page.evaluate(() => (window as unknown as { queryRequests: number }).queryRequests)).toBe(0)
    await input.press('Enter')
    expect(await page.evaluate(() => (window as unknown as { queryRequests: number }).queryRequests)).toBe(1)
    await expect(page.getByRole('status', { name: 'Result' })).toContainText('?people = 250 people')
    await expect(input).toBeFocused()
  })
}

test('forced-colors mode keeps editable claims visible without the syntax mirror', async ({ page }, testInfo) => {
  await page.emulateMedia({ forcedColors: 'active' })
  await page.goto('./#/playground')
  const claims = page.getByRole('textbox', { name: 'CAVE claims' })
  await claims.fill('api IS service\napi HAS owner: platform')
  await expect(page.locator('.cave-editor pre')).toBeHidden()
  const colors = await claims.evaluate(element => {
    const style = getComputedStyle(element)
    return { text: style.color, fill: style.webkitTextFillColor, caret: style.caretColor }
  })
  expect(colors.text).not.toBe('rgba(0, 0, 0, 0)')
  expect(colors.fill).toBe(colors.text)
  expect(colors.caret).toBe(colors.text)
  await expect(page.getByRole('button', { name: 'Rebuild database' })).toBeEnabled()
  await page.getByRole('button', { name: 'Rebuild database' }).click()
  await expect(page.getByRole('status', { name: 'Result' })).toContainText('Ready. Loaded 2 claims')
  await claims.focus()
  await page.evaluate(() => window.scrollTo(0, 0))
  await page.screenshot({ path: testInfo.outputPath('forced-colors-editor.png'), fullPage: true })
})


test('install copying allows only one pending clipboard request and recovers afterward', async ({ page }) => {
  await page.addInitScript(() => {
    const state = window as unknown as { copyCalls: number, finishCopy: () => void }
    state.copyCalls = 0
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: {
      writeText: () => {
        state.copyCalls++
        return new Promise<void>(resolve => { state.finishCopy = resolve })
      }
    } })
  })
  await page.goto('./#/home')
  const button = page.getByRole('button', { name: 'Copy install command' })
  await button.click()
  await expect(button).toBeDisabled()
  await expect(button).toHaveAttribute('aria-busy', 'true')
  await expect(button).toBeFocused()
  await expect(button).toContainText('copying…')
  await page.keyboard.press('Enter')
  await page.keyboard.press('Space')
  await button.evaluate(element => (element as HTMLButtonElement).click())
  expect(await page.evaluate(() => (window as unknown as { copyCalls: number }).copyCalls)).toBe(1)
  await page.evaluate(() => (window as unknown as { finishCopy: () => void }).finishCopy())
  await expect(button).toBeEnabled()
  await expect(page.getByRole('status')).toContainText('Install command copied.')
  await expect(button).toBeFocused()
  await button.click()
  expect(await page.evaluate(() => (window as unknown as { copyCalls: number }).copyCalls)).toBe(2)
  const book = page.getByRole('navigation', { name: 'Primary navigation', exact: true }).getByRole('link', { name: 'Book', exact: true })
  await book.focus()
  await page.evaluate(() => (window as unknown as { finishCopy: () => void }).finishCopy())
  await expect(button).toBeEnabled()
  await expect(book).toBeFocused()
})

for (const failure of ['denied', 'unavailable'] as const) {
  test(`install command remains copyable when clipboard is ${failure}`, async ({ page }, testInfo) => {
    const errors: string[] = []
    page.on('pageerror', error => errors.push(error.message))
    await page.addInitScript(mode => {
      Object.defineProperty(navigator, 'clipboard', { configurable: true, value: mode === 'unavailable' ? undefined : { writeText: async () => { throw new Error('permission denied') } } })
    }, failure)
    await page.setViewportSize({ width: 320, height: 900 })
    await page.goto('./#/home')
    const button = page.getByRole('button', { name: 'Copy install command' })
    await button.click()
    await expect(page.getByRole('status')).toContainText('Copy unavailable')
    const manual = page.getByRole('textbox', { name: 'Install command for manual copying' })
    const command = await page.locator('.install-command code').textContent()
    await expect(manual).toHaveValue(command!)
    await button.focus()
    await page.keyboard.press('Tab')
    await expect(manual).toBeFocused()
    expect(await manual.evaluate(element => (element as HTMLTextAreaElement).selectionEnd)).toBe(command!.length)
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320)
    if (failure === 'denied') {
      await manual.scrollIntoViewIfNeeded()
      await page.screenshot({ path: testInfo.outputPath('manual-copy-mobile.png') })
    }
    await page.evaluate(() => {
      Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async (text: string) => { (window as unknown as { copiedCommand: string }).copiedCommand = text } } })
    })
    await button.click()
    await expect(page.getByRole('status')).toHaveText('Install command copied.')
    await expect(manual).toHaveCount(0)
    expect(await page.evaluate(() => (window as unknown as { copiedCommand: string }).copiedCommand)).toBe(command)
    expect(errors).toEqual([])
  })
}

test('page destinations support native links and opening documentation in another tab', async ({ page, context }) => {
  await page.goto('./#/home')
  await expect(page.locator('main h1')).toBeFocused()
  await expect(page.getByRole('link', { name: 'Start the tutorial', exact: true })).toHaveAttribute('href', '#/docs/overview')
  await expect(page.getByRole('link', { name: 'CAVE home', exact: true })).toHaveAttribute('href', '#/home')
  await page.getByRole('navigation', { name: 'Primary navigation' }).getByRole('link', { name: 'Docs', exact: true }).click()
  const navigation = page.getByRole('navigation', { name: 'Documentation', exact: true })
  const link = navigation.getByRole('link', { name: 'Command line', exact: true })
  await expect(link).toHaveAttribute('href', '#/docs/cli')
  const opened = context.waitForEvent('page')
  await link.click({ button: 'middle' })
  const tab = await opened
  try {
    await expect(tab).toHaveURL(/#\/docs\/cli$/)
    await expect(tab.locator('.docs-article')).toContainText('@cavelang/cli')
    await expect(page).toHaveURL(/#\/docs\/overview$/)
  } finally {
    await tab.close()
  }
  const playground = page.getByRole('navigation', { name: 'Primary navigation' }).getByRole('link', { name: 'Playground', exact: true })
  await playground.focus()
  await page.keyboard.press('Enter')
  await expect(page.getByRole('heading', { name: 'CAVE playground', exact: true })).toBeFocused()
  await expect(page.locator('main h1')).toHaveAttribute('tabindex', '-1')
  const home = page.getByRole('link', { name: 'CAVE home', exact: true })
  await home.focus()
  await page.keyboard.press('Enter')
  await expect(page.locator('.hero h1')).toBeFocused()
  await page.goBack()
  await expect(page.getByRole('heading', { name: 'CAVE playground', exact: true })).toBeFocused()
})

test('unapplied claims remain visible while querying and clear after append or undo', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 900 })
  await page.goto('./#/playground')
  await expect(page.locator('.runtime-status.ready')).toBeVisible({ timeout: 30_000 })
  const claims = page.getByRole('textbox', { name: 'CAVE claims' })
  const query = page.getByRole('textbox', { name: 'CAVE query' })
  const notice = page.locator('#unapplied-claims')
  const original = await claims.inputValue()
  await expect(notice).toBeHidden()
  await claims.fill('widget IS service')
  await expect(notice).toBeVisible()
  await expect(query).toHaveAccessibleDescription(/Queries use the last working database/)
  await query.fill('?x IS service')
  await page.getByRole('button', { name: 'Run query' }).click()
  await expect(notice).toBeVisible()
  await notice.scrollIntoViewIfNeeded()
  await page.screenshot({ path: testInfo.outputPath('unapplied-claims-mobile.png'), fullPage: true })
  await claims.fill(original)
  await expect(notice).toBeHidden()
  await claims.fill('widget IS service')
  await page.getByRole('button', { name: 'Append again' }).click()
  await expect(page.getByRole('status', { name: 'Result' })).toContainText('Appended 1 claims')
  await expect(notice).toBeHidden()
  await page.getByRole('button', { name: 'Run query' }).click()
  await expect(page.getByRole('status', { name: 'Result' })).toContainText('?x = widget')
})

test('highlighting recovers after a failed grammar download when source changes', async ({ page }) => {
  let requests = 0
  const pageErrors: string[] = []
  page.on('pageerror', error => pageErrors.push(error.message))
  await page.route('**/tree-sitter-cave-*.wasm', async route => {
    requests++
    if (requests === 1) await route.fulfill({ status: 503, body: 'temporarily unavailable' })
    else await route.continue()
  })
  await page.goto('./#/playground')
  await expect(page.locator('.runtime-status.ready')).toBeVisible({ timeout: 30_000 })
  await expect.poll(() => requests).toBe(1)
  const editor = page.locator('.cave-editor textarea')
  const source = await editor.inputValue()
  await expect(page.locator('.cave-editor pre')).toContainText(source)
  await expect(page.locator('.cave-editor .syntax')).toHaveCount(0)
  await editor.fill(`${source}\n; highlighting recovery`)
  await expect.poll(() => page.locator('.cave-editor .syntax').count(), { timeout: 10_000 }).toBeGreaterThan(0)
  expect(requests).toBe(2)
  expect(pageErrors).toEqual([])
})

for (const width of [320, 375, 390, 720, 768, 1024, 1280]) {
  test(`production routes fit a ${width}px viewport and preserve navigation`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 900 })
    for (const route of ['home', 'docs/overview', 'playground']) {
      await page.goto(`./#/${route}`)
      await expect(page.locator(route === 'home' ? '.hero' : route === 'docs/overview' ? '.docs-article' : '.playground')).toBeVisible()
      await expect(page.locator('.route-loading')).toHaveCount(0)
      if (route === 'playground') {
        await expect(page.locator('.runtime-status.ready')).toBeVisible({ timeout: 30_000 })
      }
      await page.evaluate(() => document.fonts.ready)
      expect(await page.evaluate(() => document.documentElement.scrollWidth), route).toBeLessThanOrEqual(width)
      if (width === 320 || width === 1280) {
        await testInfo.attach(`${route.replace('/', '-')}-${width}`, { body: await page.screenshot({ path: testInfo.outputPath(`${route.replace('/', '-')}-${width}.png`) }), contentType: 'image/png' })
      }
      const brand = page.getByRole('link', { name: 'CAVE home', exact: true })
      await brand.focus()
      const navigation = page.getByRole('navigation', { name: 'Primary navigation' })
      for (const name of ['Docs', 'Playground', 'Book', 'GitHub ↗']) {
        const item = navigation.getByRole('link', { name, exact: true })
        await page.keyboard.press('Tab')
        await expect(item).toBeFocused()
        await expect(item).toBeInViewport({ ratio: 1 })
        const box = await item.boundingBox()
        expect(box!.x).toBeGreaterThanOrEqual(0)
        expect(box!.x + box!.width).toBeLessThanOrEqual(width)
        await item.click({ trial: true })
      }
      if (route === 'home') {
        for (const card of await page.locator('.capability-card').all()) {
          const box = await card.boundingBox()
          expect(box!.x + box!.width).toBeLessThanOrEqual(width)
        }
      }
    }
  })
}

test('the production playground runs through its worker and Wasm assets under /cave/', async ({ page }) => {
  const failures: string[] = []
  const responses: string[] = []
  const workers: string[] = []

  page.on('console', message => {
    if (message.type() === 'error') failures.push(`console: ${message.text()}`)
  })
  page.on('pageerror', error => failures.push(`page: ${error.message}`))
  page.on('requestfailed', request => failures.push(`request: ${request.url()} (${request.failure()?.errorText ?? 'failed'})`))
  page.on('response', response => {
    responses.push(response.url())
    if (response.status() >= 400) failures.push(`response: ${response.status()} ${response.url()}`)
  })
  page.on('worker', worker => workers.push(worker.url()))

  await page.goto('./#/playground')
  await expect(page).toHaveURL(/\/cave\/#\/playground$/)
  await expect(page.getByRole('heading', { name: 'CAVE playground' })).toBeVisible()
  await expect(page.locator('.runtime-status.ready')).toContainText('current beliefs', { timeout: 30_000 })
  await expect(page.locator('.output-panel pre')).toContainText('Ready. Loaded')

  await expect.poll(() => page.locator('.cave-editor .syntax').count(), { timeout: 30_000 }).toBeGreaterThan(0)
  await page.getByRole('button', { name: 'Run query' }).click()
  await expect(page.locator('.output-panel pre')).toContainText('?ancestor = maria')

  expect(workers.some(url => /\/cave\/assets\/worker-[^/]+\.js$/.test(url)), workers.join('\n')).toBe(true)
  expect(responses.some(url => /\/cave\/assets\/Playground-[^/]+\.js$/.test(url)), responses.join('\n')).toBe(true)
  expect(responses.filter(url => /\/cave\/assets\/[^/]+\.wasm$/.test(url)).length, responses.join('\n')).toBeGreaterThanOrEqual(3)
  expect(failures, failures.join('\n')).toEqual([])
})


for (const width of [320, 1280]) test(`documentation section links preserve the route, reload, and browser history at ${width}px`, async ({ page }) => {
  await page.setViewportSize({ width, height: 900 })
  await page.goto('./#/docs/overview')
  await page.getByRole('link', { name: 'package docs', exact: true }).click()
  await expect(page).toHaveURL(/#\/docs\/overview#where-next$/)
  const heading = page.getByRole('heading', { name: 'Where next', exact: true })
  await expect(heading).toBeInViewport()
  await expect(heading).toBeFocused()
  const header = await page.locator('.site-header').boundingBox()
  expect((await heading.boundingBox())!.y).toBeGreaterThanOrEqual(header!.y + header!.height)
  await page.reload()
  await expect(heading).toBeInViewport()
  await page.locator('.docs-article').getByRole('link', { name: 'store', exact: true }).click()
  await expect(page).toHaveURL(/#\/docs\/store$/)
  await expect(page.locator('.docs-article h1')).toContainText('@cavelang/store')
  await expect(page.locator('.docs-article h1')).toBeFocused()
  await page.goBack()
  await expect(page).toHaveURL(/#\/docs\/overview#where-next$/)
  await expect(heading).toBeInViewport()
  await expect(heading).toBeFocused()
})

test('repeated article section links restore focus and retain native new-tab behavior', async ({ page, context }) => {
  await page.goto('./#/docs/overview#where-next')
  const heading = page.getByRole('heading', { name: 'Where next', exact: true })
  const link = page.getByRole('link', { name: 'package docs', exact: true })
  await expect(heading).toBeFocused()
  await link.click()
  await expect(heading).toBeFocused()
  await expect(heading).toBeInViewport()
  await expect(page).toHaveURL(/#\/docs\/overview#where-next$/)
  const opened = context.waitForEvent('page')
  await link.click({ button: 'middle' })
  const tab = await opened
  try {
    await expect(tab).toHaveURL(/#\/docs\/overview#where-next$/)
    await expect(tab.getByRole('heading', { name: 'Where next', exact: true })).toBeInViewport()
    await expect(page).toHaveURL(/#\/docs\/overview#where-next$/)
  } finally { await tab.close() }
})

test('repeated documentation navigation restores the article heading', async ({ page, context }) => {
  for (const width of [1280, 390]) for (const entry of ['docs/overview', 'docs', 'docs/']) {
    await page.setViewportSize({ width, height: 900 })
    await page.goto('./#/home')
    await page.goto(`./#/${entry}`)
    const heading = page.locator('.docs-article h1')
    const link = page.getByRole('navigation', { name: 'Documentation', exact: true }).locator('[aria-current="page"]')
    await expect(heading).toBeFocused()
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight))
    await expect(heading).not.toBeInViewport()
    await link.click()
    await expect(page).toHaveURL(/#\/docs\/overview$/)
    await expect(heading).toBeFocused()
    await expect(heading).toBeInViewport()
    await link.focus()
    await link.press('Enter')
    await expect(heading).toBeFocused()
    const opened = context.waitForEvent('page')
    await link.click({ button: 'middle' })
    const tab = await opened
    try {
      await expect(tab).toHaveURL(/#\/docs\/overview$/)
      await expect(tab.locator('.docs-article h1')).toBeVisible()
    } finally { await tab.close() }
  }
})

test('missing or malformed documentation fragments focus the destination heading', async ({ page }) => {
  for (const fragment of ['missing-section', '%zz', 'documentation-filter']) {
    await page.goto('./#/docs/overview')
    const link = page.getByRole('navigation', { name: 'Documentation', exact: true }).getByRole('link', { name: 'Rules', exact: true })
    await link.evaluate((element, fragment) => element.setAttribute('href', `#/docs/rules#${fragment}`), fragment)
    await link.click()
    const heading = page.locator('.docs-article h1')
    await expect(heading).toContainText('@cavelang/rules')
    await expect(heading).toBeFocused()
    await expect(heading).toBeInViewport()
    await expect(page.getByRole('textbox', { name: 'Filter documentation' })).not.toHaveAttribute('tabindex', '-1')
  }
})

for (const width of [390, 1280]) test(`CLI command table links to readable diagnosis guidance at ${width}px`, async ({ page }, testInfo) => {
  await page.setViewportSize({ width, height: 900 })
  await page.goto('./#/docs/cli')
  const doctor = page.getByRole('row').filter({ hasText: 'doctor [--db p]' })
  await expect(doctor).toHaveCount(1)
  await expect(page.getByRole('row').filter({ hasText: 'help [command]' })).toHaveCount(1)
  await doctor.getByRole('link', { name: 'Diagnosis', exact: true }).click()
  const heading = page.getByRole('heading', { name: 'Diagnosis', exact: true, level: 2 })
  await expect(heading).toBeFocused()
  await expect(heading).toBeInViewport()
  await expect(page).toHaveURL(/#\/docs\/cli#diagnosis$/)
  await page.screenshot({ path: testInfo.outputPath('diagnosis-guidance.png') })
})

test('all bundled documentation links resolve to rendered pages and section targets', async ({ page }, testInfo) => {
  await page.goto('./#/docs/overview')
  const navigation = page.getByRole('navigation', { name: 'Documentation', exact: true })
  await expect(navigation).toBeVisible()
  const labels = await navigation.getByRole('link').allTextContents()
  const headings = new Map<string, Set<string>>()
  const links: { source: string, href: string }[] = []
  const duplicateIds: { source: string, id: string, count: number }[] = []
  for (const label of labels) {
    const link = navigation.getByRole('link', { name: label, exact: true })
    await link.click()
    await expect(link).toHaveClass('active')
    await expect.poll(async () => page.locator('.docs-article').evaluate(article =>
      article.querySelectorAll('.docs-contents a').length - article.querySelectorAll('h2[id]').length
    ), { message: `${label}: section navigation must be complete before link capture` }).toBe(0)
    const route = new URL(page.url()).hash.slice(1)
    const snapshot = await page.locator('.docs-article').evaluate(article => ({
      ids: [...article.querySelectorAll('[id]')].map(element => element.id),
      links: [...article.querySelectorAll('a[href]')].map(element => element.getAttribute('href')!),
    }))
    const pageDuplicates = await page.evaluate(() => {
      const counts = new Map<string, number>()
      for (const element of document.querySelectorAll('[id]')) {
        counts.set(element.id, (counts.get(element.id) ?? 0) + 1)
      }
      return [...counts].filter(([, count]) => count > 1).map(([id, count]) => ({ id, count }))
    })
    duplicateIds.push(...pageDuplicates.map(entry => ({ source: label, ...entry })))
    headings.set(route, new Set(snapshot.ids))
    links.push(...snapshot.links.filter(href => /^#\/docs\//.test(href)).map(href => ({ source: label, href })))
  }
  expect(headings.size).toBeGreaterThan(25)
  expect(links.length).toBeGreaterThan(0)
  const missing = links.filter(({ href }) => {
    const separator = href.indexOf('#', 1)
    const route = separator < 0 ? href.slice(1) : href.slice(1, separator)
    const ids = headings.get(route)
    if (ids === undefined) return true
    if (separator < 0 || separator === href.length - 1) return false
    let id: string
    try { id = decodeURIComponent(href.slice(separator + 1)) } catch { return true }
    return !ids.has(`cave-doc-${id}`) && !ids.has(id)
  })
  expect(links.some(({ href }) => !href.slice(1).includes('#'))).toBe(true)
  expect(links.some(({ href }) => href.slice(1).includes('#'))).toBe(true)
  const inventory = testInfo.outputPath('documentation-link-inventory.json')
  await writeFile(inventory, JSON.stringify({ pages: [...headings.keys()], links, missing, duplicateIds }, null, 2) + '\n')
  await testInfo.attach('documentation-link-inventory', { contentType: 'application/json', path: inventory })
  expect(missing).toEqual([])
  expect(duplicateIds).toEqual([])
})

test('a failed rebuild preserves the last good database and can be corrected', async ({ page }, testInfo) => {
  await page.goto('./#/playground')
  await expect(page.locator('.runtime-status.ready')).toBeVisible({ timeout: 30_000 })
  const output = page.getByRole('status', { name: 'Result' })
  await expect(output).toHaveAttribute('aria-live', 'polite')
  await expect(output).toHaveAttribute('aria-atomic', 'true')
  const claims = page.getByRole('textbox', { name: 'CAVE claims' })
  const queryInput = page.getByRole('textbox', { name: 'CAVE query' })
  const originalCount = await page.locator('.runtime-status').textContent()

  const dataset = page.getByRole('combobox', { name: 'Sample dataset' })
  await dataset.focus()
  await page.keyboard.press('Tab')
  await page.keyboard.press('Shift+Tab')
  await expect(dataset).toBeFocused()
  await expect(dataset).toHaveCSS('outline-style', 'solid')
  await expect(dataset).toHaveCSS('outline-width', '2px')
  await page.locator('.playground-toolbar').screenshot({ path: testInfo.outputPath('dataset-keyboard-focus.png') })

  await claims.focus()
  await expect(claims).toHaveCSS('outline-style', 'solid')
  await expect(claims).toHaveCSS('outline-width', '2px')
  await page.keyboard.press('Tab')
  await expect(page.getByRole('button', { name: 'Rebuild database' })).toBeFocused()
  await queryInput.focus()
  await expect(queryInput).toHaveCSS('outline-style', 'solid')
  await expect(queryInput).toHaveCSS('outline-width', '2px')

  await claims.fill('this is not a valid claim')
  await expect(page.locator('#unapplied-claims')).toBeVisible()
  await page.getByRole('button', { name: 'Rebuild database' }).click()
  await expect(output).toContainText('Rebuild failed. The last working database is unchanged')
  await expect(page.locator('#unapplied-claims')).toBeVisible()
  await queryInput.press('Enter')
  await expect(output).toContainText('?ancestor = maria')
  await expect(page.locator('.runtime-status')).toHaveText(originalCount!)
  await expect(page.getByRole('button', { name: 'Run query' })).toBeEnabled()

  // Construct the malformed string in the page: protocol text entry repairs it.
  await claims.evaluate(element => {
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!
    setter.call(element, 'api HAS label: "bad' + String.fromCharCode(0xd800) + 'text"')
    element.dispatchEvent(new Event('input', { bubbles: true }))
  })
  await page.getByRole('button', { name: 'Rebuild database' }).click()
  await expect(output).toContainText('unpaired UTF-16 surrogate')
  await expect(page.locator('#unapplied-claims')).toBeVisible()
  await queryInput.press('Enter')
  await expect(output).toContainText('?ancestor = maria')
  await expect(page.locator('.runtime-status')).toHaveText(originalCount!)

  await claims.fill('widget IS service')
  await page.getByRole('button', { name: 'Rebuild database' }).click()
  await expect(output).toContainText('Ready. Loaded 1 claims')
  await expect(page.locator('#unapplied-claims')).toBeHidden()
  await queryInput.fill('?x IS service')
  await page.getByRole('button', { name: 'Run query' }).click()
  await expect(output).toContainText('?x = widget')
  await page.keyboard.press('Tab')
  await expect(page.getByRole('button', { name: 'Copy result', exact: true })).toBeFocused()
  await page.keyboard.press('Tab')
  await expect(output).toBeFocused()
  await expect(output).toHaveCSS('outline-style', 'solid')
  await expect(output).toHaveCSS('outline-offset', '-2px')
  await queryInput.fill('?ancestor PARENT-OF+ me')
  await queryInput.press('Enter')
  await expect(output).toContainText('No matches.')
})

test('malformed Unicode queries report errors without matching replacement text', async ({ page }) => {
  await page.goto('./#/playground')
  await expect(page.locator('.runtime-status.ready')).toBeVisible({ timeout: 30_000 })
  const claims = page.getByRole('textbox', { name: 'CAVE claims' })
  const queryInput = page.getByRole('textbox', { name: 'CAVE query' })
  const output = page.getByRole('status', { name: 'Result' })
  await claims.fill('api HAS label: "bad�text"\nface HAS label: "café 😀"')
  await page.getByRole('button', { name: 'Rebuild database' }).click()
  await expect(output).toContainText('Ready. Loaded 2 claims')
  const originalCount = await page.locator('.runtime-status').textContent()

  for (const code of [0xd800, 0xdc00]) {
    // Create the unpaired surrogate inside the page so the browser protocol
    // cannot turn the test input into a valid replacement character first.
    await queryInput.evaluate((element, code) => {
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!
      setter.call(element, '; Unicode boundary\n\n?x HAS label: "bad' + String.fromCharCode(code) + 'text"')
      element.dispatchEvent(new Event('input', { bubbles: true }))
    }, code)
    await page.getByRole('button', { name: 'Run query' }).click()
    await expect(output).toContainText('CAVE-Q line 3: unpaired UTF-16 surrogate')
    await expect(output).not.toContainText('?x = api')
    await expect(page.locator('.runtime-status')).toHaveText(originalCount!)

    await queryInput.fill('?x HAS label: "bad�text"')
    await queryInput.press('Enter')
    await expect(output).toContainText('?x = api')
    await queryInput.fill('?x HAS label: "café 😀"')
    await queryInput.press('Enter')
    await expect(output).toContainText('?x = face')
    await expect(page.locator('.runtime-status')).toHaveText(originalCount!)
  }
})

test.describe('touch navigation', () => {
  test.use({ hasTouch: true, viewport: { width: 320, height: 900 } })

  test('all internal destinations work on a narrow phone', async ({ page }) => {
    await page.goto('./')
    const navigation = page.getByRole('navigation', { name: 'Primary navigation' })
    await navigation.getByRole('link', { name: 'Docs', exact: true }).tap()
    await expect(page.locator('.docs-article')).toBeVisible()
    await navigation.getByRole('link', { name: 'Playground', exact: true }).tap()
    await expect(page.getByRole('heading', { name: 'CAVE playground' })).toBeVisible()
    await page.getByRole('link', { name: 'CAVE home', exact: true }).tap()
    await expect(page.locator('.hero')).toBeVisible()
    await expect(navigation.getByRole('link', { name: 'Book', exact: true })).toHaveAttribute('href', './cave-book.pdf')
    await expect(navigation.getByRole('link', { name: 'GitHub ↗', exact: true })).toHaveAttribute('href', 'https://github.com/mirek/cave')
  })
})

test('direct documentation routes reveal their active navigation entry', async ({ page }) => {
  for (const width of [390, 1280]) {
    await page.setViewportSize({ width, height: 900 })
    await page.goto('./')
    await page.goto('./#/docs/documentation')
    const active = page.locator('.docs-sidebar [aria-current="page"]')
    await expect(active).toHaveText('Documentation index')
    await expect.poll(() => active.evaluate(element => {
      const box = element.getBoundingClientRect()
      const container = element.closest(window.matchMedia('(max-width: 720px)').matches ? 'nav' : 'aside')!.getBoundingClientRect()
      // Scroll offsets round to CSS pixels while layout edges may be fractional.
      return box.left >= container.left - 1 && box.right <= container.right + 1 &&
        box.top >= container.top - 1 && box.bottom <= container.bottom + 1
    })).toBe(true)
    await expect(page.locator('.docs-article h1').first()).toBeFocused()
    expect(await page.evaluate(() => window.scrollY)).toBe(0)
  }
})

for (const width of [320, 1280]) test(`article navigation returns to the page filter at ${width}px`, async ({ page }, testInfo) => {
  await page.setViewportSize({ width, height: 900 })
  await page.goto('./#/docs/query')
  const filter = page.getByRole('textbox', { name: 'Filter documentation', exact: true })
  await filter.fill('query')
  await page.getByRole('checkbox', { name: 'Include page contents', exact: true }).check()
  const heading = page.locator('.docs-article h1').first()
  await heading.focus()
  await page.keyboard.press('Tab')
  await expect(page.locator('.docs-contents summary')).toBeFocused()
  await page.keyboard.press('Tab')
  const returnToFilter = page.getByRole('button', { name: 'Find another page', exact: true })
  await expect(returnToFilter).toBeFocused()
  await page.screenshot({ path: testInfo.outputPath(`return-filter-${width}.png`) })
  await page.keyboard.press('Enter')
  await expect(filter).toBeFocused()
  await expect(filter).toHaveValue('query')
  await expect(page.getByRole('checkbox', { name: 'Include page contents', exact: true })).toBeChecked()
  await expect(page).toHaveURL(/#\/docs\/query$/)
  await expect.poll(() => filter.evaluate(element => {
    const rect = element.getBoundingClientRect()
    const bottom = document.querySelector('.site-header')!.getBoundingClientRect().bottom
    return rect.top >= bottom && rect.bottom <= window.innerHeight
  })).toBe(true)
  await page.emulateMedia({ media: 'print' })
  await expect(returnToFilter).toBeHidden()
})

test('unknown routes show an honest recovery page instead of unrelated content', async ({ page }, testInfo) => {
  for (const route of ['docs/missing-page', 'docs/overview/extra']) {
    const width = route === 'docs/missing-page' ? 390 : 1280
    await page.setViewportSize({ width, height: 900 })
    await page.goto(`./#/${route}`)
    await expect(page.getByRole('heading', { name: 'Document not found', exact: true })).toBeVisible()
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width)
    await page.screenshot({ path: testInfo.outputPath(`missing-doc-${width}.png`) })
    await page.getByRole('link', { name: 'Open documentation overview', exact: true }).click()
    await expect(page).toHaveURL(/#\/docs\/overview$/)
    await expect(page.locator('.docs-article h1').first()).not.toHaveText('Document not found')
    await page.goBack()
    await expect(page.getByRole('heading', { name: 'Document not found', exact: true })).toBeVisible()
  }
  for (const route of ['missing-page', 'docsmith']) {
    await page.goto(`./#/${route}`)
    await expect(page.getByRole('heading', { name: 'Page not found', exact: true })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Page not found', exact: true })).toBeFocused()
    await expect(page.locator('.hero')).toHaveCount(0)
    await page.getByRole('link', { name: 'Go to CAVE home', exact: true }).click()
    await expect(page.locator('.hero')).toBeVisible()
  }
})

for (const width of [320, 390, 1280]) {
  test(`documentation filtering explains empty results and restores keyboard navigation at ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 900 })
    await page.goto('./#/docs/overview')
    const search = page.getByRole('search', { name: 'Documentation', exact: true })
    const filter = search.getByRole('textbox', { name: 'Filter documentation', exact: true })
    await filter.fill('no-such-document-123')
    await expect(page.getByRole('status')).toHaveText('No matching documentation pages.')
    await expect(filter).toHaveAccessibleDescription('No matching documentation pages. Filter by page name or group. All words must match one page. Down Arrow browses matches. Escape clears the filter.')
    await expect(page.getByRole('navigation', { name: 'Documentation', exact: true }).getByRole('link')).toHaveCount(0)
    await page.screenshot({ path: testInfo.outputPath('empty-filter.png') })
    await page.getByRole('button', { name: 'Clear documentation filter', exact: true }).click()
    await expect(filter).toHaveValue('')
    await expect(filter).toBeFocused()
    const restoredCount = await page.getByRole('navigation', { name: 'Documentation', exact: true }).getByRole('link').count()
    expect(restoredCount).toBeGreaterThan(1)
    await expect(page.getByRole('status')).toHaveText(`Showing all ${restoredCount} documentation pages.`)
    await expect(filter).toHaveAccessibleDescription(new RegExp(`Showing all ${restoredCount} documentation pages`))
    await page.screenshot({ path: testInfo.outputPath('restored-filter.png') })
    await filter.fill('no-such-document-123')
    await filter.dispatchEvent('keydown', { key: 'Escape', isComposing: true })
    await expect(filter).toHaveValue('no-such-document-123')
    await expect(filter).toHaveAttribute('aria-keyshortcuts', 'Escape')
    for (const modifier of ['ctrlKey', 'metaKey', 'altKey', 'shiftKey']) {
      const handled = await filter.evaluate((input, modifier) => {
        const event = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true, [modifier]: true })
        input.dispatchEvent(event)
        return event.defaultPrevented
      }, modifier)
      expect(handled).toBe(false)
      await expect(filter).toHaveValue('no-such-document-123')
      await expect(filter).toBeFocused()
    }
    await filter.press('Escape')
    await expect(filter).toHaveValue('')
    await expect(page.getByRole('status')).toHaveText(`Showing all ${restoredCount} documentation pages.`)
    await expect(filter).toBeFocused()
    await expect(page).toHaveURL(/#\/docs\/overview$/)
    await filter.fill('solver-z3')
    const results = page.getByRole('navigation', { name: 'Documentation', exact: true }).getByRole('link')
    await expect(results).toHaveCount(1)
    await results.click()
    await expect(page).toHaveURL(/#\/docs\/solver-z3$/)
    await expect(results).toHaveAttribute('aria-current', 'page')
  })

  test(`Down Arrow browses documentation matches without navigating at ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 900 })
    await page.goto('./#/docs/overview')
    const filter = page.getByRole('textbox', { name: 'Filter documentation', exact: true })
    await filter.fill('no-such-document-123')
    await filter.press('ArrowDown')
    await expect(filter).toBeFocused()
    await filter.fill('solver')
    const links = page.getByRole('navigation', { name: 'Documentation', exact: true }).getByRole('link')
    expect(await links.count()).toBeGreaterThan(1)
    await expect(filter).toHaveAttribute('aria-keyshortcuts', 'Escape ArrowDown')
    await filter.dispatchEvent('keydown', { key: 'ArrowDown', isComposing: true })
    await expect(filter).toBeFocused()
    for (const modifier of ['Control', 'Meta', 'Alt', 'Shift']) {
      await filter.press(`${modifier}+ArrowDown`)
      await expect(filter).toBeFocused()
    }
    await filter.press('ArrowDown')
    await expect(links.first()).toBeFocused()
    await expect(links.first()).toBeInViewport()
    await expect(page).toHaveURL(/#\/docs\/overview$/)
    await page.screenshot({ path: testInfo.outputPath('browse-doc-matches.png') })
    const target = await links.first().getAttribute('href')
    await links.first().press('Enter')
    await expect.poll(() => page.evaluate(() => window.location.hash)).toBe(target)
    await expect(page.locator('.docs-article h1')).toBeFocused()
    await expect(filter).toHaveValue('solver')
  })

  for (const delayedScroll of [false, true]) test(`Down Arrow reveals a documentation match during smooth page scrolling at ${width}px (delayed=${delayedScroll})`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 })
    await page.goto('./#/docs/overview')
    const filter = page.getByRole('textbox', { name: 'Filter documentation', exact: true })
    await filter.fill('solver')
    await page.evaluate(async delayedScroll => {
      // A preceding browser keyboard shortcut can leave a smooth scroll active.
      if (!delayedScroll) window.scrollTo({ top: 1000, behavior: 'smooth' })
      await new Promise<void>(resolve => requestAnimationFrame(() => resolve()))
      document.getElementById('documentation-filter')!.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }))
      if (delayedScroll) window.scrollTo({ top: 1000, behavior: 'smooth' })
      // Observe the final position, not the initial frame before scrolling runs.
      for (let frame = 0; frame < 60; frame++) await new Promise<void>(resolve => requestAnimationFrame(() => resolve()))
    }, delayedScroll)
    const first = page.getByRole('navigation', { name: 'Documentation', exact: true }).getByRole('link').first()
    await expect(first).toBeFocused()
    await expect(first).toBeInViewport()
    await expect(page).toHaveURL(/#\/docs\/overview$/)
  })

  test(`Enter opens a unique documentation match and ignores ambiguous or composing input at ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 900 })
    await page.goto('./#/docs/overview')
    const filter = page.getByRole('textbox', { name: 'Filter documentation', exact: true })
    for (const value of ['', 'no-such-document-123']) {
      await filter.fill(value)
      await filter.press('Enter')
      await expect(page).toHaveURL(/#\/docs\/overview$/)
      await expect(filter).toBeFocused()
    }
    await filter.fill('solver-z3')
    await expect(filter).toHaveAttribute('aria-keyshortcuts', 'Escape Enter ArrowDown')
    await expect(filter).toHaveAccessibleDescription('1 matching documentation page. Press Enter to open. Filter by page name or group. All words must match one page. Down Arrow browses matches. Escape clears the filter.')
    await page.screenshot({ path: testInfo.outputPath('unique-doc-match.png') })
    await filter.dispatchEvent('keydown', { key: 'Enter', isComposing: true })
    await filter.press('Control+Enter')
    await expect(page).toHaveURL(/#\/docs\/overview$/)
    await expect(filter).toBeFocused()
    await filter.press('Enter')
    await expect(page).toHaveURL(/#\/docs\/solver-z3$/)
    await expect(page.locator('.docs-article h1')).toBeFocused()
    await expect(filter).toHaveValue('solver-z3')
    await filter.focus()
    await expect(filter).toHaveAccessibleDescription('1 matching documentation page. Press Enter to open. Filter by page name or group. All words must match one page. Down Arrow browses matches. Escape clears the filter.')
    await filter.press('Enter')
    await expect(page.locator('.docs-article h1')).toBeFocused()
  })

}

test('clearing a mobile documentation filter reveals the current page without moving focus', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 900 })
  await page.goto('./#/docs/documentation')
  const filter = page.getByRole('textbox', { name: 'Filter documentation', exact: true })
  await filter.fill('documentation index')
  await expect(page.getByRole('status')).toHaveText('1 matching documentation page. Press Enter to open.')
  await page.getByRole('button', { name: 'Clear documentation filter', exact: true }).click()
  await expect(filter).toBeFocused()
  await expect.poll(() => page.locator('.docs-sidebar [aria-current="page"]').evaluate(element => {
    const box = element.getBoundingClientRect()
    const nav = element.closest('nav')!.getBoundingClientRect()
    return box.left >= nav.left - 1 && box.right <= nav.right + 1
  })).toBe(true)
  expect(await page.evaluate(() => window.scrollY)).toBe(0)
})

test('documentation filtering accepts reordered words and normalized separators', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 900 })
  await page.goto('./#/docs/overview')
  const filter = page.getByRole('textbox', { name: 'Filter documentation', exact: true })
  const links = page.getByRole('navigation', { name: 'Documentation', exact: true }).getByRole('link')
  await expect(filter).toBeVisible()
  const allPages = await links.count()
  await filter.fill(' — ⚙️ !!! ')
  await expect(links).toHaveCount(allPages)
  await expect(filter).toHaveAccessibleDescription('Showing all documentation pages. Enter letters or numbers to filter. Filter by page name or group. All words must match one page. Down Arrow browses matches. Escape clears the filter.')
  await expect(filter).toBeFocused()
  for (const query of ['solver z3', 'z3 solver', 'SOLVER_Z3', 'ＳＯＬＶＥＲ　Ｚ３']) {
    await filter.fill(query)
    await expect(links).toHaveCount(1)
    await expect(links).toHaveText(['Z3 adapter'])
    await expect(page.getByRole('status')).toHaveText('1 matching documentation page. Press Enter to open.')
    await expect(filter).toBeFocused()
  }
  await filter.fill('line command')
  await expect(links).toHaveText(['Command line'])
  await filter.fill('checks shapes')
  await expect(links).toHaveText(['Shapes & checks'])
  await filter.press('Tab')
  await expect(page.getByRole('checkbox', { name: 'Include page contents', exact: true })).toBeFocused()
  await page.keyboard.press('Tab')
  await expect(page.getByRole('button', { name: 'Clear documentation filter', exact: true })).toBeFocused()
  await page.keyboard.press('Tab')
  await expect(links).toBeFocused()
  await page.keyboard.press('Enter')
  await expect(page).toHaveURL(/#\/docs\/shape$/)
  await expect(page.locator('.docs-article h1')).toBeFocused()
})

test('a crashed playground worker can be rebuilt without losing edited claims', async ({ page }) => {
  await page.addInitScript(() => {
    const NativeWorker = window.Worker
    const workers: Worker[] = []
    const terminated = new Set<Worker>()
    Object.assign(window, { playgroundWorkerCounts: () => ({ created: workers.length, terminated: terminated.size }) })
    Object.assign(window, { crashPlaygroundWorker: () => workers[0]!.dispatchEvent(new ErrorEvent('error', { message: 'Test worker failure' })) })
    window.Worker = class extends NativeWorker {
      constructor(url: string | URL, options?: WorkerOptions) { super(url, options); workers.push(this) }
      terminate() { terminated.add(this); super.terminate() }
    }
  })
  await page.goto('./#/playground')
  await expect(page.locator('.runtime-status.ready')).toBeVisible({ timeout: 30_000 })
  const editor = page.locator('.cave-editor textarea')
  await page.getByLabel('Sample dataset').selectOption('timeline')
  await expect(page.locator('.runtime-status.ready')).toBeVisible()
  const at = page.getByLabel('Valid at (optional)', { exact: true })
  await at.fill('2027')
  const source = `${await editor.inputValue()}\n; keep my edit after worker failure`
  await editor.fill(source)
  await page.evaluate(() => (window as unknown as { crashPlaygroundWorker: () => void }).crashPlaygroundWorker())
  await expect(page.locator('.runtime-status.error')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Run query', exact: true })).toBeDisabled()
  await page.getByRole('button', { name: 'Rebuild database', exact: true }).click()
  await expect(page.locator('.runtime-status.ready')).toBeVisible({ timeout: 30_000 })
  await expect(editor).toHaveValue(source)
  await expect(at).toHaveValue('2027')
  await page.getByRole('button', { name: 'Run query', exact: true }).click()
  await expect(page.locator('.output-panel pre')).toContainText('?people = 400 people')
  await page.getByRole('link', { name: 'CAVE home', exact: true }).click()
  await expect(page.locator('.hero')).toBeVisible()
  await expect.poll(() => page.evaluate(() => (window as unknown as { playgroundWorkerCounts: () => { created: number, terminated: number } }).playgroundWorkerCounts())).toEqual({ created: 2, terminated: 2 })
})

test('playground worker construction failures remain recoverable', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await page.addInitScript(() => {
    const NativeWorker = window.Worker
    let attempts = 0
    window.Worker = class extends NativeWorker {
      constructor(url: string | URL, options?: WorkerOptions) {
        if (++attempts === 1) throw new Error('Worker startup unavailable')
        super(url, options)
      }
    }
  })
  await page.goto('./#/playground')
  await expect(page.locator('.runtime-status.error')).toBeVisible()
  await expect(page.locator('.output-panel pre')).toContainText('Worker startup unavailable')
  const editor = page.locator('.cave-editor textarea')
  const source = `${await editor.inputValue()}\n; retain edits across startup retry`
  await editor.fill(source)
  await page.getByRole('button', { name: 'Rebuild database', exact: true }).click()
  await expect(page.locator('.runtime-status.ready')).toBeVisible({ timeout: 30_000 })
  await expect(editor).toHaveValue(source)
  expect(errors).toEqual([])
})

for (const viaHome of [true, false]) {
  test(`a recovered documentation render restores its title after navigating ${viaHome ? 'through home' : 'within Docs'}`, async ({ page }) => {
    await page.addInitScript(() => {
      const state = window as unknown as { failDocsRender: boolean }
      state.failDocsRender = true
      const normalize = String.prototype.normalize
      String.prototype.normalize = function (form?: string) {
        if (state.failDocsRender && String(this) === '') throw new Error('temporary documentation render failure')
        return normalize.call(this, form)
      }
    })
    await page.goto(viaHome ? './#/docs/overview' : './#/docs/query')
    await expect(page.getByRole('heading', { name: 'Page could not load', exact: true })).toBeVisible()
    await expect(page).toHaveTitle('Page could not load — CAVE')
    await page.evaluate(() => { (window as unknown as { failDocsRender: boolean }).failDocsRender = false })
    if (viaHome) {
      await page.getByRole('link', { name: 'CAVE home', exact: true }).click()
      await expect(page.locator('.hero')).toBeVisible()
    }
    await page.getByRole('navigation', { name: 'Primary navigation', exact: true }).getByRole('link', { name: 'Docs', exact: true }).click()
    await expect(page.locator('.docs-article h1')).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Page could not load', exact: true })).toHaveCount(0)
    await expect(page).toHaveTitle('Tutorial — CAVE Docs')
    await expect(page.locator('.docs-article h1')).toBeFocused()
  })
}

for (const [destination, chunk] of [['docs/overview', 'Docs'], ['playground', 'Playground']] as const) {
  for (const failed of [false, true]) test(`skip navigation hands delayed ${chunk} focus to ${failed ? 'recovery' : 'content'}`, async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 600 })
    let release!: () => void
    const pending = new Promise<void>(resolve => { release = resolve })
    await page.route(`**/assets/${chunk}-*.js`, async request => {
      await pending
      if (failed) await request.fulfill({ status: 503, contentType: 'text/javascript', body: 'unavailable' })
      else await request.continue()
    })
    try {
      await page.goto(`./#/${destination}`)
      const loading = page.locator('main.route-loading')
      await expect(loading.getByRole('status')).toHaveText('Loading CAVE…')
      await page.addStyleTag({ content: '.site-header { min-height: 160px; }' })
      await page.getByRole('link', { name: 'CAVE home', exact: true }).focus()
      await page.keyboard.press('Shift+Tab')
      await expect(page.getByRole('button', { name: 'Skip to content', exact: true })).toBeFocused()
      const url = page.url()
      await page.keyboard.press('Enter')
      await expect(loading).toBeFocused()
      await expect.poll(() => loading.evaluate(element =>
        element.getBoundingClientRect().top - document.querySelector('.site-header')!.getBoundingClientRect().bottom
      )).toBeGreaterThanOrEqual(0)
      expect(page.url()).toBe(url)
      release()
      const heading = page.locator('main h1').first()
      await expect(heading).toBeFocused()
      await expect(loading).toHaveCount(0)
      expect(page.url()).toBe(url)
      if (failed) {
        await expect(heading).toHaveText('Page could not load')
        await page.keyboard.press('Tab')
        await expect(page.getByRole('button', { name: 'Reload page', exact: true })).toBeFocused()
      } else {
        await expect(page).toHaveTitle(chunk === 'Docs' ? 'Tutorial — CAVE Docs' : 'Playground — CAVE')
      }
    } finally { release() }
  })
}

for (const [destination, chunk] of [['docs/overview', 'Docs'], ['playground', 'Playground']] as const) {
  for (const failed of [false, true]) {
    test(`leaving a delayed ${chunk} download preserves home after ${failed ? 'failure' : 'success'}`, async ({ page }) => {
      let release!: () => void
      const pending = new Promise<void>(resolve => { release = resolve })
      const chunkPattern = new RegExp(`/assets/${chunk}-[^/]+\\.js$`)
      await page.route(chunkPattern, async request => {
        await pending
        if (failed) await request.fulfill({ status: 503, contentType: 'text/javascript', body: 'unavailable' })
        else await request.continue()
      })
      try {
        await page.goto(`./#/${destination}`)
        await expect(page.locator('.route-loading').getByRole('status')).toBeVisible()
        await page.getByRole('link', { name: 'CAVE home', exact: true }).click()
        await expect(page.locator('.hero')).toBeVisible()
        await expect(page.locator('main h1').first()).toBeFocused()
        const book = page.getByRole('navigation', { name: 'Primary navigation', exact: true }).getByRole('link', { name: 'Book', exact: true })
        await book.focus()
        const completed = failed ?
          page.waitForEvent('requestfailed', { predicate: request => chunkPattern.test(request.url()) }) :
          page.waitForResponse(chunkPattern).then(response => response.finished())
        release()
        await completed
        await page.waitForLoadState('networkidle')
        await expect(page).toHaveURL(/#\/home$/)
        await expect(page).toHaveTitle('CAVE — Knowledge, made durable')
        await expect(page.locator('.hero')).toBeVisible()
        await expect(book).toBeFocused()
        await expect(page.locator('.route-loading')).toHaveCount(0)
        await expect(page.getByRole('heading', { name: 'Page could not load', exact: true })).toHaveCount(0)
      } finally { release() }
    })
  }
}

for (const [route, chunk, ready] of [['docs/overview', 'Docs', '.docs-article'], ['playground', 'Playground', '.playground']] as const) {
  test(`failed ${chunk} downloads retain navigation and recover after reload`, async ({ page }, testInfo) => {
    const width = chunk === 'Docs' ? 390 : 1280
    await page.setViewportSize({ width, height: 900 })
    let requests = 0
    await page.route(`**/assets/${chunk}-*.js`, async request => {
      if (++requests === 1) await request.fulfill({ status: 503, contentType: 'text/javascript', body: 'unavailable' })
      else await request.continue()
    })
    await page.goto(`./#/${route}`)
    await expect(page.getByRole('heading', { name: 'Page could not load', exact: true })).toBeVisible()
    await expect(page).toHaveTitle('Page could not load — CAVE')
    await expect(page.getByRole('heading', { name: 'Page could not load', exact: true })).toBeFocused()
    await page.keyboard.press('Tab')
    await expect(page.getByRole('button', { name: 'Reload page', exact: true })).toBeFocused()
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width)
    await page.screenshot({ path: testInfo.outputPath('route-load-error.png') })
    await page.getByRole('link', { name: 'CAVE home', exact: true }).click()
    await expect(page.locator('.hero')).toBeVisible()
    await expect(page).toHaveTitle('CAVE — Knowledge, made durable')
    await page.getByRole('navigation', { name: 'Primary navigation', exact: true }).getByRole('link', { name: chunk === 'Docs' ? 'Docs' : 'Playground', exact: true }).click()
    await expect(page.getByRole('heading', { name: 'Page could not load', exact: true })).toBeFocused()
    await expect(page).toHaveTitle('Page could not load — CAVE')
    await page.keyboard.press('Tab')
    await expect(page.getByRole('button', { name: 'Reload page', exact: true })).toBeFocused()
    await page.keyboard.press('Enter')
    await expect(page.locator(ready)).toBeVisible()
    await expect(page).toHaveTitle(chunk === 'Docs' ? 'Tutorial — CAVE Docs' : 'Playground — CAVE')
    await expect(page.getByRole('heading', { name: 'Page could not load', exact: true })).toHaveCount(0)
    await expect(page.locator('main h1').first()).toBeFocused()
    expect(requests).toBeGreaterThan(1)
  })
}

test('playground retries a failed SQLite download when rebuilt', async ({ page }) => {
  let unavailable = true
  let requests = 0
  await page.route('**/sql-wasm-*.wasm', async request => {
    requests++
    if (unavailable) await request.fulfill({ status: 503, body: 'unavailable' })
    else await request.continue()
  })
  await page.goto('./#/playground')
  await expect(page.locator('.runtime-status.error')).toBeVisible({ timeout: 30_000 })
  const failedRequests = requests
  expect(failedRequests).toBeGreaterThan(0)
  const editor = page.locator('.cave-editor textarea')
  const source = `${await editor.inputValue()}\n; keep edits while SQLite is unavailable: café 😀 �`
  const save = page.getByRole('button', { name: 'Download claims', exact: true })
  let downloads = 0
  page.on('download', () => { downloads++ })
  for (const code of [0xd800, 0xdc00]) {
    // Browser protocol text entry repairs lone surrogates; construct them here.
    await editor.evaluate((element, code) => {
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!
      setter.call(element, '; malformed ' + String.fromCharCode(code))
      element.dispatchEvent(new Event('input', { bubbles: true }))
    }, code)
    await save.click()
    await expect(page.getByRole('status', { name: 'Result' })).toContainText('Cannot download claims containing an unpaired Unicode surrogate')
    await expect(page.locator('.runtime-status.error')).toBeVisible()
  }
  await editor.fill(source)
  const pending = page.waitForEvent('download')
  await save.click()
  const download = await pending
  expect(await readFile((await download.path())!, 'utf8')).toBe(source)
  expect(downloads).toBe(1)
  expect(requests).toBe(failedRequests)
  await expect(page.getByRole('button', { name: 'Run query', exact: true })).toBeDisabled()
  await expect(page.locator('.runtime-status.error')).toBeVisible()
  unavailable = false
  await page.getByRole('button', { name: 'Rebuild database', exact: true }).click()
  await expect(page.locator('.runtime-status.ready')).toBeVisible({ timeout: 30_000 })
  await expect(editor).toHaveValue(source)
  expect(requests).toBeGreaterThan(failedRequests)
})

test('playground restarts after a fatal database cleanup reply without losing edits', async ({ page }) => {
  await page.addInitScript(() => {
    const NativeWorker = Worker
    let opens = 0
    window.Worker = class extends NativeWorker {
      postMessage(message: unknown, options?: StructuredSerializeOptions) {
        const request = message as { id: number, operation: string }
        if (request.operation === 'open' && ++opens === 2) {
          queueMicrotask(() => this.dispatchEvent(new MessageEvent('message', { data: {
            id: request.id, ok: false, fatal: true,
            error: 'Playground database cleanup failed: load interrupted; replacement close interrupted'
          } })))
          return
        }
        super.postMessage(message, options)
      }
    }
  })
  await page.goto('./#/playground')
  const run = page.getByRole('button', { name: 'Run query', exact: true })
  await expect(run).toBeEnabled()
  const claims = page.getByLabel('CAVE claims', { exact: true })
  await claims.fill('retained IS service')
  const rebuild = page.getByRole('button', { name: 'Rebuild database', exact: true })
  await rebuild.click()
  const output = page.getByRole('status', { name: 'Result' })
  await expect(output).toContainText('load interrupted; replacement close interrupted')
  await expect(run).toBeDisabled()
  await expect(claims).toHaveValue('retained IS service')
  await rebuild.click()
  await expect(run).toBeEnabled()
  await page.getByLabel('CAVE query', { exact: true }).fill('?x IS service')
  await run.click()
  await expect(output).toContainText('?x = retained')
})

for (const malformed of ['envelope', 'count', 'output'] as const) test(`playground rebuilds preserved edits after a malformed worker ${malformed}`, async ({ page }) => {
  await page.addInitScript(malformed => {
    const OriginalWorker = Worker
    let fail = true
    window.Worker = class extends OriginalWorker {
      postMessage(message: unknown, options?: StructuredSerializeOptions) {
        if (fail && (message as { operation?: string })?.operation === 'query') {
          fail = false
          const id = (message as { id: number }).id
          const data = malformed === 'envelope' ? null : { id, ok: true,
            result: malformed === 'count' ? { matches: NaN, output: 'invalid count' } : { matches: 1, output: { text: 'invalid output' } } }
          queueMicrotask(() => this.dispatchEvent(new MessageEvent('message', { data })))
          return
        }
        super.postMessage(message, options)
      }
    }
  }, malformed)
  await page.goto('./#/playground')
  const run = page.getByRole('button', { name: 'Run query', exact: true })
  await expect(run).toBeEnabled()
  const claims = page.getByLabel('CAVE claims', { exact: true })
  const source = 'retained IS service'
  await claims.fill(source)
  await run.click()
  await expect(page.getByRole('status', { name: 'Result' })).toContainText('invalid response')
  await expect(run).toBeDisabled()
  await expect(claims).toHaveValue(source)
  await page.getByRole('button', { name: 'Rebuild database', exact: true }).click()
  await expect(run).toBeEnabled()
  await page.getByLabel('CAVE query', { exact: true }).fill('?x IS service')
  await run.click()
  await expect(page.getByRole('status', { name: 'Result' })).toContainText('?x = retained')
})

test('documentation navigation releases resize observers for removed content', async ({ page }) => {
  await page.addInitScript(() => {
    const original = window.ResizeObserver
    const observers: { targets: Set<Element> }[] = []
    ;(window as unknown as { observedDocumentation: typeof observers }).observedDocumentation = observers
    window.ResizeObserver = class extends original {
      targets = new Set<Element>()
      constructor(callback: ResizeObserverCallback) { super(callback); observers.push(this) }
      observe(target: Element, options?: ResizeObserverOptions) {
        this.targets.add(target)
        super.observe(target, options)
      }
      unobserve(target: Element) { this.targets.delete(target); super.unobserve(target) }
      disconnect() { this.targets.clear(); super.disconnect() }
    }
  })
  await page.setViewportSize({ width: 390, height: 900 })
  await page.goto('./#/docs/query')
  const retained = () => page.evaluate(() => {
    const observers = (window as unknown as { observedDocumentation: { targets: Set<Element> }[] }).observedDocumentation
    const targets = observers.flatMap(observer => [...observer.targets])
    return { created: observers.length, active: targets.length, detached: targets.filter(target => !target.isConnected).length }
  })
  await expect.poll(async () => (await retained()).active).toBeGreaterThan(0)
  for (const route of ['docs/solver', 'docs/scenario', 'docs/query', 'missing-page']) {
    await page.evaluate(route => { window.location.hash = '#/' + route }, route)
    if (route.startsWith('docs/')) await expect(page.locator('.docs-sidebar a[aria-current="page"]')).toHaveAttribute('href', '#/' + route)
    else await expect(page.locator('.docs-shell')).toHaveCount(0)
    await expect(page.locator('main h1').first()).toBeFocused()
    await expect.poll(async () => (await retained()).detached).toBe(0)
  }
  await expect.poll(async () => (await retained()).active).toBe(0)
  expect((await retained()).created).toBeGreaterThan(1)
})

test('wide documentation tables preserve words and support keyboard scrolling only when needed', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 900 })
  await page.goto('./#/docs/query')
  const table = page.locator('.docs-article table').nth(1)
  await expect(table).toHaveAttribute('tabindex', '0')
  await expect(table).toHaveAttribute('aria-label', 'Scrollable documentation table')
  expect(await table.evaluate(element => getComputedStyle(element).overflowWrap)).toBe('normal')
  expect(await table.evaluate(element => element.scrollWidth > element.clientWidth)).toBe(true)
  await table.focus()
  await expect(table).toBeFocused()
  await page.keyboard.press('ArrowRight')
  await expect.poll(() => table.evaluate(element => element.scrollLeft)).toBeGreaterThan(0)
  await table.evaluate(element => { element.scrollLeft = 0 })
  await table.screenshot({ path: testInfo.outputPath('mobile-readable-table.png') })
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  await page.setViewportSize({ width: 1280, height: 900 })
  await expect(table).not.toHaveAttribute('tabindex')
  await expect(table).not.toHaveAttribute('aria-label')
  expect(await table.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true)
})


test('keyboard users can skip repeated navigation without changing the route', async ({ page }, testInfo) => {
  for (const width of [390, 1280]) {
    await page.setViewportSize({ width, height: 900 })
    for (const route of ['docs/query', 'home', 'playground', 'missing-page']) {
      await page.goto(`./#/${route}`)
      const heading = page.locator('main h1').first()
      await expect(heading).toBeVisible()
      // The skip control precedes the first navigation link in keyboard order.
      await page.getByRole('link', { name: 'CAVE home', exact: true }).focus()
      await page.keyboard.press('Shift+Tab')
      const skip = page.getByRole('button', { name: 'Skip to content', exact: true })
      await expect(skip).toBeFocused()
      const box = await skip.boundingBox()
      expect(box!.y).toBeGreaterThanOrEqual(0)
      if (width === 390 && route === 'docs/query') {
        await page.screenshot({ path: testInfo.outputPath('skip-content-mobile.png') })
      }
      const url = page.url()
      await page.keyboard.press('Enter')
      await expect(heading).toBeFocused()
      const headingBox = await heading.boundingBox()
      const headerBox = await page.locator('.site-header').boundingBox()
      expect(headingBox!.y).toBeGreaterThanOrEqual(headerBox!.y + headerBox!.height)
      expect(page.url()).toBe(url)
    }
  }
})

test('skip to content clears a taller sticky header', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 320, height: 600 })
  for (const route of ['docs/query', 'home', 'playground', 'missing-page']) {
    await page.goto(`./#/${route}`)
    const heading = page.locator('main h1').first()
    await expect(heading).toBeFocused()
    await page.addStyleTag({ content: '.site-header { min-height: 160px; }' })
    await page.getByRole('link', { name: 'CAVE home', exact: true }).focus()
    await page.keyboard.press('Shift+Tab')
    await expect(page.getByRole('button', { name: 'Skip to content', exact: true })).toBeFocused()
    const url = page.url()
    await page.keyboard.press('Enter')
    await expect(heading).toBeFocused()
    await expect.poll(() => heading.evaluate(element =>
      element.getBoundingClientRect().top - document.querySelector('.site-header')!.getBoundingClientRect().bottom
    )).toBeGreaterThanOrEqual(11)
    expect(page.url()).toBe(url)
    if (route === 'docs/query') await page.screenshot({ path: testInfo.outputPath('skip-content-tall-header.png') })
  }
})

test('playground preserves embedded NUL claim names through WASM storage', async ({ page }) => {
  await page.goto('./#/playground')
  const claims = page.getByRole('textbox', { name: 'CAVE claims', exact: true })
  const rebuild = page.getByRole('button', { name: 'Rebuild database', exact: true })
  await expect(rebuild).toBeEnabled()
  await claims.fill('before\0after IS service')
  await rebuild.click()
  await expect(page.getByRole('button', { name: 'Run query', exact: true })).toBeEnabled()
  await page.getByRole('textbox', { name: 'CAVE query', exact: true }).fill('?x IS service')
  await page.getByRole('button', { name: 'Run query', exact: true }).click()
  await expect(page.getByRole('status', { name: 'Result', exact: true })).toContainText(JSON.stringify('before\0after'))
})


test('wide documentation examples support keyboard scrolling and stop tabbing when they fit', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 900 })
  await page.goto('./#/docs/overview')
  const example = page.locator('.docs-article pre').filter({ hasText: 'copilot mcp add cave' }).first()
  await expect(example).toHaveAttribute('tabindex', '0')
  await expect(example).toHaveAttribute('aria-label', 'Scrollable code example')
  await example.focus()
  await expect(example).toBeFocused()
  await page.keyboard.press('ArrowRight')
  await expect.poll(() => example.evaluate(element => element.scrollLeft)).toBeGreaterThan(0)
  await example.screenshot({ path: testInfo.outputPath('keyboard-code-example.png') })
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  await page.setViewportSize({ width: 1280, height: 900 })
  await expect(example).not.toHaveAttribute('tabindex')
  await expect(example).not.toHaveAttribute('aria-label')
  expect(await example.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true)
})


test('playground distinguishes binding data from result separators', async ({ page }) => {
  await page.goto('./#/playground')
  const rebuild = page.getByRole('button', { name: 'Rebuild database', exact: true })
  await expect(rebuild).toBeEnabled()
  await page.getByRole('textbox', { name: 'CAVE claims', exact: true }).fill('item IS "a · ?extra = forged"')
  await rebuild.click()
  const run = page.getByRole('button', { name: 'Run query', exact: true })
  await expect(run).toBeEnabled()
  await page.getByRole('textbox', { name: 'CAVE query', exact: true }).fill('item IS ?value')
  await run.click()
  await expect(page.getByRole('status', { name: 'Result', exact: true })).toContainText('?value = "a · ?extra = forged"')
})


test('homepage code exposes source text without decorative line numbers', async ({ page }) => {
  await page.goto('./#/home')
  const code = page.locator('.hero-console pre')
  await expect(code.locator('.code-line i')).toHaveCount(9)
  await expect(code.locator('.code-line i').first()).toBeVisible()
  await expect(code.locator('.syntax-keyword').first()).toHaveText('USES')
  const lines = await code.locator('.code-line').evaluateAll(elements => elements.map(element => {
    const copy = element.cloneNode(true) as HTMLElement
    copy.querySelector('i')?.remove()
    return copy.textContent
  }))
  expect(lines).toEqual([
    '; a small monorepo: which package uses which',
    'web USES ui', 'web USES api-client', 'ui USES core',
    'api-client USES core', 'docs USES ui', ' ',
    'core HAS version: 1.4.0',
    'core HAS maintainer: bob @src:standup @ 60%',
  ])
  await expect.poll(async () => await code.ariaSnapshot()).not.toContain('01')
  const accessible = await code.ariaSnapshot()
  expect(accessible).toContain('USES')
  expect(accessible).toContain('api-client')
  expect(accessible).toContain('1.4.0')
})


test('homepage code supports named keyboard scrolling on narrow screens', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 900 })
  await page.goto('./#/home')
  const code = page.locator('.hero-console pre')
  await expect(code).toHaveAttribute('role', 'region')
  await expect(code).toHaveAttribute('aria-label', 'Scrollable code example')
  await expect(code).toHaveAttribute('tabindex', '0')
  await code.focus()
  await page.keyboard.press('ArrowRight')
  await expect.poll(() => code.evaluate(element => element.scrollLeft)).toBeGreaterThan(0)
  await expect(code).toHaveCSS('outline-style', 'solid')
  await page.locator('.hero-console').screenshot({ path: testInfo.outputPath('homepage-code-scroll.png') })
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  await page.setViewportSize({ width: 1440, height: 1000 })
  await expect(code).not.toHaveAttribute('tabindex')
  await expect(code).not.toHaveAttribute('role')
  await expect(code).not.toHaveAttribute('aria-label')
})

test('report outcome tables keep command flags intact on mobile and desktop', async ({ page }, testInfo) => {
  for (const [width, height] of [[320, 900], [390, 600], [390, 900], [1280, 900]] as const) {
    await page.setViewportSize({ width, height })
    await page.goto('./#/docs/view')
    const table = page.locator('.docs-article table').filter({ has: page.getByRole('columnheader', { name: 'Outcome', exact: true }) })
    await expect(table).toHaveCount(1)
    const flags = table.locator('code')
    expect(await flags.count()).toBeGreaterThan(0)
    for (const flag of await flags.all()) {
      expect(await flag.evaluate(element => {
        const range = document.createRange()
        range.selectNodeContents(element)
        return range.getClientRects().length
      }), await flag.textContent() ?? '').toBe(1)
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    if (await table.evaluate(element => element.scrollWidth > element.clientWidth)) {
      await expect(table).toHaveAttribute('tabindex', '0')
      await page.locator('.docs-article h1').focus()
      await page.keyboard.press('Tab')
      await table.focus()
      await expect(table).toBeFocused()
      await expect(table.locator('thead')).toBeInViewport()
      await expect.poll(() => table.evaluate(element => {
        const header = document.querySelector('.site-header')!
        return element.getBoundingClientRect().top - header.getBoundingClientRect().bottom
      })).toBeGreaterThanOrEqual(0)
      await page.screenshot({ path: testInfo.outputPath(`report-focus-${width}-${height}.png`) })
      await page.keyboard.press('ArrowRight')
      await expect.poll(() => table.evaluate(element => element.scrollLeft)).toBeGreaterThan(0)
      await table.evaluate(element => { element.scrollLeft = 0 })
    }
    await table.screenshot({ path: testInfo.outputPath(`report-outcomes-${width}-${height}.png`) })
    if (await table.evaluate(element => element.scrollWidth > element.clientWidth)) {
      await page.locator('.docs-article h1').focus()
      const lastCell = table.locator('tbody tr').last().locator('td').first()
      await lastCell.click()
      await expect(lastCell).toBeInViewport()
    }
  }
})

test('code example focus exposes its beginning below the sticky header', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 320, height: 600 })
  await page.goto('./#/docs/view')
  await expect(page.locator('.docs-article h1')).toBeFocused()
  await page.addStyleTag({ content: '.site-header { min-height: 160px; } .docs-article pre { min-height: 800px; } .docs-article pre code { min-width: 1000px; }' })
  const code = page.locator('.docs-article pre').first()
  await expect(code).toHaveAttribute('tabindex', '0')
  await code.evaluate(element => { element.scrollLeft = 40 })
  const horizontal = await code.evaluate(element => element.scrollLeft)
  await page.keyboard.press('Tab')
  await code.evaluate(element => window.scrollTo({ top: window.scrollY + element.getBoundingClientRect().top + 200, behavior: 'instant' }))
  await code.focus()
  await expect(code).toBeFocused()
  await expect.poll(() => code.evaluate(element => {
    const header = document.querySelector('.site-header')!.getBoundingClientRect()
    return element.getBoundingClientRect().top - header.bottom
  })).toBeGreaterThanOrEqual(11)
  expect(await code.evaluate(element => element.scrollLeft)).toBe(horizontal)
  await page.screenshot({ path: testInfo.outputPath('code-focus.png') })
})

test('documentation section focus clears a taller sticky header', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 320, height: 600 })
  await page.goto('./#/docs/rules')
  await expect(page.locator('.docs-article h1')).toBeFocused()
  await page.addStyleTag({ content: '.site-header { min-height: 160px; }' })
  await page.getByText('On this page', { exact: true }).click()
  const link = page.getByRole('navigation', { name: 'On this page', exact: true }).getByRole('link').first()
  await link.click()
  const heading = page.locator('.docs-article h2').first()
  await expect(heading).toBeFocused()
  await expect.poll(() => heading.evaluate(element =>
    element.getBoundingClientRect().top - document.querySelector('.site-header')!.getBoundingClientRect().bottom
  )).toBeGreaterThanOrEqual(11)
  await page.screenshot({ path: testInfo.outputPath('section-focus.png') })
})

test('table focus uses the measured sticky header height', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 600 })
  await page.goto('./#/docs/view')
  await expect(page.locator('.docs-article h1')).toBeFocused()
  // Model a header that grows beyond the default anchor offset.
  await page.addStyleTag({ content: '.site-header { padding-block: 40px; }' })
  const table = page.locator('.docs-article table').filter({ has: page.getByRole('columnheader', { name: 'Outcome', exact: true }) })
  await expect(table).toHaveAttribute('tabindex', '0')
  await table.evaluate(element => { element.scrollLeft = 40 })
  const horizontal = await table.evaluate(element => element.scrollLeft)
  expect(horizontal).toBeGreaterThan(0)
  await page.keyboard.press('Tab')
  await table.focus()
  await expect(table).toBeFocused()
  await expect(table.locator('thead')).toBeInViewport()
  await expect.poll(() => table.evaluate(element =>
    element.getBoundingClientRect().top - document.querySelector('.site-header')!.getBoundingClientRect().bottom
  )).toBeGreaterThanOrEqual(0)
  expect(await table.evaluate(element => element.scrollLeft)).toBe(horizontal)
})

test('documentation print layout keeps reference tables and examples within the page', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 680, height: 960 })
  await page.goto('./#/docs/cli')
  await expect(page.locator('.docs-article h1')).toBeVisible()
  await page.emulateMedia({ media: 'print' })
  await expect(page.locator('.docs-sidebar')).toBeHidden()
  await expect(page.locator('.site-header')).toBeHidden()
  await expect(page.locator('.docs-shell')).toHaveCSS('display', 'block')
  const contents = page.locator('.docs-article pre, .docs-article table')
  expect(await contents.count()).toBeGreaterThan(0)
  for (const element of await contents.all()) {
    expect(await element.evaluate(node => node.scrollWidth <= node.clientWidth + 1), (await element.textContent())?.slice(0, 100)).toBe(true)
  }
  await page.pdf({ path: testInfo.outputPath('cli-reference-print.pdf'), format: 'A4', printBackground: true })
  await page.emulateMedia({ media: 'screen' })
  await expect(page.locator('.docs-sidebar')).toBeVisible()
  await expect(page.locator('.site-header')).toBeVisible()
})

test('documentation examples and tables retain keyboard scrolling after text enlargement', async ({ page }) => {
  for (const width of [390, 1280]) {
    await page.setViewportSize({ width, height: 900 })
    await page.goto('./#/docs/cli')
    await expect(page.locator('.docs-article h1')).toBeVisible()
    const commands = page.locator('.docs-article table').filter({ has: page.getByRole('row').filter({ hasText: 'help [command]' }) })
    await expect(commands).toHaveCount(1)
    const elements = [page.locator('.docs-article pre').first(), commands]
    const enlarged = await page.addStyleTag({ content: '.docs-article pre, .docs-article table { font-size: 28px; }' })
    for (const element of elements) {
      await expect(element).toHaveCSS('font-size', '28px')
      await expect.poll(() => element.evaluate(node => node.scrollWidth > node.clientWidth)).toBe(true)
      await expect(element).toHaveAttribute('tabindex', '0')
      await expect(element).toHaveAttribute('aria-label', /Scrollable/)
      await element.focus()
      await page.keyboard.press('ArrowRight')
      await expect.poll(() => element.evaluate(node => node.scrollLeft)).toBeGreaterThan(0)
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await enlarged.evaluate(node => node.remove())
    for (const element of elements) {
      await expect(element).toHaveCSS('font-size', '14px')
      await expect.poll(async () => {
        const overflowing = await element.evaluate(node => node.scrollWidth > node.clientWidth)
        return (await element.getAttribute('tabindex') === '0') === overflowing
      }).toBe(true)
    }
  }
})

test('browser history restores separate documentation reading positions for repeated visits', async ({ page }) => {
  for (const width of [390, 1280]) {
    await page.setViewportSize({ width, height: 900 })
    await page.goto('./#/docs/cli')
    await expect(page.locator('.docs-article h1')).toBeFocused()
    await page.evaluate(() => window.scrollTo({ top: 1400, behavior: 'instant' }))
    const position = await page.evaluate(() => window.scrollY)
    expect(position).toBeGreaterThan(1000)
    const navigate = (slug: string) => page.locator(`.docs-sidebar a[href="#/docs/${slug}"]`).evaluate((link: HTMLAnchorElement) => link.click())
    await navigate('store')
    await expect(page).toHaveURL(/#\/docs\/store$/)
    await expect(page.locator('.docs-article h1')).toBeFocused()
    await page.evaluate(() => window.scrollTo({ top: 900, behavior: 'instant' }))
    await page.goBack()
    await expect(page).toHaveURL(/#\/docs\/cli$/)
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(position)
    await page.goForward()
    await expect(page).toHaveURL(/#\/docs\/store$/)
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(900)
    await navigate('cli')
    await expect(page).toHaveURL(/#\/docs\/cli$/)
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0)
    await page.evaluate(() => window.scrollTo({ top: 2200, behavior: 'instant' }))
    await page.goBack()
    await expect(page).toHaveURL(/#\/docs\/store$/)
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(900)
    await page.goBack()
    await expect(page).toHaveURL(/#\/docs\/cli$/)
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(position)
  }
})

test('history navigation works without cryptographic UUID support', async ({ page }) => {
  await page.addInitScript(() => Object.defineProperty(window.crypto, 'randomUUID', { value: undefined, configurable: true }))
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await page.goto('./#/docs/cli')
  await expect(page.locator('.docs-article h1')).toBeFocused()
  await page.evaluate(() => {
    window.history.replaceState({ ...window.history.state, otherState: 'retained' }, '')
    window.scrollTo({ top: 1200, behavior: 'instant' })
  })
  await page.locator('.docs-sidebar a[href="#/docs/store"]').evaluate((link: HTMLAnchorElement) => link.click())
  await expect(page).toHaveURL(/#\/docs\/store$/)
  await expect(page.locator('.docs-article h1')).toBeFocused()
  await page.goBack()
  await expect(page).toHaveURL(/#\/docs\/cli$/)
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(1200)
  expect(await page.evaluate(() => window.history.state.otherState)).toBe('retained')
  expect(errors).toEqual([])
})

for (const width of [320, 1280]) test(`article contents supports keyboard section navigation at ${width}px`, async ({ page }, testInfo) => {
  await page.setViewportSize({ width, height: 900 })
  await page.goto('./#/docs/solver')
  const contents = page.locator('.docs-contents')
  const summary = contents.locator('summary')
  await expect(summary).toHaveText('On this page')
  await expect(contents).not.toHaveAttribute('open', '')
  await expect(page.locator('.docs-article h1').first()).toBeFocused()
  await page.keyboard.press('Tab')
  await expect(summary).toBeFocused()
  await summary.press('Enter')
  const nav = page.getByRole('navigation', { name: 'On this page', exact: true })
  await expect(nav).toBeVisible()
  expect(await nav.getByRole('link').allTextContents()).toEqual(await page.locator('.docs-article h2[id]').allTextContents())
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await page.screenshot({ path: testInfo.outputPath(`article-contents-${width}.png`) })
  const link = nav.getByRole('link', { name: 'Portable semantics', exact: true })
  await link.focus()
  await link.press('Enter')
  await expect(page).toHaveURL(/#\/docs\/solver#portable-semantics$/)
  const heading = page.locator('#cave-doc-portable-semantics')
  await expect(heading).toBeFocused()
  expect(await heading.evaluate(element => element.getBoundingClientRect().top)).toBeGreaterThanOrEqual(64)
  await link.focus()
  await link.press('Enter')
  await expect(heading).toBeFocused()
  await page.getByRole('navigation', { name: 'Documentation', exact: true }).getByRole('link', { name: 'CAVE-Q', exact: true }).click()
  await expect(page).toHaveURL(/#\/docs\/query$/)
  await expect(contents).not.toHaveAttribute('open', '')
  await summary.click()
  expect(await nav.getByRole('link').allTextContents()).toEqual(await page.locator('.docs-article h2[id]').allTextContents())
  await page.emulateMedia({ media: 'print' })
  await expect(contents).toBeHidden()
  await page.emulateMedia({ media: 'screen' })
  await page.goto('./#/docs/not-a-real-document')
  await expect(page.locator('.docs-contents')).toHaveCount(0)
})

for (const width of [390, 1280]) test(`history restores the section disclosure for each document visit at ${width}px`, async ({ page }) => {
  await page.setViewportSize({ width, height: 900 })
  await page.goto('./#/docs/solver')
  const contents = page.locator('.docs-contents')
  await contents.locator('summary').click()
  await expect(contents).toHaveAttribute('open', '')
  const heading = page.locator('#cave-doc-portable-semantics')
  await heading.evaluate(element => element.scrollIntoView({ block: 'start', behavior: 'instant' }))
  const position = await page.evaluate(() => window.scrollY)
  const headingTop = await heading.evaluate(element => element.getBoundingClientRect().top)
  const navigate = (slug: string) => page.locator(`.docs-sidebar a[href="#/docs/${slug}"]`).evaluate((link: HTMLAnchorElement) => link.click())
  await navigate('query')
  await expect(page).toHaveURL(/#\/docs\/query$/)
  await expect(contents).not.toHaveAttribute('open', '')
  await navigate('solver')
  await expect(page).toHaveURL(/#\/docs\/solver$/)
  await expect(contents).not.toHaveAttribute('open', '')
  await page.evaluate(() => window.scrollTo({ top: 900, behavior: 'instant' }))
  await page.goBack()
  await expect(page).toHaveURL(/#\/docs\/query$/)
  await page.goBack()
  await expect(page).toHaveURL(/#\/docs\/solver$/)
  await expect(contents).toHaveAttribute('open', '')
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(position)
  await expect.poll(() => heading.evaluate(element => element.getBoundingClientRect().top)).toBe(headingTop)
  await page.goForward()
  await expect(page).toHaveURL(/#\/docs\/query$/)
  await page.goForward()
  await expect(page).toHaveURL(/#\/docs\/solver$/)
  await expect(contents).not.toHaveAttribute('open', '')
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(900)
})

for (const width of [390, 1280]) test(`documentation filter survives leaving docs and returning at ${width}px`, async ({ page }) => {
  await page.setViewportSize({ width, height: 900 })
  await page.goto('./#/docs/solver')
  const filter = page.getByRole('textbox', { name: 'Filter documentation', exact: true })
  await filter.fill('solver')
  await expect(page.locator('#documentation-filter-status')).toContainText('matching documentation')
  const contents = page.locator('.docs-contents')
  await contents.locator('summary').click()
  const heading = page.locator('#cave-doc-portable-semantics')
  await heading.evaluate(element => element.scrollIntoView({ block: 'start', behavior: 'instant' }))
  const position = await page.evaluate(() => window.scrollY)
  const top = await heading.evaluate(element => element.getBoundingClientRect().top)
  await page.getByRole('link', { name: 'CAVE home', exact: true }).evaluate((link: HTMLAnchorElement) => link.click())
  await expect(page).toHaveURL(/#\/home$/)
  await expect(filter).toHaveCount(0)
  await page.goBack()
  await expect(page).toHaveURL(/#\/docs\/solver$/)
  await expect(filter).toHaveValue('solver')
  await expect(contents).toHaveAttribute('open', '')
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(position)
  await expect.poll(() => heading.evaluate(element => element.getBoundingClientRect().top)).toBe(top)
  await expect(page.locator('.docs-article h1')).toBeFocused()
  await filter.focus()
  await filter.press('Escape')
  await expect(filter).toHaveValue('')
  await expect(filter).toBeFocused()
})

for (const width of [390, 1280]) test(`history restores each visit's documentation filter at ${width}px`, async ({ page }) => {
  await page.setViewportSize({ width, height: 900 })
  await page.goto('./#/docs/solver')
  const filter = page.getByRole('textbox', { name: 'Filter documentation', exact: true })
  await filter.fill('solver')
  const heading = page.locator('#cave-doc-portable-semantics')
  await heading.evaluate(element => element.scrollIntoView({ block: 'start', behavior: 'instant' }))
  const position = await page.evaluate(() => window.scrollY)
  const top = await heading.evaluate(element => element.getBoundingClientRect().top)
  await page.getByRole('link', { name: 'CAVE home', exact: true }).evaluate((link: HTMLAnchorElement) => link.click())
  await expect(page).toHaveURL(/#\/home$/)
  await page.getByRole('navigation', { name: 'Primary navigation', exact: true }).getByRole('link', { name: 'Docs', exact: true }).click()
  await expect(page).toHaveURL(/#\/docs\/overview$/)
  await expect(filter).toHaveValue('solver')
  await filter.fill('')
  await page.locator('.docs-sidebar a[href="#/docs/solver"]').click()
  await expect(page).toHaveURL(/#\/docs\/solver$/)
  await expect(page.locator('.docs-article h1')).toBeFocused()
  await page.evaluate(() => window.scrollTo({ top: 900, behavior: 'instant' }))
  await page.goBack()
  await expect(page).toHaveURL(/#\/docs\/overview$/)
  await page.goBack()
  await expect(page).toHaveURL(/#\/home$/)
  await page.goBack()
  await expect(page).toHaveURL(/#\/docs\/solver$/)
  await expect(filter).toHaveValue('solver')
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(position)
  await expect.poll(() => heading.evaluate(element => element.getBoundingClientRect().top)).toBe(top)
  await page.goForward()
  await expect(page).toHaveURL(/#\/home$/)
  await page.goForward()
  await expect(page).toHaveURL(/#\/docs\/overview$/)
  await expect(filter).toHaveValue('')
  await page.goForward()
  await expect(page).toHaveURL(/#\/docs\/solver$/)
  await expect(filter).toHaveValue('')
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(900)
})

test('playground accepts explicit claims without turning reserved subjects into operators', async ({ page }) => {
  await page.goto('./#/playground')
  const rebuild = page.getByRole('button', { name: 'Rebuild database', exact: true })
  await expect(rebuild).toBeEnabled()
  await page.getByRole('textbox', { name: 'CAVE claims', exact: true }).fill('@claim WHEN IS ready @claim\n  @claim IS EXISTS\n  WHEN @claim NOT EXISTS')
  await rebuild.click()
  const run = page.getByRole('button', { name: 'Run query', exact: true })
  await expect(run).toBeEnabled()
  await page.getByRole('textbox', { name: 'CAVE query', exact: true }).fill('?subject IS ready')
  await run.click()
  await expect(page.getByRole('status', { name: 'Result', exact: true })).toContainText('?subject = WHEN')
  await page.getByRole('textbox', { name: 'CAVE query', exact: true }).fill('?subject EXISTS')
  await run.click()
  const result = page.getByRole('status', { name: 'Result', exact: true })
  await expect(result).toContainText('?subject = IS')
  await expect(result).toContainText('?subject = NOT')
})

test('playground rejects unnamed query variables and accepts a corrected query', async ({ page }) => {
  await page.goto('./#/playground')
  const dataset = page.getByLabel('Sample dataset')
  await expect(dataset).toBeEnabled()
  await dataset.selectOption('postmortem')
  const query = page.getByLabel('CAVE query', { exact: true })
  const run = page.getByRole('button', { name: 'Run query', exact: true })
  const output = page.getByRole('status', { name: 'Result' })
  await expect(run).toBeEnabled()
  await query.fill('? CAUSE ?effect')
  await run.click()
  await expect(output).toContainText('variable requires a name')
  await query.fill('?thing CAUSE ?effect')
  await run.click()
  await expect(output).toContainText('3 matches')
})

for (const width of [390, 1280]) test(`documentation filtering matches visible groups at ${width}px`, async ({ page }) => {
  await page.setViewportSize({ width, height: 900 })
  await page.goto('./#/docs/overview')
  const filter = page.getByRole('textbox', { name: 'Filter documentation', exact: true })
  const nav = page.getByRole('navigation', { name: 'Documentation', exact: true })
  const links = nav.getByRole('link')
  await expect(nav.locator('h2').filter({ hasText: /^Integrations$/ })).toHaveCount(1)
  const integrations = await nav.locator('section').filter({ has: page.locator('h2').filter({ hasText: /^Integrations$/ }) }).getByRole('link').allTextContents()
  await filter.fill('ＩＮＴＥＧＲＡＴＩＯＮＳ')
  await expect(links).toHaveText(integrations)
  await expect(filter).toBeFocused()
  await expect(page).toHaveURL(/#\/docs\/overview$/)
  await filter.fill('reference integrations')
  await expect(links).toHaveCount(0)
  for (const query of ['reference z3', 'Z3 / Reference']) {
    await filter.fill(query)
    await expect(links).toHaveText(['Z3 adapter'])
  }
  await filter.press('Enter')
  await expect(page).toHaveURL(/#\/docs\/solver-z3$/)
  await expect(page.locator('.docs-article h1')).toBeFocused()
  await filter.focus()
  await filter.press('Escape')
  await expect(nav.locator('h2')).toHaveText(['Learn', 'Reference', 'Integrations', 'Project'])
})

for (const width of [320, 1280]) test(`solver arithmetic comparisons remain keyboard-readable at ${width}px`, async ({ page }, testInfo) => {
  await page.setViewportSize({ width, height: 900 })
  await page.goto('./#/docs/solver#exact-arithmetic-and-resource-limits')
  const tables = page.locator('.docs-article table').filter({
    has: page.getByRole('columnheader', { name: /Node 24\.21\.0 sequential \/ balanced/ })
  })
  await expect(tables).toHaveCount(3)
  for (const table of await tables.all()) {
    await expect(table.getByRole('columnheader')).toHaveCount(3)
    expect(await table.locator('tbody tr').count()).toBeGreaterThanOrEqual(3)
  }
  const enlarged = await page.addStyleTag({ content: '.docs-article table { font-size: 28px; }' })
  for (const [index, table] of (await tables.all()).entries()) {
    await expect(table).toHaveCSS('font-size', '28px')
    const overflowing = await table.evaluate(element => element.scrollWidth > element.clientWidth)
    if (overflowing) {
      await expect(table).toHaveAttribute('tabindex', '0')
      await expect(table).toHaveAttribute('aria-label', /Scrollable/)
      await table.focus()
      await expect(table).toBeFocused()
      await expect(table.locator('thead')).toBeInViewport()
    } else {
      await expect(table).not.toHaveAttribute('tabindex', '0')
      await table.scrollIntoViewIfNeeded()
    }
    await table.screenshot({ path: testInfo.outputPath(`solver-comparison-${width}-${index}.png`) })
    if (overflowing) {
      await page.keyboard.press('ArrowRight')
      await expect.poll(() => table.evaluate(element => element.scrollLeft)).toBeGreaterThan(0)
    }
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await enlarged.evaluate(element => element.remove())
  for (const table of await tables.all()) {
    await expect.poll(async () => (await table.getAttribute('tabindex') === '0') ===
      await table.evaluate(element => element.scrollWidth > element.clientWidth)).toBe(true)
  }
})

for (const width of [320, 1280]) test(`article contents identifies the selected section through history at ${width}px`, async ({ page }, testInfo) => {
  await page.setViewportSize({ width, height: 900 })
  await page.goto('./#/docs/solver#%70ortable-semantics')
  const contents = page.locator('.docs-contents')
  await contents.locator('summary').click()
  const current = contents.locator('a[aria-current="location"]')
  await expect(current).toHaveText('Portable semantics')
  await expect(current).toHaveCSS('font-weight', '700')
  const links = contents.getByRole('link')
  const next = links.filter({ hasText: /^Validation and identity$/ })
  await next.click()
  await expect(current).toHaveText('Validation and identity')
  await page.goBack()
  await expect(current).toHaveText('Portable semantics')
  await page.goForward()
  await expect(current).toHaveText('Validation and identity')
  await contents.scrollIntoViewIfNeeded()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await page.screenshot({ path: testInfo.outputPath(`selected-section-${width}.png`) })
  for (const fragment of ['not-a-section', '%E0%A4%A', '']) {
    await page.evaluate(fragment => { location.hash = `#/docs/solver${fragment === '' ? '' : '#' + fragment}` }, fragment)
    await expect(current).toHaveCount(0)
  }
})

for (const width of [320, 1280]) test(`documentation content filtering finds APIs and restores its history scope at ${width}px`, async ({ page }, testInfo) => {
  await page.setViewportSize({ width, height: 900 })
  await page.goto('./#/docs/overview')
  const filter = page.getByRole('textbox', { name: 'Filter documentation', exact: true })
  const scope = page.getByRole('checkbox', { name: 'Include page contents', exact: true })
  const navigation = page.getByRole('navigation', { name: 'Documentation', exact: true })
  await expect(scope).not.toBeChecked()
  await filter.fill('runProcessSync')
  await expect(navigation.getByRole('link')).toHaveCount(0)
  await scope.check()
  const loop = navigation.getByRole('link', { name: 'Reconstruction loop', exact: true })
  await expect(loop).toBeVisible()
  await expect(scope).toBeFocused()
  await expect(filter).toHaveAccessibleDescription(/Filter by page name, group or contents/)
  await expect(page).toHaveURL(/#\/docs\/overview$/)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  await page.screenshot({ path: testInfo.outputPath('content-filter.png') })
  await loop.click()
  await expect(page.locator('.docs-article h1')).toBeFocused()
  await expect(scope).toBeChecked()
  await scope.uncheck()
  await expect(navigation.getByRole('link')).toHaveCount(0)
  await page.getByRole('link', { name: 'CAVE home', exact: true }).click()
  await page.goBack()
  await expect(page).toHaveURL(/#\/docs\/loop$/)
  await expect(scope).not.toBeChecked()
  await expect(filter).toHaveValue('runProcessSync')
  await page.goBack()
  await expect(page).toHaveURL(/#\/docs\/overview$/)
  await expect(scope).toBeChecked()
  await expect(loop).toBeVisible()
  await page.getByRole('button', { name: 'Clear documentation filter', exact: true }).click()
  await expect(filter).toHaveValue('')
  await expect(filter).toBeFocused()
  await expect(scope).toBeChecked()
})

for (const width of [320, 1280]) test(`empty documentation search can expand to page contents at ${width}px`, async ({ page }, testInfo) => {
  await page.setViewportSize({ width, height: 900 })
  await page.goto('./#/docs/overview')
  const filter = page.getByRole('textbox', { name: 'Filter documentation', exact: true })
  const scope = page.getByRole('checkbox', { name: 'Include page contents', exact: true })
  const expand = page.getByRole('button', { name: 'Search page contents', exact: true })
  await expect(expand).toHaveCount(0)
  await filter.fill('runProcessSync')
  await expect(page.getByRole('navigation', { name: 'Documentation', exact: true }).getByRole('link')).toHaveCount(0)
  await expect(expand).toBeVisible()
  await page.screenshot({ path: testInfo.outputPath('empty-search-recovery.png') })
  await filter.press('Tab')
  await expect(scope).toBeFocused()
  await scope.press('Tab')
  await expect(expand).toBeFocused()
  await expand.press('Enter')
  await expect(scope).toBeChecked()
  await expect(filter).toBeFocused()
  await expect(filter).toHaveValue('runProcessSync')
  await expect(expand).toHaveCount(0)
  await expect(page.getByRole('navigation', { name: 'Documentation', exact: true })
    .getByRole('link', { name: 'Reconstruction loop', exact: true })).toBeVisible()
  await expect(page).toHaveURL(/#\/docs\/overview$/)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  await filter.fill('zzzxqvnomatchingdocumentationcontent')
  await expect(page.getByRole('status')).toHaveText('No matching documentation pages.')
  await expect(expand).toHaveCount(0)
  await filter.press('Escape')
  await expect(filter).toHaveValue('')
  await expect(filter).toBeFocused()
  await expect(scope).toBeChecked()
})

for (const width of [320, 1280]) test(`failed playground rebuild retains appended data at ${width}px`, async ({ page }, testInfo) => {
  await page.setViewportSize({ width, height: 900 })
  await page.goto('./#/playground')
  await expect(page.locator('.runtime-status.ready')).toBeVisible({ timeout: 30_000 })
  const claims = page.getByRole('textbox', { name: 'CAVE claims', exact: true })
  const query = page.getByRole('textbox', { name: 'CAVE query', exact: true })
  const output = page.getByRole('status', { name: 'Result', exact: true })
  const rebuild = page.getByRole('button', { name: 'Rebuild database', exact: true })
  await expect(rebuild).toHaveAccessibleDescription('Rebuild replaces the database with the editor contents. Claims absent from the editor are removed.')
  await expect(page.getByRole('button', { name: 'Append again', exact: true })).toHaveAccessibleDescription('Append again adds these claims while keeping existing data.')
  await expect(page.locator('#claims-rebuild-help')).toBeVisible()
  await expect(page.locator('#claims-append-help')).toBeVisible()
  await page.locator('.editor-panel').screenshot({ path: testInfo.outputPath(`claims-actions-${width}.png`) })
  await claims.fill('original IS retained')
  await rebuild.click()
  await expect(output).toContainText('Ready. Loaded 1 claims')
  await claims.fill('appended IS retained')
  await page.getByRole('button', { name: 'Append again', exact: true }).click()
  await expect(output).toContainText('Appended 1 claims')
  await expect(page.locator('.runtime-status')).toHaveText('2 current beliefs')
  await claims.fill('broken claim')
  await rebuild.click()
  await expect(output).toContainText('The last working database is unchanged')
  await expect(claims).toHaveValue('broken claim')
  await expect(page.locator('#unapplied-claims')).toBeVisible()
  await query.fill('?x IS retained')
  await query.press('Enter')
  await expect(output).toContainText('?x = original')
  await expect(output).toContainText('?x = appended')
  await expect(page.locator('.runtime-status')).toHaveText('2 current beliefs')
  await claims.fill('replacement IS retained')
  await rebuild.click()
  await expect(output).toContainText('Ready. Loaded 1 claims')
  await expect(page.locator('#unapplied-claims')).toBeHidden()
  await query.press('Enter')
  await expect(output).toContainText('1 match')
  await expect(output).toContainText('?x = replacement')
  await expect(output).not.toContainText('?x = original')
  await expect(output).not.toContainText('?x = appended')
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
})

for (const width of [320, 1280]) test(`playground copies the displayed query and result at ${width}px`, async ({ page }, testInfo) => {
  await page.setViewportSize({ width, height: 900 })
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: {
      writeText: async (text: string) => { (window as unknown as { copiedResult: string }).copiedResult = text }
    } })
  })
  await page.goto('./#/playground')
  const output = page.getByRole('status', { name: 'Result', exact: true })
  await expect(output).toContainText('Ready.')
  await page.getByRole('button', { name: 'Run query', exact: true }).click()
  await expect(output).toContainText('Query:')
  const expected = await output.textContent()
  await page.getByRole('textbox', { name: 'CAVE query', exact: true }).fill('edited IS query')
  const copy = page.getByRole('button', { name: 'Copy result', exact: true })
  await copy.click()
  await expect(page.locator('.result-copy-status')).toHaveText('Result copied.')
  expect(await page.evaluate(() => (window as unknown as { copiedResult: string }).copiedResult)).toBe(expected)
  await expect(copy).toBeFocused()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  await page.screenshot({ path: testInfo.outputPath('copy-result.png'), fullPage: true })
})

test('pending result copying captures text once and does not relabel a newer result', async ({ page }) => {
  await page.addInitScript(() => {
    const state = window as unknown as { copies: string[], finishCopy: () => void }
    state.copies = []
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: {
      writeText: (text: string) => {
        state.copies.push(text)
        return new Promise<void>(resolve => { state.finishCopy = resolve })
      }
    } })
  })
  await page.goto('./#/playground')
  const output = page.getByRole('status', { name: 'Result', exact: true })
  await expect(output).toContainText('Ready.')
  const initial = await output.textContent()
  const copy = page.getByRole('button', { name: 'Copy result', exact: true })
  await copy.click()
  await expect(copy).toHaveAttribute('aria-busy', 'true')
  await page.keyboard.press('Enter')
  await copy.evaluate(element => (element as HTMLButtonElement).click())
  expect(await page.evaluate(() => (window as unknown as { copies: string[] }).copies)).toEqual([initial])
  await page.getByRole('button', { name: 'Run query', exact: true }).click()
  await expect(output).toContainText('Query:')
  await page.evaluate(() => (window as unknown as { finishCopy: () => void }).finishCopy())
  await expect(copy).toHaveAttribute('aria-busy', 'false')
  await expect(page.locator('.result-copy-status')).toBeEmpty()
  await copy.click()
  expect(await page.evaluate(() => (window as unknown as { copies: string[] }).copies)).toEqual([initial, await output.textContent()])
  await page.evaluate(() => (window as unknown as { finishCopy: () => void }).finishCopy())
  await expect(page.locator('.result-copy-status')).toHaveText('Result copied.')
})

for (const failure of ['denied', 'unavailable']) test(`playground offers manual result selection when copying is ${failure}`, async ({ page }) => {
  await page.addInitScript(mode => {
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: mode === 'unavailable' ? undefined : {
      writeText: async () => { throw new Error('denied') }
    } })
  }, failure)
  await page.goto('./#/playground')
  const output = page.getByRole('status', { name: 'Result', exact: true })
  await expect(output).toContainText('Ready.')
  await page.getByRole('button', { name: 'Copy result', exact: true }).click()
  await expect(page.locator('.result-copy-status')).toContainText('Copy unavailable.')
  await page.getByRole('button', { name: 'Select result text', exact: true }).click()
  await expect(output).toBeFocused()
  expect(await page.evaluate(() => window.getSelection()?.toString())).toBe(await output.textContent())
  await page.getByRole('button', { name: 'Run query', exact: true }).click()
  await expect(output).toContainText('Query:')
  await expect(page.getByRole('button', { name: 'Select result text', exact: true })).toHaveCount(0)
})


test('homepage capability examples support keyboard scrolling without unnecessary tab stops', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 320, height: 900 })
  await page.goto('./#/home')
  const card = page.locator('.capability-card').filter({ has: page.getByRole('heading', { name: 'Derive what nobody wrote' }) })
  const code = card.getByRole('region', { name: 'Scrollable code example' })
  await expect(code).toHaveAttribute('tabindex', '0')
  await code.focus()
  await page.keyboard.press('ArrowRight')
  await expect.poll(() => code.evaluate(element => element.scrollLeft)).toBeGreaterThan(0)
  await expect(code).toHaveCSS('outline-style', 'solid')
  await expect(code).toContainText('?adv AFFECTS ?dep, ?pkg USES+ ?dep => ?pkg EXPOSED-TO ?adv')
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  await card.screenshot({ path: testInfo.outputPath('capability-code-mobile.png') })
  await page.setViewportSize({ width: 1440, height: 1000 })
  const short = page.locator('.capability-card').filter({ has: page.getByRole('heading', { name: 'Ask across the graph' }) }).locator('pre')
  await expect(short).not.toHaveAttribute('tabindex')
  await expect(short).not.toHaveAttribute('role')
  await page.locator('.capabilities').screenshot({ path: testInfo.outputPath('capability-code-desktop.png') })
})


test('solver capture-order summary fits narrow screens without horizontal scrolling', async ({ page }) => {
  for (const width of [320, 390, 1280]) {
    await page.setViewportSize({ width, height: 900 })
    await page.goto('./#/docs/solver#validation-and-identity')
    const table = page.locator('.docs-article table').filter({ hasText: 'Order before model use' })
    await expect(table).toBeVisible()
    expect(await table.evaluate(element => element.scrollWidth)).toBeLessThanOrEqual(await table.evaluate(element => element.clientWidth))
    await expect(table).not.toHaveAttribute('tabindex')
    await expect(table).toContainText('freeze it before adapter execution')
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width)
  }
})
