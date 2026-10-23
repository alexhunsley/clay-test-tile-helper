# Ceramic Test Tile Helper

Open **index.html** directly in a browser. It is a self-contained HTML file with
all JavaScript and the PDF font embedded: no server, installation, or internet
connection is needed. It can also be hosted by any static web host.

Enter a project title, glaze count, footprint width/height in millimetres,
horizontal/vertical page margins, glaze step descriptions, and glaze names. Both margins default to
12 mm and apply symmetrically to opposite edges. Zero and fractional margins
are supported; the grid page count updates when margins change. Glaze names
start empty and each must contain non-whitespace text.

**Swell cells to available paper** is off by default. Enable it to treat the
footprint as a minimum and expand cells to fill the existing sheet layout.
Maximum cell width and height are enabled with this option; 0 means no limit.
A positive maximum must be at least the footprint size. Width and height grow
independently, with the same expanded width and height applied to every cell on
every sheet. The entire table is a continuous surface, sliced into paper-sized
rectangles. Cells can cross sheet boundaries in either direction, including a
single cell larger than one sheet. The initial footprint determines the sheets
across/down. Swelling expands every cell to fill that combined paper area;
only a maximum size limit can prevent it from filling an axis. The preview
shows the common expanded dimensions.
Download PDF downloads an A4 landscape document with a checklist and as many
grid sheets as necessary. The grid includes all N × N combinations, including
the diagonal. Columns are glaze step 1 and rows are glaze step 2. Step-description
fields default to "bottom" and "left side", require text, and are saved in
share links (older links get those defaults).
The checklist starts with the print-scale hint, then empty square checkboxes
for waxing feet, placing tiles, glazing each column with its named glaze,
glazing each row with its named glaze, and wiping feet. It wraps onto further
pages when needed. The scale check appears only on the first checklist page.
Every cell has a centered footer in column.row order, followed by the column
glaze name and row glaze name, e.g. `2.3 Glaze A / Glaze B`. Long labels wrap or
shrink to stay inside the cell; very small cells require very small type.

**Download preview image** downloads a PNG of the grid sheets joined in place,
with the page margins removed and matching semicircles touching. It uses the
same table renderer as the PDF, including clipped cells, labels, watermarks and
edge letters. The image's longest side is 3,200 pixels. Dotted lines mark
internal paper edges and bisect matching join
markers in the preview only; the PDF has no dotted seam lines. It is an
overview rather than a print-scale template. It works offline with the bundled
font and requires the same valid form values as PDF generation.

**Tile decoder** opens a modal with two fields for a column.row tile code.
It uses the current setup's glaze names to show "Column glaze below Row glaze."
as you type, checks the code range, and can be closed with Close or Escape.
It only needs a valid glaze count and the selected glaze names.

With swelling off, cells retain their exact requested width and height in PDF
coordinates. Page boundaries can cut through cells, labels and text. Trim the
page margins, then join the table portions to
restore the continuous grid. Every joining edge has a medium-grey semicircle
with a white letter at its midpoint. Match identical letters on adjacent sheets;
each join has its own code (A–Z, then AA, AB, and so on). The flat side sits
exactly on the cut edge; outside edges have no marker.
In the PDF only, pages below the first sheet row have a dashed top cut guide,
and pages after the first sheet column have a dashed left cut guide. Repeated
"CUT HERE" labels sit just above or to the left of those edges, in the waste
margins. The assembly PNG does not include these cut guides or labels.
Internal paper edges do not introduce extra grid
lines. Row labels are rotated 90 degrees and
appear only on the leftmost sheets. Column labels appear only on the topmost
sheets. Continuation sheets reclaim the space from the omitted labels. On grid
pages, the project title is a faint diagonal watermark across the cells; its
angle follows each sheet's grid from bottom left to top right. The instructions
keep the normal title heading. Print at
**100% / Actual size**, with A4 landscape selected, and check the 100 mm scale
in the footer of the first instructions page. Grid sheets have no scale check,
print-setting footer, or page-number footer.
Printer scaling affects physical dimensions; the page cannot override it.
Row and column headers both use 10 pt text, without reducing their font size.
Long names wrap and grow the header bands into the available table area;
the tile cells retain their footprint (or expanded size). Full glaze names are
also included in the checklist. Supported font coverage is Noto Sans (Latin, Greek, Cyrillic,
and related glyphs), rather than every script or emoji.

At the default margins, the usable grid area on the top-left sheet is
261 × 178 mm for short, single-line headers, after allowing for labels and
margins. Column headers start at 8 mm high and grow as needed for readable
10 pt text; the rotated row header band starts at 12 mm wide and also grows.
Header sizing is included in pagination and swelling. The table starts at the
top margin with no sheet heading. Sheets without row labels gain
12 mm of width; sheets without column labels gain 8 mm of height.
Cell dimensions must be positive, and may exceed the size of one sheet.
Horizontal margins are limited
to 95.5 mm so the 100 mm scale fits, and vertical margins to 65 mm to leave
space for headings and grid labels. Instructions wrap onto more pages as needed.
To prevent accidental huge documents, the MVP accepts up to
100 glazes and 400 grid sheets.

Share link to this setup encodes the values into URL query parameters, including
Unicode, punctuation and page margins. Older links use the 12 mm defaults.
The copy button has a selectable-text fallback.
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
