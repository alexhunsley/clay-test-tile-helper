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
const valid = { title: 'Studio tests', count: '6', width: '50', height: '60', names: ['Ash', 'Blue', 'White', 'Green', 'Clear', 'Ochre'] };

test('validation rejects missing fields, fractional counts, non-finite dimensions, oversized cells, and empty names', () => {
  const invalid = [
    [{ title: '' }, 'title'], [{ count: '2.5' }, 'count'], [{ count: '0' }, 'count'],
    [{ count: '101' }, 'count'], [{ width: '' }, 'width'], [{ height: '-2' }, 'height'],
    [{ width: 'Infinity' }, 'width'], [{ width: '261.01' }, 'width'], [{ height: '124.01' }, 'height'],
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
  const expanded = helper.layout(20, 27, 36);
  assert.equal(expanded.columnBands[0].count, 9);
  assert.equal(expanded.columnBands[1].count, 10);
  assert.equal(expanded.rowBands[0].count, 3);
  assert.equal(expanded.rowBands[1].count, 4);
});

test('query links round-trip Unicode, punctuation, names and fractional values', () => {
  const raw = { ...valid, title: 'Émaux & clay? #1 + 2', width: '50.25', names: ['1', '青釉', 'A&B', '<script>alert(1)</script>', 'Crème + ash'] };
  const link = helper.shareUrl(raw, 'https://example.test/helper.html?old=1#old');
  const restored = helper.readUrl(link);
  assert.equal(JSON.stringify(restored), JSON.stringify(raw));
  assert.equal(new URL(link).hash, '');
  assert.equal(new URL(link).searchParams.has('old'), false);
  assert.equal(helper.readUrl('file:///tmp/index.html'), null);
  assert.throws(() => helper.readUrl('https://example.test/?v=2'), /unsupported/);
  assert.equal(helper.readUrl(helper.shareUrl(raw, 'file:///tmp/index.html')).title, raw.title);
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
      const call = { page: doc.getNumberOfPages(), args };
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
  const vertical = drawCalls.filter(({ page, args: [x1,y1,x2,y2] }) => page === 2 && x1 === x2 && y1 === 34 && y2 === 178);
  assert.deepEqual(vertical.map(({ args }) => args[0]), [24, 74, 124, 174, 224, 274]);
  const horizontal = drawCalls.filter(({ page, args: [x1,y1,x2,y2] }) => page === 2 && x1 === 12 && x2 === 274 && y1 === y2);
  assert.deepEqual(horizontal.map(({ args }) => args[1]), [58, 118, 178]);
  assert.equal(labelCalls.filter(call => call.page === 2 && call.args[3]?.angle === 90).length, 2);
  assert.equal(labelCalls.filter(call => call.page === 3 && call.args[3]?.angle === 90).length, 0);
  assert.equal(labelCalls.filter(call => call.page === 3).length, 1); // Top edge continuation: column #6 only.
  assert.equal(labelCalls.filter(call => call.page === 4).length, 2); // Left edge continuation: rows #3 and #4 only.
  assert.equal(labelCalls.filter(call => call.page === 5).length, 0); // Interior sheet: no row/column labels.
  const interiorVertical = drawCalls.filter(({ page, args: [x1,y1,x2,y2] }) => page === 5 && x1 === x2 && y1 === 34 && y2 === 154);
  assert.deepEqual(interiorVertical.map(({ args }) => args[0]), [12, 62]);
  const scales = textCalls.filter(call => call.args[0] === '100 mm scale check');
  assert.equal(scales.length, 1);
  assert.equal(scales[0].page, 1);
  assert.equal(scales[0].args[2], 199);
  assert.ok(drawCalls.some(({page, args: [x1, y1, x2, y2]}) => page === 1 && x1 === 12 && x2 === 112 && y1 === 193 && y2 === 193));
  assert.equal(textCalls.some(call => /^Page \d+ of \d+/.test(call.args[0])), false);
  assert.equal(textCalls.some(call => call.args[0] === 'A4 landscape · Print at 100% / Actual size'), false);
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
