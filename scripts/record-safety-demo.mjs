// Optional development recorder. No sibling repo is required by the runtime.
// Point PLAYWRIGHT_MODULE at an installed Playwright ES module if needed.
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright')
const root = fileURLToPath(new URL('..', import.meta.url))
const evidence = path.resolve(process.argv[2] || 'docs/media/recording')
mkdirSync(evidence, { recursive: true })
const browser = await chromium.launch({ headless: true })
const checks = []
try {
  for (const [width, height] of [[1440, 900], [430, 932], [390, 844]]) {
    const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 })
    await page.goto(pathToFileURL(path.join(root, 'docs/media/safety-demo.html')).href)
    await page.keyboard.press('Tab')
    const focused = await page.locator('#next').evaluate(el => el === document.activeElement)
    const target = await page.locator('#next').boundingBox()
    if (!focused || target.height < 44 || target.width < 44) throw new Error('Keyboard or target-size check failed')
    for (let i = 0; i < 4; i++) {
      if (await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)) throw new Error('Horizontal overflow')
      await page.screenshot({ path: path.join(evidence, `${width}-step-${i}.png`), fullPage: true })
      await page.keyboard.press('Enter')
    }
    if (!(await page.locator('#label').textContent()).includes('Private')) throw new Error('Keyboard replay did not cycle')
    checks.push({ width, height, focused, target, checkedSteps: 4, horizontalOverflow: false })
    await page.close()
  }
  writeFileSync(path.join(evidence, 'visual-checks.json'), JSON.stringify(checks, null, 2) + '\n')
} finally { await browser.close() }
