import { test, expect } from '@playwright/test'

test('claims highlighting follows editor scrolling and replacement', async ({ page }) => {
  await page.goto('./#/playground')
  const editor = page.getByRole('textbox', { name: 'CAVE claims', exact: true })
  const source = Array.from({ length: 100 }, (_, index) => `item-${index} IS ${'long-name-'.repeat(40)}ready`).join('\n')
  await editor.fill(source)
  await expect.poll(() => page.locator('.cave-editor .syntax').count()).toBeGreaterThan(0)
  await editor.evaluate(element => { element.scrollTop = 800; element.scrollLeft = 600 })
  await expect.poll(() => editor.evaluate(element => [element.scrollTop, element.scrollLeft])).toEqual([800, 600])
  const offsets = () => page.locator('.cave-editor').evaluate(element => {
    const input = element.querySelector('textarea')!, mirror = element.querySelector('pre')!
    return [input.scrollTop - mirror.scrollTop, input.scrollLeft - mirror.scrollLeft]
  })
  await expect.poll(offsets).toEqual([0, 0])
  await page.setViewportSize({ width: 390, height: 844 })
  await expect.poll(offsets).toEqual([0, 0])
  await editor.fill('short EXISTS')
  await expect.poll(offsets).toEqual([0, 0])
  await editor.fill(source)
  await editor.press('ControlOrMeta+End')
  await expect.poll(() => editor.evaluate(element => element.scrollTop)).toBeGreaterThan(800)
  await expect.poll(offsets).toEqual([0, 0])
})
