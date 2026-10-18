(function (root) {
  "use strict";
  const POINT_TO_MM = 25.4 / 72;
  let previewFont;

  async function createAssemblyPng(data) {
    if (!previewFont) {
      previewFont = (async () => {
        const font = new FontFace("TileHelperPreview", `url(data:font/ttf;base64,${root.CERAMIC_FONT})`);
        document.fonts.add(await font.load());
      })().catch(error => { previewFont = null; throw error; });
    }
    await previewFont;
    const helper = root.TileHelper;
    const plan = helper.layout(data.count, data.width, data.height, data.marginH, data.marginV, data);
    const scale = 3200 / Math.max(plan.tableWidth, plan.tableHeight);
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(plan.tableWidth * scale));
    canvas.height = Math.max(1, Math.round(plan.tableHeight * scale));
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas is unavailable.");
    ctx.fillStyle = "white";
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // This adapter renders the exact same drawing commands as the PDF. PDF
    // font metrics supply wrapping and sizing; the embedded font paints pixels.
    class CanvasDocument {
      constructor() {
        this.metrics = new root.jspdf.jsPDF();
        this.page = 1;
        this.fontSize = 10;
        this.textColor = "black";
        this.stack = [];
        this.startSheet();
      }
      startSheet() {
        if (this.page > 1) ctx.restore();
        ctx.save();
        const col = (this.page - 1) % plan.across;
        const row = Math.floor((this.page - 1) / plan.across);
        ctx.setTransform(scale, 0, 0, scale,
          (plan.columnBands[col].offset - plan.area.marginH) * scale,
          (plan.rowBands[row].offset - plan.area.gridTop) * scale);
        ctx.beginPath();
      }
      addPage() { this.page++; this.startSheet(); return this; }
      getNumberOfPages() { return this.page; }
      setProperties() { return this; }
      addFileToVFS(...args) { this.metrics.addFileToVFS(...args); return this; }
      addFont(...args) { this.metrics.addFont(...args); return this; }
      setFont(...args) { this.metrics.setFont(...args); return this; }
      setFontSize(size) { this.fontSize = size; this.metrics.setFontSize(size); return this; }
      getTextWidth(value) { return this.metrics.getTextWidth(value); }
      splitTextToSize(...args) { return this.metrics.splitTextToSize(...args); }
      setTextColor(...rgb) { this.textColor = `rgb(${rgb.join(",")})`; return this; }
      setFillColor(...rgb) { ctx.fillStyle = `rgb(${rgb.join(",")})`; return this; }
      setDrawColor(...rgb) { ctx.strokeStyle = `rgb(${rgb.join(",")})`; return this; }
      setLineWidth(width) { ctx.lineWidth = width; return this; }
      rect(x, y, width, height, style) {
        ctx.beginPath(); ctx.rect(x, y, width, height);
        if (style === "F") ctx.fill();
        else if (style !== null) ctx.stroke();
        return this;
      }
      circle(x, y, radius, style) {
        ctx.beginPath(); ctx.arc(x, y, radius, 0, Math.PI * 2);
        if (style === "F") ctx.fill(); else ctx.stroke();
        return this;
      }
      line(x1, y1, x2, y2) {
        ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
        return this;
      }
      clip() { ctx.clip(); return this; }
      discardPath() { ctx.beginPath(); return this; }
      saveGraphicsState() {
        ctx.save(); this.stack.push({ fontSize: this.fontSize, textColor: this.textColor });
        return this;
      }
      restoreGraphicsState() {
        ctx.restore(); const state = this.stack.pop();
        this.setFontSize(state.fontSize); this.textColor = state.textColor;
        return this;
      }
      text(value, x, y, options = {}) {
        ctx.save();
        ctx.translate(x, y);
        ctx.rotate(-(options.angle || 0) * Math.PI / 180);
        ctx.font = `${this.fontSize * POINT_TO_MM}px TileHelperPreview`;
        ctx.fontKerning = "none";
        ctx.fillStyle = this.textColor;
        ctx.textAlign = options.align || "left";
        ctx.textBaseline = "alphabetic";
        const lines = String(value).split("\n");
        lines.forEach((line, i) => ctx.fillText(line, 0, i * this.fontSize * POINT_TO_MM * (options.lineHeightFactor || 1.15)));
        ctx.restore();
        return this;
      }
    }
    helper.createPdf(data, CanvasDocument, { tableOnly: true });
    ctx.restore();
    // Preview-only paper cuts, in assembled image coordinates. Drawing these
    // last makes them bisect the paired join markers as well as the grid.
    ctx.save();
    ctx.strokeStyle = "#515a52";
    ctx.lineWidth = 3;
    ctx.lineCap = "round";
    ctx.setLineDash([.02, 10]);
    for (const slice of plan.columnBands.slice(1)) {
      const x = slice.offset * scale;
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, canvas.height); ctx.stroke();
    }
    for (const slice of plan.rowBands.slice(1)) {
      const y = slice.offset * scale;
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(canvas.width, y); ctx.stroke();
    }
    ctx.restore();
    return new Promise((resolve, reject) => canvas.toBlob(blob => {
      if (blob) resolve(blob); else reject(new Error("PNG encoding failed."));
    }, "image/png"));
  }
  root.TileHelper.createAssemblyPng = createAssemblyPng;
})(globalThis);
