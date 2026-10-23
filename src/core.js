(function (root) {
  "use strict";
  const PAGE = Object.freeze({ width: 297, height: 210, margin: 12, labelWidth: 12, labelHeight: 8, gridX: 24, gridY: 20, gridWidth: 261, gridHeight: 178, continuationWidth: 273, continuationHeight: 186 });
  const MAX_GLAZES = 100;
  const MAX_GRID_PAGES = 400;
  const HEADER_FONT_SIZE = 10;
  const HEADER_LINE_HEIGHT = HEADER_FONT_SIZE * (25.4 / 72) * 1.15;
  let headerMetrics;
  let headerCache;

  function metricsForHeaders() {
    if (!headerMetrics) {
      headerMetrics = new root.jspdf.jsPDF();
      headerMetrics.setFont("helvetica", "normal");
      headerMetrics.setFontSize(HEADER_FONT_SIZE);
    }
    return headerMetrics;
  }

  function headerText(metrics, value, length) {
    const padding = Math.min(2, length * .1);
    const wrapWidth = Math.max(metrics.getTextWidth("W"), length - padding * 2);
    return { padding, lines: metrics.splitTextToSize(value, wrapWidth) };
  }

  function headerDimensions(count, width, height, names) {
    if (!names) return { labelWidth: PAGE.labelWidth, labelHeight: PAGE.labelHeight };
    const labels = Array.from({ length: count }, (_, i) => `#${i + 1}  ${String(names[i] ?? "").slice(0, 100)}`);
    const key = JSON.stringify([width, height, labels]);
    if (headerCache?.key === key) return headerCache.value;
    const metrics = metricsForHeaders();
    let labelWidth = PAGE.labelWidth, labelHeight = PAGE.labelHeight;
    for (const label of labels) {
      const column = headerText(metrics, label, width);
      const row = headerText(metrics, label, height);
      const textHeight = lines => HEADER_FONT_SIZE * (25.4 / 72) + (lines.length - 1) * HEADER_LINE_HEIGHT;
      labelHeight = Math.max(labelHeight, column.padding * 2 + textHeight(column.lines));
      labelWidth = Math.max(labelWidth, row.padding * 2 + textHeight(row.lines));
    }
    const value = { labelWidth, labelHeight };
    headerCache = { key, value };
    return value;
  }

  function geometry(marginH = PAGE.margin, marginV = PAGE.margin, labels = PAGE) {
    const contentWidth = PAGE.width - 2 * marginH;
    const gridTop = marginV;
    const bottom = PAGE.height - marginV;
    return { marginH, marginV, contentWidth, gridTop, bottom, labelWidth: labels.labelWidth, labelHeight: labels.labelHeight, gridWidth: contentWidth - labels.labelWidth, gridHeight: bottom - gridTop - labels.labelHeight, continuationWidth: contentWidth, continuationHeight: bottom - gridTop };
  }

  function layout(count, width, height, marginH = PAGE.margin, marginV = PAGE.margin, options = {}) {
    let labels = headerDimensions(count, width, height, options.names);
    let area = geometry(marginH, marginV, labels);
    // The labelled table is one continuous surface. Sheets are rectangular
    // windows onto it, and may cut through cells, text and grid lines.
    const across = Math.max(1, Math.ceil((area.labelWidth + count * width - 1e-9) / area.contentWidth));
    const down = Math.max(1, Math.ceil((area.labelHeight + count * height - 1e-9) / area.continuationHeight));
    const expand = (minimum, available, limit) => options.swell
      ? Math.max(minimum, Math.min(available / count, limit > 0 ? limit : Infinity)) : minimum;
    let cellWidth = width, cellHeight = height;
    for (let i = 0; i < 256; i++) {
      cellWidth = expand(width, across * area.contentWidth - area.labelWidth, options.maxWidth);
      cellHeight = expand(height, down * area.continuationHeight - area.labelHeight, options.maxHeight);
      if (!options.swell) break;
      labels = headerDimensions(count, cellWidth, cellHeight, options.names);
      if (labels.labelWidth === area.labelWidth && labels.labelHeight === area.labelHeight) break;
      area = geometry(marginH, marginV, labels);
    }
    const tableWidth = area.labelWidth + count * cellWidth;
    const tableHeight = area.labelHeight + count * cellHeight;
    const pages = across * down;
    function slices(sheets, span, total, labelSize, cellSize) {
      if (!Number.isFinite(pages) || pages > MAX_GRID_PAGES) return [];
      return Array.from({ length: sheets }, (_, i) => {
        const offset = i * span;
        const extent = Math.min(span, Math.max(0, total - offset));
        const start = Math.max(0, Math.min(count, Math.floor((offset - labelSize) / cellSize)));
        const end = Math.max(start, Math.min(count, Math.ceil((offset + extent - labelSize - 1e-9) / cellSize)));
        return { offset, extent, start, count: end - start, cellSize };
      });
    }
    const columnBands = slices(across, area.contentWidth, tableWidth, area.labelWidth, cellWidth);
    const rowBands = slices(down, area.continuationHeight, tableHeight, area.labelHeight, cellHeight);
    return { columnBands, rowBands, across, down, pages, cellWidth, cellHeight, tableWidth, tableHeight, area };
  }

  function validate(raw) {
    const errors = {};
    const title = String(raw.title || "").trim();
    const count = Number(raw.count);
    const width = Number(raw.width);
    const height = Number(raw.height);
    const marginH = Number(raw.marginH ?? PAGE.margin);
    const marginV = Number(raw.marginV ?? PAGE.margin);
    const swell = raw.swell === true;
    const maxWidth = Number(raw.maxWidth ?? 0);
    const maxHeight = Number(raw.maxHeight ?? 0);
    const step1Desc = String(raw.step1Desc ?? "bottom").trim();
    const step2Desc = String(raw.step2Desc ?? "left side").trim();
    for (const [key, value, step] of [["step1Desc", step1Desc, 1], ["step2Desc", step2Desc, 2]]) {
      if (!value) errors[key] = `Enter a description for glaze step ${step}.`;
      else if (value.length > 100) errors[key] = "Use 100 characters or fewer.";
    }
    if (swell) {
      for (const [key, value, minimum] of [["maxWidth", maxWidth, width], ["maxHeight", maxHeight, height]]) {
        if (String(raw[key] ?? 0).trim() === "" || !Number.isFinite(value) || value < 0) errors[key] = "Enter 0 for no limit, or a positive size in mm.";
        else if (value > 0 && value < minimum) errors[key] = "The maximum must be at least the footprint size, or 0 for no limit.";
      }
    }
    for (const [key, value, max] of [["marginH", marginH, 95.5], ["marginV", marginV, 65]]) {
      if (String(raw[key] ?? PAGE.margin).trim() === "" || !Number.isFinite(value) || value < 0 || value > max) {
        errors[key] = `Enter a margin from 0 to ${max} mm, leaving room for the instructions, scale and grid labels.`;
      }
    }
    if (!title) errors.title = "Enter a project title.";
    else if (title.length > 160) errors.title = "Use 160 characters or fewer.";
    if (!Number.isInteger(count) || count < 1 || count > MAX_GLAZES) errors.count = `Enter a whole number from 1 to ${MAX_GLAZES}.`;
    for (const [key, value] of [["width", width], ["height", height]]) {
      if (!Number.isFinite(value) || value <= 0) errors[key] = "Enter a size greater than 0 mm.";
    }
    const names = Array.from({ length: errors.count ? 0 : count }, (_, i) => String(raw.names?.[i] ?? "").trim());
    names.forEach((name, i) => {
      if (!name) errors[`name-${i}`] = `Enter a name for glaze #${i + 1}.`;
      else if (name.length > 100) errors[`name-${i}`] = "Use 100 characters or fewer.";
    });
    if (!errors.count && !errors.width && !errors.height && !errors.marginH && !errors.marginV) {
      const plan = layout(count, width, height, marginH, marginV, { names });
      if (plan.pages > MAX_GRID_PAGES) errors.count = `This needs ${plan.pages.toLocaleString()} grid sheets. Reduce the glaze count or footprint to use at most ${MAX_GRID_PAGES}.`;
    }
    return { errors, data: { title, count, width, height, marginH, marginV, swell, maxWidth, maxHeight, step1Desc, step2Desc, names } };
  }

  function shareUrl(raw, href) {
    const url = new URL(href);
    url.search = "";
    url.hash = "";
    url.searchParams.set("v", "1");
    for (const key of ["title", "count", "width", "height", "marginH", "marginV"]) url.searchParams.set(key, String(raw[key] ?? PAGE.margin));
    url.searchParams.set("swell", raw.swell === true ? "1" : "0");
    for (const key of ["maxWidth", "maxHeight"]) url.searchParams.set(key, String(raw[key] ?? 0));
    url.searchParams.set("step1Desc", String(raw.step1Desc ?? "bottom"));
    url.searchParams.set("step2Desc", String(raw.step2Desc ?? "left side"));
    for (const name of raw.names) url.searchParams.append("glaze", name);
    return url.href;
  }

  function readUrl(href) {
    const params = new URL(href).searchParams;
    if (!params.has("v")) return null;
    if (params.get("v") !== "1") throw new Error("This link uses an unsupported form version.");
    return { title: params.get("title") ?? "", count: params.get("count") ?? "", width: params.get("width") ?? "", height: params.get("height") ?? "", marginH: params.get("marginH") ?? String(PAGE.margin), marginV: params.get("marginV") ?? String(PAGE.margin), swell: params.get("swell") === "1", maxWidth: params.get("maxWidth") ?? "0", maxHeight: params.get("maxHeight") ?? "0", step1Desc: params.get("step1Desc") ?? "bottom", step2Desc: params.get("step2Desc") ?? "left side", names: params.getAll("glaze") };
  }

  function decodeTile(a, b, count, names) {
    const result = { text: "", error: "", invalidFields: [] };
    count = Number(count);
    if (!Number.isInteger(count) || count < 1 || count > MAX_GLAZES) {
      result.error = "Enter a valid number of glazes in the setup first.";
      return result;
    }
    const codes = [String(a).trim(), String(b).trim()];
    codes.forEach((code, i) => {
      if (code && (!/^\d+$/.test(code) || Number(code) < 1 || Number(code) > count)) result.invalidFields.push(i === 0 ? "a" : "b");
    });
    if (result.invalidFields.length) {
      result.error = `Use whole numbers from 1 to ${count}.`;
      return result;
    }
    if (codes.some(code => !code)) return result;
    const indices = codes.map(code => Number(code) - 1);
    const glazeNames = indices.map(index => String(names?.[index] ?? "").trim());
    const missing = glazeNames.findIndex(name => !name);
    if (missing !== -1) {
      result.error = `Enter a name for glaze #${indices[missing] + 1} in the setup.`;
      return result;
    }
    result.text = `${glazeNames[0]} below ${glazeNames[1]}.`;
    result.glazeNames = glazeNames;
    return result;
  }

  function createPdf(data, JsPDF, renderOptions = {}) {
    const doc = new JsPDF({ orientation: "landscape", unit: "mm", format: [PAGE.width, PAGE.height], precision: 6, compress: true });
    doc.setFont("helvetica", "normal");
    doc.setProperties({ title: data.title, subject: "Ceramic test tile glaze combinations", creator: "Ceramic Test Tile Helper" });
    const plan = layout(data.count, data.width, data.height, data.marginH, data.marginV, data);
    const area = plan.area;
    const left = area.marginH;
    const ink = [45, 55, 47];
    const muted = [90, 100, 91];
    const labelFill = [243, 244, 238];
    const text = (value, x, y, size = 10, options = {}) => {
      doc.setTextColor(...ink);
      doc.setFontSize(size);
      doc.text(String(value), x, y, options);
    };

    function fitted(value, x, y, width, height, maxSize = 10, rotated = false) {
      // All label text remains inside the reserved label box. Full names are in the key.
      const physicalHeight = height;
      if (rotated) [width, height] = [height, width];
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
      if (rotated) {
        text(lines.join("\n"), x + padding + size * .352778, y + physicalHeight - padding, size, { angle: 90, lineHeightFactor: 1.15 });
      } else {
        text(lines.join("\n"), x + padding, y + padding + size * .352778, size, { lineHeightFactor: 1.15 });
      }
    }

    function pageHeading(subtitle) {
      fitted(data.title, left, area.marginV, area.contentWidth, 14, 17);
      fitted(subtitle, left, area.marginV + 14, area.contentWidth, 8, 9);
    }

    function tableHeader(value, x, y, width, height, rotated = false) {
      doc.setFontSize(HEADER_FONT_SIZE);
      const { padding, lines } = headerText(doc, value, rotated ? height : width);
      const baseline = padding + HEADER_FONT_SIZE * (25.4 / 72);
      if (rotated) {
        text(lines.join("\n"), x + baseline, y + height - padding, HEADER_FONT_SIZE, { angle: 90, lineHeightFactor: 1.15 });
      } else {
        text(lines.join("\n"), x + padding, y + baseline, HEADER_FONT_SIZE, { lineHeightFactor: 1.15 });
      }
    }

    function cellFooter(value, x, y, width, height, viewport) {
      const padding = Math.min(2, width * .05, height * .05);
      const innerWidth = Math.max(.000001, width - 2 * padding);
      const footerHeight = Math.min(12, height * .25);
      const pointToMm = 25.4 / 72;
      let size = 8, lines;
      for (; size >= 4; size -= .5) {
        doc.setFontSize(size);
        lines = doc.splitTextToSize(value, innerWidth);
        if (lines.length * size * pointToMm * 1.2 <= footerHeight) break;
      }
      if (size < 4) {
        // Keep the complete pair even when the footprint is too small for readable type.
        doc.setFontSize(1);
        size = Math.min(4, innerWidth / Math.max(doc.getTextWidth(value), .000001), footerHeight / (pointToMm * 1.2));
        lines = [value];
      }
      const lineHeight = size * pointToMm * 1.2;
      const baseline = y + height - padding - size * pointToMm * .25 - (lines.length - 1) * lineHeight;
      doc.setFontSize(size);
      const textWidth = Math.max(...lines.map(line => doc.getTextWidth(line)));
      if (viewport && (baseline - size * pointToMm >= viewport.bottom ||
        baseline + (lines.length - 1) * lineHeight + size * pointToMm * .25 <= viewport.top ||
        x + width / 2 + textWidth / 2 <= viewport.left || x + width / 2 - textWidth / 2 >= viewport.right)) return;
      text(lines.join("\n"), x + width / 2, baseline, size, { align: "center", lineHeightFactor: 1.2 });
    }

    function watermark(x, y, width, height) {
      const angle = Math.atan2(height, width);
      const cos = Math.cos(angle), sin = Math.sin(angle);
      doc.setFontSize(1);
      const lengthPerPoint = doc.getTextWidth(data.title);
      const credit = "hunsley.io";
      const creditLengthPerPoint = doc.getTextWidth(credit);
      const heightPerPoint = 25.4 / 72;
      // Fit the rotated text's bounding box inside the cells, with space at both ends.
      let size = Math.min(120,
        width * .88 / (lengthPerPoint * cos + heightPerPoint * sin),
        height * .88 / (lengthPerPoint * sin + heightPerPoint * cos));
      let creditSize = Math.min(28, size * .5);
      let gap = Math.min(1, width * .01, height * .01);
      const groupLength = Math.max(lengthPerPoint * size, creditLengthPerPoint * creditSize);
      const groupHeight = heightPerPoint * (size * 1.3 + creditSize * 1.35) + gap;
      const fit = Math.min(1, width * .88 / (groupLength * cos + groupHeight * sin), height * .88 / (groupLength * sin + groupHeight * cos));
      size *= fit;
      creditSize *= fit;
      gap *= fit;
      const length = lengthPerPoint * size;
      const creditOffset = heightPerPoint * (size * .3 + creditSize * 1.1) + gap;
      const baselineOffset = (heightPerPoint * size - creditOffset - heightPerPoint * creditSize * .25) / 2;
      const startX = x + width / 2 - length * cos / 2 + baselineOffset * sin;
      const startY = y + height / 2 + length * sin / 2 + baselineOffset * cos;
      doc.saveGraphicsState();
      doc.rect(x, y, width, height, null).clip().discardPath();
      doc.setFontSize(size);
      doc.setTextColor(230, 233, 228);
      doc.text(data.title, startX, startY, { angle: angle * 180 / Math.PI });
      const creditLength = creditLengthPerPoint * creditSize;
      const creditBaseline = baselineOffset + creditOffset;
      doc.setFontSize(creditSize);
      doc.text(credit,
        x + width / 2 - creditLength * cos / 2 + creditBaseline * sin,
        y + height / 2 + creditLength * sin / 2 + creditBaseline * cos,
        { angle: angle * 180 / Math.PI });
      doc.restoreGraphicsState();
    }

    function joinLetter(index) {
      let result = "";
      for (let value = index + 1; value > 0; value = Math.floor((value - 1) / 26)) {
        result = String.fromCharCode(65 + (value - 1) % 26) + result;
      }
      return result;
    }

    function joinMarker(letter, edge, x, y, radius) {
      // The sheet viewport clips a circle centered on its cut edge into a
      // semicircle. The matching sheet supplies the other half.
      doc.setFillColor(128, 128, 128);
      doc.circle(x, y, radius, "F");
      doc.setFontSize(1);
      const horizontalEdge = edge === "top" || edge === "bottom";
      const availableWidth = radius * (horizontalEdge ? 1.3 : .85);
      const size = Math.min(12, availableWidth / Math.max(doc.getTextWidth(letter), .000001), radius * .75 / (25.4 / 72));
      const offset = radius * .45;
      const textX = x + (edge === "left" ? offset : edge === "right" ? -offset : 0);
      const textY = y + (edge === "top" ? offset : edge === "bottom" ? -offset : 0);
      doc.setFontSize(size);
      doc.setTextColor(255, 255, 255);
      doc.text(letter, textX, textY + size * (25.4 / 72) * .35, { align: "center" });
    }

    function cutGuides(sheetRow, sheetColumn, x, y, width, height) {
      if (sheetRow === 0 && sheetColumn === 0) return;
      doc.saveGraphicsState();
      doc.setDrawColor(110, 110, 110);
      doc.setLineWidth(.2);
      doc.setLineDashPattern([2, 1.5], 0);
      if (sheetRow > 0) doc.line(x, y, x + width, y);
      if (sheetColumn > 0) doc.line(x, y, x, y + height);
      doc.setLineDashPattern([], 0);
      doc.setFontSize(7);
      doc.setTextColor(110, 110, 110);
      const label = "CUT HERE";
      const labelLength = doc.getTextWidth(label);
      const positions = span => [.15, .35, .65, .85].map(fraction => span * fraction).filter(position =>
        position - labelLength / 2 >= 2 && position + labelLength / 2 <= span - 2 &&
        Math.abs(position - span / 2) >= 8 + labelLength / 2);
      // Put the words in the waste margins, outside the table's clipping area.
      if (sheetRow > 0) for (const position of positions(width)) {
        doc.text(label, x + position, y - 1.5, { align: "center" });
      }
      if (sheetColumn > 0) for (const position of positions(height)) {
        doc.text(label, x - 1.5, y + position + labelLength / 2, { angle: 90 });
      }
      doc.restoreGraphicsState();
    }

    if (!renderOptions.tableOnly) {
      pageHeading("Ceramic Test Tile Helper / Checklist");
      doc.setDrawColor(...muted);
      doc.line(left, area.bottom - 7, left + 100, area.bottom - 7);
      doc.line(left, area.bottom - 8.5, left, area.bottom - 5.5);
      doc.line(left + 100, area.bottom - 8.5, left + 100, area.bottom - 5.5);
      text("100 mm scale check", left, area.bottom - 1, 8);
      const hints = "Hints: Print on A4 at 100% / Actual size. Turn off Fit to page. Check the 100 mm scale line length before using.";
      const items = [
        "Wax feet of tiles",
        "Place tiles on grid (writing any text on them if necessary)",
        ...data.names.map((name, i) => `Glaze column ${i + 1} (${data.step1Desc}) with ${name}`),
        ...data.names.map((name, i) => `Glaze row ${i + 1} (${data.step2Desc}) with ${name}`),
        "Wipe feet"
      ];
      let y = area.marginV + 30;
      const bodyBottom = () => area.bottom - (doc.getNumberOfPages() === 1 ? 15 : 0);
      function nextInstructionPage() {
        doc.addPage();
        pageHeading("Ceramic Test Tile Helper / Checklist continued");
        y = area.marginV + 30;
      }
      doc.setFontSize(10);
      for (const line of doc.splitTextToSize(hints, area.contentWidth)) {
        if (y + 5 > bodyBottom()) nextInstructionPage();
        text(line, left, y, 10);
        y += 5;
      }
      y += 7;
      for (const item of items) {
        doc.setFontSize(10);
        const lines = doc.splitTextToSize(item, area.contentWidth - 8);
        if (y + lines.length * 5 + 4 > bodyBottom()) nextInstructionPage();
        doc.setDrawColor(...muted);
        doc.setLineWidth(.25);
        doc.rect(left, y - 3, 3.5, 3.5, "S");
        for (const line of lines) {
          if (y + 5 > bodyBottom()) nextInstructionPage();
          text(line, left + 7, y, 10);
          y += 5;
        }
        y += 4;
      }
    }

    // PDF instructions and grid sheets must never share a page. The assembly
    // preview omits instructions and starts directly on its first grid sheet.
    if (!renderOptions.tableOnly) doc.addPage();

    for (let sheetRow = 0; sheetRow < plan.down; sheetRow++) {
      for (let sheetColumn = 0; sheetColumn < plan.across; sheetColumn++) {
        if (sheetRow !== 0 || sheetColumn !== 0) doc.addPage();
        const rowSlice = plan.rowBands[sheetRow];
        const columnSlice = plan.columnBands[sheetColumn];
        const { cellWidth, cellHeight } = plan;
        const viewX = columnSlice.offset, viewY = rowSlice.offset;
        const viewWidth = columnSlice.extent, viewHeight = rowSlice.extent;
        const projectX = x => left + x - viewX;
        const projectY = y => area.gridTop + y - viewY;
        const gridX = Math.max(left, projectX(area.labelWidth));
        const gridY = Math.max(area.gridTop, projectY(area.labelHeight));
        const gridWidth = left + viewWidth - gridX;
        const gridHeight = area.gridTop + viewHeight - gridY;
        doc.saveGraphicsState();
        doc.rect(left, area.gridTop, viewWidth, viewHeight, null).clip().discardPath();
        if (gridWidth > 0 && gridHeight > 0) watermark(gridX, gridY, gridWidth, gridHeight);

        doc.setFillColor(...labelFill);
        if (viewY < area.labelHeight) doc.rect(left, area.gridTop, viewWidth, Math.min(viewHeight, area.labelHeight - viewY), "F");
        if (viewX < area.labelWidth && gridHeight > 0) doc.rect(left, gridY, Math.min(viewWidth, area.labelWidth - viewX), gridHeight, "F");
        for (let col = columnSlice.start; viewY < area.labelHeight && col < columnSlice.start + columnSlice.count; col++) {
          tableHeader(`#${col + 1}  ${data.names[col]}`, projectX(area.labelWidth + col * cellWidth), projectY(0), cellWidth, area.labelHeight);
        }
        for (let row = rowSlice.start; viewX < area.labelWidth && row < rowSlice.start + rowSlice.count; row++) {
          tableHeader(`#${row + 1}  ${data.names[row]}`, projectX(0), projectY(area.labelHeight + row * cellHeight), area.labelWidth, cellHeight, true);
        }
        doc.setDrawColor(115, 124, 112);
        doc.setLineWidth(.2);
        // Only genuine table boundaries are stroked. An internal paper edge
        // cuts through the continuous drawing without inventing a cell border.
        if (sheetColumn === 0) doc.line(left, area.gridTop, left, area.gridTop + viewHeight);
        if (sheetRow === 0) doc.line(left, area.gridTop, left + viewWidth, area.gridTop);
        for (let col = 0; col <= data.count; col++) {
          const x = area.labelWidth + col * cellWidth;
          if (x >= viewX - 1e-9 && x <= viewX + viewWidth + 1e-9) {
            doc.line(projectX(x), area.gridTop, projectX(x), area.gridTop + viewHeight);
          }
        }
        for (let row = 0; row <= data.count; row++) {
          const y = area.labelHeight + row * cellHeight;
          if (y >= viewY - 1e-9 && y <= viewY + viewHeight + 1e-9) {
            doc.line(left, projectY(y), left + viewWidth, projectY(y));
          }
        }
        const viewport = { left, top: area.gridTop, right: left + viewWidth, bottom: area.gridTop + viewHeight };
        for (let row = rowSlice.start; row < rowSlice.start + rowSlice.count; row++) {
          for (let col = columnSlice.start; col < columnSlice.start + columnSlice.count; col++) {
            const pair = `${col + 1}.${row + 1} ${data.names[col]} / ${data.names[row]}`;
            cellFooter(pair, projectX(area.labelWidth + col * cellWidth), projectY(area.labelHeight + row * cellHeight), cellWidth, cellHeight, viewport);
          }
        }
        const horizontalJoins = plan.down * (plan.across - 1);
        if (sheetColumn > 0) {
          const radius = Math.min(6, viewHeight / 2, viewWidth, plan.columnBands[sheetColumn - 1].extent);
          joinMarker(joinLetter(sheetRow * (plan.across - 1) + sheetColumn - 1), "left", left, area.gridTop + viewHeight / 2, radius);
        }
        if (sheetColumn < plan.across - 1) {
          const radius = Math.min(6, viewHeight / 2, viewWidth, plan.columnBands[sheetColumn + 1].extent);
          joinMarker(joinLetter(sheetRow * (plan.across - 1) + sheetColumn), "right", left + viewWidth, area.gridTop + viewHeight / 2, radius);
        }
        if (sheetRow > 0) {
          const radius = Math.min(6, viewWidth / 2, viewHeight, plan.rowBands[sheetRow - 1].extent);
          joinMarker(joinLetter(horizontalJoins + (sheetRow - 1) * plan.across + sheetColumn), "top", left + viewWidth / 2, area.gridTop, radius);
        }
        if (sheetRow < plan.down - 1) {
          const radius = Math.min(6, viewWidth / 2, viewHeight, plan.rowBands[sheetRow + 1].extent);
          joinMarker(joinLetter(horizontalJoins + sheetRow * plan.across + sheetColumn), "bottom", left + viewWidth / 2, area.gridTop + viewHeight, radius);
        }
        doc.restoreGraphicsState();
        if (!renderOptions.tableOnly) cutGuides(sheetRow, sheetColumn, left, area.gridTop, viewWidth, viewHeight);
      }
    }
    return doc;
  }

  root.TileHelper = { PAGE, MAX_GLAZES, MAX_GRID_PAGES, layout, validate, shareUrl, readUrl, decodeTile, createPdf };
})(globalThis);
