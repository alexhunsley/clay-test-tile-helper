(function (root) {
  "use strict";
  const PAGE = Object.freeze({ width: 297, height: 210, margin: 12, labelWidth: 36, labelHeight: 24, gridX: 48, gridY: 58, gridWidth: 237, gridHeight: 124 });
  const MAX_GLAZES = 100;
  const MAX_GRID_PAGES = 400;

  function layout(count, width, height) {
    // Tolerance covers floating-point arithmetic at exact sheet boundaries only.
    const columnsPerPage = Math.min(count, Math.floor((PAGE.gridWidth + 1e-9) / width));
    const rowsPerPage = Math.min(count, Math.floor((PAGE.gridHeight + 1e-9) / height));
    if (columnsPerPage < 1 || rowsPerPage < 1) return null;
    const across = Math.ceil(count / columnsPerPage);
    const down = Math.ceil(count / rowsPerPage);
    return { columnsPerPage, rowsPerPage, across, down, pages: across * down };
  }

  function validate(raw) {
    const errors = {};
    const title = String(raw.title || "").trim();
    const count = Number(raw.count);
    const width = Number(raw.width);
    const height = Number(raw.height);
    if (!title) errors.title = "Enter a project title.";
    else if (title.length > 160) errors.title = "Use 160 characters or fewer.";
    if (!Number.isInteger(count) || count < 1 || count > MAX_GLAZES) errors.count = `Enter a whole number from 1 to ${MAX_GLAZES}.`;
    for (const [key, value, max] of [["width", width, PAGE.gridWidth], ["height", height, PAGE.gridHeight]]) {
      if (!Number.isFinite(value) || value <= 0) errors[key] = "Enter a size greater than 0 mm.";
      else if (value > max) errors[key] = `Use ${max} mm or less so a whole cell fits on A4 with labels.`;
    }
    const names = Array.from({ length: errors.count ? 0 : count }, (_, i) => String(raw.names?.[i] ?? "").trim());
    names.forEach((name, i) => {
      if (!name) errors[`name-${i}`] = `Enter a name for glaze #${i + 1}.`;
      else if (name.length > 100) errors[`name-${i}`] = "Use 100 characters or fewer.";
    });
    if (!errors.count && !errors.width && !errors.height) {
      const plan = layout(count, width, height);
      if (plan.pages > MAX_GRID_PAGES) errors.count = `This needs ${plan.pages.toLocaleString()} grid sheets. Reduce the glaze count or footprint to use at most ${MAX_GRID_PAGES}.`;
    }
    return { errors, data: { title, count, width, height, names } };
  }

  function shareUrl(raw, href) {
    const url = new URL(href);
    url.search = "";
    url.hash = "";
    url.searchParams.set("v", "1");
    for (const key of ["title", "count", "width", "height"]) url.searchParams.set(key, String(raw[key]));
    for (const name of raw.names) url.searchParams.append("glaze", name);
    return url.href;
  }

  function readUrl(href) {
    const params = new URL(href).searchParams;
    if (!params.has("v")) return null;
    if (params.get("v") !== "1") throw new Error("This link uses an unsupported form version.");
    return { title: params.get("title") ?? "", count: params.get("count") ?? "", width: params.get("width") ?? "", height: params.get("height") ?? "", names: params.getAll("glaze") };
  }

  function createPdf(data, JsPDF) {
    const doc = new JsPDF({ orientation: "landscape", unit: "mm", format: [PAGE.width, PAGE.height], precision: 6, compress: true });
    if (root.CERAMIC_FONT) {
      doc.addFileToVFS("NotoSans-Regular.ttf", root.CERAMIC_FONT);
      doc.addFont("NotoSans-Regular.ttf", "NotoSans", "normal");
      doc.setFont("NotoSans", "normal");
    }
    doc.setProperties({ title: data.title, subject: "Ceramic test tile glaze combinations", creator: "Ceramic Test Tile Helper" });
    const plan = layout(data.count, data.width, data.height);
    const ink = [45, 55, 47];
    const muted = [90, 100, 91];
    const labelFill = [243, 244, 238];
    const text = (value, x, y, size = 10, options = {}) => {
      doc.setTextColor(...ink);
      doc.setFontSize(size);
      doc.text(String(value), x, y, options);
    };

    function fitted(value, x, y, width, height, maxSize = 10) {
      // All label text remains inside the reserved label box. Full names are in the key.
      let lines, size = maxSize;
      const padding = Math.min(2, height / 5, width / 5);
      const innerWidth = Math.max(.05, width - padding * 2);
      const innerHeight = Math.max(.05, height - padding * 2);
      for (; size >= 5; size -= .5) {
        doc.setFontSize(size);
        lines = doc.splitTextToSize(value, innerWidth);
        if (lines.length * size * .352778 * 1.15 <= innerHeight) break;
      }
      size = Math.max(5, size);
      // Avoid overflowing even for footprints too small to hold readable text.
      if (innerWidth < size * .352778 || innerHeight < size * .352778 * 1.15) return;
      doc.setFontSize(size);
      lines = doc.splitTextToSize(value, innerWidth);
      const maxLines = Math.max(1, Math.floor(innerHeight / (size * .352778 * 1.15)));
      if (lines.length > maxLines) {
        lines = lines.slice(0, maxLines);
        let last = lines[maxLines - 1];
        while (last.length && doc.getTextWidth(last + "…") > innerWidth) last = last.slice(0, -1);
        lines[maxLines - 1] = last + "…";
      }
      text(lines.join("\n"), x + padding, y + padding + size * .352778, size, { lineHeightFactor: 1.15 });
    }

    function pageHeading(subtitle) {
      fitted(data.title, 12, 8, 273, 14, 17);
      text(subtitle, 12, 29, 9);
    }

    pageHeading("Ceramic Test Tile Helper / Instructions & glaze key");
    const instructions = [
      `Prepare ${data.count * data.count} test tiles: ${data.count} row glazes × ${data.count} column glazes.`,
      `Each grid cell is ${data.width} × ${data.height} mm. The grid spans ${plan.pages} A4 landscape sheet${plan.pages === 1 ? "" : "s"} (${plan.across} across × ${plan.down} down).`,
      "Print on A4 at 100% / Actual size. Turn off Fit to page. Measure the 100 mm scale on a grid sheet before using it.",
      "Use the row glaze first and the column glaze second. The diagonal pairs a glaze with itself. Keep your application method consistent.",
      "Place each tile in its labelled cell to keep combinations organised. Record the glaze pair on the tile before moving it.",
      "Every sheet repeats its row and column labels. Long labels may be shortened; use the full glaze key below. Very small footprints may leave no room for readable grid labels."
    ];
    let y = 42;
    doc.setFontSize(10);
    for (const paragraph of instructions) {
      const lines = doc.splitTextToSize(paragraph, 267);
      text(lines.join("\n"), 15, y, 10, { lineHeightFactor: 1.4 });
      y += lines.length * 4.94 + 4;
    }
    y += 5;
    text("Glaze key", 12, y, 13);
    y += 10;
    data.names.forEach((name, i) => {
      doc.setFontSize(10);
      const lines = doc.splitTextToSize(`#${i + 1}  ${name}`, 267);
      const needed = lines.length * 4.6 + 3;
      if (y + needed > 187) {
        doc.addPage();
        pageHeading("Ceramic Test Tile Helper / Glaze key continued");
        y = 43;
      }
      text(lines.join("\n"), 15, y, 10, { lineHeightFactor: 1.3 });
      y += needed;
    });
    const instructionPages = doc.getNumberOfPages();

    for (let sheetRow = 0; sheetRow < plan.down; sheetRow++) {
      for (let sheetColumn = 0; sheetColumn < plan.across; sheetColumn++) {
        doc.addPage();
        const rowStart = sheetRow * plan.rowsPerPage;
        const columnStart = sheetColumn * plan.columnsPerPage;
        const rows = Math.min(plan.rowsPerPage, data.count - rowStart);
        const columns = Math.min(plan.columnsPerPage, data.count - columnStart);
        const gridWidth = columns * data.width;
        const gridHeight = rows * data.height;
        pageHeading(`Grid / sheet row ${sheetRow + 1} of ${plan.down}, column ${sheetColumn + 1} of ${plan.across} / cells ${data.width} × ${data.height} mm`);

        doc.setFillColor(...labelFill);
        doc.rect(PAGE.margin, 34, PAGE.labelWidth + gridWidth, PAGE.labelHeight, "F");
        doc.rect(PAGE.margin, PAGE.gridY, PAGE.labelWidth, gridHeight, "F");
        fitted("ROW: first glaze\nCOLUMN: second glaze", PAGE.margin, 34, PAGE.labelWidth, PAGE.labelHeight, 8);
        for (let col = 0; col < columns; col++) {
          const index = columnStart + col;
          fitted(`#${index + 1}  ${data.names[index]}`, PAGE.gridX + col * data.width, 34, data.width, PAGE.labelHeight);
        }
        for (let row = 0; row < rows; row++) {
          const index = rowStart + row;
          fitted(`#${index + 1}  ${data.names[index]}`, PAGE.margin, PAGE.gridY + row * data.height, PAGE.labelWidth, data.height);
        }
        doc.setDrawColor(115, 124, 112);
        doc.setLineWidth(.2);
        doc.rect(PAGE.margin, 34, PAGE.labelWidth + gridWidth, PAGE.labelHeight + gridHeight);
        for (let col = 0; col <= columns; col++) {
          const x = PAGE.gridX + col * data.width;
          doc.line(x, 34, x, PAGE.gridY + gridHeight);
        }
        for (let row = 0; row <= rows; row++) {
          const lineY = PAGE.gridY + row * data.height;
          doc.line(PAGE.margin, lineY, PAGE.gridX + gridWidth, lineY);
        }
        doc.setDrawColor(...muted);
        doc.line(12, 193, 112, 193);
        doc.line(12, 191.5, 12, 194.5);
        doc.line(112, 191.5, 112, 194.5);
        text("100 mm scale check", 12, 199, 8);
        text("A4 landscape · Print at 100% / Actual size", 285, 196, 8, { align: "right" });
      }
    }
    const total = doc.getNumberOfPages();
    for (let i = 1; i <= total; i++) {
      doc.setPage(i);
      text(`Page ${i} of ${total}${i <= instructionPages ? " / Instructions & glaze key" : ""}`, 285, 204, 7, { align: "right" });
    }
    return doc;
  }

  root.TileHelper = { PAGE, MAX_GLAZES, MAX_GRID_PAGES, layout, validate, shareUrl, readUrl, createPdf };
})(globalThis);
