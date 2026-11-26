// Vault — core app. Feature modules (graph/canvas/collab/plugins) get this API via init().
import { initGraph } from "./graph.js?v=45";
import { initCanvas } from "./canvas.js?v=45";
import { initCollab } from "./collab.js?v=45";
import { initPlugins } from "./plugins.js?v=45";
import { exportPdfFile } from "./pdf.js?v=45";
import { initLive } from "./live.js?v=45";
import { initDaily } from "./daily.js?v=45";

const $ = (id) => document.getElementById(id);
const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };
const BUILD = "v45";
const dbg = (...args) => { if (window.__DBG_ON) (window.__dbg = window.__dbg || []).push(args.join(" | ")); };
window.__dbg = window.__dbg || [];

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
  mode: "split",
  index: new Map(),
  history: [],
  hIndex: -1,
  commands: [],
  ribbonButtons: [],
  handlers: new Map(),
  pending: new Set(),
  bookmarks: JSON.parse(store.get("bookmarks", "[]")),
  folders: new Set(),
  second: null,
  groups: [{ tabs: [], active: null }],
  mobileGroup: Number(store.get("mobileGroup", "1")) === 2 ? 2 : 1,
};

let liveApi = null;
let livePath = null;
let live2Api = null;
let live2Path = null;
let activePane = 1;
let linkPane = 1;
let dailyApi = null;

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
    cache: "no-store",
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

function group1() { return state.groups[0]; }
function group2() { return state.groups[1] || null; }
function ensureGroup2() {
  if (!state.groups[1]) state.groups[1] = { tabs: [], active: null };
  return state.groups[1];
}
function groupFile(group) {
  if (!group || !group.active) return null;
  return state.open.find((f) => f.path === group.active) || null;
}
function addTab(group, path) {
  if (!group.tabs.includes(path)) group.tabs.push(path);
  group.active = path;
}
function removeTab(group, path) {
  const at = group.tabs.indexOf(path);
  if (at < 0) return;
  group.tabs.splice(at, 1);
  if (group.active === path) group.active = group.tabs[Math.max(0, at - 1)] || null;
}
function fileInAnyGroup(path) {
  return state.groups.some((group) => group.tabs.includes(path));
}
function syncSecond() {
  state.second = state.groups[1] ? state.groups[1].active : null;
}

let workspaceTimer = null;

function saveWorkspace() {
  const pane2 = $("pane2");
  const match = pane2 ? String(pane2.style.flex || "").match(/(\d+)px/) : null;
  const data = {
    v: 1,
    groups: state.groups.map((group) => ({ tabs: group.tabs.slice(), active: group.active })),
    pane2Width: state.groups[1] && match ? Number(match[1]) : null,
  };
  store.set("workspace", JSON.stringify(data));
}

function scheduleWorkspaceSave() {
  clearTimeout(workspaceTimer);
  workspaceTimer = setTimeout(saveWorkspace, 250);
}

async function restoreWorkspace() {
  let data = null;
  try { data = JSON.parse(store.get("workspace", "")); } catch { data = null; }
  if (!data || !Array.isArray(data.groups)) return false;
  const valid = (path) => typeof path === "string" && path.endsWith(".md") && state.files.includes(path);
  const specs = data.groups.slice(0, 2).map((group) => ({
    tabs: Array.isArray(group.tabs) ? group.tabs.filter(valid) : [],
    active: valid(group.active) ? group.active : null,
  }));
  if (!specs.length) return false;
  const paths = [...new Set(specs.flatMap((group) => group.tabs))];
  if (!paths.length) return false;
  for (const path of paths) {
    if (state.open.some((file) => file.path === path)) continue;
    try {
      const { text, sha } = await ghGet(path);
      state.index.set(path, text);
      state.open.push({ path, sha, text, dirty: false });
    } catch { /* missing file */ }
  }
  const loaded = new Set(state.open.map((file) => file.path));
  const build = (spec) => {
    const tabs = spec.tabs.filter((path) => loaded.has(path));
    return { tabs, active: tabs.includes(spec.active) ? spec.active : (tabs[0] || null) };
  };
  let groups = specs.map(build);
  if (!groups[0] || !groups[0].tabs.length) {
    if (groups[1] && groups[1].tabs.length) groups = [groups[1]];
    else return false;
  }
  if (groups[1] && !groups[1].tabs.length) groups = [groups[0]];
  state.groups = groups;
  state.active = groups[0].active;
  syncSecond();
  if (groups[1]) {
    document.body.classList.add("split");
    const saved = Number(data.pane2Width);
    if (Number.isFinite(saved) && saved > 120) {
      const mainWidth = document.querySelector("main").getBoundingClientRect().width || window.innerWidth;
      const width = Math.min(Math.round(saved), Math.max(120, Math.round(mainWidth * 0.85)));
      $("pane2").style.flex = "0 0 " + width + "px";
    } else {
      $("pane2").style.flex = "";
    }
  } else {
    document.body.classList.remove("split");
    $("pane2").style.flex = "";
  }
  setView("note");
  renderTabs();
  renderTree();
  paint();
  updateSplitButtons();
  applyMobilePane();
  return true;
}

function isMobileLayout() { return window.matchMedia("(max-width: 760px)").matches; }

function activeGroupIndex() {
  return isMobileLayout() && state.mobileGroup === 2 && state.groups[1] ? 1 : 0;
}

function applyMobilePane() {
  if (!isMobileLayout()) {
    document.body.classList.remove("mobile-pane2");
    const toggle = $("mobileSwitch");
    if (toggle) toggle.style.display = "none";
    renderTabs();
    return;
  }
  if (!state.groups[1]) state.mobileGroup = 1;
  if (state.mobileGroup === 1 && !group1().tabs.length && state.groups[1] && state.groups[1].tabs.length) state.mobileGroup = 2;
  if (state.mobileGroup === 2 && !state.groups[1]) state.mobileGroup = 1;
  store.set("mobileGroup", String(state.mobileGroup));
  const showSecond = !!state.groups[1] && state.mobileGroup === 2;
  document.body.classList.toggle("mobile-pane2", showSecond);
  const toggle = $("mobileSwitch");
  if (toggle) {
    toggle.style.display = state.groups[1] ? "flex" : "none";
    toggle.querySelectorAll("button").forEach((btn) => {
      btn.classList.toggle("active", Number(btn.dataset.group) === (showSecond ? 2 : 1));
    });
  }
  renderTabs();
  if (showSecond) paintSecond();
}

function setMobileGroup(index) {
  state.mobileGroup = index === 2 ? 2 : 1;
  store.set("mobileGroup", String(state.mobileGroup));
  applyMobilePane();
  if (isMobileLayout()) {
    if (state.mobileGroup === 2) {
      if (state.mode === "live") live2Api?.focus(); else $("editor2").focus();
    } else if (state.mode === "live") {
      liveApi?.focus();
    } else {
      $("editor").focus();
    }
  }
}

function theme() { document.documentElement.dataset.theme = store.get("theme", "dark"); }

const ACCENT_PRESETS = ["#a882ff", "#5d9cff", "#52c98a", "#e0b458", "#e5686c", "#ff7ac6", "#7ad7d7", "#9a9a9a"];

const HOTKEY_ACTIONS = [
  { id: "save", label: "Зберегти нотатку", def: "Mod+S" },
  { id: "mode", label: "Режим: редактор / live / читання", def: "Mod+E" },
  { id: "palette", label: "Палітра команд", def: "Mod+P" },
  { id: "switcher", label: "Швидкий перехід", def: "Mod+O" },
  { id: "graph", label: "Graph view", def: "Mod+G" },
  { id: "find", label: "Знайти", def: "Mod+F" },
  { id: "replace", label: "Замінити", def: "Mod+H" },
  { id: "left", label: "Ліва панель", def: "Mod+B" },
  { id: "right", label: "Права панель", def: "Mod+Shift+B" },
  { id: "theme", label: "Тема", def: "Mod+Shift+L" },
];
const DEFAULT_HOTKEYS = Object.fromEntries(HOTKEY_ACTIONS.map((action) => [action.id, action.def]));
let hotkeys = { ...DEFAULT_HOTKEYS };
try { Object.assign(hotkeys, JSON.parse(store.get("hotkeys", "{}"))); } catch { /* keep defaults */ }

function applyAccent() {
  const accent = store.get("accent", "");
  if (accent) {
    document.documentElement.style.setProperty("--accent", accent);
    document.documentElement.style.setProperty("--accent-2", "color-mix(in srgb, " + accent + " 72%, #000)");
  } else {
    document.documentElement.style.removeProperty("--accent");
    document.documentElement.style.removeProperty("--accent-2");
  }
}

function applyPrefs() {
  const font = store.get("font", "15");
  document.documentElement.style.setProperty("--editor-font-size", font + "px");
  $("editor").style.fontSize = "";
  document.documentElement.style.setProperty("--editor-width", store.get("width", "46rem"));
  applyAccent();
}

function comboFromEvent(event) {
  const parts = [];
  if (event.ctrlKey || event.metaKey) parts.push("Mod");
  if (event.altKey) parts.push("Alt");
  if (event.shiftKey) parts.push("Shift");
  if (!event.key || ["Control", "Meta", "Alt", "Shift", "CapsLock"].includes(event.key)) return "";
  let name = event.key.length === 1 ? event.key.toUpperCase() : event.key;
  if (name === " ") name = "Space";
  parts.push(name);
  return parts.join("+");
}

function runHotkey(id) {
  switch (id) {
    case "save": saveNote(); break;
    case "mode": toggleMode(); break;
    case "palette": showPalette(); break;
    case "switcher": showSwitcher(); break;
    case "graph": setView(state.view === "graph" ? "note" : "graph"); break;
    case "find": openFind(); break;
    case "replace": openFind(); $("replaceInput").focus(); break;
    case "left": toggleLeft(); break;
    case "right": toggleRight(); break;
    case "theme": toggleTheme(); break;
  }
}


/* ---------------- commands ---------------- */
function registerCommand(cmd) {
  state.commands.push(cmd);
  return () => {
    const at = state.commands.indexOf(cmd);
    if (at >= 0) state.commands.splice(at, 1);
  };
}
function addRibbonButton(btn) {
  state.ribbonButtons.push(btn);
  renderRibbonExtra();
  return () => {
    const at = state.ribbonButtons.indexOf(btn);
    if (at >= 0) state.ribbonButtons.splice(at, 1);
    renderRibbonExtra();
  };
}
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
  const all = (data.tree || []).filter((n) => n.type === "blob").map((n) => n.path);
  state.folders = new Set();
  for (const p of all) {
    if (p.endsWith("/.gitkeep")) state.folders.add(p.slice(0, -"/.gitkeep".length));
  }
  const remote = all
    .filter((p) => p.endsWith(".md") || p.endsWith(".canvas"))
    .map((p) => p);
  const remoteSet = new Set(remote);
  for (const p of [...state.pending]) { if (remoteSet.has(p)) state.pending.delete(p); }
  for (const p of state.pending) if (!remoteSet.has(p)) remote.push(p);
  state.files = remote.sort((a, b) => a.localeCompare(b, "uk", { numeric: true }));
  renderTree();
  renderBookmarks();
  renderTags();
  emit("tree", state.files);
}

async function listAll() {
  const data = await api("/repos/" + state.repo + "/git/trees/" + state.branch + "?recursive=1");
  return (data.tree || []).filter((node) => node.type === "blob").map((node) => node.path);
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
  for (const folder of state.folders) {
    const parts = folder.split("/");
    let node = tree;
    for (const part of parts) {
      if (!node[part] || node[part] === null) node[part] = {};
      node = node[part];
    }
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
      if (leaf.startsWith(".")) continue;
      const full = prefix ? prefix + "/" + leaf : leaf;
      const row = el("div", "file-row" + (full === state.active ? " active" : ""));
      row.style.paddingLeft = 12 + depth * 12 + "px";
      row.draggable = true;
      row.appendChild(el("span", null, full.endsWith(".canvas") ? "🎨" : "📄"));
      row.appendChild(el("span", "label", leaf.replace(/\.(md|canvas)$/, "")));
      const starred = state.bookmarks.includes(full);
      const star = el("button", "star-btn" + (starred ? " on" : ""), "★");
      star.title = starred ? "Зняти із закладок" : "У закладки";
      star.onclick = (e) => { e.stopPropagation(); toggleBookmark(full); };
      row.appendChild(star);
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
      row.oncontextmenu = (e) => { e.preventDefault(); e.stopPropagation(); fileContext(e, full); };
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
    state.pending.add(target);
    if (path.endsWith(".canvas")) {
      await ghPutRaw(path, b64encode(text), sha, "cleanup move " + path);
      await ghDelete(path, sha);
    } else {
      await ghDelete(path, sha);
    }
    const openFile = state.open.find((f) => f.path === path);
    if (openFile) openFile.path = target;
    if (state.active === path) state.active = target;
    for (const group of state.groups) {
      group.tabs = group.tabs.map((item) => (item === path ? target : item));
      if (group.active === path) group.active = target;
    }
    state.active = group1().active;
    syncSecond();
    if (state.index.has(path)) { state.index.set(target, state.index.get(path)); state.index.delete(path); }
    const bmAt = state.bookmarks.indexOf(path);
    if (bmAt >= 0) { state.bookmarks[bmAt] = target; store.set("bookmarks", JSON.stringify(state.bookmarks)); renderBookmarks(); }
    state.pending.delete(path);
    await loadTree();
    renderTabs(); paint();
    setState("переміщено", "ok");
    emit("rename", { from: path, to: target });
    toast("→ " + target);
  } catch (error) {
    setState("помилка: " + error.message, "err");
    toast("Не перемістилось: " + error.message);
  }
}

/* ---------------- bookmarks, context menu, split pane ---------------- */
function renderBookmarks() {
  const host = $("bookmarks");
  if (!host) return;
  host.innerHTML = "";
  if (!state.bookmarks.length) return;
  host.appendChild(el("div", "bm-head", "Закладки"));
  for (const path of state.bookmarks) {
    const row = el("div", "bm-item");
    row.appendChild(el("span", "star", "★"));
    row.appendChild(el("span", null, path.replace(/\.(md|canvas)$/, "")));
    row.onclick = () => openNote(path);
    row.oncontextmenu = (e) => { e.preventDefault(); e.stopPropagation(); fileContext(e, path); };
    host.appendChild(row);
  }
}

function toggleBookmark(path) {
  const at = state.bookmarks.indexOf(path);
  if (at >= 0) state.bookmarks.splice(at, 1);
  else state.bookmarks.push(path);
  store.set("bookmarks", JSON.stringify(state.bookmarks));
  renderBookmarks();
  renderTree();
  toast(at >= 0 ? "знято із закладок" : "у закладках: " + path.split("/").pop());
}

function showCtx(x, y, items) {
  const menu = $("ctxMenu");
  menu.innerHTML = "";
  for (const item of items) {
    if (item.sep) { menu.appendChild(el("div", "ctx-sep")); continue; }
    const row = el("div", "ctx-item" + (item.danger ? " danger" : ""), item.label);
    row.onclick = () => { hideCtx(); item.run(); };
    menu.appendChild(row);
  }
  menu.classList.add("show");
  const rect = menu.getBoundingClientRect();
  menu.style.left = Math.max(6, Math.min(x, window.innerWidth - rect.width - 8)) + "px";
  menu.style.top = Math.max(6, Math.min(y, window.innerHeight - rect.height - 8)) + "px";
}
function hideCtx() { const m = $("ctxMenu"); if (m) m.classList.remove("show"); }

function fileContext(event, path) {
  showCtx(event.clientX, event.clientY, [
    { label: "Відкрити", run: () => openNote(path) },
    { label: "Відкрити в другій панелі", run: () => openInSecond(path) },
    { sep: true },
    { label: "Перейменувати", run: () => renameNote(path) },
    { label: "Перемістити…", run: () => moveFilePrompt(path) },
    { label: "Дублювати", run: () => duplicateNote(path) },
    { label: "Копіювати шлях", run: () => navigator.clipboard.writeText(path).then(() => toast("шлях скопійовано"), () => toast("буфер недоступний")) },
    { sep: true },
    { label: state.bookmarks.includes(path) ? "Зняти із закладок" : "У закладки", run: () => toggleBookmark(path) },
    { sep: true },
    { label: "Видалити", danger: true, run: () => deleteNote(path) },
  ]);
}

async function moveFilePrompt(path) {
  const folders = [...state.folders].filter((f) => f && f !== ".").sort();
  const raw = prompt("Тека (порожньо — корінь):\n" + folders.slice(0, 20).join(", "), "");
  if (raw === null) return;
  await moveFile(path, raw.trim().replace(/^\/+|\/+$/g, ""));
}

async function duplicateNote(path) {
  try {
    const { text } = await ghGet(path);
    const dot = path.lastIndexOf(".");
    const target = dot > 0 ? path.slice(0, dot) + " copy" + path.slice(dot) : path + " copy.md";
    await ghPut(target, text, null, "duplicate " + path);
    state.pending.add(target);
    await loadTree();
    emit("create", target);
    toast("створено " + target);
  } catch (error) { toast("Не вийшло: " + error.message); }
}

async function newFolder() {
  const raw = prompt("Назва теки (можна з підпапкою):", "Нова тека");
  if (!raw) return;
  const name = raw.trim().replace(/^\/+|\/+$/g, "");
  if (!name) return;
  const marker = name + "/.gitkeep";
  try {
    await ghPut(marker, "", null, "add folder " + name);
    await loadTree();
    emit("create", marker);
    toast("теку створено: " + name);
  } catch (error) { toast("Не вийшло: " + error.message); }
}

function openInSecond(path) {
  if (!path) return;
  const apply = () => {
    const group = ensureGroup2();
    addTab(group, path);
    document.body.classList.add("split");
    if (isMobileLayout()) state.mobileGroup = 2;
    syncSecond();
    paint();
    updateSplitButtons();
    applyMobilePane();
  };
  if (state.open.some((f) => f.path === path)) { apply(); return; }
  openNote(path).then(apply, apply);
}

function closeSecond() {
  const group = state.groups[1];
  if (group) {
    const orphanDirty = group.tabs
      .filter((path) => !group1().tabs.includes(path))
      .map((path) => state.open.find((file) => file.path === path))
      .filter((file) => file && file.dirty);
    if (orphanDirty.length && !confirm("У другій панелі є незбережені зміни. Закрити?")) return;
    for (const path of group.tabs.slice()) {
      if (!group1().tabs.includes(path)) {
        const at = state.open.findIndex((f) => f.path === path);
        if (at >= 0) state.open.splice(at, 1);
      }
    }
    state.groups.splice(1, 1);
  }
  document.body.classList.remove("split");
  $("pane2").style.flex = "";
  state.mobileGroup = 1;
  syncSecond();
  state.active = group1().active;
  renderTabs(); renderTree(); paint(); updateSplitButtons();
  applyMobilePane();
}

function updateSplitButtons() {
  const btn = $("splitBtn");
  const open = !!state.groups[1];
  if (btn) {
    btn.textContent = open ? "▣" : "▢";
    btn.title = open ? "Закрити другу панель" : "Відкрити другу панель";
  }
}

function renderPane2Tabs() {
  const host = $("pane2Tabs");
  if (!host) return;
  host.innerHTML = "";
  const group = state.groups[1];
  if (!group) { syncSecond(); return; }
  for (const path of group.tabs) {
    const file = state.open.find((f) => f.path === path);
    if (!file) continue;
    const tab = el("div", "tab" + (path === group.active ? " active" : ""));
    tab.appendChild(el("span", "name", path.split("/").pop().replace(/\.md$/, "")));
    if (file.dirty) tab.appendChild(el("span", "dot", "•"));
    const x = el("span", "close", "✕");
    x.onclick = (event) => { event.stopPropagation(); closeTab(path, 1); };
    tab.appendChild(x);
    tab.onclick = () => {
      activePane = 2;
      group.active = path;
      syncSecond();
      paintSecond();
      renderPane2Tabs();
    };
    tab.onauxclick = (event) => { if (event.button === 1) closeTab(path, 1); };
    makeTabDraggable(tab, path, "pane2");
    tab.addEventListener("dragover", (event) => {
      if (![...event.dataTransfer.types].includes("text/vault-tab")) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = "move";
      const rect = tab.getBoundingClientRect();
      const after = event.clientX > rect.left + rect.width / 2;
      tab.classList.toggle("drop-after", after);
      tab.classList.toggle("drop-before", !after);
    });
    tab.addEventListener("dragleave", () => tab.classList.remove("drop-before", "drop-after"));
    tab.addEventListener("drop", (event) => {
      const moved = event.dataTransfer.getData("text/vault-tab");
      const source = event.dataTransfer.getData("text/vault-tab-source");
      if (!moved) return;
      event.preventDefault();
      event.stopPropagation();
      clearTabDropMarkers();
      if (source === "main") { moveTabBetweenGroups(0, moved, 1); return; }
      const rect = tab.getBoundingClientRect();
      const after = event.clientX > rect.left + rect.width / 2;
      reorderGroupTabs(1, moved, path, after);
    });
    host.appendChild(tab);
  }
  host.ondragover = (event) => {
    if ([...event.dataTransfer.types].includes("text/vault-tab")) event.preventDefault();
  };
  host.ondrop = (event) => {
    const moved = event.dataTransfer.getData("text/vault-tab");
    const source = event.dataTransfer.getData("text/vault-tab-source");
    if (!moved) return;
    event.preventDefault();
    event.stopPropagation();
    if (source === "main") moveTabBetweenGroups(0, moved, 1);
    else reorderGroupTabs(1, moved, null, false);
  };
  syncSecond();
  scheduleWorkspaceSave();
}

function moveTabToSecond(path) {
  moveTabBetweenGroups(0, path, 1);
}

function returnFromSecond(path) {
  moveTabBetweenGroups(1, path, 0);
}

function syncHighlight2() {
  const pre = $("hlCode2");
  if (!pre) return;
  const ed = $("editor2");
  pre.innerHTML = highlightMarkdown(ed.value) + "\n";
  pre.style.transform = "translateY(" + -ed.scrollTop + "px)";
}

function paintSecond() {
  const ed = $("editor2");
  if (!ed) return;
  const file = groupFile(state.groups[1]);
  ed.value = file ? file.text : "";
  ed.readOnly = !file;
  syncHighlight2();
  syncSecond();
  renderPane2Tabs();
  if (live2Api) {
    const path = file ? file.path : null;
    if (live2Path !== path) {
      live2Api.reset(file ? file.text : "");
      live2Path = path;
    } else {
      live2Api.setDoc(file ? file.text : "");
    }
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
    addTab(group1(), path);
    setView("note");
    if (pushHistory) pushHistoryState(path);
    renderTabs(); renderTree(); paint();
    return;
  }
  try {
    setState("відкриваю…");
    let got = await ghGet(path);
    if (!got.text) {
      // GitHub occasionally answers with an empty body right after a write; ask again.
      await new Promise((r) => setTimeout(r, 900));
      const again = await ghGet(path).catch(() => null);
      if (again && again.text) got = again;
    }
    const { text, sha } = got;
    dbg("openNote", path, "len=" + text.length);
    state.index.set(path, text);
    state.open.push({ path, sha, text, dirty: false });
    state.active = path;
    addTab(group1(), path);
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

function closeTab(path, groupIndex = 0) {
  const file = state.open.find((f) => f.path === path);
  if (!file) return;
  const group = state.groups[groupIndex];
  if (!group) return;
  const otherGroupHas = state.groups.some((item, index) => index !== groupIndex && item.tabs.includes(path));
  if (file.dirty && !otherGroupHas && !confirm("Є незбережені зміни. Закрити?")) return;
  removeTab(group, path);
  if (!fileInAnyGroup(path)) {
    const at = state.open.indexOf(file);
    if (at >= 0) state.open.splice(at, 1);
  }
  if (groupIndex === 0) {
    state.active = group.active;
  } else {
    if (!group.tabs.length) {
      state.groups.splice(1, 1);
      document.body.classList.remove("split");
      $("pane2").style.flex = "";
    }
    syncSecond();
  }
  if (!group1().tabs.length) state.active = group1().active;
  if (!state.groups[1]) state.mobileGroup = 1;
  renderTabs(); renderTree(); paint(); updateSplitButtons();
  applyMobilePane();
}

function clearTabDropMarkers() {
  document.querySelectorAll(".tab.drop-before, .tab.drop-after").forEach((tab) => tab.classList.remove("drop-before", "drop-after"));
}

function makeTabDraggable(tab, path, source) {
  tab.draggable = true;
  tab.addEventListener("dragstart", (event) => {
    event.dataTransfer.setData("text/vault-tab", path);
    event.dataTransfer.setData("text/vault-tab-source", source);
    event.dataTransfer.effectAllowed = "move";
    tab.classList.add("dragging");
  });
  tab.addEventListener("dragend", () => {
    tab.classList.remove("dragging");
    clearTabDropMarkers();
  });
}

function reorderGroupTabs(groupIndex, fromPath, toPath, after) {
  const group = state.groups[groupIndex];
  if (!group) return;
  const from = group.tabs.indexOf(fromPath);
  if (from < 0) return;
  const [path] = group.tabs.splice(from, 1);
  let at = toPath ? group.tabs.indexOf(toPath) : group.tabs.length;
  if (at < 0) at = group.tabs.length;
  if (after) at += 1;
  group.tabs.splice(at, 0, path);
  renderTabs();
}

function moveTabBetweenGroups(fromIndex, path, toIndex) {
  const from = state.groups[fromIndex];
  if (!from || fromIndex === toIndex || !from.tabs.includes(path)) return;
  const to = toIndex === 1 ? ensureGroup2() : state.groups[0];
  removeTab(from, path);
  addTab(to, path);
  if (toIndex === 0) {
    state.active = path;
    pushHistoryState(path);
  } else {
    state.active = group1().active;
  }
  if (state.groups[1] && !state.groups[1].tabs.length) {
    state.groups.splice(1, 1);
    document.body.classList.remove("split");
    $("pane2").style.flex = "";
  }
  if (isMobileLayout()) state.mobileGroup = toIndex === 1 && state.groups[1] ? 2 : 1;
  syncSecond();
  renderTabs(); renderTree(); paint(); updateSplitButtons();
  applyMobilePane();
}

function renderTabs() {
  const host = $("tabs");
  const groupIndex = activeGroupIndex();
  const group = state.groups[groupIndex] || group1();
  const activePath = groupIndex === 1 ? group.active : state.active;
  host.innerHTML = "";
  for (const path of group.tabs) {
    const file = state.open.find((item) => item.path === path);
    if (!file) continue;
    const isActive = path === activePath && (groupIndex === 1 || state.view === "note");
    const tab = el("div", "tab" + (isActive ? " active" : ""));
    tab.appendChild(el("span", "name", path.split("/").pop().replace(/\.md$/, "")));
    if (file.dirty) tab.appendChild(el("span", "dot", "•"));
    const x = el("span", "close", "✕");
    x.onclick = (e) => { e.stopPropagation(); closeTab(path, groupIndex); };
    tab.appendChild(x);
    tab.onclick = () => {
      if (groupIndex === 1) {
        group.active = path;
        syncSecond();
        paintSecond();
        renderTabs();
        return;
      }
      activePane = 1;
      state.active = path;
      group1().active = path;
      setView("note");
      pushHistoryState(path);
      renderTabs(); renderTree(); paint();
    };
    tab.onauxclick = (e) => { if (e.button === 1) closeTab(path, groupIndex); };
    makeTabDraggable(tab, path, "main");
    tab.addEventListener("dragover", (event) => {
      if (![...event.dataTransfer.types].includes("text/vault-tab")) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = "move";
      const rect = tab.getBoundingClientRect();
      const after = event.clientX > rect.left + rect.width / 2;
      tab.classList.toggle("drop-after", after);
      tab.classList.toggle("drop-before", !after);
    });
    tab.addEventListener("dragleave", () => tab.classList.remove("drop-before", "drop-after"));
    tab.addEventListener("drop", (event) => {
      const moved = event.dataTransfer.getData("text/vault-tab");
      const source = event.dataTransfer.getData("text/vault-tab-source");
      if (!moved) return;
      event.preventDefault();
      event.stopPropagation();
      clearTabDropMarkers();
      if (source === "pane2" && !isMobileLayout()) { moveTabBetweenGroups(1, moved, 0); return; }
      const rect = tab.getBoundingClientRect();
      const after = event.clientX > rect.left + rect.width / 2;
      reorderGroupTabs(groupIndex, moved, path, after);
    });
    host.appendChild(tab);
  }
  host.ondragover = (event) => {
    if ([...event.dataTransfer.types].includes("text/vault-tab")) event.preventDefault();
  };
  host.ondrop = (event) => {
    if (event.target.closest(".tab")) return;
    const moved = event.dataTransfer.getData("text/vault-tab");
    const source = event.dataTransfer.getData("text/vault-tab-source");
    if (!moved) return;
    event.preventDefault();
    if (source === "pane2" && !isMobileLayout()) moveTabBetweenGroups(1, moved, 0);
    else reorderGroupTabs(groupIndex, moved, null, false);
  };
  renderPane2Tabs();
  scheduleWorkspaceSave();
}

function paint() {
  const file = currentFile();
  dbg("paint", "active=" + state.active, "fileLen=" + (file ? file.text.length : "none"), "editorBefore=" + $("editor").value.length);
  $("editor").value = file ? file.text : "";
  $("editor").readOnly = !file;
  $("stPath").textContent = state.view === "graph" ? "Graph view" : state.view === "canvas" ? ($("canvasName").textContent || "Canvas") : (file ? file.path : "—");
  $("stBranch").textContent = state.repo.split("/")[1] + " · " + state.branch + " · " + BUILD;
  document.title = (file ? file.path.split("/").pop().replace(/\.md$/, "") + " · " : "") + "Vault";
  renderPreview();
  if (liveApi) {
    if (!file) { liveApi.setDoc(""); livePath = null; }
    else if (livePath !== file.path) { liveApi.reset(file.text); livePath = file.path; }
    else liveApi.setDoc(file.text);
  }
  renderContext();
  renderOutline();
  syncHighlight();
  paintSecond();
  const words = file ? file.text.trim().split(/\s+/).filter(Boolean).length : 0;
  $("stMeta").textContent = file ? words + " слів · " + file.text.length + " симв." : "";
  setState(file ? (file.dirty ? "не збережено" : "синхронізовано") : "", file && file.dirty ? "warn" : "ok");
  emit("paint", file);
}

async function saveNote(silent = false, target = null) {
  const file = target || currentFile();
  if (!file) return;
  try {
    if (!silent) setState("зберігаю…");
    const data = await ghPut(file.path, file.text, file.sha, "edit: " + file.path);
    file.sha = data.content.sha;
    file.dirty = false;
    state.index.set(file.path, file.text);
    renderTabs(); paint();
    setState("збережено " + new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }), "ok");
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
    state.pending.add(path);
    await loadTree();
    await openNote(path);
    emit("create", path);
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
    state.pending.add(target);
    state.pending.delete(path);
    await ghDelete(path, sha);
    const openFile = state.open.find((f) => f.path === path);
    if (openFile) openFile.path = target;
    if (state.active === path) state.active = target;
    for (const group of state.groups) {
      group.tabs = group.tabs.map((item) => (item === path ? target : item));
      if (group.active === path) group.active = target;
    }
    state.active = group1().active;
    syncSecond();
    await loadTree(); renderTabs(); paint();
    emit("rename", { from: path, to: target });
    toast("перейменовано");
  } catch (error) { toast("Не вийшло: " + error.message); }
}

async function deleteNote(path) {
  if (!confirm("Видалити " + path + "?")) return;
  try {
    const { sha } = await ghGet(path);
    await ghDelete(path, sha);
    state.open = state.open.filter((f) => f.path !== path);
    for (const group of state.groups) {
      group.tabs = group.tabs.filter((item) => item !== path);
      if (group.active === path) group.active = group.tabs[0] || null;
    }
    if (state.groups[1] && !state.groups[1].tabs.length) {
      state.groups.splice(1, 1);
      document.body.classList.remove("split");
      $("pane2").style.flex = "";
    }
    state.active = group1().active;
    syncSecond();
    await loadTree(); renderTabs(); paint(); updateSplitButtons();
    emit("delete", path);
    toast("видалено");
  } catch (error) { toast("Не вийшло: " + error.message); }
}

/* ---------------- images ---------------- */
function insertAtCursor(text) {
  const api = activePane === 2 && live2Api ? live2Api : liveApi;
  if (state.mode === "live" && api) { api.insertAtCaret(text); return; }
  const ed = activePane === 2 ? $("editor2") : $("editor");
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
/* ---------------- task list checkboxes ---------------- */
function taskItems(text) {
  const lines = text.split(/\r?\n/);
  const out = [];
  let inFence = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^\s*(```|~~~)/.test(line)) { inFence = !inFence; continue; }
    if (inFence) continue;
    const m = line.match(/^(\s*(?:[-*+]|\d+\.)\s+\[)( |x|X)(\])/);
    if (m) out.push({ line: i, checked: m[2].toLowerCase() === "x", prefixLen: m[1].length });
  }
  return out;
}

function toggleTaskLine(lineIndex, prefixLen) {
  const file = currentFile();
  if (!file) return;
  const eol = file.text.includes("\r\n") ? "\r\n" : "\n";
  const lines = file.text.split(/\r?\n/);
  const line = lines[lineIndex];
  if (!line) return;
  const ch = line.charAt(prefixLen);
  if (ch !== " " && ch.toLowerCase() !== "x") return;
  lines[lineIndex] = line.slice(0, prefixLen) + (ch.toLowerCase() === "x" ? " " : "x") + line.slice(prefixLen + 1);
  file.text = lines.join(eol);
  file.dirty = true;
  state.index.set(file.path, file.text);
  $("editor").value = file.text;
  renderPreview();
  setState("не збережено", "warn");
  emit("edit", { path: file.path, text: file.text, prev: file.text });
  emit("modify", { path: file.path, text: file.text, prev: file.text });
  clearTimeout($("editor")._t);
  $("editor")._t = setTimeout(() => saveNote(true), 1200);
  toast("позначено");
}

function stripYamlComment(value) {
  let quote = null;
  for (let i = 0; i < value.length; i++) {
    const ch = value[i];
    if (quote) {
      if (ch === quote && value[i - 1] !== "\\") quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") { quote = ch; continue; }
    if (ch === "#" && (i === 0 || /\s/.test(value[i - 1]))) return value.slice(0, i).trimEnd();
  }
  return value.trimEnd();
}

function parseProps(text) {
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---[ \t]*\r?\n/);
  if (!m) return null;
  const rows = m[1].split(/\r?\n/).filter((l) => l.trim() && !l.trim().startsWith("#"));
  const props = [];
  for (const line of rows) {
    const kv = line.match(/^([A-Za-z0-9_\u0400-\u04FF-]+):\s*(.*)$/);
    if (kv) {
      const raw = stripYamlComment(kv[2]);
      props.push([kv[1], raw.replace(/^["']|["']$/g, "")]);
      continue;
    }
    const item = line.match(/^\s*-\s*(.*)$/);
    if (item && props.length) {
      const last = props[props.length - 1];
      const value = stripYamlComment(item[1]).replace(/^["']|["']$/g, "").trim();
      last[1] = last[1] ? last[1] + ", " + value : value;
    }
  }
  return { raw: m[0], body: text.slice(m[0].length), props };
}

const READING_TRIANGLE_SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="svg-icon right-triangle"><path d="M3 8L12 17L21 8"></path></svg>';

function buildReadingHeader(file, parsed) {
  const header = el("div", "mod-header mod-ui");
  const title = el("div", "inline-title", file.path.split("/").pop().replace(/\.md$/, ""));
  title.contentEditable = "false";
  title.spellcheck = true;
  title.tabIndex = -1;
  header.appendChild(title);
  if (!parsed || !parsed.props.length) return header;
  const container = el("div", "metadata-container");
  container.tabIndex = -1;
  container.dataset.propertyCount = String(parsed.props.length);
  const error = el("div", "metadata-error-container");
  error.style.display = "none";
  container.appendChild(error);
  const heading = el("div", "metadata-properties-heading");
  heading.tabIndex = 0;
  const collapse = el("div", "collapse-indicator collapse-icon");
  collapse.innerHTML = READING_TRIANGLE_SVG;
  const headingTitle = el("div", "metadata-properties-title", "Властивості");
  heading.append(collapse, headingTitle);
  const content = el("div", "metadata-content");
  const properties = el("div", "metadata-properties");
  for (const [key, value] of parsed.props) {
    const prop = el("div", "metadata-property");
    prop.tabIndex = 0;
    prop.dataset.propertyKey = key;
    const keyEl = el("div", "metadata-property-key");
    const icon = el("span", "metadata-property-icon");
    icon.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="svg-icon lucide-text"><path d="M17 6.1H3"></path><path d="M21 12.1H3"></path><path d="M15.1 18H3"></path></svg>';
    const input = document.createElement("input");
    input.className = "metadata-property-key-input";
    input.value = key;
    input.readOnly = true;
    input.spellcheck = false;
    keyEl.append(icon, input);
    const valueEl = el("div", "metadata-property-value");
    if (key === "tags" || key === "aliases") {
      const multi = el("div", "multi-select-container");
      for (const item of String(value).split(",").map((part) => part.trim()).filter(Boolean)) {
        const pill = el("div", "multi-select-pill");
        const pillContent = el("div", "multi-select-pill-content");
        pillContent.appendChild(el("span", null, item));
        pill.appendChild(pillContent);
        multi.appendChild(pill);
      }
      valueEl.appendChild(multi);
    } else {
      valueEl.appendChild(el("div", "metadata-input-longtext", value));
    }
    prop.append(keyEl, valueEl);
    properties.appendChild(prop);
  }
  content.appendChild(properties);
  container.append(heading, content);
  header.appendChild(container);
  return header;
}

function blockWrapClass(node) {
  if (node.matches("div.callout")) return "el-div";
  if (node.classList.contains("embed-note")) return "el-div";
  const tag = node.tagName.toLowerCase();
  if (/^h[1-6]$/.test(tag)) return "el-" + tag;
  if (tag === "p") return "el-p";
  if (tag === "table") return "el-table";
  if (tag === "ul") return "el-ul";
  if (tag === "ol") return "el-ol";
  if (tag === "pre") return "el-pre";
  if (tag === "blockquote") return "el-blockquote";
  if (tag === "hr") return "el-hr";
  return "el-p";
}

function renderPreview() {
  const file = currentFile();
  const host = $("preview");
  if (!file) { host.innerHTML = ""; return; }
  const parsed = parseProps(file.text);
  const body = parsed ? parsed.body : file.text;

  host.innerHTML = "";
  const pusher = el("div", "markdown-preview-pusher");
  pusher.style.width = "1px";
  pusher.style.height = "0.1px";
  pusher.style.marginBottom = "0px";
  host.appendChild(pusher);
  host.appendChild(buildReadingHeader(file, parsed));
  if (parsed) {
    const frontmatter = el("div", "el-pre mod-frontmatter mod-ui");
    const pre = document.createElement("pre");
    pre.className = "frontmatter language-yaml";
    pre.style.display = "none";
    const code = document.createElement("code");
    code.className = "language-yaml is-loaded";
    code.textContent = parsed.raw;
    pre.appendChild(code);
    frontmatter.appendChild(pre);
    host.appendChild(frontmatter);
  }

  const tmp = document.createElement("div");
  tmp.innerHTML = markdownToHtml(body);
  styleCallouts(tmp);
  for (const child of [...tmp.children]) {
    const wrap = el("div", blockWrapClass(child));
    if (wrap.className === "el-table") {
      wrap.dir = "ltr";
      wrap.style.overflowX = "auto";
    }
    wrap.appendChild(child);
    host.appendChild(wrap);
  }

  const footer = el("div", "mod-footer mod-ui");
  const backlinks = el("div", "embedded-backlinks");
  backlinks.style.display = "none";
  footer.appendChild(backlinks);
  host.appendChild(footer);
  wireRendered(host, file.text, 0);
  resolveEmbeds(host);
}

function markdownToHtml(body) {
  const fences = [];
  let src = body.replace(/(^|\n)(```|~~~)[\s\S]*?(?:\n\2\s*(?=\n|$)|$)/g, (m, pre) => {
    fences.push(m.slice(pre.length));
    return pre + "\u0000F" + (fences.length - 1) + "\u0000";
  });

  src = src.replace(/!\[\[([^\]]+)\]\]/g, (m, inner) => {
    const name = inner.split("|")[0].trim();
    if (/\.(svg|png|jpe?g|gif|webp|bmp|avif)$/i.test(name)) {
      return "![" + name + "](" + encodeURI("https://raw.githubusercontent.com/" + state.repo + "/" + state.branch + "/" + name.replace(/^\.?\//, "")) + ")";
    }
    return '<div class="embed-note" data-note="' + encodeURIComponent(name) + '">…</div>';
  });
  src = src.replace(/\[\[([^\]|]+)(\|[^\]]+)?\]\]/g, (m, t, l) => {
    const target = t.trim();
    const label = (l ? l.slice(1) : t).trim();
    const safe = target.replace(/"/g, "&quot;");
    return '<a class="internal-link" data-target="' + safe + '" data-href="' + safe + '" href="' + encodeURI(target) + '">' + escapeHtml(label) + "</a>";
  });
  src = src.replace(/(^|\s)#([A-Za-z0-9_\u0400-\u04FF][A-Za-z0-9_\u0400-\u04FF/-]{1,})/g, (m, pre, tag) =>
    pre + '<a class="tag" data-tag="' + escapeHtml(tag) + '" href="#' + escapeHtml(tag) + '">#' + escapeHtml(tag) + "</a>");
  src = src.replace(/==([^=\n]+)==/g, '<mark data-highlight="">$1</mark>');
  src = src.replace(/^>\s*\[!(\w+)\]([+-]?)\s*(.*)$/gm, (m, kind, fold, title) =>
    "> <span class=\"callout-kind\" data-kind=\"" + kind.toLowerCase() + "\" data-fold=\"" + fold + "\">" + escapeHtml(title) + "</span>");
  src = src.replace(/\u0000F(\d+)\u0000/g, (m, i) => fences[Number(i)]);

  let html;
  if (!window.marked) {
    html = '<div style="background:#5a2323;color:#fff;padding:8px 12px;border-radius:8px;margin-bottom:12px">' +
      'Markdown-рушій не завантажився. Онови сторінку з Ctrl+Shift+R.</div>' +
      "<pre>" + escapeHtml(src) + "</pre>";
  } else {
    html = marked.parse(src, { breaks: true, mangle: false, headerIds: false });
  }
  return html;
}

const CALLOUT_TITLES = { note: "Нотатка", tip: "Порада", info: "Інфо", success: "Готово", warning: "Увага", danger: "Небезпека", bug: "Баг", example: "Приклад", quote: "Цитата", todo: "Зробити" };

function calloutIconSvg(kind) {
  const paths = {
    note: '<path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z"></path><path d="m15 5 4 4"></path>',
    tip: '<path d="M9 18h6"></path><path d="M10 22h4"></path><path d="M12 2a7 7 0 0 0-4 12.7c.6.5 1 1.2 1 2V18h6v-1.3c0-.8.4-1.5 1-2A7 7 0 0 0 12 2z"></path>',
    warning: '<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"></path><path d="M12 9v4"></path><path d="M12 17h.01"></path>',
    danger: '<path d="M12 2 2 22h20z"></path><path d="M12 9v4"></path><path d="M12 17h.01"></path>',
    success: '<path d="M20 6 9 17l-5-5"></path>',
    info: '<circle cx="12" cy="12" r="10"></circle><path d="M12 16v-4"></path><path d="M12 8h.01"></path>',
    quote: '<path d="M3 21c3 0 7-1 7-8V5c0-1.25-.756-2.017-2-2H4c-1.25 0-2 .75-2 1.972V11c0 1.25.75 2 2 2 1 0 1 0 1 1v1c0 1-1 2-2 2s-1 .008-1 1.031V20c0 1 0 1 1 1z"></path>',
  };
  return '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="svg-icon lucide-' + kind + '">' + (paths[kind] || paths.info) + "</svg>";
}

function styleCallouts(root) {
  root.querySelectorAll("blockquote").forEach((bq) => {
    const kindEl = bq.querySelector(".callout-kind");
    if (!kindEl) return;
    const kind = (kindEl.dataset.kind || "note").toLowerCase();
    const fold = kindEl.dataset.fold || "";
    const titleText = kindEl.textContent.trim() || CALLOUT_TITLES[kind] || kind;
    const div = document.createElement("div");
    div.className = "callout";
    div.dataset.callout = kind;
    div.dataset.calloutMetadata = "";
    div.dataset.calloutFold = fold;
    const head = document.createElement("div");
    head.className = "callout-title";
    head.dir = "auto";
    const icon = document.createElement("div");
    icon.className = "callout-icon";
    icon.innerHTML = calloutIconSvg(kind);
    const inner = document.createElement("div");
    inner.className = "callout-title-inner";
    inner.textContent = titleText;
    head.append(icon, inner);
    if (fold) {
      const foldEl = document.createElement("div");
      foldEl.className = "callout-fold";
      foldEl.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="svg-icon lucide-chevron-down"><path d="m6 9 6 6 6-6"></path></svg>';
      head.appendChild(foldEl);
    }
    const content = document.createElement("div");
    content.className = "callout-content";
    kindEl.remove();
    while (bq.firstChild && bq.firstChild.nodeType === Node.TEXT_NODE && !bq.firstChild.textContent.trim()) bq.removeChild(bq.firstChild);
    const firstP = bq.querySelector("p");
    if (firstP) {
      while (firstP.firstChild && firstP.firstChild.nodeName === "BR") firstP.removeChild(firstP.firstChild);
      if (!firstP.textContent.trim() && !firstP.querySelector("img")) firstP.remove();
    }
    while (bq.firstChild) content.appendChild(bq.firstChild);
    div.append(head, content);
    bq.replaceWith(div);
    div.classList.toggle("is-collapsed", fold === "-");
    div.classList.toggle("collapsed", fold === "-");
    if (fold) {
      head.classList.add("foldable");
      head.onclick = () => {
        const collapsed = div.classList.toggle("is-collapsed");
        div.classList.toggle("collapsed", collapsed);
      };
    }
  });
}

function wireRendered(root, sourceText, lineOffset = 0) {
  const tasks = taskItems(sourceText);
  let boxIndex = 0;
  root.querySelectorAll("li").forEach((li) => {
    const box = li.querySelector('input[type="checkbox"]');
    if (!box) return;
    const info = tasks[boxIndex++];
    if (!info) return;
    box.disabled = false;
    box.checked = info.checked;
    box.classList.add("task-list-item-checkbox");
    li.classList.add("task-list-item");
    box.title = info.checked ? "Зняти позначку" : "Позначити виконаним";
    if (info.checked) { li.classList.add("is-checked"); }
    box.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      toggleTaskLine(info.line + lineOffset, info.prefixLen);
    });
  });

  root.querySelectorAll(".internal-link[data-target]").forEach((a) => {
    a.onclick = (event) => {
      event.preventDefault();
      const target = a.dataset.target.replace(/^#/, "");
      const hit = state.files.find((p) => p === target + ".md" || p === target || p.endsWith("/" + target + ".md"));
      if (hit) openNote(hit); else toast("Нема такої нотатки: " + target);
    };
  });
  root.querySelectorAll("img").forEach((img) => {
    const src = img.getAttribute("src") || "";
    if (!/^https?:/.test(src)) img.src = "https://raw.githubusercontent.com/" + state.repo + "/" + state.branch + "/" + src.replace(/^\.?\//, "");
  });
  root.querySelectorAll("a[href]").forEach((a) => {
    if (a.classList.contains("internal-link") || a.classList.contains("tag")) return;
    a.target = "_blank";
    a.rel = "noopener";
  });
  root.querySelectorAll(".tag[data-tag]").forEach((t) => {
    t.onclick = (event) => {
      event.preventDefault();
      const input = $("searchInput");
      if (input) { input.value = "#" + t.dataset.tag; showPane("search"); input.dispatchEvent(new Event("input")); }
    };
  });
}

function resolveEmbeds(root) {
  root.querySelectorAll(".embed-note").forEach((box) => {
    const name = decodeURIComponent(box.dataset.note || "").split("#")[0].trim();
    const hit = state.files.find((p) => p === name + ".md" || p === name || p.endsWith("/" + name + ".md"));
    if (!hit) { box.textContent = "немає нотатки: " + name; box.classList.add("missing"); return; }
    const paintEmbed = (text) => {
      const parsed = parseProps(text);
      const body = parsed ? parsed.body : text;
      box.innerHTML = '<div class="embed-title">' + escapeHtml(hit.split("/").pop().replace(/\.md$/, "")) + "</div>" + markdownToHtml(body);
      styleCallouts(box);
      wireRendered(box, body, 0);
      box.querySelectorAll('input[type="checkbox"]').forEach((c) => { c.disabled = true; });
      box.classList.add("loaded");
      box.onclick = (e) => { e.stopPropagation(); openNote(hit); };
    };
    const text = state.index.get(hit);
    if (text === undefined) {
      box.textContent = name + " (завантажую…)";
      ghGet(hit)
        .then(({ text: fetched }) => { state.index.set(hit, fetched); paintEmbed(fetched); })
        .catch(() => { box.textContent = "не завантажилось: " + name; box.classList.add("missing"); });
      return;
    }
    paintEmbed(text);
  });
}


function noteEdited(prev) {
  const file = currentFile();
  if (!file) return;
  file.dirty = true;
  state.index.set(file.path, file.text);
  setState("не збережено", "warn");
  const words = file.text.trim().split(/\s+/).filter(Boolean).length;
  $("stMeta").textContent = words + " слів · " + file.text.length + " симв.";
  emit("edit", { path: file.path, text: file.text, prev });
  emit("modify", { path: file.path, text: file.text, prev });
  clearTimeout($("editor")._t);
  $("editor")._t = setTimeout(() => saveNote(true), 3000);
  clearTimeout($("editor")._o);
  $("editor")._o = setTimeout(renderOutline, 350);
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
  const raw = $("searchInput").value.trim();
  const host = $("searchResults");
  host.innerHTML = "";
  if (raw.length < 2) { host.appendChild(el("div", "empty", "мінімум 2 символи")); return; }
  host.appendChild(el("div", "empty", "шукаю…"));
  await ensureIndex();

  const parsed = parseSearchQuery(raw);
  const results = [];
  for (const [path, text] of state.index) {
    if (!text) continue;
    const lower = text.toLowerCase();
    const pathLower = path.toLowerCase();
    if (parsed.path.some((p) => !pathLower.includes(p))) continue;
    if (parsed.tags.some((t) => !lower.includes("#" + t))) continue;
    if (parsed.not.some((t) => lower.includes(t))) continue;
    if (parsed.terms.some((t) => !lower.includes(t))) continue;
    if (parsed.phrases.some((t) => !lower.includes(t))) continue;

    const needle = parsed.phrases[0] || parsed.terms[0] || "";
    const at = needle ? lower.indexOf(needle) : 0;
    let hits = 0;
    if (needle) {
      let i = lower.indexOf(needle);
      while (i !== -1 && hits < 100) { hits++; i = lower.indexOf(needle, i + needle.length); }
    }
    results.push({
      path,
      hits: Math.max(1, hits),
      snippet: needle ? text.slice(Math.max(0, at - 40), at + 90).replace(/\n/g, " ") : text.slice(0, 80).replace(/\n/g, " "),
    });
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

function parseSearchQuery(raw) {
  const out = { terms: [], phrases: [], path: [], tags: [], not: [] };
  const re = /(-?)("([^"]+)"|(\S+))/g;
  let m;
  while ((m = re.exec(raw)) !== null) {
    const neg = m[1] === "-";
    const token = (m[3] || m[4] || "").trim();
    if (!token) continue;
    if (neg) { out.not.push(token.toLowerCase()); continue; }
    if (/^path:/i.test(token)) { out.path.push(token.slice(5).toLowerCase()); continue; }
    if (/^tag:/i.test(token)) { out.tags.push(token.slice(4).replace(/^#/, "").toLowerCase()); continue; }
    if (m[3]) out.phrases.push(token.toLowerCase());
    else out.terms.push(token.toLowerCase());
  }
  return out;
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

let switcherMode = "open";
let linkPos = null;
function showSwitcher(mode) {
  switcherMode = mode === "link" ? "link" : mode === "template" ? "template" : "open";
  linkPos = null;
  if (switcherMode === "link") linkPane = activePane;
  $("switcherInput").value = "";
  $("switcherInput").placeholder = switcherMode === "link" ? "Вставити [[посилання]] на…" : switcherMode === "template" ? "Вставити шаблон…" : "Перейти до нотатки…";
  switcherActive = 0;
  renderSwitcher();
  openModal("switcher");
  $("switcherInput").focus();
}
function chooseSwitcherItem(path) {
  if (!path) return;
  closeModals();
  if (switcherMode === "template") {
    switcherMode = "open";
    if (dailyApi) dailyApi.insertTemplate(path);
    return;
  }
  if (switcherMode === "link") {
    const link = "[[" + path.replace(/\.(md|canvas)$/, "") + "]]";
    const api = linkPane === 2 && live2Api ? live2Api : liveApi;
    if (state.mode === "live" && api && linkPos !== null) api.insertAt(linkPos, link);
    else insertAtCursor(link);
    linkPos = null;
    switcherMode = "open";
  } else {
    openNote(path);
  }
}
function renderSwitcher() {
  const q = $("switcherInput").value.trim().toLowerCase();
  const list = $("switcherList");
  list.innerHTML = "";
  const source = switcherMode === "template" ? (dailyApi ? dailyApi.templateFiles() : []) : state.files;
  const scored = source
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
    item.appendChild(el("span", null, switcherMode === "template" ? "🧾" : path.endsWith(".canvas") ? "🎨" : "📄"));
    item.appendChild(el("span", null, switcherMode === "template" ? path.replace(/\.md$/, "") : path.replace(/\.(md|canvas)$/, "")));
    item.onclick = () => {
      chooseSwitcherItem(path);
    };
    list.appendChild(item);
  });
  if (!switcherItems.length) list.appendChild(el("div", "empty", switcherMode === "template" ? "нема шаблонів у теці" : "нічого не знайдено"));
}

/* ---------------- panes / modes ---------------- */
function showPane(pane) {
  ["files", "search", "tags", "plugins"].forEach((p) => { const node = $(p + "Pane"); if (node) node.style.display = p === pane ? "" : "none"; });
  $("paneTitle").textContent = pane === "files" ? "Файли" : pane === "search" ? "Пошук" : pane === "tags" ? "Теги" : "Плагіни";
  document.querySelectorAll("#ribbon [data-pane]").forEach((b) => b.classList.toggle("active", b.dataset.pane === pane));
  if (pane === "tags") renderTags();
  if (pane === "plugins") emit("plugins:pane");
}
const MODES = ["edit", "live", "split", "read"];
function setMode(mode) {
  if (!MODES.includes(mode)) mode = "edit";
  state.mode = mode;
  document.body.classList.remove("mode-edit", "mode-live", "mode-split", "mode-read");
  document.body.classList.add("mode-" + mode);
  store.set("mode", mode);
  for (const m of MODES) {
    const btn = $("mode" + m.charAt(0).toUpperCase() + m.slice(1));
    if (btn) btn.style.background = m === mode ? "var(--bg-4)" : "";
  }
  if (mode === "live") {
    liveApi?.setDoc(currentFile() ? currentFile().text : "");
    liveApi?.focus();
    paintSecond();
  }
}
const toggleMode = () => setMode(MODES[(MODES.indexOf(state.mode) + 1) % MODES.length]);
const toggleLeft = () => { if (window.innerWidth <= 980) $("left").classList.toggle("open"); else document.body.classList.toggle("no-left"); };
const toggleRight = () => { if (window.innerWidth <= 980) $("right").classList.toggle("open"); else document.body.classList.toggle("no-right"); };
const toggleTheme = () => { store.set("theme", store.get("theme", "dark") === "dark" ? "light" : "dark"); theme(); };

function exportPdf() {
  if (!currentFile()) { toast("Спочатку відкрий нотатку"); return; }
  setMode("read");
  renderPreview();
  exportPdfFile($("preview"), currentFile().path.split("/").pop().replace(/\.md$/, ""), { download: true })
    .then((res) => { toast("PDF готовий: " + res.pages + " стор., " + Math.round(res.bytes / 1024) + " КБ"); setState("PDF: " + res.pages + " стор.", "ok"); })
    .catch((error) => { toast("PDF не вийшов (" + error.message + ") — відкриваю друк"); setTimeout(() => window.print(), 300); });
}

function printNote() {
  if (!currentFile()) { toast("Спочатку відкрий нотатку"); return; }
  setMode("read");
  renderPreview();
  setTimeout(() => window.print(), 200);
}

/* ---------------- canvas view hook ---------------- */
let canvasApi = null;
function openCanvas(path) { if (canvasApi) canvasApi.open(path); }
function openGraph() { setView("graph"); emit("view", "graph"); }

/* ---------------- API for modules ---------------- */
export const Vault = {
  state, api, ghGet, ghPut, ghPutRaw, ghDelete, b64encode, b64decode,
  contentsPath, openNote, openCanvas, openGraph, toast, setState, currentFile,
  saveNote, ensureIndex, registerCommand, addRibbonButton, on, emit, loadTree, listAll,
  renderTree, renderTabs, paint, renderPreview, renderContext, renderTags, showPane, showSwitcher,
  moveFile, uploadImage, insertAtCursor, openModal, closeModals, setView, exportPdf, printNote, openInSecond, closeSecond,
  exportPdfFile: (opts = {}) => exportPdfFile($("preview"), (currentFile()?.path || "note").split("/").pop().replace(/\.md$/, ""), opts),
  get files() { return state.files; },
  get index() { return state.index; },
  get repo() { return state.repo; },
  get branch() { return state.branch; },
  get token() { return state.token; },
  get openFiles() { return state.open; },
  get live() { return liveApi; },
  get live2() { return live2Api; },
};
window.Vault = Vault;

/* ---------------- markdown highlight, outline, find ---------------- */
function escapeHtml(s) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function inlineMarkdown(s) {
  return s
    .replace(/!\[\[([^\]]+)\]\]/g, '<span class="hl-l">![[$1]]</span>')
    .replace(/\[\[([^\]]+)\]\]/g, '<span class="hl-w">[[$1]]</span>')
    .replace(/!?\[([^\]]*)\]\(([^)]+)\)/g, (m) => '<span class="hl-l">' + m + "</span>")
    .replace(/`([^`]+)`/g, '<span class="hl-c">`$1`</span>')
    .replace(/\*\*([^*]+)\*\*/g, '<span class="hl-b">**$1**</span>')
    .replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<span class="hl-i">*$2*</span>')
    .replace(/(^|\s)(#[A-Za-z0-9_\u0400-\u04FF-]{2,})/g, '$1<span class="hl-t">$2</span>');
}

function highlightMarkdown(text) {
  const lines = text.split("\n");
  const out = [];
  let inFence = false;
  let inFront = lines.length > 0 && /^---\s*$/.test(lines[0]);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (inFront) {
      out.push('<span class="hl-f">' + escapeHtml(line) + "</span>");
      if (i > 0 && /^---\s*$/.test(line)) inFront = false;
      continue;
    }
    if (/^\s*(```|~~~)/.test(line)) {
      inFence = !inFence;
      out.push('<span class="hl-f">' + escapeHtml(line) + "</span>");
      continue;
    }
    if (inFence) {
      out.push('<span class="hl-code">' + escapeHtml(line) + "</span>");
      continue;
    }
    let html = escapeHtml(line);
    const heading = html.match(/^(#{1,6})(\s.*)$/);
    if (heading) {
      out.push('<span class="hl-h">' + heading[1] + heading[2] + "</span>");
      continue;
    }
    if (/^&gt;\s?/.test(html)) {
      out.push('<span class="hl-q">' + html + "</span>");
      continue;
    }
    const list = html.match(/^(\s*)([-*+]|\d+\.)(\s+)/);
    if (list) {
      const prefix = list[0];
      html = html.slice(prefix.length);
      let marker = '<span class="hl-m">' + prefix + "</span>";
      const task = html.match(/^\[( |x|X)\]\s/);
      if (task) {
        marker += '<span class="hl-m">' + task[0] + "</span>";
        html = html.slice(task[0].length);
      }
      out.push(marker + inlineMarkdown(html));
      continue;
    }
    out.push(inlineMarkdown(html));
  }
  return out.join("\n");
}

function syncHighlight() {
  const pre = $("hlCode");
  if (!pre) return;
  const ed = $("editor");
  pre.innerHTML = highlightMarkdown(ed.value) + "\n";
  pre.style.transform = "translateY(" + -ed.scrollTop + "px)";
}

function renderOutline() {
  const host = $("outline");
  if (!host) return;
  host.innerHTML = "";
  const file = currentFile();
  if (!file) { host.appendChild(el("div", "empty", "немає нотатки")); return; }
  const lines = file.text.split("\n");
  const items = [];
  let inFence = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^\s*(```|~~~)/.test(line)) { inFence = !inFence; continue; }
    if (inFence) continue;
    const m = line.match(/^(#{1,6})\s+(.*)$/);
    if (m) items.push({ level: m[1].length, text: m[2].replace(/[*_`]/g, "").trim(), line: i });
  }
  if (!items.length) { host.appendChild(el("div", "empty", "немає заголовків")); return; }
  for (const item of items) {
    const btn = el("button", "outline-item l" + item.level, item.text);
    btn.title = "рядок " + (item.line + 1);
    btn.onclick = () => jumpToLine(item.line);
    host.appendChild(btn);
  }
}

function jumpToLine(line) {
  if (state.mode === "live" && liveApi) { liveApi.goToLine(line + 1); return; }
  const ed = $("editor");
  const lines = ed.value.split("\n");
  let pos = 0;
  for (let i = 0; i < line && i < lines.length; i++) pos += lines[i].length + 1;
  ed.focus();
  ed.selectionStart = ed.selectionEnd = pos;
  const lh = parseFloat(getComputedStyle(ed).lineHeight) || 25;
  ed.scrollTop = Math.max(0, line * lh - ed.clientHeight / 3);
  syncHighlight();
}

let findMatches = [];
let findIndex = -1;

function openFind() {
  $("findBar").classList.add("show");
  $("findInput").focus();
  $("findInput").select();
  runFind();
}
function closeFind() {
  $("findBar").classList.remove("show");
  if (state.mode === "live" && liveApi) liveApi.focus();
  else $("editor").focus();
}
function runFind() {
  const ed = $("editor");
  const q = $("findInput").value;
  findMatches = [];
  findIndex = -1;
  if (q) {
    const hayText = state.mode === "live" && liveApi ? liveApi.getText() : ed.value;
    const hay = hayText.toLowerCase();
    const needle = q.toLowerCase();
    let at = hay.indexOf(needle);
    while (at !== -1) {
      findMatches.push(at);
      at = hay.indexOf(needle, at + Math.max(1, needle.length));
    }
  }
  $("findCount").textContent = findMatches.length ? "1/" + findMatches.length : "0";
  if (findMatches.length) { findIndex = 0; selectMatch(); }
}
function selectMatch() {
  const ed = $("editor");
  const q = $("findInput").value;
  if (!findMatches.length) return;
  const start = findMatches[findIndex];
  if (state.mode === "live" && liveApi) {
    liveApi.select(start, start + q.length);
    $("findCount").textContent = (findIndex + 1) + "/" + findMatches.length;
    return;
  }
  ed.focus();
  ed.selectionStart = start;
  ed.selectionEnd = start + q.length;
  const lh = parseFloat(getComputedStyle(ed).lineHeight) || 25;
  const line = ed.value.slice(0, start).split("\n").length - 1;
  ed.scrollTop = Math.max(0, line * lh - ed.clientHeight / 3);
  $("findCount").textContent = (findIndex + 1) + "/" + findMatches.length;
  syncHighlight();
}
function findNext() {
  if (!findMatches.length) { runFind(); return; }
  findIndex = (findIndex + 1) % findMatches.length;
  selectMatch();
}
function findPrev() {
  if (!findMatches.length) { runFind(); return; }
  findIndex = (findIndex - 1 + findMatches.length) % findMatches.length;
  selectMatch();
}
function replaceOne() {
  const ed = $("editor");
  const q = $("findInput").value;
  if (!q) return;
  if (state.mode === "live" && liveApi) {
    const sel = liveApi.selection();
    if (sel && sel.text.toLowerCase() === q.toLowerCase()) liveApi.replaceSelection($("replaceInput").value);
    runFind();
    return;
  }
  const sel = ed.value.slice(ed.selectionStart, ed.selectionEnd);
  if (sel.toLowerCase() === q.toLowerCase()) {
    ed.setRangeText($("replaceInput").value, ed.selectionStart, ed.selectionEnd, "end");
    ed.dispatchEvent(new Event("input"));
  }
  runFind();
  findIndex = Math.min(findIndex, Math.max(0, findMatches.length - 1));
  if (findMatches.length) selectMatch();
}
function replaceAllInNote() {
  const ed = $("editor");
  const q = $("findInput").value;
  if (!q) return;
  if (state.mode === "live" && liveApi) {
    const count = liveApi.replaceAll(q, $("replaceInput").value);
    runFind();
    toast("замінено входжень: " + count);
    return;
  }
  const re = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi");
  const count = (ed.value.match(re) || []).length;
  ed.value = ed.value.replace(re, $("replaceInput").value);
  ed.dispatchEvent(new Event("input"));
  runFind();
  toast("замінено входжень: " + count);
}

/* ---------------- editor wiring ---------------- */
$("editor").addEventListener("input", () => {
  const file = currentFile();
  if (!file) return;
  const prev = file.text;
  file.text = $("editor").value;
  noteEdited(prev);
  renderPreview();
  liveApi?.setDoc(file.text);
  syncHighlight();
  updateCursorPos();

  const ed = $("editor");
  const before = ed.value.slice(Math.max(0, ed.selectionStart - 2), ed.selectionStart);
  if (before === "[[") {
    ed.value = ed.value.slice(0, ed.selectionStart - 2) + ed.value.slice(ed.selectionStart);
    ed.selectionStart = ed.selectionEnd = ed.selectionStart - 2;
    showSwitcher("link");
  }
});

function updateCursorPos() {
  const ed = $("editor");
  if (!ed || document.activeElement !== ed) return;
  const pos = ed.selectionStart;
  const before = ed.value.slice(0, pos);
  const line = before.split("\n").length;
  const ch = pos - before.lastIndexOf("\n");
  const el2 = $("stCursor");
  if (el2) el2.textContent = line + ":" + ch;
}
$("editor").addEventListener("click", updateCursorPos);
$("editor").addEventListener("keyup", updateCursorPos);

$("editor").addEventListener("keydown", (e) => {
  const ed = $("editor");
  const mod = e.ctrlKey || e.metaKey;
  if (mod && "bik".indexOf(e.key.toLowerCase()) >= 0) e.stopPropagation();

  if (e.key === "Tab") {
    e.preventDefault();
    const s = ed.selectionStart;
    ed.value = ed.value.slice(0, s) + "  " + ed.value.slice(ed.selectionEnd);
    ed.selectionStart = ed.selectionEnd = s + 2;
    ed.dispatchEvent(new Event("input"));
    return;
  }

  if (mod && e.key.toLowerCase() === "b") {
    e.preventDefault();
    wrapSelection("**");
    return;
  }
  if (mod && e.key.toLowerCase() === "i") {
    e.preventDefault();
    wrapSelection("*");
    return;
  }
  if (mod && e.key.toLowerCase() === "k") {
    e.preventDefault();
    const s = ed.selectionStart, t = ed.selectionEnd;
    const text = ed.value.slice(s, t) || "текст";
    ed.value = ed.value.slice(0, s) + "[" + text + "]()" + ed.value.slice(t);
    ed.selectionStart = ed.selectionEnd = s + text.length + 3;
    ed.dispatchEvent(new Event("input"));
    return;
  }
  if (e.key === "Enter" && !e.shiftKey && !mod) {
    const s = ed.selectionStart;
    const before = ed.value.slice(0, s);
    const lineStart = before.lastIndexOf("\n") + 1;
    const line = before.slice(lineStart);
    const m = line.match(/^(\s*)([-*+]|\d+\.)\s+(\[[ xX]\]\s+)?/);
    if (m) {
      e.preventDefault();
      const indent = m[1];
      let marker = m[2];
      const task = m[3] || "";
      if (/^\d+\.$/.test(marker)) marker = String(Number(marker.slice(0, -1)) + 1) + ".";
      const isEmpty = line.trim() === m[2] || line.trim() === m[2] + (task ? "[ ]" : "");
      if (isEmpty) {
        ed.value = ed.value.slice(0, lineStart) + ed.value.slice(s);
        ed.selectionStart = ed.selectionEnd = lineStart;
      } else {
        const insert = "\n" + indent + marker + " " + (task ? "[ ] " : "");
        ed.value = ed.value.slice(0, s) + insert + ed.value.slice(ed.selectionEnd);
        ed.selectionStart = ed.selectionEnd = s + insert.length;
      }
      ed.dispatchEvent(new Event("input"));
    }
  }
});

function wrapSelection(marker) {
  if (state.mode === "live" && liveApi) { liveApi.wrap(marker); return; }
  const ed = $("editor");
  const s = ed.selectionStart;
  const t = ed.selectionEnd;
  const sel = ed.value.slice(s, t);
  const text = marker + sel + marker;
  ed.value = ed.value.slice(0, s) + text + ed.value.slice(t);
  ed.selectionStart = s + marker.length;
  ed.selectionEnd = t + marker.length;
  ed.dispatchEvent(new Event("input"));
}

$("editor").addEventListener("scroll", () => syncHighlight());
$("editor").addEventListener("focus", () => { activePane = 1; });
$("editor2").addEventListener("focus", () => { activePane = 2; });

$("editor2").addEventListener("input", () => {
  const file = groupFile(state.groups[1]);
  if (!file) return;
  file.text = $("editor2").value;
  file.dirty = true;
  state.index.set(file.path, file.text);
  setState("не збережено", "warn");
  syncHighlight2();
  renderPane2Tabs();
  clearTimeout($("editor2")._t);
  $("editor2")._t = setTimeout(() => saveNote(true, file), 1500);
});
$("editor2").addEventListener("scroll", () => syncHighlight2());
$("editor2").addEventListener("keydown", (e) => {
  if (e.key === "Tab") {
    e.preventDefault();
    const ed = $("editor2");
    const s = ed.selectionStart;
    ed.value = ed.value.slice(0, s) + "  " + ed.value.slice(ed.selectionEnd);
    ed.selectionStart = ed.selectionEnd = s + 2;
    ed.dispatchEvent(new Event("input"));
  }
});

$("splitter").addEventListener("mousedown", (e) => {
  e.preventDefault();
  const main = document.querySelector("main");
  const move = (ev) => {
    const rect = main.getBoundingClientRect();
    const ratio = Math.min(0.85, Math.max(0.15, (ev.clientX - rect.left) / rect.width));
    const right = Math.round(rect.width * (1 - ratio)) - 3;
    $("pane2").style.flex = "0 0 " + Math.max(120, right) + "px";
  };
  const up = () => {
    window.removeEventListener("mousemove", move);
    window.removeEventListener("mouseup", up);
    scheduleWorkspaceSave();
  };
  window.addEventListener("mousemove", move);
  window.addEventListener("mouseup", up);
});

$("pane2").addEventListener("dragover", (event) => {
  if (isMobileLayout()) return;
  if (![...event.dataTransfer.types].includes("text/vault-tab")) return;
  event.preventDefault();
  event.dataTransfer.dropEffect = "move";
  $("pane2").classList.add("drop-target");
});
$("pane2").addEventListener("dragleave", (event) => {
  if (!$("pane2").contains(event.relatedTarget)) $("pane2").classList.remove("drop-target");
});
$("pane2").addEventListener("drop", (event) => {
  $("pane2").classList.remove("drop-target");
  if (isMobileLayout()) return;
  const path = event.dataTransfer.getData("text/vault-tab");
  const source = event.dataTransfer.getData("text/vault-tab-source");
  if (!path) return;
  event.preventDefault();
  if (source !== "pane2") moveTabToSecond(path);
});

$("tree").addEventListener("contextmenu", (e) => {
  if (e.target.closest(".file-row")) return;
  e.preventDefault();
  showCtx(e.clientX, e.clientY, [
    { label: "Нова нотатка", run: newNote },
    { label: "Нова тека", run: newFolder },
  ]);
});
document.addEventListener("click", (e) => { if (!e.target.closest("#ctxMenu")) hideCtx(); });
document.addEventListener("contextmenu", (e) => { if (!e.target.closest(".file-row, .bm-item, #tree, #ctxMenu")) hideCtx(); });
window.addEventListener("blur", hideCtx);

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
  if (e.key === "Escape") {
    if ($("findBar").classList.contains("show")) closeFind(); else closeModals();
    return;
  }
  const inLive = e.target && e.target.closest && e.target.closest("#live .cm-editor");
  if (inLive && (e.ctrlKey || e.metaKey) && ["b", "i", "k"].includes(e.key.toLowerCase())) return;
  const combo = comboFromEvent(e);
  if (!combo) return;
  const id = Object.keys(hotkeys).find((action) => hotkeys[action] === combo);
  if (!id) return;
  e.preventDefault();
  runHotkey(id);
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
  if (e.key === "Enter") { const path = switcherItems[switcherActive]; if (path) chooseSwitcherItem(path); }
});

$("overlay").onclick = closeModals;
$("saveBtn").onclick = () => saveNote();
$("modeEdit").onclick = () => setMode("edit");
$("modeLive").onclick = () => setMode("live");
$("modeSplit").onclick = () => setMode("split");
$("modeRead").onclick = () => setMode("read");
$("toggleLeft").onclick = toggleLeft;
$("toggleRight").onclick = toggleRight;
$("themeBtn").onclick = toggleTheme;
$("openPalette").onclick = showPalette;
$("openSwitcher").onclick = showSwitcher;
$("openSettings").onclick = openSettings;
$("closeSettings").onclick = closeModals;
$("newNote").onclick = newNote;
$("splitBtn").onclick = () => {
  if (state.groups[1]) closeSecond();
  else if (state.active) openInSecond(state.active);
  else toast("відкрий нотатку");
};
document.querySelectorAll("#mobileSwitch button").forEach((btn) => {
  btn.onclick = () => setMobileGroup(Number(btn.dataset.group));
});
const mobileMedia = window.matchMedia("(max-width: 760px)");
const onMobileMediaChange = () => {
  if (!mobileMedia.matches) state.mobileGroup = 1;
  applyMobilePane();
};
if (mobileMedia.addEventListener) mobileMedia.addEventListener("change", onMobileMediaChange);
else if (mobileMedia.addListener) mobileMedia.addListener(onMobileMediaChange);
$("reloadTree").onclick = () => loadTree().catch((e) => toast(e.message));
$("filter").oninput = renderTree;
$("searchInput").oninput = () => { clearTimeout($("searchInput")._t); $("searchInput")._t = setTimeout(runSearch, 300); };
$("rebuildIndex").onclick = async () => { state.index.clear(); await ensureIndex(); renderContext(); renderTags(); toast("індекс оновлено"); };
$("copyOutline").onclick = () => {  const items = [...document.querySelectorAll("#outline .outline-item")].map((b) => b.textContent);
  if (!items.length) { toast("немає заголовків"); return; }
  navigator.clipboard.writeText(items.map((t) => "- " + t).join("\n")).then(
    () => toast("заголовки скопійовано"),
    () => toast("браузер не дав доступ до буфера")
  );
};
$("findNext").onclick = findNext;
$("findPrev").onclick = findPrev;
$("replaceOne").onclick = replaceOne;
$("replaceAll").onclick = replaceAllInNote;
$("findClose").onclick = closeFind;
$("findInput").addEventListener("input", runFind);
$("findInput").addEventListener("keydown", (e) => {
  if (e.key === "Enter") { e.preventDefault(); e.shiftKey ? findPrev() : findNext(); }
  if (e.key === "Escape") closeFind();
});
$("replaceInput").addEventListener("keydown", (e) => {
  if (e.key === "Enter") { e.preventDefault(); replaceOne(); }
  if (e.key === "Escape") closeFind();
});
$("navBack").onclick = goBack;
$("navFwd").onclick = goFwd;
$("openGraph").onclick = () => setView(state.view === "graph" ? "note" : "graph");
$("openCanvas").onclick = () => { const c = state.files.find((p) => p.endsWith(".canvas")); if (c) openCanvas(c); else toast("Нема .canvas — створи 🎨"); };
$("newCanvas").onclick = () => { if (canvasApi) canvasApi.create(); };
document.querySelectorAll("#ribbon [data-pane]").forEach((b) => { b.onclick = () => showPane(b.dataset.pane); });

/* settings */
function renderAccentPresets() {
  const host = $("accentPresets");
  if (!host) return;
  host.innerHTML = "";
  for (const color of ACCENT_PRESETS) {
    const swatch = document.createElement("button");
    swatch.type = "button";
    swatch.style.background = color;
    swatch.title = color;
    swatch.onclick = () => {
      $("setAccent").value = color;
      store.set("accent", color);
      applyPrefs();
    };
    host.appendChild(swatch);
  }
}

function renderHotkeysSettings() {
  const host = $("hotkeyList");
  if (!host) return;
  host.innerHTML = "";
  for (const action of HOTKEY_ACTIONS) {
    const row = el("div", "hotkey-row");
    row.appendChild(el("span", "hotkey-label", action.label));
    const input = document.createElement("input");
    input.className = "hk-input";
    input.readOnly = true;
    input.value = hotkeys[action.id] || "";
    input.placeholder = "не задано";
    input.addEventListener("keydown", (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (event.key === "Escape") { input.blur(); return; }
      if (event.key === "Backspace" || event.key === "Delete") {
        hotkeys[action.id] = "";
        store.set("hotkeys", JSON.stringify(hotkeys));
        input.value = "";
        input.blur();
        return;
      }
      const combo = comboFromEvent(event);
      if (!combo) return;
      for (const key of Object.keys(hotkeys)) if (key !== action.id && hotkeys[key] === combo) hotkeys[key] = "";
      hotkeys[action.id] = combo;
      store.set("hotkeys", JSON.stringify(hotkeys));
      input.value = combo;
      input.blur();
      renderHotkeysSettings();
      toast(action.label + " → " + combo);
    });
    row.appendChild(input);
    const reset = el("button", "ghost-border hk-reset", "↺");
    reset.title = "Скинути до " + (action.def || "порожньо");
    reset.onclick = () => {
      hotkeys[action.id] = action.def;
      store.set("hotkeys", JSON.stringify(hotkeys));
      renderHotkeysSettings();
    };
    row.appendChild(reset);
    host.appendChild(row);
  }
}

function openSettings() {
  $("setRepo").value = state.repo;
  $("setBranch").value = state.branch;
  $("setToken").value = state.token;
  $("setTheme").value = store.get("theme", "dark");
  $("setFont").value = store.get("font", "15");
  $("setWidth").value = store.get("width", "46rem");
  $("setGraphForce").value = store.get("graphForce", "120");
  const computed = getComputedStyle(document.documentElement).getPropertyValue("--accent").trim();
  $("setAccent").value = /^#[0-9a-f]{6}$/i.test(computed) ? computed : "#a882ff";
  renderAccentPresets();
  renderHotkeysSettings();
  openModal("settings");
}
$("setAccent").addEventListener("input", () => {
  store.set("accent", $("setAccent").value);
  applyPrefs();
});
$("accentReset").onclick = () => {
  store.del("accent");
  applyPrefs();
  const computed = getComputedStyle(document.documentElement).getPropertyValue("--accent").trim();
  $("setAccent").value = /^#[0-9a-f]{6}$/i.test(computed) ? computed : "#a882ff";
};
$("setFont").addEventListener("change", () => {
  store.set("font", $("setFont").value);
  applyPrefs();
});
$("saveSettings").onclick = () => {
  store.set("repo", $("setRepo").value.trim());
  store.set("branch", $("setBranch").value.trim());
  store.set("token", $("setToken").value.trim());
  store.set("theme", $("setTheme").value);
  store.set("font", $("setFont").value);
  store.set("width", $("setWidth").value);
  store.set("accent", $("setAccent").value);
  store.set("graphForce", $("setGraphForce").value);
  store.set("hotkeys", JSON.stringify(hotkeys));
  theme(); applyPrefs();
  closeModals();
  location.reload();
};

window.addEventListener("beforeunload", (e) => { if (state.open.some((f) => f.dirty)) { e.preventDefault(); e.returnValue = ""; } });
window.addEventListener("beforeunload", saveWorkspace);

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
    if (dailyApi) await dailyApi.loadConfigs();
    else dailyApi = await initDaily(Vault);
    window.__daily = dailyApi;
    const restored = await restoreWorkspace();
    if (!restored) {
      const first = state.files.find((p) => p.endsWith(".md"));
      if (first) await openNote(first);
      applyMobilePane();
    }
    showPane("files");
    ensureIndex().then(() => { renderTags(); renderContext(); emit("index"); }).catch(() => {});
    initGraph(Vault);
    canvasApi = initCanvas(Vault);
    initCollab(Vault);
    initPlugins(Vault);
    window.__vaultReady = true;
  } catch (error) {
    $("loginError").textContent = "Не вийшло: " + error.message;
  }
}

/* commands */
registerCommand({ id: "new", label: "Нова нотатка", hint: "＋", run: newNote });
registerCommand({ id: "save", label: "Зберегти нотатку", hint: "Ctrl+S", run: () => saveNote() });
registerCommand({ id: "mode", label: "Режим читання / редактор", hint: "Ctrl+E", run: toggleMode });
registerCommand({ id: "pdf", label: "Експорт PDF (файл)", hint: "PDF", run: exportPdf });
registerCommand({ id: "print", label: "Друк / зберегти як PDF (вікно друку)", hint: "Ctrl+P", run: printNote });
registerCommand({ id: "graph", label: "Graph view", hint: "Ctrl+G", run: () => setView(state.view === "graph" ? "note" : "graph") });
registerCommand({ id: "canvas", label: "Відкрити canvas", run: () => { const c = state.files.find((p) => p.endsWith(".canvas")); if (c) openCanvas(c); else toast("Нема .canvas"); } });
registerCommand({ id: "bookmark", label: "Додати/зняти закладку", run: () => { if (state.active) toggleBookmark(state.active); } });
registerCommand({ id: "split", label: "Друга панель (розділити екран)", run: () => { if (state.groups[1]) closeSecond(); else if (state.active) openInSecond(state.active); else toast("відкрий нотатку"); } });
registerCommand({ id: "new-folder", label: "Нова тека", run: newFolder });
registerCommand({ id: "task", label: "Вставити чекбокс", hint: "- [ ]", run: () => insertAtCursor("\n- [ ] ") });
registerCommand({ id: "bold", label: "Жирний", hint: "Ctrl+B", run: () => { wrapSelection("**"); } });
registerCommand({ id: "italic", label: "Курсив", hint: "Ctrl+I", run: () => { wrapSelection("*"); } });
registerCommand({ id: "find", label: "Знайти в нотатці", hint: "Ctrl+F", run: openFind });
registerCommand({ id: "replace", label: "Замінити в нотатці", hint: "Ctrl+H", run: () => { openFind(); $("replaceInput").focus(); } });
registerCommand({ id: "link-note", label: "Вставити [[посилання]]", hint: "[[", run: () => showSwitcher("link") });
registerCommand({ id: "outline-copy", label: "Скопіювати заголовки нотатки", run: () => $("copyOutline").click() });
registerCommand({ id: "theme", label: "Перемкнути тему", run: toggleTheme });
registerCommand({ id: "left", label: "Показати/сховати ліву панель", hint: "Ctrl+B", run: toggleLeft });
registerCommand({ id: "right", label: "Показати/сховати праву панель", run: toggleRight });
registerCommand({ id: "reload", label: "Оновити список файлів", run: () => loadTree() });
registerCommand({ id: "index", label: "Перебудувати індекс звʼязків", run: async () => { state.index.clear(); await ensureIndex(); renderContext(); renderTags(); toast("індекс оновлено"); } });
registerCommand({ id: "collab", label: "Спільна робота (real-time)", hint: "👥", run: () => emit("collab:open") });
registerCommand({ id: "logout", label: "Забути токен і вийти", run: () => { store.del("token"); location.reload(); } });

liveApi = initLive({
  getText: () => (currentFile() ? currentFile().text : ""),
  onChange: (text, prev) => {
    const file = currentFile();
    if (!file) return;
    file.text = text;
    $("editor").value = text;
    if (live2Path === file.path) live2Api?.setDoc(text);
    noteEdited(prev);
    renderPreview();
    syncHighlight();
    updateCursorPos();
  },
  onCursor: (line, ch) => {
    const node = $("stCursor");
    if (node) node.textContent = line + ":" + ch;
  },
  onOpenNote: (target) => {
    const name = String(target || "").replace(/^#/, "");
    const hit = state.files.find((p) => p === name + ".md" || p === name || p.endsWith("/" + name + ".md"));
    if (hit) openNote(hit); else toast("Немає такої нотатки: " + name);
  },
  imageUrl: (name) => "https://raw.githubusercontent.com/" + state.repo + "/" + state.branch + "/" + encodeURI(name.replace(/^\.?\//, "")),
  onLinkTrigger: (pos) => { linkPane = 1; showSwitcher("link"); linkPos = pos; },
  onFocus: () => { activePane = 1; },
});

live2Api = initLive({
  hostId: "live2",
  getText: () => {
    const file = groupFile(state.groups[1]);
    return file ? file.text : "";
  },
  onChange: (text, prev) => {
    const file = groupFile(state.groups[1]);
    if (!file) return;
    file.text = text;
    $("editor2").value = text;
    if (livePath === file.path) liveApi?.setDoc(text);
    file.dirty = true;
    state.index.set(file.path, text);
    setState("не збережено", "warn");
    syncHighlight2();
    renderTabs();
    renderPane2Tabs();
    clearTimeout($("editor2")._t);
    $("editor2")._t = setTimeout(() => saveNote(true, file), 1500);
    emit("modify", { path: file.path, text, prev });
  },
  onCursor: (line, ch) => {
    const node = $("stCursor");
    if (node) node.textContent = line + ":" + ch;
  },
  onOpenNote: (target) => {
    const name = String(target || "").replace(/^#/, "");
    const hit = state.files.find((p) => p === name + ".md" || p === name || p.endsWith("/" + name + ".md"));
    if (hit) openNote(hit); else toast("Немає такої нотатки: " + name);
  },
  imageUrl: (name) => "https://raw.githubusercontent.com/" + state.repo + "/" + state.branch + "/" + encodeURI(name.replace(/^\.?\//, "")),
  onLinkTrigger: (pos) => { linkPane = 2; showSwitcher("link"); linkPos = pos; },
  onFocus: () => { activePane = 2; },
});

theme();
applyPrefs();
setMode(store.get("mode", window.innerWidth <= 980 ? "edit" : "split"));
renderBookmarks();
updateSplitButtons();$("repo").value = state.repo;
$("branch").value = state.branch;
$("token").value = state.token;
$("connect").onclick = () => connect($("repo").value, $("branch").value, $("token").value, true);
$("token").addEventListener("keydown", (e) => { if (e.key === "Enter") $("connect").click(); });
$("forget").onclick = () => { store.del("token"); $("token").value = ""; toast("токен видалено"); };
if (state.token) connect(state.repo, state.branch, state.token, false);
