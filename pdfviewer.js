// PDF viewer: renders vault PDFs with pdf.js (lazy CDN load, zoom, fit and page navigation).
let Vault = null;
let libPromise = null;
let doc = null;
let path = null;
let scale = 1.25;
let current = 1;
let token = 0;

const PDF_VERSION = "3.11.174";
const PDF_BASE = "https://cdn.jsdelivr.net/npm/pdfjs-dist@" + PDF_VERSION + "/build/";

function ensureLib() {
  if (window.pdfjsLib) {
    window.pdfjsLib.GlobalWorkerOptions.workerSrc = PDF_BASE + "pdf.worker.min.js";
    return Promise.resolve(window.pdfjsLib);
  }
  if (libPromise) return libPromise;
  libPromise = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = PDF_BASE + "pdf.min.js";
    script.async = true;
    script.onload = () => {
      if (!window.pdfjsLib) { reject(new Error("pdf.js missing")); return; }
      window.pdfjsLib.GlobalWorkerOptions.workerSrc = PDF_BASE + "pdf.worker.min.js";
      resolve(window.pdfjsLib);
    };
    script.onerror = () => reject(new Error("pdf.js load failed"));
    document.head.appendChild(script);
  });
  return libPromise;
}

function base64ToBytes(value) {
  const bin = atob(String(value || "").replace(/\s/g, ""));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

async function fetchPdf(target) {
  try {
    const data = await Vault.api(Vault.contentsPath(target) + "?ref=" + encodeURIComponent(Vault.branch));
    if (data && data.encoding === "base64" && data.content) return base64ToBytes(data.content);
  } catch { /* raw fallback */ }
  const raw = "https://raw.githubusercontent.com/" + Vault.repo + "/" + Vault.branch + "/" + target.split("/").map(encodeURIComponent).join("/");
  const res = await fetch(raw);
  if (!res.ok) throw new Error("HTTP " + res.status);
  return new Uint8Array(await res.arrayBuffer());
}

function toolbar() {
  const page = document.getElementById("pdfPage");
  const count = document.getElementById("pdfCount");
  const title = document.getElementById("pdfTitle");
  if (page) page.value = String(current);
  if (count) count.textContent = "/ " + (doc ? doc.numPages : 0);
  if (title) title.textContent = path ? path.split("/").pop() : "PDF";
}

async function render() {
  const host = document.getElementById("pdfPages");
  if (!host || !doc) return;
  const run = ++token;
  host.innerHTML = "";
  for (let n = 1; n <= doc.numPages; n++) {
    if (run !== token) return;
    const page = await doc.getPage(n);
    const viewport = page.getViewport({ scale });
    const wrap = document.createElement("div");
    wrap.className = "pdf-page";
    wrap.dataset.page = String(n);
    const canvas = document.createElement("canvas");
    canvas.width = Math.floor(viewport.width);
    canvas.height = Math.floor(viewport.height);
    canvas.style.width = Math.floor(viewport.width) + "px";
    canvas.style.height = Math.floor(viewport.height) + "px";
    wrap.appendChild(canvas);
    host.appendChild(wrap);
    await page.render({ canvasContext: canvas.getContext("2d"), viewport }).promise;
  }
  if (run === token) toolbar();
}

function setScale(next) {
  scale = Math.max(0.4, Math.min(3.5, next));
  render().catch((error) => Vault.toast("PDF: " + error.message));
}

function fitWidth() {
  if (!doc) return;
  const host = document.getElementById("pdfPages");
  if (!host) return;
  const available = Math.max(200, host.clientWidth - 44);
  doc.getPage(1).then((page) => {
    const base = page.getViewport({ scale: 1 });
    setScale(available / base.width);
  }).catch((error) => Vault.toast("PDF: " + error.message));
}

function goPage(number) {
  if (!doc) return;
  current = Math.max(1, Math.min(doc.numPages, Number(number) || 1));
  const target = document.querySelector('#pdfPages .pdf-page[data-page="' + current + '"]');
  if (target) target.scrollIntoView({ block: "start" });
  toolbar();
}

async function open(target) {
  if (!Vault) return;
  Vault.setView("pdf");
  path = target;
  current = 1;
  scale = 1.25;
  token++;
  const host = document.getElementById("pdfPages");
  if (host) host.innerHTML = '<div class="pdf-loading">Завантажую PDF…</div>';
  toolbar();
  if (document.getElementById("stPath")) document.getElementById("stPath").textContent = target;
  document.title = target.split("/").pop() + " · Vault";
  try {
    const lib = await ensureLib();
    const bytes = await fetchPdf(target);
    doc = await lib.getDocument({ data: bytes }).promise;
    toolbar();
    await render();
    const pages = document.getElementById("pdfPages");
    if (pages) pages.scrollTop = 0;
  } catch (error) {
    if (host) host.innerHTML = '<div class="pdf-loading">PDF не відкрився: ' + String(error.message || error) + "</div>";
    Vault.toast("PDF: " + error.message);
  }
}

function close() {
  token++;
  doc = null;
  path = null;
  const host = document.getElementById("pdfPages");
  if (host) host.innerHTML = "";
  Vault.setView("note");
  Vault.paint();
}

function initPdfViewer(vault) {
  Vault = vault;
  const host = document.getElementById("pdfHost");
  if (!host) return null;
  document.getElementById("pdfPrev").onclick = () => goPage(current - 1);
  document.getElementById("pdfNext").onclick = () => goPage(current + 1);
  document.getElementById("pdfZoomOut").onclick = () => setScale(scale / 1.2);
  document.getElementById("pdfZoomIn").onclick = () => setScale(scale * 1.2);
  document.getElementById("pdfFit").onclick = fitWidth;
  document.getElementById("pdfClose").onclick = close;
  document.getElementById("pdfPage").addEventListener("change", () => goPage(document.getElementById("pdfPage").value));
  document.getElementById("pdfExternal").onclick = () => {
    if (!path) return;
    const raw = "https://raw.githubusercontent.com/" + Vault.repo + "/" + Vault.branch + "/" + path.split("/").map(encodeURIComponent).join("/");
    window.open(raw, "_blank", "noopener");
  };
  const pages = document.getElementById("pdfPages");
  pages.addEventListener("scroll", () => {
    if (!doc) return;
    let best = 1;
    let bestDistance = Infinity;
    const top = pages.scrollTop;
    for (const el of pages.querySelectorAll(".pdf-page")) {
      const distance = Math.abs(el.offsetTop - top);
      if (distance < bestDistance) { bestDistance = distance; best = Number(el.dataset.page) || 1; }
    }
    if (best !== current) { current = best; toolbar(); }
  }, { passive: true });
  pages.addEventListener("wheel", (event) => {
    if (!event.ctrlKey && !event.metaKey) return;
    event.preventDefault();
    setScale(scale * (event.deltaY < 0 ? 1.1 : 1 / 1.1));
  }, { passive: false });
  return {
    open,
    close,
    setScale,
    fitWidth,
    goPage,
    get path() { return path; },
    state: () => ({ path, pages: doc ? doc.numPages : 0, current, scale }),
  };
}

export { initPdfViewer };
