// Optional browser QA using an existing Playwright and Chromium installation.
import { writeFileSync } from 'node:fs'
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright')
const browser = await chromium.launch({ headless: true })
const results = []
try {
  for (const [width, height] of [[1440, 900], [430, 932], [390, 844]]) {
    const page = await browser.newPage({ viewport: { width, height } })
    const errors = []
    page.on('pageerror', error => errors.push(error.message))
    await page.goto('http://127.0.0.1:4317/corpus')
    await page.getByRole('heading', { name: 'From the source', exact: true }).waitFor()
    await page.getByLabel('Your question').focus()
    await page.keyboard.press('Enter')
    await page.waitForFunction(() => document.querySelector('.results').getAttribute('aria-busy') === 'false')
    if (!await page.getByRole('blockquote').textContent().then(t => t.includes('preferred source'))) throw new Error('Wrong passage')
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)
    const smallTargets = await page.locator('button:visible, a:visible, input:visible, select:visible').evaluateAll(els => els.filter(el => {
      const rect = el.getBoundingClientRect()
      return rect.width < 43.99 || rect.height < 43.99
    }).map(el => el.textContent))
    if (overflow || smallTargets.length || errors.length) throw new Error(JSON.stringify({ width, overflow, smallTargets, errors }))
    await page.screenshot({ path: `docs/media/public-corpus-light-${width}x${height}.png`, fullPage: true })
    await page.getByRole('button', { name: 'Switch color theme' }).click()
    await page.screenshot({ path: `docs/media/public-corpus-dark-${width}x${height}.png`, fullPage: true })
    await page.getByLabel('Collection').selectOption('fictional')
    await page.getByLabel('Your question').fill('onboarding guide')
    await page.getByRole('button', { name: 'Find source passage' }).click()
    await page.getByText('Passage fictional-1', { exact: true }).waitFor()
    await page.getByLabel('Collection').selectOption('public')
    await page.getByLabel('Your question').fill('zzzzzzzz')
    await page.getByRole('button', { name: 'Find source passage' }).click()
    await page.getByRole('heading', { name: 'No matching passage', exact: true }).waitFor()
    await page.route('**/api/corpus?**', route => route.fulfill({ status: 500, body: '{}' }))
    await page.getByRole('button', { name: 'Find source passage' }).click()
    await page.getByRole('heading', { name: 'Search unavailable' }).waitFor()
    await page.unroute('**/api/corpus?**')
    await page.getByLabel('Your question').fill('blood gas oximetry conflicting')
    await page.getByRole('button', { name: 'Find source passage' }).click()
    await page.getByRole('heading', { name: 'From the source', exact: true }).waitFor()
    results.push({ width, height, overflow, smallTargets, errors, keyboardSubmit: true, collectionSwitch: true, emptyState: true, errorRecovery: true })
    await page.close()
  }
  writeFileSync('docs/public-corpus/evidence/browser.json', JSON.stringify(results, null, 2) + '\n')
} finally { await browser.close() }
