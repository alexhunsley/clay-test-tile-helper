(function () {
  "use strict";
  const helper = globalThis.TileHelper;
  const form = document.getElementById("tile-form");
  const fields = { title: document.getElementById("project-title"), count: document.getElementById("glaze-count"), width: document.getElementById("tile-width"), height: document.getElementById("tile-height"), marginH: document.getElementById("margin-horizontal"), marginV: document.getElementById("margin-vertical") };
  fields.swell = document.getElementById("swell-cells");
  fields.maxWidth = document.getElementById("max-cell-width");
  fields.maxHeight = document.getElementById("max-cell-height");
  fields.step1Desc = document.getElementById("step-1-desc");
  fields.step2Desc = document.getElementById("step-2-desc");
  const glazeFields = document.getElementById("glaze-fields");
  const status = document.getElementById("form-status");
  const generate = document.getElementById("generate");
  const preview = document.getElementById("preview");
  const shareResult = document.getElementById("share-result");
  let nameCache = [];
  let submitted = false;

  function readForm() {
    return { ...Object.fromEntries(Object.entries(fields).map(([key, input]) => [key, input.type === "checkbox" ? input.checked : input.validity.badInput ? "" : input.value])), names: Array.from(glazeFields.querySelectorAll("input"), (input) => input.value) };
  }

  function syncNames() {
    glazeFields.querySelectorAll("input").forEach((input, i) => { nameCache[i] = input.value; });
    const count = Number(fields.count.value);
    const wanted = Number.isInteger(count) && count >= 1 && count <= helper.MAX_GLAZES ? count : 0;
    while (glazeFields.children.length > wanted) glazeFields.lastElementChild.remove();
    while (glazeFields.children.length < wanted) {
      const index = glazeFields.children.length;
      const wrapper = document.createElement("div");
      wrapper.className = "field";
      const label = document.createElement("label");
      label.htmlFor = `glaze-${index}`;
      label.textContent = `Glaze #${index + 1} Name`;
      const input = document.createElement("input");
      input.id = label.htmlFor;
      input.name = "glaze";
      input.type = "text";
      input.maxLength = 100;
      input.required = true;
      input.value = nameCache[index] ?? "";
      input.setAttribute("aria-describedby", `glaze-${index}-error`);
      const error = document.createElement("p");
      error.id = `glaze-${index}-error`;
      error.className = "error";
      wrapper.append(label, input, error);
      glazeFields.append(wrapper);
    }
    document.getElementById("tile-count").textContent = wanted ? `${count} x ${count} = ${count * count} test tiles` : "";
  }

  function showErrors(errors) {
    form.querySelectorAll(".error").forEach((p) => { p.textContent = ""; });
    form.querySelectorAll("[aria-invalid]").forEach((input) => input.removeAttribute("aria-invalid"));
    for (const [key, message] of Object.entries(errors)) {
      const input = key.startsWith("name-") ? document.getElementById(`glaze-${key.slice(5)}`) : fields[key];
      if (!input) continue;
      input.setAttribute("aria-invalid", "true");
      document.getElementById(`${input.id}-error`).textContent = message;
    }
  }

  function updateSummary() {
    const { data, errors } = helper.validate(readForm());
    const summary = document.getElementById("layout-summary");
    if (errors.count || errors.width || errors.height || errors.marginH || errors.marginV || errors.maxWidth || errors.maxHeight) {
      summary.textContent = "Enter a glaze count and footprint to plan your grid.";
      return;
    }
    const plan = helper.layout(data.count, data.width, data.height, data.marginH, data.marginV, data);
    summary.textContent = `${data.count * data.count} cells · ${Number(plan.cellWidth.toFixed(3))} × ${Number(plan.cellHeight.toFixed(3))} mm${data.swell ? " (expanded)" : " each"} · ${plan.across} × ${plan.down} = ${plan.pages} grid sheet${plan.pages === 1 ? "" : "s"}, plus instructions`;
  }

  function validate() {
    submitted = true;
    const result = helper.validate(readForm());
    showErrors(result.errors);
    const valid = Object.keys(result.errors).length === 0;
    status.classList.toggle("problem", !valid);
    status.textContent = valid ? "" : "Please check the highlighted fields.";
    if (!valid) form.querySelector("[aria-invalid=true]")?.focus();
    return valid ? result.data : null;
  }

  function filename(title) {
    return title.replace(/[^\p{L}\p{N}._-]+/gu, "-").replace(/^-+|-+$/g, "").slice(0, 100) || "ceramic-test-tiles";
  }

  form.addEventListener("input", (event) => {
    if (event.target === fields.count) syncNames();
    fields.maxWidth.disabled = fields.maxHeight.disabled = !fields.swell.checked;
    updateSummary();
    if (submitted) showErrors(helper.validate(readForm()).errors);
    status.textContent = "";
    shareResult.hidden = true;
  });

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const data = validate();
    if (!data) return;
    generate.disabled = true;
    preview.disabled = true;
    generate.textContent = "Making your PDF…";
    status.textContent = "Drawing your true-size grid…";
    await new Promise((resolve) => requestAnimationFrame(() => setTimeout(resolve, 0)));
    try {
      const pdf = helper.createPdf(data, globalThis.jspdf.jsPDF);
      await pdf.save(`${filename(data.title)}.pdf`, { returnPromise: true });
      status.textContent = `PDF generated: ${pdf.getNumberOfPages()} pages. Print on A4 at 100% / Actual size.`;
    } catch (error) {
      console.error(error);
      status.classList.add("problem");
      status.textContent = "The PDF could not be generated. Please try a smaller grid.";
    } finally {
      generate.disabled = false;
      preview.disabled = false;
      generate.textContent = "Generate PDF ↓";
    }
  });

  preview.addEventListener("click", async () => {
    const data = validate();
    if (!data) return;
    generate.disabled = preview.disabled = true;
    preview.textContent = "Making preview…";
    status.textContent = "Assembling the grid sheets…";
    await new Promise(resolve => requestAnimationFrame(() => setTimeout(resolve, 0)));
    try {
      const blob = await helper.createAssemblyPng(data);
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `${filename(data.title)}-assembly.png`;
      document.body.append(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 30000);
      status.textContent = "Table assembly PNG downloaded.";
    } catch (error) {
      console.error(error);
      status.classList.add("problem");
      status.textContent = "The assembly preview could not be generated. Please try again.";
    } finally {
      generate.disabled = preview.disabled = false;
      preview.textContent = "Preview table assembly ↓";
    }
  });

  document.getElementById("share").addEventListener("click", async () => {
    if (!validate()) return;
    const url = helper.shareUrl(readForm(), location.href);
    const output = document.getElementById("share-url");
    output.value = url;
    shareResult.hidden = false;
    document.getElementById("share-note").textContent = location.protocol === "file:"
      ? "This is a local-file link. Recipients need this HTML file and may need to adjust the file path. Host the page to share a web link."
      : "This link includes all the form details. Anyone with it can open the filled form.";
    try {
      await navigator.clipboard.writeText(url);
      status.textContent = "Filled-form link copied.";
    } catch {
      output.focus();
      output.select();
      status.textContent = "Copy the selected filled-form link below.";
    }
  });

  try {
    const restored = helper.readUrl(location.href);
    if (restored) {
      for (const key of Object.keys(fields)) {
        if (fields[key].type === "checkbox") fields[key].checked = restored[key];
        else fields[key].value = restored[key];
      }
      nameCache = restored.names;
    }
  } catch (error) {
    status.classList.add("problem");
    status.textContent = error.message;
  }
  syncNames();
  fields.maxWidth.disabled = fields.maxHeight.disabled = !fields.swell.checked;
  updateSummary();
})();
