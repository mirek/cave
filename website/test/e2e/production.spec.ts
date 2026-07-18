import { expect, test } from '@playwright/test'

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
