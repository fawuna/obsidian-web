// PDF export: renders the preview to a real .pdf file (raster pages, so Cyrillic works).
let deps = null;

async function loadDeps() {
  if (deps) return deps;
  const [jspdf, html2canvas] = await Promise.all([
    import("https://esm.sh/jspdf@2.5.2"),
    import("https://esm.sh/html2canvas@1.4.1"),
  ]);
  deps = {
    jsPDF: jspdf.jsPDF || jspdf.default,
    html2canvas: html2canvas.default || html2canvas.html2canvas,
  };
  if (typeof deps.jsPDF !== "function") throw new Error("jsPDF не завантажився");
  if (typeof deps.html2canvas !== "function") throw new Error("html2canvas не завантажився");
  return deps;
}

/**
 * Renders an element into an A4 PDF.
 * Returns { blob, pages, bytes } and (unless options.download === false) saves the file.
 */
export async function exportPdfFile(element, title, options = {}) {
  if (!element) throw new Error("нема що експортувати");
  const { jsPDF, html2canvas } = await loadDeps();

  const canvas = await html2canvas(element, {
    backgroundColor: "#ffffff",
    scale: 2,
    useCORS: true,
    logging: false,
    windowWidth: element.scrollWidth,
  });
  if (!canvas.width || !canvas.height) throw new Error("canvas порожній");

  const pdf = new jsPDF({ unit: "pt", format: "a4", orientation: "portrait", compress: true });
  const pageW = pdf.internal.pageSize.getWidth();
  const pageH = pdf.internal.pageSize.getHeight();
  const margin = 24;
  const contentW = pageW - margin * 2;
  const contentH = pageH - margin * 2;

  // slice the tall canvas into page-sized chunks
  const pxPerPoint = canvas.width / contentW;
  const pageSlicePx = Math.floor(contentH * pxPerPoint);
  const pages = Math.max(1, Math.ceil(canvas.height / pageSlicePx));

  const slice = document.createElement("canvas");
  const sctx = slice.getContext("2d");

  for (let i = 0; i < pages; i++) {
    const startY = i * pageSlicePx;
    const height = Math.min(pageSlicePx, canvas.height - startY);
    slice.width = canvas.width;
    slice.height = height;
    sctx.fillStyle = "#ffffff";
    sctx.fillRect(0, 0, slice.width, slice.height);
    sctx.drawImage(canvas, 0, startY, canvas.width, height, 0, 0, canvas.width, height);

    if (i > 0) pdf.addPage();
    const imgH = (height * contentW) / canvas.width;
    pdf.addImage(slice.toDataURL("image/jpeg", 0.92), "JPEG", margin, margin, contentW, imgH, undefined, "FAST");
  }

  pdf.setProperties({ title: title || "Vault note", creator: "Vault web" });
  const blob = pdf.output("blob");
  const buffer = await blob.arrayBuffer();

  if (options.download !== false) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = (title || "note").replace(/[\\/:*?"<>|]+/g, "_").slice(0, 80) + ".pdf";
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  }

  return { blob, pages, bytes: buffer.byteLength, header: new TextDecoder().decode(buffer.slice(0, 8)) };
}
