const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const browser = { console, atob, btoa, Blob, URL, TextEncoder, TextDecoder, setTimeout, clearTimeout, navigator: { userAgent: 'test' } };
browser.window = browser;
browser.self = browser;
vm.createContext(browser);
for (const file of ['vendor/jspdf.umd.min.js', 'vendor/noto-sans.js', 'src/core.js']) {
  vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), browser, { filename: file });
}
const helper = browser.TileHelper;
const valid = { title: 'Studio tests', count: '6', width: '50', height: '60', marginH: '12', marginV: '12', swell: false, maxWidth: '0', maxHeight: '0', names: ['Ash', 'Blue', 'White', 'Green', 'Clear', 'Ochre'] };

test('validation rejects missing fields, fractional counts, non-finite dimensions, oversized cells, and empty names', () => {
  const invalid = [
    [{ title: '' }, 'title'], [{ count: '2.5' }, 'count'], [{ count: '0' }, 'count'],
    [{ count: '101' }, 'count'], [{ width: '' }, 'width'], [{ height: '-2' }, 'height'],
    [{ width: 'Infinity' }, 'width'], [{ width: '261.01' }, 'width'], [{ height: '154.01' }, 'height'],
    [{ marginH: '' }, 'marginH'], [{ marginV: '-1' }, 'marginV'], [{ marginH: 'Infinity' }, 'marginH'],
    [{ marginH: '96' }, 'marginH'], [{ marginV: '66' }, 'marginV'],
    [{ names: ['', 'Blue', 'White', 'Green', 'Clear'] }, 'name-0']
  ];
  for (const [changes, key] of invalid) assert.ok(helper.validate({ ...valid, ...changes }).errors[key], key);
  assert.equal(Object.keys(helper.validate(valid).errors).length, 0);
  assert.equal(Object.keys(helper.validate({ ...valid, width: '.5', height: '1.25' }).errors).length, 0);
  assert.ok(helper.validate({ ...valid, count: 100, width: 237, height: 124 }).errors.count);
});

test('pagination covers every cell exactly once without splitting cells, including fractional exact fits', () => {
  for (const [count, width, height] of [[1, 237, 124], [5, 50, 60], [13, 47.4, 31], [100, .1, .2], [7, 118.5, 62]]) {
    const plan = helper.layout(count, width, height);
    plan.columnBands.forEach((band, i) => assert.ok(band.count * width <= (i ? helper.PAGE.continuationWidth : helper.PAGE.gridWidth) + 1e-8));
    plan.rowBands.forEach((band, i) => assert.ok(band.count * height <= (i ? helper.PAGE.continuationHeight : helper.PAGE.gridHeight) + 1e-8));
    const cells = new Set();
    for (let sy = 0; sy < plan.down; sy++) for (let sx = 0; sx < plan.across; sx++) {
      const rb = plan.rowBands[sy], cb = plan.columnBands[sx];
      for (let r = rb.start; r < rb.start + rb.count; r++) {
        for (let c = cb.start; c < cb.start + cb.count; c++) {
          assert.ok(!cells.has(`${r},${c}`));
          cells.add(`${r},${c}`);
        }
      }
    }
    assert.equal(cells.size, count * count);
  }
  const plan = helper.layout(5, 50, 60);
  assert.equal(plan.pages, 3);
  assert.equal(plan.across, 1);
  assert.equal(plan.down, 3);
  assert.equal(helper.layout(13, 47.4, 31).columnsPerPage, 5);
  const expanded = helper.layout(20, 27, 40);
  assert.equal(expanded.columnBands[0].count, 9);
  assert.equal(expanded.columnBands[1].count, 10);
  assert.equal(expanded.rowBands[0].count, 3);
  assert.equal(expanded.rowBands[1].count, 4);
});

test('query links round-trip Unicode, punctuation, names and fractional values', () => {
  const raw = { ...valid, title: 'Émaux & clay? #1 + 2', width: '50.25', names: ['1', '青釉', 'A&B', '<script>alert(1)</script>', 'Crème + ash'] };
  const link = helper.shareUrl(raw, 'https://example.test/helper.html?old=1#old');
  const restored = helper.readUrl(link);
  assert.deepEqual(JSON.parse(JSON.stringify(restored)), raw);
  assert.equal(new URL(link).hash, '');
  assert.equal(new URL(link).searchParams.has('old'), false);
  assert.equal(helper.readUrl('file:///tmp/index.html'), null);
  assert.throws(() => helper.readUrl('https://example.test/?v=2'), /unsupported/);
  assert.equal(helper.readUrl(helper.shareUrl(raw, 'file:///tmp/index.html')).title, raw.title);
  const oldLink = helper.readUrl('https://example.test/?v=1&title=Old&count=1&width=50&height=50&glaze=Ash');
  assert.equal(oldLink.marginH, '12');
  assert.equal(oldLink.marginV, '12');
  assert.equal(oldLink.swell, false);
  assert.equal(oldLink.maxWidth, '0');
});

test('swelling fills every band independently, keeps pagination and respects independent size limits', () => {
  for (const [count, width, height, marginH, marginV] of [[6,50,60,12,12], [11,33.5,47.25,3.5,4.25], [1,50,60,0,0], [100,5,5,12,12]]) {
    const original = helper.layout(count, width, height, marginH, marginV);
    for (const [maxWidth, maxHeight] of [[0,0], [width + 3,0], [0,height + 10], [width,height], [width + 7,height + 2]]) {
      const plan = helper.layout(count, width, height, marginH, marginV, { swell: true, maxWidth, maxHeight });
      assert.equal(plan.pages, original.pages);
      for (const [bands, baseBands, minSize, maxSize, firstSpace, laterSpace] of [
        [plan.columnBands, original.columnBands, width, maxWidth, plan.area.gridWidth, plan.area.continuationWidth],
        [plan.rowBands, original.rowBands, height, maxHeight, plan.area.gridHeight, plan.area.continuationHeight]
      ]) {
        bands.forEach((band, i) => {
          const available = i === 0 ? firstSpace : laterSpace;
          assert.equal(band.start, baseBands[i].start);
          assert.equal(band.count, baseBands[i].count);
          assert.ok(band.cellSize >= minSize);
          assert.ok(band.cellSize * band.count <= available + 1e-8);
          if (maxSize > 0) assert.ok(band.cellSize <= maxSize + 1e-8);
          assert.ok(Math.abs(band.cellSize - Math.min(available / band.count, maxSize || Infinity)) < 1e-8);
        });
      }
    }
  }
  const raw = { ...valid, swell: true, maxWidth: '70.25', maxHeight: '0' };
  assert.deepEqual(JSON.parse(JSON.stringify(helper.readUrl(helper.shareUrl(raw, 'https://example.test/')))), raw);
  for (const [changes, error] of [[{maxWidth:'49'},'maxWidth'], [{maxHeight:'59'},'maxHeight'], [{maxWidth:'-1'},'maxWidth'], [{maxHeight:''},'maxHeight'], [{maxWidth:'Infinity'},'maxWidth']]) {
    assert.ok(helper.validate({ ...raw, ...changes }).errors[error]);
    assert.equal(helper.validate({ ...raw, ...changes, swell: false }).errors[error], undefined);
  }
  const data = helper.validate({ ...valid, swell: true }).data;
  const rects = [], textCalls = [];
  function TrackedPDF(options) {
    const doc = new browser.jspdf.jsPDF(options);
    for (const [method, list] of [['rect', rects], ['text', textCalls]]) {
      const original = doc[method].bind(doc);
      doc[method] = (...args) => { list.push({page: doc.getNumberOfPages(), args}); return original(...args); };
    }
    return doc;
  }
  const pdf = helper.createPdf(data, TrackedPDF);
  assert.equal(pdf.getNumberOfPages(), 7);
  // The final interior sheet fills both axes, despite containing only one column.
  assert.ok(rects.some(({page,args:[x,y,w,h]}) => page === 7 && x === 12 && y === 20 && w === 273 && h === 178));
  assert.ok(textCalls.some(({page,args}) => page === 7 && String(args[0]).includes('cells 273 × 89 mm')));
  fs.writeFileSync(path.join(root, 'test-output/swelled.pdf'), Buffer.from(pdf.output('arraybuffer')));
});

test('real PDF has A4 pages, expected pagination, embedded font, and exact mm grid spacing', () => {
  const data = helper.validate(valid).data;
  const drawCalls = [];
  const labelCalls = [];
  const textCalls = [];
  function TrackedPDF(options) {
    const doc = new browser.jspdf.jsPDF({ ...options, compress: false });
    const line = doc.line.bind(doc);
    doc.line = (...args) => { drawCalls.push({ page: doc.getNumberOfPages(), args }); return line(...args); };
    const text = doc.text.bind(doc);
    doc.text = (...args) => {
      const call = { page: doc.getNumberOfPages(), args, color: doc.getTextColor(), size: doc.getFontSize() };
      textCalls.push(call);
      if (String(args[0]).startsWith('#')) labelCalls.push(call);
      return text(...args);
    };
    return doc;
  }
  const pdf = helper.createPdf(data, TrackedPDF);
  assert.equal(pdf.getNumberOfPages(), 7); // One instructions/key page plus six grid sheets.
  assert.ok(Math.abs(pdf.internal.pageSize.getWidth() - 297) < .001);
  assert.ok(Math.abs(pdf.internal.pageSize.getHeight() - 210) < .001);
  const vertical = drawCalls.filter(({ page, args: [x1,y1,x2,y2] }) => page === 2 && x1 === x2 && y1 === 20 && y2 === 164);
  assert.deepEqual(vertical.map(({ args }) => args[0]), [24, 74, 124, 174, 224, 274]);
  const horizontal = drawCalls.filter(({ page, args: [x1,y1,x2,y2] }) => page === 2 && x1 === 12 && x2 === 274 && y1 === y2);
  assert.deepEqual(horizontal.map(({ args }) => args[1]), [44, 104, 164]);
  assert.equal(labelCalls.filter(call => call.page === 2 && call.args[3]?.angle === 90).length, 2);
  assert.equal(labelCalls.filter(call => call.page === 3 && call.args[3]?.angle === 90).length, 0);
  assert.equal(labelCalls.filter(call => call.page === 3).length, 1); // Top edge continuation: column #6 only.
  assert.equal(labelCalls.filter(call => call.page === 4).length, 2); // Left edge continuation: rows #3 and #4 only.
  assert.equal(labelCalls.filter(call => call.page === 5).length, 0); // Interior sheet: no row/column labels.
  const interiorVertical = drawCalls.filter(({ page, args: [x1,y1,x2,y2] }) => page === 5 && x1 === x2 && y1 === 20 && y2 === 140);
  assert.deepEqual(interiorVertical.map(({ args }) => args[0]), [12, 62]);
  const scales = textCalls.filter(call => call.args[0] === '100 mm scale check');
  assert.equal(scales.length, 1);
  assert.equal(scales[0].page, 1);
  assert.equal(scales[0].args[2], 197);
  assert.ok(drawCalls.some(({page, args: [x1, y1, x2, y2]}) => page === 1 && x1 === 12 && x2 === 112 && y1 === 191 && y2 === 191));
  assert.equal(textCalls.some(call => /^Page \d+ of \d+/.test(call.args[0])), false);
  assert.equal(textCalls.some(call => call.args[0] === 'A4 landscape · Print at 100% / Actual size'), false);
  for (let page = 2; page <= pdf.getNumberOfPages(); page++) {
    const titles = textCalls.filter(call => call.page === page && call.args[0] === data.title);
    assert.equal(titles.length, 1);
    const title = titles[0];
    const band = planBand(page);
    const expectedAngle = Math.atan2(band.height, band.width) * 180 / Math.PI;
    assert.ok(Math.abs(title.args[3].angle - expectedAngle) < 1e-8);
    const channels = title.color.match(/[a-f0-9]{2}/g).map(channel => parseInt(channel, 16));
    assert.ok(channels.every(channel => channel >= 225 && channel <= 240));
    assert.ok(title.size > 17);
  }
  function planBand(page) {
    const plan = helper.layout(data.count, data.width, data.height);
    const i = page - 2;
    return { width: plan.columnBands[i % plan.across].count * data.width, height: plan.rowBands[Math.floor(i / plan.across)].count * data.height };
  }
  const instructionTitle = textCalls.find(call => call.page === 1 && call.args[0] === data.title);
  assert.equal(instructionTitle.args[3].angle, undefined);
  const output = pdf.output();
  assert.ok(output.startsWith('%PDF-'));
  assert.ok(output.includes('/FontFile2'));
  // Check actual PDF point coordinates, beyond the drawing API call arguments.
  const pointX = (24 * 72 / 25.4).toFixed(6).replace(/0+$/, '');
  assert.ok(output.includes(pointX));
  fs.mkdirSync(path.join(root, 'test-output'), { recursive: true });
  fs.writeFileSync(path.join(root, 'test-output/sample.pdf'), Buffer.from(pdf.output('arraybuffer')));
});

test('long names wrap through additional key pages and still generate all grid sheets', () => {
  const names = Array.from({ length: 25 }, (_, i) => `Glaze ${i + 1}: ${'very long glaze name '.repeat(4)}`.slice(0, 100));
  const data = helper.validate({ title: 'Long labels', count: 25, width: 20.5, height: 25.25, names }).data;
  const pdf = helper.createPdf(data, browser.jspdf.jsPDF);
  assert.ok(pdf.getNumberOfPages() > helper.layout(25, 20.5, 25.25).pages + 1);
});

test('custom margins reclaim space, preserve cell sizes, constrain PDF content and round-trip in links', () => {
  assert.equal(helper.layout(5, 54.5, 62, 12, 12).pages, 6);
  assert.equal(helper.layout(5, 54.5, 62, 5, 5).pages, 2);
  const raw = { ...valid, marginH: '3.5', marginV: '4.25' };
  assert.deepEqual(JSON.parse(JSON.stringify(helper.readUrl(helper.shareUrl(raw, 'file:///tmp/index.html')))), raw);
  assert.ok(helper.validate({ ...valid, width: 270 }).errors.width);
  assert.equal(helper.validate({ ...valid, width: 270, marginH: 5 }).errors.width, undefined);
  for (const [marginH, marginV] of [[0, 0], [3.5, 4.25], [20, 20], [95.5, 65]]) {
    const data = helper.validate({ ...valid, count: 2, width: 20, height: 25, marginH, marginV, names: ['Ash', 'Blue'] }).data;
    const rectangles = [], lines = [], captions = [];
    function TrackedPDF(options) {
      const doc = new browser.jspdf.jsPDF(options);
      for (const [method, list] of [['rect', rectangles], ['line', lines], ['text', captions]]) {
        const original = doc[method].bind(doc);
        doc[method] = (...args) => { list.push({ page: doc.getNumberOfPages(), args }); return original(...args); };
      }
      return doc;
    }
    const pdf = helper.createPdf(data, TrackedPDF);
    assert.ok(pdf.getNumberOfPages() >= 2);
    for (const { args: [x, y, w, h] } of rectangles) {
      assert.ok(x >= marginH && y >= marginV);
      assert.ok(x + w <= 297 - marginH + 1e-8);
      assert.ok(y + h <= 210 - marginV + 1e-8);
    }
    assert.ok(lines.some(({page, args: [x1, y1, x2, y2]}) => page === 1 && x1 === marginH && x2 - x1 === 100 && y1 === y2));
    assert.equal(captions.filter(call => call.args[0] === '100 mm scale check').length, 1);
    assert.ok(captions.every(({args}) => args[2] >= marginV && args[2] <= 210 - marginV));
    // The grid's two cells stay 20 mm wide and 25 mm high at every margin setting.
    const firstRows = helper.layout(2, 20, 25, marginH, marginV).rowsPerPage;
    assert.ok(rectangles.some(({args: [x, y, w, h]}) => x === marginH && y === marginV + 8 && w === 52 && h === 24 + firstRows * 25));
    if (marginH === 95.5) fs.writeFileSync(path.join(root, 'test-output/large-margins.pdf'), Buffer.from(pdf.output('arraybuffer')));
  }
});
