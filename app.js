// Vault — core app. Feature modules (graph/canvas/collab/plugins) get this API via init().
import { initGraph } from "./graph.js";
import { initCanvas } from "./canvas.js";
import { initCollab } from "./collab.js";
import { initPlugins } from "./plugins.js";

const $ = (id) => document.getElementById(id);
const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };

const store = {
  get: (k, def = "") => { const v = localStorage.getItem("vw-" + k); return v === null ? def : v; },
  set: (k, v) => localStorage.setItem("vw-" + k, String(v)),
  del: (k) => localStorage.removeItem("vw-" + k),
};

const state = {
  repo: store.get("repo", "fawuna/SUPER-GAME"),
  branch: store.get("branch", "main"),
  token: store.get("token"),
  files: [],
  open: [],
  active: null,
  preview: false,
  view: "note",
  index: new Map(),
  history: [],
  hIndex: -1,
  commands: [],
  ribbonButtons: [],
  handlers: new Map(),
};

/* ---------------- events ---------------- */
function on(event, fn) {
  if (!state.handlers.has(event)) state.handlers.set(event, new Set());
  state.handlers.get(event).add(fn);
  return () => state.handlers.get(event).delete(fn);
}
function emit(event, payload) {
  (state.handlers.get(event) || []).forEach((fn) => { try { fn(payload); } catch (e) { console.warn("handler", event, e); } });
}

/* ---------------- github ---------------- */
async function api(path, options = {}) {
  const res = await fetch("https://api.github.com" + path, {
    ...options,
    headers: {
      accept: "application/vnd.github+json",
      authorization: "Bearer " + state.token,
      "x-github-api-version": "2022-11-28",
      ...(options.headers || {}),
    },
  });
  const raw = await res.text();
  let data = null;
  try { data = raw ? JSON.parse(raw) : null; } catch { data = { raw }; }
  if (!res.ok) {
    const err = new Error((data && data.message ? data.message : res.statusText) + " (" + res.status + ")");
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

const b64encode = (text) => {
  const bytes = typeof text === "string" ? new TextEncoder().encode(text) : text;
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(bin);
};
const b64decode = (b64) => {
  const bin = atob(String(b64 || "").replace(/\s/g, ""));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder("utf-8").decode(bytes);
};

const contentsPath = (path) => "/repos/" + state.repo + "/contents/" + path.split("/").map(encodeURIComponent).join("/");

async function ghGet(path) {
  const data = await api(contentsPath(path) + "?ref=" + encodeURIComponent(state.branch));
  return { text: b64decode(data.content), sha: data.sha, encoding: data.encoding };
}
async function ghPutRaw(path, contentB64, sha, message) {
  const body = { message: message || ("update " + path), content: contentB64, branch: state.branch };
  if (sha) body.sha = sha;
  return api(contentsPath(path), { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
}
async function ghPut(path, text, sha, message) {
  return ghPutRaw(path, b64encode(text), sha, message);
}
async function ghDelete(path, sha) {
  return api(contentsPath(path), {
    method: "DELETE",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ message: "delete " + path, sha, branch: state.branch }),
  });
}

/* ---------------- ui helpers ---------------- */
let toastTimer = null;
function toast(msg) {
  const t = $("toast");
  t.textContent = msg;
  t.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove("show"), 2200);
}
function setState(text, cls) { $("stState").textContent = text; $("stState").className = cls || ""; }
function currentFile() { return state.open.find((f) => f.path === state.active) || null; }

function theme() { document.documentElement.dataset.theme = store.get("theme", "dark"); }
function applyPrefs() {
  $("editor").style.fontSize = store.get("font", "15") + "px";
  document.documentElement.style.setProperty("--editor-width", store.get("width", "46rem"));
}

/* ---------------- commands ---------------- */
function registerCommand(cmd) { state.commands.push(cmd); }
function addRibbonButton(btn) { state.ribbonButtons.push(btn); renderRibbonExtra(); }
function renderRibbonExtra() {
  const ribbon = $("ribbon");
  ribbon.querySelectorAll("[data-extra]").forEach((n) => n.remove());
  const spacer = ribbon.querySelector(".spacer");
  state.ribbonButtons.forEach((btn) => {
    const b = el("button", null, btn.icon || "◆");
    b.title = btn.title || btn.id;
    b.dataset.extra = "1";
    b.onclick = () => { try { btn.run(); } catch (e) { toast(String(e.message || e)); } };
    ribbon.insertBefore(b, spacer);
  });
}

/* ---------------- tree ---------------- */
async function loadTree() {
  const data = await api("/repos/" + state.repo + "/git/trees/" + state.branch + "?recursive=1");
  state.files = (data.tree || [])
    .filter((n) => n.type === "blob" && (n.path.endsWith(".md") || n.path.endsWith(".canvas")))
    .map((n) => n.path)
    .sort((a, b) => a.localeCompare(b, "uk", { numeric: true }));
  renderTree();
  renderTags();
  emit("tree", state.files);
}

function renderTree() {
  const q = $("filter").value.trim().toLowerCase();
  const host = $("tree");
  host.innerHTML = "";
  const files = state.files.filter((p) => !q || p.toLowerCase().includes(q));
  const tree = {};
  for (const path of files) {
    const parts = path.split("/");
    let node = tree;
    for (let i = 0; i < parts.length - 1; i++) { node[parts[i]] = node[parts[i]] || {}; node = node[parts[i]]; }
    node[parts[parts.length - 1]] = null;
  }
  const collapsed = new Set(JSON.parse(store.get("collapsed", "[]")));
  const walk = (node, prefix, depth) => {
    const folders = Object.keys(node).filter((k) => node[k] !== null).sort();
    const leaves = Object.keys(node).filter((k) => node[k] === null).sort();
    for (const folder of folders) {
      const full = prefix ? prefix + "/" + folder : folder;
      const isCollapsed = collapsed.has(full);
      const row = el("div", "folder-row");
      row.style.paddingLeft = 6 + depth * 12 + "px";
      row.appendChild(el("span", "chev", isCollapsed ? "▸" : "▾"));
      row.appendChild(el("span", null, folder));
      row.onclick = () => {
        if (isCollapsed) collapsed.delete(full); else collapsed.add(full);
        store.set("collapsed", JSON.stringify([...collapsed]));
        renderTree();
      };
      row.ondragover = (e) => { e.preventDefault(); row.classList.add("drop-target"); };
      row.ondragleave = () => row.classList.remove("drop-target");
      row.ondrop = async (e) => {
        e.preventDefault();
        row.classList.remove("drop-target");
        const path = e.dataTransfer.getData("text/vault-path");
        if (path) await moveFile(path, full);
      };
      host.appendChild(row);
      if (!isCollapsed) walk(node[folder], full, depth + 1);
    }
    for (const leaf of leaves) {
      const full = prefix ? prefix + "/" + leaf : leaf;
      const row = el("div", "file-row" + (full === state.active ? " active" : ""));
      row.style.paddingLeft = 12 + depth * 12 + "px";
      row.draggable = true;
      row.appendChild(el("span", null, full.endsWith(".canvas") ? "🎨" : "📄"));
      row.appendChild(el("span", "label", leaf.replace(/\.(md|canvas)$/, "")));
      const actions = el("span", "actions");
      const rename = el("button", null, "✎");
      rename.title = "Перейменувати";
      rename.onclick = (e) => { e.stopPropagation(); renameNote(full); };
      const del = el("button", null, "🗑");
      del.title = "Видалити";
      del.onclick = (e) => { e.stopPropagation(); deleteNote(full); };
      actions.append(rename, del);
      row.appendChild(actions);
      row.onclick = () => openNote(full);
      row.ondragstart = (e) => { e.dataTransfer.setData("text/vault-path", full); e.dataTransfer.effectAllowed = "move"; row.classList.add("dragging"); };
      row.ondragend = () => row.classList.remove("dragging");
      host.appendChild(row);
    }
  };
  walk(tree, "", 0);
  if (!files.length) host.appendChild(el("div", "empty", "нічого не знайдено"));
}

async function moveFile(path, folder) {
  const name = path.split("/").pop();
  const target = folder ? folder + "/" + name : name;
  if (target === path) return;
  try {
    setState("переміщую…");
    const { text, sha } = await ghGet(path);
    await ghPut(target, text, null, "move " + path + " → " + target);
    if (path.endsWith(".canvas")) {
      await ghPutRaw(path, b64encode(text), sha, "cleanup move " + path);
      await ghDelete(path, sha);
    } else {
      await ghDelete(path, sha);
    }
    const openFile = state.open.find((f) => f.path === path);
    if (openFile) openFile.path = target;
    if (state.active === path) state.active = target;
    await loadTree();
    renderTabs(); paint();
    setState("переміщено", "ok");
    toast("→ " + target);
  } catch (error) {
    setState("помилка: " + error.message, "err");
    toast("Не перемістилось: " + error.message);
  }
}

/* ---------------- notes ---------------- */
function setView(view) {
  state.view = view;
  document.body.classList.toggle("view-graph", view === "graph");
  document.body.classList.toggle("view-canvas", view === "canvas");
  emit("view", view);
}

async function openNote(path, pushHistory = true) {
  if (path.endsWith(".canvas")) { openCanvas(path); return; }
  const existing = state.open.find((f) => f.path === path);
  if (existing) {
    state.active = path;
    setView("note");
    if (pushHistory) pushHistoryState(path);
    renderTabs(); renderTree(); paint();
    return;
  }
  try {
    setState("відкриваю…");
    const { text, sha } = await ghGet(path);
    state.index.set(path, text);
    state.open.push({ path, sha, text, dirty: false });
    state.active = path;
    setView("note");
    if (pushHistory) pushHistoryState(path);
    renderTabs(); renderTree(); paint();
    setState("", "");
    if (window.matchMedia("(max-width: 980px)").matches) $("left").classList.remove("open");
    emit("open", path);
  } catch (error) {
    setState("помилка: " + error.message, "err");
    toast("Не відкрилось: " + error.message);
  }
}

function pushHistoryState(path) {
  state.history = state.history.slice(0, state.hIndex + 1);
  if (state.history[state.history.length - 1] !== path) state.history.push(path);
  state.hIndex = state.history.length - 1;
}
const goBack = () => { if (state.hIndex > 0) openNote(state.history[--state.hIndex], false); };
const goFwd = () => { if (state.hIndex < state.history.length - 1) openNote(state.history[++state.hIndex], false); };

function closeTab(path) {
  const idx = state.open.findIndex((f) => f.path === path);
  if (idx === -1) return;
  if (state.open[idx].dirty && !confirm("Є незбережені зміни. Закрити?")) return;
  state.open.splice(idx, 1);
  if (state.active === path) state.active = state.open[Math.max(0, idx - 1)]?.path || null;
  renderTabs(); renderTree(); paint();
}

function renderTabs() {
  const host = $("tabs");
  host.innerHTML = "";
  for (const file of state.open) {
    const tab = el("div", "tab" + (file.path === state.active && state.view === "note" ? " active" : ""));
    tab.appendChild(el("span", "name", file.path.split("/").pop().replace(/\.md$/, "")));
    if (file.dirty) tab.appendChild(el("span", "dot", "•"));
    const x = el("span", "close", "✕");
    x.onclick = (e) => { e.stopPropagation(); closeTab(file.path); };
    tab.appendChild(x);
    tab.onclick = () => { state.active = file.path; setView("note"); pushHistoryState(file.path); renderTabs(); renderTree(); paint(); };
    tab.onauxclick = (e) => { if (e.button === 1) closeTab(file.path); };
    host.appendChild(tab);
  }
}

function paint() {
  const file = currentFile();
  $("editor").value = file ? file.text : "";
  $("editor").readOnly = !file;
  $("stPath").textContent = state.view === "graph" ? "Graph view" : state.view === "canvas" ? ($("canvasName").textContent || "Canvas") : (file ? file.path : "—");
  $("stBranch").textContent = state.repo.split("/")[1] + " · " + state.branch;
  document.title = (file ? file.path.split("/").pop().replace(/\.md$/, "") + " · " : "") + "Vault";
  renderPreview();
  renderContext();
  const words = file ? file.text.trim().split(/\s+/).filter(Boolean).length : 0;
  $("stMeta").textContent = file ? words + " слів · " + file.text.length + " симв." : "";
  setState(file ? (file.dirty ? "не збережено" : "синхронізовано") : "", file && file.dirty ? "warn" : "ok");
  emit("paint", file);
}

async function saveNote(silent = false) {
  const file = currentFile();
  if (!file) return;
  try {
    if (!silent) setState("зберігаю…");
    const data = await ghPut(file.path, file.text, file.sha, "edit: " + file.path);
    file.sha = data.content.sha;
    file.dirty = false;
    state.index.set(file.path, file.text);
    renderTabs(); paint();
    setState("збережено " + new Date().toLocaleTimeString().slice(0, 5), "ok");
    emit("saved", file.path);
  } catch (error) {
    if (error.status === 409 || error.status === 422) {
      try {
        const fresh = await ghGet(file.path);
        file.sha = fresh.sha;
        await ghPut(file.path, file.text, file.sha, "merge: " + file.path);
        file.dirty = false;
        renderTabs(); paint();
        setState("злито і збережено", "ok");
        toast("Файл змінили ззовні — зберіг поверх, перевір diff у git");
        emit("saved", file.path);
        return;
      } catch (e2) { /* fallthrough */ }
    }
    setState("помилка: " + error.message, "err");
    toast("Не збереглось: " + error.message);
  }
}

async function newNote() {
  const raw = prompt("Назва нотатки (можна з папкою: папка/назва):", "Нова нотатка");
  if (!raw) return;
  let path = raw.trim().replace(/^\/+/, "");
  if (!path.endsWith(".md")) path += ".md";
  try {
    await ghPut(path, "# " + path.split("/").pop().replace(/\.md$/, "") + "\n\n", null, "add " + path);
    await loadTree();
    await openNote(path);
    toast("створено " + path);
  } catch (error) { toast("Не вийшло: " + error.message); }
}

async function renameNote(path) {
  const next = prompt("Нове імʼя:", path);
  if (!next || next === path) return;
  let target = next.trim().replace(/^\/+/, "");
  if (!/\.(md|canvas)$/.test(target)) target += path.endsWith(".canvas") ? ".canvas" : ".md";
  try {
    const { text, sha } = await ghGet(path);
    await ghPut(target, text, null, "rename " + path + " → " + target);
    await ghDelete(path, sha);
    const openFile = state.open.find((f) => f.path === path);
    if (openFile) openFile.path = target;
    if (state.active === path) state.active = target;
    await loadTree(); renderTabs(); paint();
    toast("перейменовано");
  } catch (error) { toast("Не вийшло: " + error.message); }
}

async function deleteNote(path) {
  if (!confirm("Видалити " + path + "?")) return;
  try {
    const { sha } = await ghGet(path);
    await ghDelete(path, sha);
    state.open = state.open.filter((f) => f.path !== path);
    if (state.active === path) state.active = state.open[0]?.path || null;
    await loadTree(); renderTabs(); paint();
    toast("видалено");
  } catch (error) { toast("Не вийшло: " + error.message); }
}

/* ---------------- images ---------------- */
function insertAtCursor(text) {
  const ed = $("editor");
  const start = ed.selectionStart ?? ed.value.length;
  ed.value = ed.value.slice(0, start) + text + ed.value.slice(ed.selectionEnd ?? start);
  ed.selectionStart = ed.selectionEnd = start + text.length;
  ed.dispatchEvent(new Event("input"));
}

async function uploadImage(file) {
  const name = "assets/" + Date.now() + "-" + file.name.replace(/[^\w.\-]+/g, "_");
  const buffer = new Uint8Array(await file.arrayBuffer());
  setState("завантажую картинку…");
  await ghPutRaw(name, b64encode(buffer), null, "upload " + name);
  insertAtCursor("\n![[" + name + "]]\n");
  setState("картинку вставлено", "ok");
  toast("+" + name);
}

async function handleImageFiles(files) {
  const images = [...files].filter((f) => f.type.startsWith("image/"));
  for (const img of images) {
    try { await uploadImage(img); }
    catch (error) { toast("Не завантажилось: " + error.message); }
  }
  return images.length;
}

/* ---------------- preview ---------------- */
function parseProps(text) {
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---[ \t]*\r?\n/);
  if (!m) return null;
  const rows = m[1].split(/\r?\n/).filter((l) => l.trim() && !l.trim().startsWith("#"));
  const props = [];
  for (const line of rows) {
    const kv = line.match(/^([A-Za-z0-9_\u0400-\u04FF-]+):\s*(.*)$/);
    if (kv) props.push([kv[1], kv[2].replace(/^["']|["']$/g, "")]);
  }
  return { raw: m[0], body: text.slice(m[0].length), props };
}

function renderPreview() {
  const file = currentFile();
  const host = $("preview");
  if (!file) { host.innerHTML = ""; return; }
  const parsed = parseProps(file.text);
  let body = parsed ? parsed.body : file.text;

  body = body.replace(/\[\[([^\]|]+)(\|[^\]]+)?\]\]/g, (m, t, l) =>
    '<a class="wikilink" data-target="' + t.trim().replace(/"/g, "&quot;") + '">' + (l ? l.slice(1) : t).trim() + "</a>");
  body = body.replace(/!\[\[([^\]]+\.(svg|png|jpe?g|gif|webp))\]\]/gi, (m, name) =>
    "![" + name + "](https://raw.githubusercontent.com/" + state.repo + "/" + state.branch + "/" + encodeURI(name.trim()) + ")");
  body = body.replace(/(^|\s)#([A-Za-z0-9_\u0400-\u04FF-]{2,})/g, (m, pre, tag) => pre + '<span class="tag">#' + tag + "</span>");

  let html = window.marked
    ? marked.parse(body, { breaks: true, mangle: false, headerIds: false })
    : "<pre>" + body.replace(/[<>&]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" }[c])) + "</pre>";

  html = html.replace(/<blockquote>\s*<p>\[!(\w+)\]\s*([^<]*)/g, (m, kind, rest) => '<div class="callout"><b>' + kind.toUpperCase() + "</b> " + rest);

  let head = "";
  if (parsed && parsed.props.length) {
    head = '<div class="props">' + parsed.props.map(([k, v]) => '<div class="row"><span class="k">' + k + '</span><span class="v">' + v + "</span></div>").join("") + "</div>";
  }
  host.innerHTML = head + html;

  host.querySelectorAll(".wikilink").forEach((a) => {
    a.onclick = () => {
      const target = a.dataset.target.replace(/^#/, "");
      const hit = state.files.find((p) => p === target + ".md" || p === target || p.endsWith("/" + target + ".md"));
      if (hit) openNote(hit); else toast("Нема такої нотатки: " + target);
    };
  });
  host.querySelectorAll("img").forEach((img) => {
    const src = img.getAttribute("src") || "";
    if (!/^https?:/.test(src)) img.src = "https://raw.githubusercontent.com/" + state.repo + "/" + state.branch + "/" + src.replace(/^\.?\//, "");
  });
  host.querySelectorAll("a[href]").forEach((a) => { a.target = "_blank"; a.rel = "noopener"; });
}

/* ---------------- context / tags / search ---------------- */
async function ensureIndex(exceptPath) {
  const missing = state.files.filter((p) => p.endsWith(".md") && !state.index.has(p) && p !== exceptPath);
  for (let i = 0; i < missing.length; i++) {
    const path = missing[i];
    try { const { text } = await ghGet(path); state.index.set(path, text); }
    catch { state.index.set(path, ""); }
    if (i % 4 === 3) await new Promise((r) => setTimeout(r, 60));
  }
}

async function renderContext() {
  const host = $("context");
  const file = currentFile();
  host.innerHTML = "";
  if (!file) { host.appendChild(el("div", "empty", "Нотатку не відкрито")); return; }
  const name = file.path.split("/").pop().replace(/\.md$/, "");
  host.appendChild(el("div", "empty", "шукаю звʼязки…"));
  await ensureIndex(file.path);

  const back = [];
  const pattern = new RegExp("\\[\\[\\s*" + name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\s*(\\||\\]\\])", "i");
  for (const [path, text] of state.index) {
    if (path === file.path || !text) continue;
    if (pattern.test(text)) back.push(path);
  }
  const out = [...file.text.matchAll(/\[\[([^\]|]+)/g)].map((m) => m[1].trim());
  const tags = [...new Set([...file.text.matchAll(/(^|\s)#([A-Za-z0-9_\u0400-\u04FF-]{2,})/g)].map((m) => m[2]))];

  host.innerHTML = "";
  const section = (title, items, emptyText, onClick) => {
    const wrap = el("div");
    const h = el("div", "pane-head");
    h.appendChild(el("span", "title", title + " (" + items.length + ")"));
    wrap.appendChild(h);
    if (!items.length) wrap.appendChild(el("div", "empty", emptyText));
    items.slice(0, 60).forEach((item) => {
      const b = el("button", "backlink", item.replace(/\.md$/, ""));
      b.onclick = () => onClick(item);
      wrap.appendChild(b);
    });
    return wrap;
  };
  host.appendChild(section("Згадки", back, "ніхто не посилається", (p) => openNote(p)));
  host.appendChild(section("Посилання", out, "нема посилань", (t) => {
    const hit = state.files.find((p) => p === t + ".md" || p.endsWith("/" + t + ".md"));
    if (hit) openNote(hit); else toast("Нема нотатки: " + t);
  }));
  if (tags.length) {
    const wrap = el("div");
    const h = el("div", "pane-head");
    h.appendChild(el("span", "title", "Теги"));
    wrap.appendChild(h);
    tags.forEach((t) => wrap.appendChild(el("span", "tag-chip", "#" + t)));
    host.appendChild(wrap);
  }
}

function renderTags() {
  const host = $("tagsPane");
  host.innerHTML = "";
  const counts = new Map();
  for (const [, text] of state.index) {
    if (!text) continue;
    for (const m of text.matchAll(/(^|\s)#([A-Za-z0-9_\u0400-\u04FF-]{2,})/g)) counts.set(m[2], (counts.get(m[2]) || 0) + 1);
  }
  if (!counts.size) { host.appendChild(el("div", "empty", "Тегів ще нема. Відкрий кілька нотаток — індекс збереться.")); return; }
  [...counts.entries()].sort((a, b) => b[1] - a[1]).forEach(([tag, n]) => {
    const chip = el("span", "tag-chip", "#" + tag + " · " + n);
    chip.onclick = () => { $("searchInput").value = "#" + tag; runSearch(); showPane("search"); };
    host.appendChild(chip);
  });
}

async function runSearch() {
  const q = $("searchInput").value.trim().toLowerCase();
  const host = $("searchResults");
  host.innerHTML = "";
  if (q.length < 2) { host.appendChild(el("div", "empty", "мінімум 2 символи")); return; }
  host.appendChild(el("div", "empty", "шукаю…"));
  await ensureIndex();
  const results = [];
  for (const [path, text] of state.index) {
    if (!text) continue;
    const lower = text.toLowerCase();
    let idx = lower.indexOf(q), hits = 0;
    while (idx !== -1 && hits < 50) { hits++; idx = lower.indexOf(q, idx + q.length); }
    if (hits) results.push({ path, hits, snippet: text.slice(Math.max(0, lower.indexOf(q) - 40), lower.indexOf(q) + 90).replace(/\n/g, " ") });
  }
  host.innerHTML = "";
  if (!results.length) { host.appendChild(el("div", "empty", "нічого не знайдено")); return; }
  results.sort((a, b) => b.hits - a.hits).forEach((r) => {
    const card = el("div", "backlink");
    card.style.display = "block";
    const t = el("div", null, r.path.replace(/\.md$/, "") + "  ·  " + r.hits);
    t.style.color = "var(--accent)";
    const s = el("div", null, "…" + r.snippet + "…");
    s.style.color = "var(--muted)";
    s.style.fontSize = "12px";
    card.append(t, s);
    card.onclick = () => openNote(r.path);
    host.appendChild(card);
  });
}

/* ---------------- palette / switcher ---------------- */
let paletteItems = [], paletteActive = 0, switcherItems = [], switcherActive = 0;

function openModal(id) { $("overlay").classList.add("show"); $(id).classList.add("show"); }
function closeModals() { $("overlay").classList.remove("show"); ["palette", "switcher", "settings", "collabModal"].forEach((id) => $(id).classList.remove("show")); }

function showPalette() {
  $("paletteInput").value = "";
  paletteActive = 0;
  renderPalette();
  openModal("palette");
  $("paletteInput").focus();
}
function renderPalette() {
  const q = $("paletteInput").value.trim().toLowerCase();
  const list = $("paletteList");
  list.innerHTML = "";
  paletteItems = state.commands.filter((c) => !q || c.label.toLowerCase().includes(q));
  paletteActive = Math.min(paletteActive, Math.max(0, paletteItems.length - 1));
  paletteItems.forEach((cmd, i) => {
    const item = el("div", "item" + (i === paletteActive ? " active" : ""), cmd.label);
    if (cmd.hint) item.appendChild(el("span", "hint", cmd.hint));
    item.onclick = () => { closeModals(); cmd.run(); };
    list.appendChild(item);
  });
  if (!paletteItems.length) list.appendChild(el("div", "empty", "нічого не знайдено"));
}

function showSwitcher() {
  $("switcherInput").value = "";
  switcherActive = 0;
  renderSwitcher();
  openModal("switcher");
  $("switcherInput").focus();
}
function renderSwitcher() {
  const q = $("switcherInput").value.trim().toLowerCase();
  const list = $("switcherList");
  list.innerHTML = "";
  const scored = state.files
    .map((path) => {
      const name = path.split("/").pop().replace(/\.(md|canvas)$/, "").toLowerCase();
      let score = 0;
      if (!q) score = 1;
      else if (name === q) score = 100;
      else if (name.startsWith(q)) score = 80;
      else if (name.includes(q)) score = 60;
      else if (path.toLowerCase().includes(q)) score = 30;
      return { path, score };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score);
  switcherItems = scored.map((s) => s.path);
  switcherActive = Math.min(switcherActive, Math.max(0, switcherItems.length - 1));
  switcherItems.slice(0, 80).forEach((path, i) => {
    const item = el("div", "item" + (i === switcherActive ? " active" : ""));
    item.appendChild(el("span", null, path.endsWith(".canvas") ? "🎨" : "📄"));
    item.appendChild(el("span", null, path.replace(/\.(md|canvas)$/, "")));
    item.onclick = () => { closeModals(); openNote(path); };
    list.appendChild(item);
  });
  if (!switcherItems.length) list.appendChild(el("div", "empty", "нічого не знайдено"));
}

/* ---------------- panes / modes ---------------- */
function showPane(pane) {
  ["files", "search", "tags", "plugins"].forEach((p) => { const node = $(p + "Pane"); if (node) node.style.display = p === pane ? "" : "none"; });
  $("paneTitle").textContent = pane === "files" ? "Файли" : pane === "search" ? "Пошук" : pane === "tags" ? "Теги" : "Плагіни";
  document.querySelectorAll("#ribbon [data-pane]").forEach((b) => b.classList.toggle("active", b.dataset.pane === pane));
  if (pane === "tags") renderTags();
  if (pane === "plugins") emit("plugins:pane");
}
const toggleMode = () => { state.preview = !state.preview; document.body.classList.toggle("mode-preview", state.preview); };
const toggleLeft = () => { if (window.innerWidth <= 980) $("left").classList.toggle("open"); else document.body.classList.toggle("no-left"); };
const toggleRight = () => { if (window.innerWidth <= 980) $("right").classList.toggle("open"); else document.body.classList.toggle("no-right"); };
const toggleTheme = () => { store.set("theme", store.get("theme", "dark") === "dark" ? "light" : "dark"); theme(); };

function exportPdf() {
  if (!currentFile()) { toast("Спочатку відкрий нотатку"); return; }
  state.preview = true;
  document.body.classList.add("mode-preview");
  renderPreview();
  setTimeout(() => { window.print(); }, 200);
}

/* ---------------- canvas view hook ---------------- */
let canvasApi = null;
function openCanvas(path) { if (canvasApi) canvasApi.open(path); }
function openGraph() { setView("graph"); emit("view", "graph"); }

/* ---------------- API for modules ---------------- */
export const Vault = {
  state, api, ghGet, ghPut, ghPutRaw, ghDelete, b64encode, b64decode,
  contentsPath, openNote, openCanvas, openGraph, toast, setState, currentFile,
  saveNote, ensureIndex, registerCommand, addRibbonButton, on, emit, loadTree,
  renderTree, renderTabs, paint, renderPreview, renderContext, renderTags, showPane,
  moveFile, uploadImage, insertAtCursor, openModal, closeModals, setView,
  get files() { return state.files; },
  get index() { return state.index; },
  get repo() { return state.repo; },
  get branch() { return state.branch; },
  get token() { return state.token; },
  get openFiles() { return state.open; },
};
window.Vault = Vault;

/* ---------------- editor wiring ---------------- */
$("editor").addEventListener("input", () => {
  const file = currentFile();
  if (!file) return;
  file.text = $("editor").value;
  file.dirty = true;
  state.index.set(file.path, file.text);
  setState("не збережено", "warn");
  const words = file.text.trim().split(/\s+/).filter(Boolean).length;
  $("stMeta").textContent = words + " слів · " + file.text.length + " симв.";
  renderPreview();
  emit("edit", { path: file.path, text: file.text });
  clearTimeout($("editor")._t);
  $("editor")._t = setTimeout(() => saveNote(true), 3000);
});

$("editor").addEventListener("keydown", (e) => {
  if (e.key === "Tab") {
    e.preventDefault();
    const ed = $("editor"), s = ed.selectionStart;
    ed.value = ed.value.slice(0, s) + "  " + ed.value.slice(ed.selectionEnd);
    ed.selectionStart = ed.selectionEnd = s + 2;
    ed.dispatchEvent(new Event("input"));
  }
});

$("editor").addEventListener("paste", async (e) => {
  const items = [...(e.clipboardData?.items || [])];
  const images = items.filter((i) => i.type.startsWith("image/")).map((i) => i.getAsFile()).filter(Boolean);
  if (!images.length) return;
  e.preventDefault();
  await handleImageFiles(images);
});

["dragover", "drop"].forEach((type) => {
  $("editor").addEventListener(type, async (e) => {
    if (type === "dragover" && e.dataTransfer?.types?.includes("Files")) { e.preventDefault(); e.dataTransfer.dropEffect = "copy"; return; }
    if (type === "drop" && e.dataTransfer?.files?.length) {
      const images = [...e.dataTransfer.files].filter((f) => f.type.startsWith("image/"));
      if (images.length) { e.preventDefault(); await handleImageFiles(images); }
      else if (e.dataTransfer.getData("text/vault-path")) {
        e.preventDefault();
        await openNote(e.dataTransfer.getData("text/vault-path"));
      }
    }
  });
});

document.addEventListener("keydown", (e) => {
  const mod = e.ctrlKey || e.metaKey;
  if (mod && e.key.toLowerCase() === "s") { e.preventDefault(); saveNote(); }
  else if (mod && e.key.toLowerCase() === "e") { e.preventDefault(); toggleMode(); }
  else if (mod && e.key.toLowerCase() === "p") { e.preventDefault(); showPalette(); }
  else if (mod && e.key.toLowerCase() === "o") { e.preventDefault(); showSwitcher(); }
  else if (mod && e.key.toLowerCase() === "b") { e.preventDefault(); toggleLeft(); }
  else if (mod && e.key.toLowerCase() === "g") { e.preventDefault(); setView(state.view === "graph" ? "note" : "graph"); }
  else if (e.key === "Escape") closeModals();
});

$("paletteInput").addEventListener("input", () => { paletteActive = 0; renderPalette(); });
$("paletteInput").addEventListener("keydown", (e) => {
  if (e.key === "ArrowDown") { e.preventDefault(); paletteActive = Math.min(paletteActive + 1, paletteItems.length - 1); renderPalette(); }
  if (e.key === "ArrowUp") { e.preventDefault(); paletteActive = Math.max(paletteActive - 1, 0); renderPalette(); }
  if (e.key === "Enter") { const cmd = paletteItems[paletteActive]; if (cmd) { closeModals(); cmd.run(); } }
});
$("switcherInput").addEventListener("input", () => { switcherActive = 0; renderSwitcher(); });
$("switcherInput").addEventListener("keydown", (e) => {
  if (e.key === "ArrowDown") { e.preventDefault(); switcherActive = Math.min(switcherActive + 1, switcherItems.length - 1); renderSwitcher(); }
  if (e.key === "ArrowUp") { e.preventDefault(); switcherActive = Math.max(switcherActive - 1, 0); renderSwitcher(); }
  if (e.key === "Enter") { const path = switcherItems[switcherActive]; if (path) { closeModals(); openNote(path); } }
});

$("overlay").onclick = closeModals;
$("saveBtn").onclick = () => saveNote();
$("modeBtn").onclick = toggleMode;
$("toggleLeft").onclick = toggleLeft;
$("toggleRight").onclick = toggleRight;
$("themeBtn").onclick = toggleTheme;
$("openPalette").onclick = showPalette;
$("openSwitcher").onclick = showSwitcher;
$("openSettings").onclick = openSettings;
$("closeSettings").onclick = closeModals;
$("newNote").onclick = newNote;
$("reloadTree").onclick = () => loadTree().catch((e) => toast(e.message));
$("filter").oninput = renderTree;
$("searchInput").oninput = () => { clearTimeout($("searchInput")._t); $("searchInput")._t = setTimeout(runSearch, 300); };
$("rebuildIndex").onclick = async () => { state.index.clear(); await ensureIndex(); renderContext(); renderTags(); toast("індекс оновлено"); };
$("navBack").onclick = goBack;
$("navFwd").onclick = goFwd;
$("openGraph").onclick = () => setView(state.view === "graph" ? "note" : "graph");
$("openCanvas").onclick = () => { const c = state.files.find((p) => p.endsWith(".canvas")); if (c) openCanvas(c); else toast("Нема .canvas — створи 🎨"); };
$("newCanvas").onclick = () => { if (canvasApi) canvasApi.create(); };
document.querySelectorAll("#ribbon [data-pane]").forEach((b) => { b.onclick = () => showPane(b.dataset.pane); });

/* settings */
function openSettings() {
  $("setRepo").value = state.repo;
  $("setBranch").value = state.branch;
  $("setToken").value = state.token;
  $("setTheme").value = store.get("theme", "dark");
  $("setFont").value = store.get("font", "15");
  $("setWidth").value = store.get("width", "46rem");
  $("setGraphForce").value = store.get("graphForce", "120");
  openModal("settings");
}
$("saveSettings").onclick = () => {
  store.set("repo", $("setRepo").value.trim());
  store.set("branch", $("setBranch").value.trim());
  store.set("token", $("setToken").value.trim());
  store.set("theme", $("setTheme").value);
  store.set("font", $("setFont").value);
  store.set("width", $("setWidth").value);
  store.set("graphForce", $("setGraphForce").value);
  theme(); applyPrefs();
  closeModals();
  location.reload();
};

window.addEventListener("beforeunload", (e) => { if (state.open.some((f) => f.dirty)) { e.preventDefault(); e.returnValue = ""; } });

/* ---------------- global drag&drop hint ---------------- */
let dragDepth = 0;
document.addEventListener("dragenter", (e) => { if (e.dataTransfer?.types?.includes("Files")) { dragDepth++; $("dropHint").classList.add("show"); } });
document.addEventListener("dragleave", () => { dragDepth = Math.max(0, dragDepth - 1); if (!dragDepth) $("dropHint").classList.remove("show"); });
document.addEventListener("drop", (e) => { dragDepth = 0; $("dropHint").classList.remove("show"); });
document.addEventListener("dragover", (e) => { if (e.dataTransfer?.types?.includes("Files")) e.preventDefault(); });

/* ---------------- boot ---------------- */
async function connect(repo, branch, token, remember) {
  state.repo = repo.trim();
  state.branch = branch.trim() || "main";
  state.token = token.trim();
  $("loginError").textContent = "";
  try {
    const info = await api("/repos/" + state.repo);
    if (!info.permissions || !info.permissions.push) throw new Error("нема прав на запис");
    if (remember) { store.set("repo", state.repo); store.set("branch", state.branch); store.set("token", state.token); }
    $("login").style.display = "none";
    $("app").classList.add("ready");
    await loadTree();
    const first = state.files.find((p) => p.endsWith(".md"));
    if (first) await openNote(first);
    showPane("files");
    ensureIndex().then(() => { renderTags(); renderContext(); emit("index"); }).catch(() => {});
    initGraph(Vault);
    canvasApi = initCanvas(Vault);
    initCollab(Vault);
    initPlugins(Vault);
  } catch (error) {
    $("loginError").textContent = "Не вийшло: " + error.message;
  }
}

/* commands */
registerCommand({ id: "new", label: "Нова нотатка", hint: "＋", run: newNote });
registerCommand({ id: "save", label: "Зберегти нотатку", hint: "Ctrl+S", run: () => saveNote() });
registerCommand({ id: "mode", label: "Режим читання / редактор", hint: "Ctrl+E", run: toggleMode });
registerCommand({ id: "pdf", label: "Експорт PDF (друк)", hint: "PDF", run: exportPdf });
registerCommand({ id: "graph", label: "Graph view", hint: "Ctrl+G", run: () => setView(state.view === "graph" ? "note" : "graph") });
registerCommand({ id: "canvas", label: "Відкрити canvas", run: () => { const c = state.files.find((p) => p.endsWith(".canvas")); if (c) openCanvas(c); else toast("Нема .canvas"); } });
registerCommand({ id: "theme", label: "Перемкнути тему", run: toggleTheme });
registerCommand({ id: "left", label: "Показати/сховати ліву панель", hint: "Ctrl+B", run: toggleLeft });
registerCommand({ id: "right", label: "Показати/сховати праву панель", run: toggleRight });
registerCommand({ id: "reload", label: "Оновити список файлів", run: () => loadTree() });
registerCommand({ id: "index", label: "Перебудувати індекс звʼязків", run: async () => { state.index.clear(); await ensureIndex(); renderContext(); renderTags(); toast("індекс оновлено"); } });
registerCommand({ id: "collab", label: "Спільна робота (real-time)", hint: "👥", run: () => emit("collab:open") });
registerCommand({ id: "logout", label: "Забути токен і вийти", run: () => { store.del("token"); location.reload(); } });

theme();
applyPrefs();
$("repo").value = state.repo;
$("branch").value = state.branch;
$("token").value = state.token;
$("connect").onclick = () => connect($("repo").value, $("branch").value, $("token").value, true);
$("token").addEventListener("keydown", (e) => { if (e.key === "Enter") $("connect").click(); });
$("forget").onclick = () => { store.del("token"); $("token").value = ""; toast("токен видалено"); };
if (state.token) connect(state.repo, state.branch, state.token, false);
