// Optional integration check: PLAYWRIGHT_MODULE can point to a temporary install.
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

(async () => {
  const root = path.resolve(__dirname, '..');
  const output = path.join(root, 'test-output');
  await fs.mkdir(output, { recursive: true });
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({ viewport: { width: 1200, height: 1100 }, acceptDownloads: true });
    await context.setOffline(true);
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    const href = pathToFileURL(path.join(root, 'index.html')).href;
    await page.goto(href);
    assert.equal(await page.title(), 'Ceramic Test Tile Helper');
    assert.equal(await page.locator('#glaze-fields input').count(), 3);
    assert.equal(await page.locator('#tile-count').textContent(), '3 x 3 = 9 test tiles');
    await page.locator('#generate').click();
    assert.equal(await page.locator('#project-title').getAttribute('aria-invalid'), 'true');
    assert.match(await page.locator('#project-title-error').textContent(), /Enter a project title/);

    await page.locator('#project-title').fill('Émaux & ash #1');
    await page.locator('#glaze-0').fill('Crème + cobalt');
    await page.locator('#glaze-count').fill('5');
    assert.equal(await page.locator('#glaze-fields input').count(), 5);
    assert.equal(await page.locator('#glaze-4').inputValue(), '5');
    assert.equal(await page.locator('#glaze-0').inputValue(), 'Crème + cobalt');
    assert.equal(await page.locator('#tile-count').textContent(), '5 x 5 = 25 test tiles');
    await page.locator('#glaze-4').fill('Keep this name');
    await page.locator('#glaze-count').fill('2');
    await page.locator('#glaze-count').fill('5');
    assert.equal(await page.locator('#glaze-4').inputValue(), 'Keep this name');

    await page.locator('#tile-width').fill('262');
    await page.locator('#tile-height').fill('0');
    await page.locator('#glaze-1').fill('');
    await page.locator('#generate').click();
    for (const selector of ['#tile-width', '#tile-height', '#glaze-1']) assert.equal(await page.locator(selector).getAttribute('aria-invalid'), 'true');
    await page.locator('#tile-width').fill('50.25');
    await page.locator('#tile-height').fill('60.5');
    await page.locator('#glaze-1').fill('Blue & white');

    await page.locator('#share').click();
    const share = await page.locator('#share-url').inputValue();
    assert.ok(share.startsWith('file:///'));
    assert.equal(new URL(share).searchParams.get('glaze'), 'Crème + cobalt');
    // Force the clipboard-denied fallback and ensure the selected URL is available.
    await page.evaluate(() => Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async () => { throw Error('denied'); } } }));
    await page.locator('#share').click();
    assert.match(await page.locator('#form-status').textContent(), /Copy the selected/);
    await page.goto(share);
    assert.equal(await page.locator('#project-title').inputValue(), 'Émaux & ash #1');
    assert.equal(await page.locator('#tile-width').inputValue(), '50.25');
    assert.equal(await page.locator('#glaze-fields input').count(), 5);
    assert.equal(await page.locator('#glaze-4').inputValue(), 'Keep this name');

    const downloadEvent = page.waitForEvent('download');
    await page.locator('#generate').click();
    const download = await downloadEvent;
    await download.saveAs(path.join(output, 'browser-download.pdf'));
    assert.equal(download.suggestedFilename(), 'Émaux-ash-1.pdf');
    await page.waitForFunction(() => document.getElementById('form-status').textContent.includes('PDF generated'));
    assert.match(await page.locator('#form-status').textContent(), /4 pages/);
    assert.ok((await fs.stat(path.join(output, 'browser-download.pdf'))).size > 1000);
    await page.screenshot({ path: path.join(output, 'desktop.png'), fullPage: true });

    await page.setViewportSize({ width: 390, height: 844 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await page.screenshot({ path: path.join(output, 'mobile.png'), fullPage: true });
    await page.goto(`${href}?v=1&title=%3Cscript%3Ealert(1)%3C%2Fscript%3E&count=1&width=50&height=50&glaze=%3Cimg%20src%3Dx%3E`);
    assert.equal(await page.locator('#project-title').inputValue(), '<script>alert(1)</script>');
    assert.equal(await page.locator('#glaze-fields img').count(), 0);
    assert.deepEqual(errors, []);
    console.log('Browser checks passed: offline file://, dynamic fields, inline errors, name retention, share restoration, clipboard fallback, PDF download, and mobile layout.');
  } finally {
    await browser.close();
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
