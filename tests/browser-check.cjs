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
    async function downloadPreview(name) {
      const event = page.waitForEvent('download');
      await page.locator('#preview').click();
      const download = await event;
      const target = path.join(output, name);
      await download.saveAs(target);
      const bytes = await fs.readFile(target);
      assert.equal(bytes.subarray(0,8).toString('hex'), '89504e470d0a1a0a');
      const width=bytes.readUInt32BE(16), height=bytes.readUInt32BE(20);
      assert.ok(width>0 && height>0 && Math.max(width,height)===3200);
      await page.waitForFunction(() => document.getElementById('form-status').textContent.includes('PNG downloaded'));
      assert.equal(await page.locator('#preview').isEnabled(),true);
      assert.equal(await page.locator('#generate').isEnabled(),true);
      return {download,width,height,url:`data:image/png;base64,${bytes.toString('base64')}`};
    }
    async function assertGreyJoin(url,xFraction,yFraction,axis='horizontal') {
      const pixel = await page.evaluate(async ({url,xFraction,yFraction,axis}) => {
        const img = new Image(); img.src=url; await img.decode();
        const canvas=document.createElement('canvas');canvas.width=img.width;canvas.height=img.height;
        const ctx=canvas.getContext('2d');ctx.drawImage(img,0,0);
        return Array.from(ctx.getImageData(Math.floor(img.width*xFraction)+(axis==='vertical'?4:0),Math.floor(img.height*yFraction)+(axis==='horizontal'?4:0),1,1).data);
      },{url,xFraction,yFraction,axis});
      assert.ok(pixel.slice(0,3).every(channel=>Math.abs(channel-128)<=12),String(pixel));
      assert.equal(pixel[3],255);
    }
    async function assertDottedBoundary(url,axis,fraction) {
      const {dark,gaps}=await page.evaluate(async ({url,axis,fraction})=>{
        const img=new Image();img.src=url;await img.decode();
        const canvas=document.createElement('canvas');canvas.width=img.width;canvas.height=img.height;
        const ctx=canvas.getContext('2d');ctx.drawImage(img,0,0);
        const fixed=Math.floor((axis==='vertical'?img.width:img.height)*fraction);
        let dark=0,gaps=0;
        for(let along=100;along<400;along++){
          let brightness=255;
          for(let offset=-1;offset<=1;offset++){
            const x=axis==='vertical'?fixed+offset:along,y=axis==='vertical'?along:fixed+offset;
            const pixel=ctx.getImageData(x,y,1,1).data;
            brightness=Math.min(brightness,(pixel[0]+pixel[1]+pixel[2])/3);
          }
          if(brightness<150)dark++;
          if(brightness>220)gaps++;
        }
        return {dark,gaps};
      },{url,axis,fraction});
      assert.ok(dark>30 && gaps>30,JSON.stringify({dark,gaps}));
    }
    await page.goto(href);
    assert.equal(await page.title(), 'Ceramic Test Tile Helper');
    assert.equal(await page.locator('#margin-horizontal').inputValue(), '12');
    assert.equal(await page.locator('#margin-vertical').inputValue(), '12');
    assert.equal(await page.locator('#swell-cells').isChecked(), false);
    assert.equal(await page.locator('#max-cell-width').isDisabled(), true);
    assert.equal(await page.locator('#max-cell-height').isDisabled(), true);
    assert.equal(await page.locator('#glaze-fields input').count(), 3);
    assert.deepEqual(await page.locator('#glaze-fields input').evaluateAll(inputs => inputs.map(input => input.value)), ['', '', '']);
    assert.equal(await page.locator('#tile-count').textContent(), '3 x 3 = 9 test tiles');
    await page.locator('#generate').click();
    assert.equal(await page.locator('#project-title').getAttribute('aria-invalid'), 'true');
    assert.match(await page.locator('#project-title-error').textContent(), /Enter a project title/);
    assert.equal(await page.locator('#glaze-fields input[aria-invalid=true]').count(), 3);
    await page.locator('#preview').click();
    assert.equal(await page.locator('#project-title').getAttribute('aria-invalid'), 'true');

    await page.locator('#project-title').fill('Émaux & ash #1');
    await page.locator('#glaze-0').fill('Crème + cobalt');
    await page.locator('#glaze-count').fill('5');
    assert.equal(await page.locator('#glaze-fields input').count(), 5);
    assert.equal(await page.locator('#glaze-4').inputValue(), '');
    assert.equal(await page.locator('#glaze-0').inputValue(), 'Crème + cobalt');
    assert.equal(await page.locator('#tile-count').textContent(), '5 x 5 = 25 test tiles');
    await page.locator('#glaze-4').fill('Keep this name');
    await page.locator('#glaze-count').fill('2');
    await page.locator('#glaze-count').fill('5');
    assert.equal(await page.locator('#glaze-4').inputValue(), 'Keep this name');

    await page.locator('#tile-width').fill('0');
    await page.locator('#tile-height').fill('0');
    await page.locator('#glaze-1').fill('');
    await page.locator('#generate').click();
    for (const selector of ['#tile-width', '#tile-height', '#glaze-1']) assert.equal(await page.locator(selector).getAttribute('aria-invalid'), 'true');
    await page.locator('#tile-width').fill('50.25');
    await page.locator('#tile-height').fill('60.5');
    await page.locator('#glaze-1').fill('Blue & white');
    await page.locator('#glaze-2').fill('Clear');
    await page.locator('#glaze-3').fill('Ochre');
    await page.locator('#margin-horizontal').fill('-1');
    await page.locator('#margin-vertical').fill('');
    await page.locator('#generate').click();
    assert.equal(await page.locator('#margin-horizontal').getAttribute('aria-invalid'), 'true');
    assert.equal(await page.locator('#margin-vertical').getAttribute('aria-invalid'), 'true');
    await page.locator('#margin-horizontal').fill('3.5');
    await page.locator('#margin-vertical').fill('4.25');
    const originalSummary = await page.locator('#layout-summary').textContent();
    await page.locator('#swell-cells').check();
    assert.equal(await page.locator('#max-cell-width').isEnabled(), true);
    assert.equal(await page.locator('#max-cell-height').inputValue(), '0');
    assert.match(await page.locator('#layout-summary').textContent(), /expanded/);
    await page.locator('#max-cell-width').fill('40');
    await page.locator('#max-cell-height').fill('-1');
    await page.locator('#generate').click();
    assert.equal(await page.locator('#max-cell-width').getAttribute('aria-invalid'), 'true');
    assert.equal(await page.locator('#max-cell-height').getAttribute('aria-invalid'), 'true');
    await page.locator('#swell-cells').uncheck();
    assert.equal(await page.locator('#max-cell-width').isDisabled(), true);
    assert.equal(await page.locator('#max-cell-width').getAttribute('aria-invalid'), null);
    assert.equal(await page.locator('#layout-summary').textContent(), originalSummary);
    await page.locator('#swell-cells').check();
    await page.locator('#max-cell-width').fill('65.5');
    await page.locator('#max-cell-height').fill('0');

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
    assert.equal(await page.locator('#margin-horizontal').inputValue(), '3.5');
    assert.equal(await page.locator('#margin-vertical').inputValue(), '4.25');
    assert.equal(await page.locator('#swell-cells').isChecked(), true);
    assert.equal(await page.locator('#max-cell-width').inputValue(), '65.5');
    assert.equal(await page.locator('#max-cell-height').inputValue(), '0');
    assert.equal(await page.locator('#max-cell-width').isEnabled(), true);
    assert.equal(await page.locator('#glaze-fields input').count(), 5);
    assert.equal(await page.locator('#glaze-4').inputValue(), 'Keep this name');

    const downloadEvent = page.waitForEvent('download');
    await page.locator('#generate').click();
    const download = await downloadEvent;
    await download.saveAs(path.join(output, 'browser-download.pdf'));
    assert.equal(download.suggestedFilename(), 'Émaux-ash-1.pdf');
    await page.waitForFunction(() => document.getElementById('form-status').textContent.includes('PDF generated'));
    assert.match(await page.locator('#form-status').textContent(), /3 pages/);
    assert.ok((await fs.stat(path.join(output, 'browser-download.pdf'))).size > 1000);
    const assembly=await downloadPreview('assembly.png');
    assert.equal(assembly.download.suggestedFilename(),'Émaux-ash-1-assembly.png');
    assert.ok(Math.abs(assembly.width/assembly.height-290/403)<.001);
    await assertGreyJoin(assembly.url,.5,.5);
    await assertDottedBoundary(assembly.url,'horizontal',.5);
    await page.screenshot({ path: path.join(output, 'desktop.png'), fullPage: true });

    await page.setViewportSize({ width: 390, height: 844 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await page.screenshot({ path: path.join(output, 'mobile.png'), fullPage: true });
    await page.goto(`${href}?v=1&title=%3Cscript%3Ealert(1)%3C%2Fscript%3E&count=1&width=50&height=50&glaze=%3Cimg%20src%3Dx%3E`);
    assert.equal(await page.locator('#project-title').inputValue(), '<script>alert(1)</script>');
    assert.equal(await page.locator('#glaze-fields img').count(), 0);
    assert.equal(await page.locator('#swell-cells').isChecked(), false);
    assert.equal(await page.locator('#max-cell-width').isDisabled(), true);
    assert.equal(await page.locator('#margin-horizontal').inputValue(), '12');
    assert.equal(await page.locator('#margin-vertical').inputValue(), '12');
    await page.goto(`${href}?v=1&title=Spanning%20cell&count=1&width=500&height=300&swell=1&glaze=Ash`);
    assert.match(await page.locator('#layout-summary').textContent(), /534 × 364 mm/);
    assert.match(await page.locator('#layout-summary').textContent(), /2 × 2 = 4 grid sheets/);
    const spanningDownload = page.waitForEvent('download');
    await page.locator('#generate').click();
    await (await spanningDownload).saveAs(path.join(output, 'browser-spanning-cell.pdf'));
    await page.waitForFunction(() => document.getElementById('form-status').textContent.includes('PDF generated'));
    assert.match(await page.locator('#form-status').textContent(), /5 pages/);
    const spanningAssembly=await downloadPreview('spanning-assembly.png');
    assert.equal(spanningAssembly.download.suggestedFilename(),'Spanning-cell-assembly.png');
    assert.ok(Math.abs(spanningAssembly.width/spanningAssembly.height-546/372)<.002);
    await assertGreyJoin(spanningAssembly.url,.5,.25,'vertical');
    await assertGreyJoin(spanningAssembly.url,.25,.5);
    await assertDottedBoundary(spanningAssembly.url,'vertical',.5);
    await assertDottedBoundary(spanningAssembly.url,'horizontal',.5);
    assert.deepEqual(errors, []);
    console.log('Browser checks passed: offline file://, dynamic fields, inline errors, name retention, share restoration, clipboard fallback, PDF download, and mobile layout.');
  } finally {
    await browser.close();
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
