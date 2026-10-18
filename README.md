# Ceramic Test Tile Helper

Open **index.html** directly in a browser. It is a self-contained HTML file with
all JavaScript and the PDF font embedded: no server, installation, or internet
connection is needed. It can also be hosted by any static web host.

Enter a project title, glaze count, footprint width/height in millimetres, and
glaze names. Glaze names start empty and each must contain non-whitespace text.
Generate PDF downloads an A4 landscape document with instructions,
a complete numbered glaze key, and as many grid sheets as necessary. The grid
includes all N × N combinations, including the diagonal. Rows represent the
first glaze and columns the second glaze.

Cells retain their exact requested width and height in PDF coordinates. Page
breaks always fall between whole cells. Row labels are rotated 90 degrees and
appear only on the leftmost sheets. Column labels appear only on the topmost
sheets. Continuation sheets reclaim the space from the omitted labels. Print at
**100% / Actual size**, with A4 landscape selected, and check the 100 mm scale
in the footer of the first instructions page. Grid sheets have no scale check,
print-setting footer, or page-number footer.
Printer scaling affects physical dimensions; the page cannot override it.
For very small cells, labels may be shortened or omitted; the full glaze key is
always included. Supported font coverage is Noto Sans (Latin, Greek, Cyrillic,
and related glyphs), rather than every script or emoji.

The usable grid area on the top-left sheet is 261 × 124 mm, after allowing for
titles, labels, margins, and the scale check. Sheets without row labels gain
12 mm of width; sheets without column labels gain 24 mm of height.
Each dimension must be positive and fit
inside that area. To prevent accidental huge documents, the MVP accepts up to
100 glazes and 400 grid sheets.

Share filled form encodes the values into URL query parameters, including
Unicode and punctuation. The copy button has a selectable-text fallback.
For links other people can open directly, host the same file at a web URL.
Local `file://` links require a recipient's own file and a matching/adjusted path.

## Development

Edit files in `src/`, then rebuild the standalone page:

```sh
python3 scripts/build.py
mise trust
mise exec -- node --test tests/*.test.cjs
```

The pinned Node version is in `mise.toml`. Runtime code has no npm dependencies.
Tests use Node's built-in test runner and execute the bundled browser PDF build.

An optional real-browser check lives in `tests/browser-check.cjs`. With
Playwright and its Chromium browser installed, run:

```sh
mise exec -- node tests/browser-check.cjs
```

Set `PLAYWRIGHT_MODULE` to the package path to use a temporary external install.
It checks the bundled page offline via `file://`, including PDF downloads,
field validation, share links, name retention, and mobile layout. Test PDFs and
screenshots are written to the ignored `test-output/` folder.

Vendor dependencies: jsPDF 4.2.1 (MIT) and Noto Sans Regular (SIL Open Font
License), with licenses included under `vendor/`. The original Noto Sans TTF is
stored as base64 in `vendor/noto-sans.js` so the final page stays offline.
