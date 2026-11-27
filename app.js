// Vault — core app. Feature modules (graph/canvas/collab/plugins) get this API via init().
import { initGraph } from "./graph.js?v=117";
import { initCanvas } from "./canvas.js?v=117";
import { initCollab } from "./collab.js?v=117";
import { initPlugins } from "./plugins.js?v=117";
import { exportPdfFile } from "./pdf.js?v=117";
import { initLive } from "./live.js?v=117";
import { initDaily } from "./daily.js?v=117";
import { initRecorder } from "./recorder.js?v=117";
import { initPdfViewer } from "./pdfviewer.js?v=117";
import { initMediaViewer, isMediaPath } from "./mediaviewer.js?v=117";

const $ = (id) => document.getElementById(id);
const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };
const BUILD = "v117";
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
  mobileGroup: (() => { const value = Number(store.get("mobileGroup", "1")); return Number.isFinite(value) && value >= 1 ? Math.floor(value) : 1; })(),
};

let bookmarkItems = [];
try {
  const savedBookmarks = JSON.parse(store.get("bookmarkItems", "[]"));
  if (Array.isArray(savedBookmarks)) bookmarkItems = savedBookmarks.filter((item) => item && typeof item === "object" && typeof item.type === "string");
} catch { bookmarkItems = []; }
if (!bookmarkItems.length && Array.isArray(state.bookmarks) && state.bookmarks.length) {
  bookmarkItems = state.bookmarks.map((path) => ({ type: "file", path, title: String(path).split("/").pop().replace(/\.md$/i, ""), ctime: Date.now() }));
  store.set("bookmarkItems", JSON.stringify(bookmarkItems));
}

/* ---------------- core plugins ---------------- */
const CORE_PLUGINS = [
  { id: "file-explorer", label: "File explorer", desc: "Дерево файлів волту", def: true },
  { id: "global-search", label: "Search", desc: "Пошук по всьому волту", def: true },
  { id: "switcher", label: "Quick switcher", desc: "Швидкий перехід між нотатками", def: true },
  { id: "graph", label: "Graph view", desc: "Граф звʼязків", def: true },
  { id: "backlink", label: "Backlinks", desc: "Згадки в інших нотатках", def: true },
  { id: "outgoing-link", label: "Outgoing links", desc: "Посилання з поточної нотатки", def: true },
  { id: "tag-pane", label: "Tags view", desc: "Панель тегів", def: true },
  { id: "properties", label: "Properties view", desc: "Усі властивості волту", def: true },
  { id: "page-preview", label: "Page preview", desc: "Прев'ю при наведенні на посилання", def: true },
  { id: "daily-notes", label: "Daily notes", desc: "Щоденна нотатка", def: true },
  { id: "templates", label: "Templates", desc: "Вставка шаблонів", def: true },
  { id: "slides", label: "Slides", desc: "Презентація з нотатки", def: true },
  { id: "unique-note", label: "Unique note creator", desc: "Нотатки з унікальною часовою назвою", def: true },
  { id: "note-composer", label: "Note composer", desc: "Витяг і обʼєднання нотаток", def: true },
  { id: "command-palette", label: "Command palette", desc: "Палітра команд", def: true },
  { id: "editor-status", label: "Editor status", desc: "Позиція курсора", def: true },
  { id: "bookmarks", label: "Bookmarks", desc: "Закладки", def: true },
  { id: "outline", label: "Outline", desc: "Структура нотатки", def: true },
  { id: "word-count", label: "Word count", desc: "Слова й символи", def: true },
  { id: "canvas", label: "Canvas", desc: "Полотно", def: true },
  { id: "bases", label: "Bases", desc: "Табличні бази з нотаток", def: true },
  { id: "webviewer", label: "Web viewer", desc: "Відкривати сайти в застосунку", def: true },
  { id: "format-converter", label: "Format converter", desc: "Конвертація HTML ↔ Markdown", def: true },
  { id: "importer", label: "Importer", desc: "Імпорт файлів у волт", def: true },
  { id: "file-recovery", label: "File recovery", desc: "Історія версій нотатки", def: true },
  { id: "audiorecorder", label: "Audio recorder", desc: "Запис звуку в нотатку", def: true },
  { id: "workspaces", label: "Workspaces", desc: "Збережені розкладки", def: false },
  { id: "random-note", label: "Random note", desc: "Випадкова нотатка", def: false },
  { id: "sync", label: "Sync / collab", desc: "Спільна робота", def: true },
];

let corePluginOverrides = {};
try {
  const savedCore = JSON.parse(store.get("corePlugins", "{}"));
  if (savedCore && typeof savedCore === "object" && !Array.isArray(savedCore)) corePluginOverrides = savedCore;
} catch { corePluginOverrides = {}; }

function isCoreEnabled(id) {
  if (Object.prototype.hasOwnProperty.call(corePluginOverrides, id)) return !!corePluginOverrides[id];
  const plugin = CORE_PLUGINS.find((item) => item.id === id);
  return plugin ? plugin.def : true;
}

function setCoreEnabled(id, enabled) {
  corePluginOverrides[id] = !!enabled;
  store.set("corePlugins", JSON.stringify(corePluginOverrides));
  applyCorePlugins();
}

function applyCorePlugins() {
  const graphBtn = $("openGraph");
  if (graphBtn) graphBtn.style.display = isCoreEnabled("graph") ? "" : "none";
  const canvasBtn = $("openCanvas");
  if (canvasBtn) canvasBtn.style.display = isCoreEnabled("canvas") ? "" : "none";
  const baseBtn = $("openBase");
  if (baseBtn) baseBtn.style.display = isCoreEnabled("bases") ? "" : "none";
  const paletteBtn = $("openPalette");
  if (paletteBtn) paletteBtn.style.display = isCoreEnabled("command-palette") ? "" : "none";
  const switcherBtn = $("openSwitcher");
  if (switcherBtn) switcherBtn.style.display = isCoreEnabled("switcher") ? "" : "none";
  const meta = $("stMeta");
  if (meta) meta.style.display = isCoreEnabled("word-count") ? "" : "none";
  const cursor = $("stCursor");
  if (cursor) cursor.style.display = isCoreEnabled("editor-status") ? "" : "none";
  if (!isCoreEnabled("page-preview")) hidePagePreview();
  renderRibbonExtra();
  showPane(store.get("leftTab", "files"));
  renderRightTabs();
  renderRightPanels();
}

let liveApi = null;
let livePath = null;
let live2Api = null;
let live2Path = null;
let activePane = 1;
let linkPane = 1;
const liveApis = [];
const livePaths = [];
const paneRefs = [];
let dailyApi = null;
let recorderApi = null;
let pdfApi = null;
let mediaApi = null;
let pluginsApi = null;
let appCfg = {
  newFileLocation: "root",
  newFileFolderPath: "",
  attachmentFolderPath: "",
  useTab: false,
  tabSize: 4,
  strictLineBreaks: false,
  propertiesInDocument: "visible",
};
let propertyTypes = {};

function editorIndentUnit() {
  return appCfg.useTab === true ? "\t" : " ".repeat(Math.max(1, Number(appCfg.tabSize) || 4));
}

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

function groupIndexFile(index) {
  const group = state.groups[index];
  if (!group || !group.active) return null;
  return state.open.find((file) => file.path === group.active) || null;
}

function imageUrlFor(name) {
  return "https://raw.githubusercontent.com/" + state.repo + "/" + state.branch + "/" + encodeURI(String(name).replace(/^\.?\//, ""));
}

const attachmentUrls = new Map();

function mimeFor(name) {
  const ext = String(name).split(".").pop().toLowerCase();
  return ({
    svg: "image/svg+xml", png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg",
    gif: "image/gif", webp: "image/webp", bmp: "image/bmp", avif: "image/avif",
    mp3: "audio/mpeg", wav: "audio/wav", ogg: "audio/ogg", m4a: "audio/mp4",
    flac: "audio/flac", aac: "audio/aac", opus: "audio/ogg",
    mp4: "video/mp4", webm: "video/webm", ogv: "video/ogg", mov: "video/quicktime",
    mkv: "video/x-matroska", m4v: "video/mp4", pdf: "application/pdf",
  }[ext] || "application/octet-stream");
}

function base64Bytes(value) {
  const bin = atob(String(value || "").replace(/\s/g, ""));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

async function loadAttachment(name) {
  let path = String(name || "").replace(/^\.?\//, "").split("#")[0];
  if (!path) throw new Error("empty path");
  if (!state.files.includes(path)) {
    const hit = state.files.find((p) => p === path || p.endsWith("/" + path));
    if (hit) path = hit;
  }
  const cacheKey = state.repo + "/" + state.branch + "/" + path;
  if (attachmentUrls.has(cacheKey)) return attachmentUrls.get(cacheKey);
  const promise = (async () => {
    let blob = null;
    try {
      const data = await api(contentsPath(path) + "?ref=" + encodeURIComponent(state.branch));
      if (data && data.encoding === "base64" && data.content) {
        blob = new Blob([base64Bytes(data.content)], { type: mimeFor(path) });
      }
    } catch { /* raw media fallback */ }
    if (!blob) {
      const res = await fetch("https://api.github.com" + contentsPath(path) + "?ref=" + encodeURIComponent(state.branch), {
        headers: {
          accept: "application/vnd.github.raw",
          authorization: "Bearer " + state.token,
          "x-github-api-version": "2022-11-28",
        },
      });
      if (!res.ok) throw new Error("HTTP " + res.status);
      blob = new Blob([await res.arrayBuffer()], { type: mimeFor(path) });
    }
    return URL.createObjectURL(blob);
  })();
  attachmentUrls.set(cacheKey, promise);
  try {
    return await promise;
  } catch (error) {
    attachmentUrls.delete(cacheKey);
    throw error;
  }
}

function openTargetNote(target) {
  const raw = String(target || "");
  const sameNote = raw.startsWith("#");
  const clean = sameNote ? raw.slice(1) : raw;
  const [name, anchor] = sameNote ? [null, clean] : clean.split("#");
  if (sameNote) { jumpToAnchor(anchor); return; }
  let hit = state.files.find((p) => p === name + ".md" || p === name || p.endsWith("/" + name + ".md"));
  if (!hit) hit = aliasTarget(name);
  if (!hit) { toast("Немає такої нотатки: " + name); return; }
  openNote(hit).then(() => { if (anchor) setTimeout(() => jumpToAnchor(anchor), 120); });
}

function extractSection(text, anchor) {
  const clean = String(anchor || "").replace(/^#/, "").trim();
  if (!clean) return text;
  const lines = String(text || "").split(/\r?\n/);
  if (clean.startsWith("^")) {
    const id = clean.slice(1);
    const at = lines.findIndex((line) => new RegExp("\\^" + escapeRegExp(id) + "\\s*$").test(line));
    if (at < 0) return text;
    let start = at;
    let end = at;
    while (start > 0 && lines[start - 1].trim() !== "") start--;
    while (end < lines.length - 1 && lines[end + 1].trim() !== "") end++;
    return lines.slice(start, end + 1).join("\n");
  }
  const headingText = (line) => {
    const match = line.match(/^(#{1,6})\s+(.*)$/);
    return match ? { level: match[1].length, text: match[2].replace(/[*_`]/g, "").trim() } : null;
  };
  const wanted = clean.toLowerCase();
  const at = lines.findIndex((line) => {
    const heading = headingText(line);
    return heading && heading.text.toLowerCase() === wanted;
  });
  if (at < 0) return text;
  const level = (lines[at].match(/^#+/) || [""])[0].length;
  let end = lines.length;
  for (let i = at + 1; i < lines.length; i++) {
    const heading = headingText(lines[i]);
    if (heading && heading.level <= level) { end = i; break; }
  }
  return lines.slice(at, end).join("\n");
}

function anchorLine(text, anchor) {
  const clean = String(anchor || "").replace(/^#/, "").trim();
  if (!clean) return -1;
  const lines = String(text || "").split(/\r?\n/);
  if (clean.startsWith("^")) {
    const id = clean.slice(1);
    return lines.findIndex((line) => new RegExp("\\^" + escapeRegExp(id) + "\\s*$").test(line));
  }
  const wanted = clean.toLowerCase();
  return lines.findIndex((line) => {
    const match = line.match(/^#{1,6}\s+(.*)$/);
    return match && match[1].replace(/[*_`]/g, "").trim().toLowerCase() === wanted;
  });
}

function scrollToAnchor(anchor) {
  const clean = String(anchor || "").replace(/^#/, "").trim();
  if (!clean) return;
  const host = $("preview");
  if (!host) return;
  let target = null;
  if (clean.startsWith("^")) {
    const id = clean.slice(1);
    target = host.querySelector('[data-block-id="' + CSS.escape(id) + '"]');
  } else {
    const wanted = clean.toLowerCase();
    target = [...host.querySelectorAll("h1,h2,h3,h4,h5,h6")].find((heading) => (heading.dataset.heading || heading.textContent).replace(/[*_`]/g, "").trim().toLowerCase() === wanted);
  }
  if (!target) return;
  target.scrollIntoView({ block: "start", behavior: "smooth" });
  target.classList.add("is-flashing");
  setTimeout(() => target.classList.remove("is-flashing"), 1200);
}

function jumpToAnchor(anchor) {
  const current = currentFile();
  if (!current) return;
  if (state.mode === "live" && liveApi) {
    const line = anchorLine(current.text, anchor);
    if (line >= 0) liveApi.goToLine(line + 1);
    return;
  }
  scrollToAnchor(anchor);
}

function stripBlockIds(root) {
  root.querySelectorAll("p, li").forEach((node) => {
    const match = (node.textContent || "").match(/\s\^([A-Za-z0-9-]+)\s*$/);
    if (!match) return;
    node.dataset.blockId = match[1];
    const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT);
    let last = null;
    while (walker.nextNode()) last = walker.currentNode;
    if (last && last.nodeValue && last.nodeValue.trimEnd().endsWith("^" + match[1])) {
      last.nodeValue = last.nodeValue.replace(new RegExp("\\s*\\^" + escapeRegExp(match[1]) + "\\s*$"), "");
    }
  });
}

function openVaultMenu(event) {
  event.stopPropagation();
  const rect = event.currentTarget.getBoundingClientRect();
  const items = [];
  for (const vault of readVaults()) {
    const current = vault.repo === state.repo && vault.branch === state.branch;
    items.push({
      label: (current ? "✓ " : "") + vault.repo + " · " + vault.branch,
      run: () => switchVault(vault.repo, vault.branch),
    });
  }
  if (!items.length) items.push({ label: "Поточне сховище: " + state.repo, run: openSettings });
  items.push({ sep: true });
  items.push({ label: "Налаштування сховища", run: openSettings });
  items.push({ label: "Забути токен", danger: true, run: () => { store.del("token"); location.reload(); } });
  showCtx(rect.left, rect.bottom + 4, items);
}

function readVaults() {
  try {
    const data = JSON.parse(store.get("vaults", "[]"));
    if (!Array.isArray(data)) return [];
    return data
      .filter((item) => item && typeof item.repo === "string" && item.repo.includes("/"))
      .map((item) => ({ repo: item.repo, branch: item.branch || "main" }));
  } catch { return []; }
}

function saveVault() {
  if (!state.repo || !state.repo.includes("/")) return;
  const list = readVaults().filter((item) => !(item.repo === state.repo && item.branch === state.branch));
  list.unshift({ repo: state.repo, branch: state.branch });
  store.set("vaults", JSON.stringify(list.slice(0, 12)));
  renderVaultButton();
}

function renderVaultButton() {
  const btn = $("vaultBtn");
  if (!btn) return;
  const name = state.repo.split("/")[1] || state.repo || "Vault";
  btn.textContent = name + " ▾";
  btn.title = state.repo + " · " + state.branch;
}

function switchVault(repo, branch) {
  store.set("repo", repo);
  store.set("branch", branch || "main");
  location.reload();
}

let workspaceTimer = null;

function saveWorkspace() {
  const pane2 = $("pane2");
  const match = pane2 ? String(pane2.style.flex || "").match(/(\d+)px/) : null;
  const widths = state.groups.map((_, index) => {
    if (index === 0) return null;
    if (index === 1) return state.groups[1] && match ? Number(match[1]) : null;
    const pane = getPane(index);
    const width = pane && pane.wrapper ? pane.wrapper.getBoundingClientRect().width : 0;
    return width > 0 ? Math.round(width) : null;
  });
  const data = {
    v: 1,
    groups: state.groups.map((group) => ({ tabs: group.tabs.slice(), active: group.active, stacked: !!group.stacked })),
    pane2Width: widths[1],
    widths,
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
  const specs = data.groups.map((group) => ({
    tabs: Array.isArray(group.tabs) ? group.tabs.filter(valid) : [],
    active: valid(group.active) ? group.active : null,
    stacked: !!group.stacked,
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
    return { tabs, active: tabs.includes(spec.active) ? spec.active : (tabs[0] || null), stacked: !!spec.stacked };
  };
  let groups = specs.map(build).filter((group) => group.tabs.length);
  if (!groups.length) return false;
  state.groups = groups;
  state.active = groups[0].active;
  syncSecond();
  destroyExtraPanes();
  for (let at = 2; at < groups.length; at++) getPane(at);
  const savedWidths = Array.isArray(data.widths) ? data.widths : [];
  const savedPane2 = Number(data.pane2Width || savedWidths[1]);
  if (groups[1]) {
    document.body.classList.add("split");
    if (Number.isFinite(savedPane2) && savedPane2 > 120) {
      const mainWidth = document.querySelector("main").getBoundingClientRect().width || window.innerWidth;
      const width = Math.min(Math.round(savedPane2), Math.max(120, Math.round(mainWidth * 0.85)));
      $("pane2").style.flex = "0 0 " + width + "px";
    } else {
      $("pane2").style.flex = "";
    }
  } else {
    document.body.classList.remove("split");
    $("pane2").style.flex = "";
  }
  const mainWidth = document.querySelector("main").getBoundingClientRect().width || window.innerWidth;
  for (let at = 2; at < groups.length; at++) {
    const pane = getPane(at);
    const width = Number(savedWidths[at]);
    if (pane && pane.wrapper && Number.isFinite(width) && width > 120) {
      pane.wrapper.style.flex = "0 0 " + Math.min(Math.round(width), Math.max(160, Math.round(mainWidth * 0.7))) + "px";
    }
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
  if (!isMobileLayout()) return 0;
  const index = state.mobileGroup - 1;
  return index >= 0 && index < state.groups.length ? index : 0;
}

function applyMobilePane() {
  const toggle = $("mobileSwitch");
  const pane1Editor = document.querySelector('main > .editor-host[data-pane="1"]');
  const pane1Live = $("liveHost");
  if (!isMobileLayout()) {
    document.body.classList.remove("mobile-pane2");
    document.querySelectorAll(".mobile-hidden").forEach((node) => node.classList.remove("mobile-hidden"));
    if (toggle) toggle.style.display = "none";
    renderTabs();
    return;
  }
  const count = state.groups.length;
  state.mobileGroup = Math.max(1, Math.min(state.mobileGroup || 1, count));
  store.set("mobileGroup", String(state.mobileGroup));
  const selected = state.mobileGroup - 1;
  if (pane1Editor) pane1Editor.classList.toggle("mobile-hidden", selected !== 0);
  if (pane1Live) pane1Live.classList.toggle("mobile-hidden", selected !== 0);
  const previewHost = $("previewHost");
  if (previewHost) previewHost.classList.toggle("mobile-hidden", selected !== 0);
  for (let index = 1; index < count; index++) {
    const pane = getPane(index);
    if (pane && pane.wrapper) pane.wrapper.classList.toggle("mobile-hidden", selected !== index);
  }
  if (toggle) {
    toggle.style.display = count > 1 ? "flex" : "none";
    toggle.innerHTML = "";
    for (let index = 0; index < count; index++) {
      const btn = document.createElement("button");
      btn.dataset.group = String(index + 1);
      btn.textContent = String(index + 1);
      btn.title = "Група " + (index + 1);
      btn.classList.toggle("active", index === selected);
      btn.onclick = () => setMobileGroup(index + 1);
      toggle.appendChild(btn);
    }
  }
  renderTabs();
  if (selected > 0) paintGroup(selected);
}

function setMobileGroup(index) {
  state.mobileGroup = Math.max(1, Math.min(index, state.groups.length));
  store.set("mobileGroup", String(state.mobileGroup));
  applyMobilePane();
  if (!isMobileLayout()) return;
  const groupIndex = state.mobileGroup - 1;
  if (state.mode === "live") {
    const api = groupIndex === 0 ? liveApi : groupIndex === 1 ? live2Api : liveApis[groupIndex];
    api?.focus();
  } else {
    const editor = groupIndex === 0 ? $("editor") : getPane(groupIndex)?.editor;
    editor?.focus();
  }
}

function theme() {
  const pref = store.get("theme", "dark");
  const systemDark = window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches;
  const actual = pref === "system" ? (systemDark ? "dark" : "light") : pref;
  document.documentElement.dataset.theme = actual;
  document.body.classList.toggle("theme-dark", actual === "dark");
  document.body.classList.toggle("theme-light", actual === "light");
}

const themeMedia = window.matchMedia ? window.matchMedia("(prefers-color-scheme: dark)") : null;
const onThemeMediaChange = () => { if (store.get("theme", "dark") === "system") theme(); };
if (themeMedia) {
  if (themeMedia.addEventListener) themeMedia.addEventListener("change", onThemeMediaChange);
  else if (themeMedia.addListener) themeMedia.addListener(onThemeMediaChange);
}

let themeStyleEl = null;
let installedThemes = [];
let activeThemeName = "";

async function listThemes() {
  try {
    const data = await api("/repos/" + state.repo + "/contents/.obsidian/themes?ref=" + encodeURIComponent(state.branch));
    const dirs = Array.isArray(data) ? data.filter((item) => item && item.type === "dir") : [];
    const themes = [];
    for (const dir of dirs) {
      try {
        const css = await ghGet(".obsidian/themes/" + dir.name + "/theme.css");
        themes.push({ name: dir.name, css: css.text });
      } catch { /* skip theme without css */ }
    }
    installedThemes = themes;
  } catch { installedThemes = []; }
  return installedThemes;
}

function clearThemeCss() {
  if (themeStyleEl) { themeStyleEl.remove(); themeStyleEl = null; }
}

function applyThemeCss(name, css) {
  clearThemeCss();
  activeThemeName = name || "";
  if (!name || !css) return;
  themeStyleEl = document.createElement("style");
  themeStyleEl.id = "vault-community-theme";
  themeStyleEl.textContent = css;
  document.head.appendChild(themeStyleEl);
}

async function applyThemeByName(name) {
  if (!name) { applyThemeCss("", ""); return; }
  const hit = installedThemes.find((item) => item.name === name);
  if (hit) { applyThemeCss(hit.name, hit.css); return; }
  try {
    const css = await ghGet(".obsidian/themes/" + name + "/theme.css");
    applyThemeCss(name, css.text);
  } catch { applyThemeCss("", ""); }
}

async function loadAppearanceConfig() {
  try {
    const raw = JSON.parse((await ghGet(".obsidian/appearance.json")).text);
    if (raw && typeof raw === "object" && raw.cssTheme) {
      await listThemes();
      await applyThemeByName(raw.cssTheme);
    }
  } catch { /* no custom theme */ }
}

function renderThemeOptions(selected) {
  const select = $("setThemeName");
  if (!select) return;
  select.innerHTML = "";
  const def = document.createElement("option");
  def.value = "";
  def.textContent = "Стандартна";
  select.appendChild(def);
  for (const theme of installedThemes) {
    const option = document.createElement("option");
    option.value = theme.name;
    option.textContent = theme.name;
    select.appendChild(option);
  }
  select.value = selected != null ? selected : activeThemeName;
}

const ACCENT_PRESETS = ["#a882ff", "#5d9cff", "#52c98a", "#e0b458", "#e5686c", "#ff7ac6", "#7ad7d7", "#9a9a9a"];

const HOTKEY_ACTIONS = [
  { id: "save", label: "Зберегти нотатку", def: "Mod+S" },
  { id: "close-tab", label: "Закрити вкладку", def: "Mod+W" },
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
  applySpellcheck();
}

function applySpellcheck() {
  const on = store.get("spellcheck", "1") !== "0";
  ["editor", "editor2"].forEach((id) => { const node = $(id); if (node) node.spellcheck = on; });
  document.querySelectorAll(".cm-content").forEach((node) => { node.spellcheck = on; });
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
    case "close-tab": {
      const index = activeGroupIndex();
      const group = state.groups[index];
      if (group && group.active) closeTab(group.active, index);
      break;
    }
    case "mode": toggleMode(); break;
    case "palette": showPalette(); break;
    case "switcher": showSwitcher(); break;
    case "graph":
      if (state.view === "graph") { setView("note"); }
      else {
        const localToggle = $("graphLocal");
        if (localToggle) { localToggle.checked = false; localToggle.dispatchEvent(new Event("change")); }
        setView("graph");
      }
      break;
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
    const core = btn.core || (btn.id === "daily" ? "daily-notes" : btn.id === "template" ? "templates" : null);
    if (core && !isCoreEnabled(core)) return;
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
    .filter((p) => p.endsWith(".md") || p.endsWith(".canvas") || p.endsWith(".base") || p.endsWith(".pdf") || isMediaPath(p))
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
  const sortMode = store.get("fileSort", "name-asc");
  const sortDir = sortMode === "name-desc" ? -1 : 1;
  const foldersFirst = store.get("foldersFirst", "1") === "1";
  const cmp = (a, b) => a.localeCompare(b, "uk", { numeric: true, sensitivity: "base" }) * sortDir;
  const walk = (node, prefix, depth) => {
    const folderNames = Object.keys(node).filter((k) => node[k] !== null);
    const leafNames = Object.keys(node).filter((k) => node[k] === null);
    const entries = [];
    if (foldersFirst) {
      folderNames.sort(cmp).forEach((name) => entries.push({ name, folder: true }));
      leafNames.sort(cmp).forEach((name) => entries.push({ name, folder: false }));
    } else {
      folderNames.forEach((name) => entries.push({ name, folder: true }));
      leafNames.forEach((name) => entries.push({ name, folder: false }));
      entries.sort((a, b) => cmp(a.name, b.name));
    }
    for (const entry of entries) {
      if (entry.folder) {
        const folder = entry.name;
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
        row.oncontextmenu = (event) => {
          event.preventDefault();
          event.stopPropagation();
          folderContext(event, full);
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
      } else {
        const leaf = entry.name;
        if (leaf.startsWith(".")) continue;
        const full = prefix ? prefix + "/" + leaf : leaf;
        const row = el("div", "file-row" + (full === state.active ? " active" : ""));
        row.style.paddingLeft = 12 + depth * 12 + "px";
        row.draggable = true;
        row.appendChild(el("span", null, full.endsWith(".canvas") ? "🎨" : full.endsWith(".base") ? "🗃" : full.endsWith(".pdf") ? "📕" : /\.(svg|png|jpe?g|gif|webp|bmp|avif)$/i.test(full) ? "🖼" : /\.(mp3|wav|ogg|m4a|flac|aac|opus)$/i.test(full) ? "🎵" : /\.(mp4|webm|ogv|mov|mkv|m4v)$/i.test(full) ? "🎬" : "📄"));
        row.appendChild(el("span", "label", leaf.replace(/\.(md|canvas|base|pdf|svg|png|jpe?g|gif|webp|bmp|avif|mp3|wav|ogg|m4a|flac|aac|opus|mp4|webm|ogv|mov|mkv|m4v)$/i, "")));
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
    renameBookmarkPath(path, target);
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
function bookmarkFilePaths(items = bookmarkItems) {
  const paths = [];
  for (const item of items) {
    if (!item || typeof item !== "object") continue;
    if (item.type === "file" && item.path) paths.push(item.path);
    if (item.type === "group" && Array.isArray(item.items)) paths.push(...bookmarkFilePaths(item.items));
  }
  return paths;
}

function persistBookmarks() {
  store.set("bookmarkItems", JSON.stringify(bookmarkItems));
  state.bookmarks = bookmarkFilePaths();
  store.set("bookmarks", JSON.stringify(state.bookmarks));
}

function findBookmark(predicate, items = bookmarkItems) {
  for (const item of items) {
    if (!item || typeof item !== "object") continue;
    if (predicate(item)) return item;
    if (item.type === "group" && Array.isArray(item.items)) {
      const hit = findBookmark(predicate, item.items);
      if (hit) return hit;
    }
  }
  return null;
}

function bookmarkIcon(item) {
  if (item.type === "folder") return "📁";
  if (item.type === "search") return "🔍";
  if (item.type === "heading") return "#";
  if (item.type === "block") return "¶";
  if (item.type === "group") return item.collapsed ? "▸" : "▾";
  return "📄";
}

function renderBookmarkGroup(items, host, depth) {
  for (const item of items) {
    if (!item || typeof item !== "object") continue;
    const row = el("div", "bm-item bm-" + item.type);
    row.style.paddingLeft = 6 + depth * 12 + "px";
    row.appendChild(el("span", "bm-icon", bookmarkIcon(item)));
    const title = item.title || (item.type === "search" ? item.query : item.path) || "Без назви";
    row.appendChild(el("span", "bm-title", title));
    row.title = item.type === "search" ? (item.query || "") : (item.path || title);
    if (item.type === "group") {
      row.onclick = () => {
        item.collapsed = !item.collapsed;
        store.set("bookmarkItems", JSON.stringify(bookmarkItems));
        renderBookmarks();
      };
      row.oncontextmenu = (event) => { event.preventDefault(); event.stopPropagation(); bookmarkContext(event, item); };
      host.appendChild(row);
      if (!item.collapsed) renderBookmarkGroup(Array.isArray(item.items) ? item.items : [], host, depth + 1);
      continue;
    }
    row.onclick = () => openBookmark(item);
    row.oncontextmenu = (event) => { event.preventDefault(); event.stopPropagation(); bookmarkContext(event, item); };
    host.appendChild(row);
  }
}

function renderBookmarks() {
  const host = $("bookmarks");
  if (!host) return;
  host.innerHTML = "";
  if (!bookmarkItems.length) {
    host.appendChild(el("div", "empty", "Немає закладок. Зірочка біля файлу або команда «У закладки»."));
    return;
  }
  host.appendChild(el("div", "bm-head", "Закладки"));
  renderBookmarkGroup(bookmarkItems, host, 0);
}

async function openBookmark(item) {
  if (!item) return;
  if (item.type === "file") { await openNote(item.path); return; }
  if (item.type === "folder") { revealFolder(item.path); return; }
  if (item.type === "search") {
    $("searchInput").value = item.query || "";
    showPane("search");
    await runSearch();
    return;
  }
  if (item.type === "heading") {
    await openNote(item.path);
    const file = currentFile();
    const target = String(item.subpath || "").replace(/^#/, "").trim();
    if (!file || !target) return;
    const lines = file.text.split(/\r?\n/);
    const at = lines.findIndex((line) => {
      const match = line.match(/^#{1,6}\s+(.*)$/);
      return match && match[1].trim() === target;
    });
    if (at >= 0) jumpToLine(at);
    return;
  }
  if (item.type === "block") {
    await openNote(item.path);
    const file = currentFile();
    const id = String(item.subpath || "").replace(/^\^/, "").trim();
    if (!file || !id) return;
    const at = file.text.indexOf("^" + id);
    if (at >= 0) jumpToLine(file.text.slice(0, at).split("\n").length - 1);
  }
}

function revealFolder(folder) {
  let collapsed = [];
  try { collapsed = JSON.parse(store.get("collapsed", "[]")); } catch { collapsed = []; }
  const open = new Set(Array.isArray(collapsed) ? collapsed : []);
  const parts = String(folder || "").split("/").filter(Boolean);
  let prefix = "";
  for (const part of parts) {
    prefix = prefix ? prefix + "/" + part : part;
    open.delete(prefix);
  }
  store.set("collapsed", JSON.stringify([...open]));
  showPane("files");
  renderTree();
}

function bookmarkItemKey(item) {
  return [item.type, item.path || "", item.subpath || "", item.query || "", item.title || ""].join("\u0000");
}

function removeBookmarkItem(target) {
  if (!target) return;
  const key = bookmarkItemKey(target);
  const removeFrom = (list) => {
    const at = list.indexOf(target);
    if (at >= 0) { list.splice(at, 1); return true; }
    const byKey = list.findIndex((item) => item && typeof item === "object" && bookmarkItemKey(item) === key);
    if (byKey >= 0) { list.splice(byKey, 1); return true; }
    for (const item of list) {
      if (item && item.type === "group" && Array.isArray(item.items) && removeFrom(item.items)) return true;
    }
    return false;
  };
  removeFrom(bookmarkItems);
  persistBookmarks();
  renderBookmarks();
  renderTree();
  toast("знято із закладок");
}

function toggleBookmark(path) {
  const existing = findBookmark((item) => item.type === "file" && item.path === path);
  if (existing) { removeBookmarkItem(existing); return; }
  bookmarkItems.push({ type: "file", path, title: noteName(path), ctime: Date.now() });
  persistBookmarks();
  renderBookmarks();
  renderTree();
  toast("у закладках: " + path.split("/").pop());
}

function addFolderBookmark(folder) {
  if (findBookmark((item) => item.type === "folder" && item.path === folder)) { toast("тека вже в закладках"); return; }
  bookmarkItems.push({ type: "folder", path: folder, title: folder.split("/").pop(), ctime: Date.now() });
  persistBookmarks();
  renderBookmarks();
  toast("тека в закладках: " + folder);
}

function bookmarkCurrentSearch() {
  const query = $("searchInput").value.trim();
  if (!query) { showPane("search"); toast("Спочатку введи запит у пошуку"); return; }
  bookmarkItems.push({ type: "search", query, title: query, ctime: Date.now() });
  persistBookmarks();
  renderBookmarks();
  toast("пошук у закладках");
}

function bookmarkCurrentHeading() {
  const file = currentFile();
  if (!file) { toast("Спочатку відкрий нотатку"); return; }
  const ctx = selectionLineContext();
  const lines = file.text.split(/\r?\n/);
  let line = 0;
  if (ctx) line = ctx.text.slice(0, ctx.from).split("\n").length - 1;
  let heading = "";
  for (let i = Math.min(line, lines.length - 1); i >= 0; i--) {
    const match = lines[i].match(/^#{1,6}\s+(.*)$/);
    if (match) { heading = match[1].trim(); break; }
  }
  if (!heading) { toast("Немає заголовка вище"); return; }
  const subpath = "#" + heading;
  if (findBookmark((item) => item.type === "heading" && item.path === file.path && item.subpath === subpath)) {
    toast("заголовок уже в закладках");
    return;
  }
  bookmarkItems.push({ type: "heading", path: file.path, subpath, title: heading, ctime: Date.now() });
  persistBookmarks();
  renderBookmarks();
  toast("заголовок у закладках");
}

function createBookmarkGroup() {
  const title = prompt("Назва групи закладок:", "Група");
  if (title == null || !title.trim()) return;
  bookmarkItems.push({ type: "group", title: title.trim(), items: [], ctime: Date.now() });
  persistBookmarks();
  renderBookmarks();
  toast("група створена: " + title.trim());
}

function bookmarkContext(event, item) {
  const menu = [
    { label: "Відкрити", run: () => openBookmark(item) },
    { label: "Перейменувати…", run: () => {
        const next = prompt("Назва закладки:", item.title || "");
        if (next == null) return;
        item.title = next.trim() || item.title;
        persistBookmarks();
        renderBookmarks();
      } },
    { sep: true },
  ];
  if (item.type === "group") {
    menu.push(
      { label: "Додати поточну нотатку", run: () => {
          const file = currentFile();
          if (!file) { toast("Спочатку відкрий нотатку"); return; }
          if (!Array.isArray(item.items)) item.items = [];
          item.items.push({ type: "file", path: file.path, title: noteName(file.path), ctime: Date.now() });
          persistBookmarks();
          renderBookmarks();
        } },
      { label: "Додати поточний пошук", run: () => {
          const query = $("searchInput").value.trim();
          if (!query) { toast("Порожній пошук"); return; }
          if (!Array.isArray(item.items)) item.items = [];
          item.items.push({ type: "search", query, title: query, ctime: Date.now() });
          persistBookmarks();
          renderBookmarks();
        } }
    );
  }
  menu.push({ label: "Видалити із закладок", danger: true, run: () => removeBookmarkItem(item) });
  showCtx(event.clientX, event.clientY, menu);
}

function renameBookmarkPath(from, to) {
  let changed = false;
  const walk = (items) => {
    for (const item of items) {
      if (!item || typeof item !== "object") continue;
      if (item.type === "group") { walk(Array.isArray(item.items) ? item.items : []); continue; }
      if (!item.path) continue;
      if (item.path === from) {
        item.path = to;
        item.title = item.type === "file" ? noteName(to) : (item.title || to.split("/").pop());
        changed = true;
      } else if (item.path.startsWith(from + "/")) {
        item.path = to + item.path.slice(from.length);
        changed = true;
      }
    }
  };
  walk(bookmarkItems);
  if (changed) {
    persistBookmarks();
    renderBookmarks();
  }
}

function copyText(text) {
  navigator.clipboard.writeText(text).then(() => toast("скопійовано"), () => toast("буфер недоступний"));
}

function showCtx(x, y, items) {
  const menu = $("ctxMenu");
  menu.innerHTML = "";
  for (const item of items) {
    if (item.sep) { menu.appendChild(el("div", "ctx-sep")); continue; }
    const row = el("div", "ctx-item" + (item.danger ? " danger" : "") + (item.disabled ? " disabled" : ""), item.label);
    if (!item.disabled) row.onclick = () => { hideCtx(); item.run(); };
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
    { label: "Відкрити в новій панелі", run: () => addPane(path) },
    { sep: true },
    { label: "Перейменувати", run: () => renameNote(path) },
    { label: "Перемістити…", run: () => moveFilePrompt(path) },
    { label: "Дублювати", run: () => duplicateNote(path) },
    { label: "Копіювати шлях", run: () => copyText(path) },
    { sep: true },
    { label: state.bookmarks.includes(path) ? "Зняти із закладок" : "У закладки", run: () => toggleBookmark(path) },
    { sep: true },
    { label: "Видалити", danger: true, run: () => deleteNote(path) },
  ]);
}

function tabContext(event, groupIndex, path) {
  showCtx(event.clientX, event.clientY, [
    { label: "Закрити", run: () => closeTab(path, groupIndex) },
    { label: "Закрити інші", run: () => closeOtherTabs(groupIndex, path) },
    { label: "Закрити всі", run: () => closeAllTabs(groupIndex) },
    { sep: true },
    { label: "Відкрити в новій панелі", run: () => addPane(path) },
    { label: "Перемістити в першу панель", disabled: groupIndex === 0, run: () => moveTabBetweenGroups(groupIndex, path, 0) },
    { sep: true },
    { label: "Копіювати шлях", run: () => copyText(path) },
    { label: state.groups[groupIndex] && state.groups[groupIndex].stacked ? "Розкласти вкладки" : "Скласти вкладки", run: () => toggleStackedTabs(groupIndex) },
    { label: state.bookmarks.includes(path) ? "Зняти із закладок" : "У закладки", run: () => toggleBookmark(path) },
  ]);
}

function closeOtherTabs(groupIndex, keepPath) {
  const group = state.groups[groupIndex];
  if (!group) return;
  for (const path of group.tabs.slice()) {
    if (path !== keepPath) closeTab(path, groupIndex);
  }
  const next = state.groups[groupIndex];
  if (next) next.active = keepPath;
  state.active = group1().active;
  renderTabs(); renderTree(); paint(); scheduleWorkspaceSave();
}

function closeAllTabs(groupIndex) {
  const group = state.groups[groupIndex];
  if (!group) return;
  for (const path of group.tabs.slice()) closeTab(path, groupIndex);
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

function folderContext(event, folder) {
  const bookmarked = !!findBookmark((item) => item.type === "folder" && item.path === folder);
  showCtx(event.clientX, event.clientY, [
    { label: "Нова нотатка", run: () => newNoteInFolder(folder) },
    { label: "Нова тека", run: () => newSubfolder(folder) },
    { sep: true },
    { label: "Перейменувати теку", run: () => renameFolder(folder) },
    { label: "Копіювати шлях", run: () => copyText(folder) },
    { sep: true },
    { label: bookmarked ? "Зняти теку із закладок" : "Теку в закладки", run: () => {
        if (bookmarked) {
          const item = findBookmark((entry) => entry.type === "folder" && entry.path === folder);
          if (item) removeBookmarkItem(item);
        } else {
          addFolderBookmark(folder);
        }
      } },
    { sep: true },
    { label: "Видалити теку", danger: true, run: () => deleteFolder(folder) },
  ]);
}

async function newNoteInFolder(folder) {
  const raw = prompt("Назва нотатки:", "Нова нотатка");
  if (!raw) return;
  let name = raw.trim().replace(/^\/+/, "");
  if (!name) return;
  if (!name.endsWith(".md")) name += ".md";
  const path = folder ? folder + "/" + name : name;
  try {
    await ghPut(path, "# " + name.split("/").pop().replace(/\.md$/, "") + "\n\n", null, "add " + path);
    state.pending.add(path);
    await loadTree();
    await openNote(path);
    emit("create", path);
    toast("створено " + path);
  } catch (error) { toast("Не вийшло: " + error.message); }
}

async function newSubfolder(folder) {
  const raw = prompt("Назва теки:", "Нова тека");
  if (!raw) return;
  const name = raw.trim().replace(/^\/+|\/+$/g, "");
  if (!name) return;
  const path = folder ? folder + "/" + name : name;
  try {
    await ghPut(path + "/.gitkeep", "", null, "add folder " + path);
    await loadTree();
    emit("create", path + "/.gitkeep");
    toast("теку створено: " + path);
  } catch (error) { toast("Не вийшло: " + error.message); }
}

async function renameFolder(folder) {
  const next = prompt("Нове імʼя теки:", folder);
  if (!next) return;
  const target = next.trim().replace(/^\/+|\/+$/g, "");
  if (!target || target === folder || target.startsWith(folder + "/")) return;
  if (state.files.some((path) => path.startsWith(target + "/")) || state.folders.includes(target)) {
    toast("тека вже існує");
    return;
  }
  const prefix = folder + "/";
  const affected = [...new Set([...state.files, ...state.folders.map((name) => name + "/.gitkeep")])]
    .filter((path) => path.startsWith(prefix));
  if (!affected.length) { toast("тека порожня"); return; }
  try {
    setState("перейменовую…");
    for (const path of affected) {
      const { text, sha } = await ghGet(path);
      const moved = target + "/" + path.slice(prefix.length);
      await ghPut(moved, text, null, "rename " + path + " → " + moved);
      await ghDelete(path, sha);
    }
    for (const file of state.open) {
      if (file.path.startsWith(prefix)) file.path = target + "/" + file.path.slice(prefix.length);
    }
    for (const group of state.groups) {
      group.tabs = group.tabs.map((path) => path.startsWith(prefix) ? target + "/" + path.slice(prefix.length) : path);
      if (group.active && group.active.startsWith(prefix)) group.active = target + "/" + group.active.slice(prefix.length);
    }
    state.active = group1().active;
    syncSecond();
    await loadTree(); renderTabs(); paint(); updateSplitButtons();
    renameBookmarkPath(folder, target);
    toast("теку перейменовано");
  } catch (error) { toast("Не вийшло: " + error.message); }
}

async function deleteFolder(folder) {
  if (!confirm("Видалити теку " + folder + " і весь її вміст?")) return;
  const prefix = folder + "/";
  const targets = state.files.filter((path) => path.startsWith(prefix));
  try {
    setState("видаляю…");
    for (const path of targets) {
      try {
        const { sha } = await ghGet(path);
        await ghDelete(path, sha);
      } catch { /* skip missing */ }
    }
    state.open = state.open.filter((file) => !file.path.startsWith(prefix));
    for (const group of state.groups) {
      group.tabs = group.tabs.filter((path) => !path.startsWith(prefix));
      if (group.active && group.active.startsWith(prefix)) group.active = group.tabs[0] || null;
    }
    state.active = group1().active;
    syncSecond();
    await loadTree(); renderTabs(); paint(); updateSplitButtons(); applyMobilePane();
    toast("теку видалено");
  } catch (error) { toast("Не вийшло: " + error.message); }
}

function ensureGroupAt(index) {
  while (state.groups.length <= index) {
    state.groups.push({ tabs: [], active: null });
    const created = state.groups.length - 1;
    if (created >= 2) getPane(created);
  }
  return state.groups[index];
}

function openInGroup(path, index = 1) {
  if (!path) return;
  const apply = () => {
    ensureGroupAt(index);
    const group = state.groups[index];
    addTab(group, path);
    document.body.classList.add("split");
    if (isMobileLayout()) state.mobileGroup = index + 1;
    if (index === 1) syncSecond();
    renderTabs();
    paint();
    updateSplitButtons();
    applyMobilePane();
    scheduleWorkspaceSave();
  };
  if (state.open.some((f) => f.path === path)) { apply(); return; }
  openNote(path).then(apply, apply);
}

function openInSecond(path) {
  openInGroup(path, 1);
}

function addPane(path) {
  const index = state.groups.length;
  state.groups.push({ tabs: [], active: null });
  if (index >= 2) getPane(index);
  if (path) addTab(state.groups[index], path);
  document.body.classList.add("split");
  if (isMobileLayout()) state.mobileGroup = index + 1;
  renderTabs();
  paint();
  updateSplitButtons();
  applyMobilePane();
  scheduleWorkspaceSave();
}

function destroyExtraPanes() {
  for (const key of Object.keys(paneRefs)) {
    const index = Number(key);
    if (index < 2) continue;
    const pane = paneRefs[index];
    if (pane && pane.splitter) pane.splitter.remove();
    if (pane && pane.wrapper) pane.wrapper.remove();
    delete paneRefs[index];
    delete liveApis[index];
    delete livePaths[index];
  }
}

function removeGroupAt(index) {
  if (index <= 0 || index >= state.groups.length) return;
  state.groups.splice(index, 1);
  destroyExtraPanes();
  for (let at = 2; at < state.groups.length; at++) getPane(at);
  if (state.groups.length === 1) {
    document.body.classList.remove("split");
    $("pane2").style.flex = "";
  }
  state.mobileGroup = Math.min(state.mobileGroup, state.groups.length);
  state.active = group1().active;
  syncSecond();
}

function closeGroup(index) {
  if (index <= 0) return;
  const group = state.groups[index];
  if (!group) return;
  const otherGroups = state.groups.filter((_, at) => at !== index);
  const orphanDirty = group.tabs
    .filter((path) => !otherGroups.some((item) => item.tabs.includes(path)))
    .map((path) => state.open.find((file) => file.path === path))
    .filter((file) => file && file.dirty);
  if (orphanDirty.length && !confirm("У панелі є незбережені зміни. Закрити?")) return;
  for (const path of group.tabs) {
    if (!otherGroups.some((item) => item.tabs.includes(path))) {
      const at = state.open.findIndex((file) => file.path === path);
      if (at >= 0) state.open.splice(at, 1);
    }
  }
  removeGroupAt(index);
  renderTabs(); renderTree(); paint(); updateSplitButtons();
  applyMobilePane();
  scheduleWorkspaceSave();
}

function closeSecond() {
  closeGroup(1);
}

function updateSplitButtons() {
  const btn = $("splitBtn");
  if (btn) {
    btn.textContent = "▢";
    btn.title = "Додати панель";
  }
}

function parseGroupSource(source) {
  const match = String(source || "").match(/^group:(\d+)$/);
  return match ? Number(match[1]) : -1;
}

function groupBar(index) {
  if (index === 0) return $("tabs");
  const pane = getPane(index);
  return pane ? pane.tabs : null;
}

function makeGroupTab(index, path, bar) {
  const group = state.groups[index];
  const file = state.open.find((item) => item.path === path);
  if (!group || !file) return;
  const tab = el("div", "tab" + (path === group.active ? " active" : ""));
  tab.appendChild(el("span", "name", path.split("/").pop().replace(/\.md$/, "")));
  if (file.dirty) tab.appendChild(el("span", "dot", "•"));
  const close = el("span", "close", "✕");
  close.onclick = (event) => { event.stopPropagation(); closeTab(path, index); };
  tab.appendChild(close);
  tab.onclick = () => {
    group.active = path;
    if (index === 0) {
      state.active = path;
      setView("note");
      pushHistoryState(path);
      renderTabs(); renderTree(); paint();
    } else {
      activePane = index + 1;
      if (index === 1) syncSecond();
      paintGroup(index);
      renderGroupTabsInto(index, bar);
    }
  };
  tab.onauxclick = (event) => { if (event.button === 1) closeTab(path, index); };
  tab.oncontextmenu = (event) => {
    event.preventDefault();
    event.stopPropagation();
    tabContext(event, index, path);
  };
  makeTabDraggable(tab, path, "group:" + index);
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
    const sourceIndex = parseGroupSource(event.dataTransfer.getData("text/vault-tab-source"));
    if (!moved || sourceIndex < 0) return;
    event.preventDefault();
    event.stopPropagation();
    clearTabDropMarkers();
    if (sourceIndex === index) {
      const rect = tab.getBoundingClientRect();
      const after = event.clientX > rect.left + rect.width / 2;
      reorderGroupTabs(index, moved, path, after);
    } else {
      moveTabBetweenGroups(sourceIndex, moved, index);
    }
  });
  bar.appendChild(tab);
}

function renderGroupTabsInto(index, bar) {
  if (!bar) return;
  const group = state.groups[index];
  bar.innerHTML = "";
  bar.classList.toggle("stacked", !!(group && group.stacked));
  document.body.classList.toggle("has-stacked-tabs", state.groups.some((item) => item && item.stacked));
  if (!group) return;
  for (const path of group.tabs) makeGroupTab(index, path, bar);
  if (index > 0) {
    const close = el("button", "icon-btn pane-close", "✕");
    close.title = "Закрити панель";
    close.onclick = (event) => { event.stopPropagation(); closeGroup(index); };
    bar.appendChild(close);
  }
  bar.ondragover = (event) => {
    if ([...event.dataTransfer.types].includes("text/vault-tab")) event.preventDefault();
  };
  bar.ondrop = (event) => {
    if (event.target.closest(".tab")) return;
    const moved = event.dataTransfer.getData("text/vault-tab");
    const sourceIndex = parseGroupSource(event.dataTransfer.getData("text/vault-tab-source"));
    if (!moved || sourceIndex < 0) return;
    event.preventDefault();
    event.stopPropagation();
    if (sourceIndex === index) reorderGroupTabs(index, moved, null, false);
    else moveTabBetweenGroups(sourceIndex, moved, index);
  };
}

function renderPane2Tabs() {
  if (state.groups[1]) renderGroupTabsInto(1, $("pane2Tabs"));
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

function setupPaneRefs() {
  paneRefs[0] = { tabs: $("tabs"), editor: $("editor"), hl: $("hlCode"), liveHost: $("liveHost"), live: $("live"), api: liveApi };
  paneRefs[1] = { wrapper: $("pane2"), tabs: $("pane2Tabs"), editor: $("editor2"), hl: $("hlCode2"), liveHost: $("live2Host"), live: $("live2"), api: live2Api };
  liveApis[0] = liveApi;
  liveApis[1] = live2Api;
  livePaths[0] = livePath;
  livePaths[1] = live2Path;
}

function getPane(index) {
  if (paneRefs[index]) return paneRefs[index];
  if (index < 2) return null;
  return createPane(index);
}

function createPane(index) {
  const n = index + 1;
  const wrapper = document.createElement("div");
  wrapper.className = "pane";
  wrapper.id = "pane" + n;
  const tabs = document.createElement("div");
  tabs.className = "tabs pane-tabs";
  tabs.id = "pane" + n + "Tabs";
  const editorHost = document.createElement("div");
  editorHost.className = "editor-host";
  editorHost.dataset.pane = String(n);
  const hlLayer = document.createElement("div");
  hlLayer.className = "hl-layer";
  hlLayer.setAttribute("aria-hidden", "true");
  const pre = document.createElement("pre");
  pre.id = "hlCode" + n;
  hlLayer.appendChild(pre);
  const textarea = document.createElement("textarea");
  textarea.id = "editor" + n;
  textarea.className = "pane-editor";
  textarea.spellcheck = false;
  textarea.placeholder = "Панель " + n + ": перетягни вкладку сюди";
  editorHost.append(hlLayer, textarea);
  const liveHost = document.createElement("div");
  liveHost.className = "live-host";
  liveHost.id = "live" + n + "Host";
  const live = document.createElement("div");
  live.id = "live" + n;
  live.className = "cm-host";
  liveHost.appendChild(live);
  wrapper.append(tabs, editorHost, liveHost);
  document.querySelector("main").insertBefore(wrapper, $("findBar"));
  const splitter = document.createElement("div");
  splitter.className = "pane-splitter";
  splitter.title = "Потягни, щоб змінити ширину";
  document.querySelector("main").insertBefore(splitter, wrapper);
  splitter.addEventListener("mousedown", (event) => {
    event.preventDefault();
    const main = document.querySelector("main");
    const startX = event.clientX;
    const startWidth = wrapper.getBoundingClientRect().width;
    const maxWidth = Math.max(200, main.getBoundingClientRect().width * 0.75);
    const move = (ev) => {
      const width = Math.max(160, Math.min(maxWidth, startWidth + (startX - ev.clientX)));
      wrapper.style.flex = "0 0 " + Math.round(width) + "px";
    };
    const up = () => {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
      scheduleWorkspaceSave();
    };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
  });

  textarea.addEventListener("input", () => handleExtraInput(index));
  textarea.addEventListener("scroll", () => syncHighlightPane(index));
  textarea.addEventListener("focus", () => { activePane = index + 1; });
  wrapper.addEventListener("dragover", (event) => {
    if (![...event.dataTransfer.types].includes("text/vault-tab")) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    wrapper.classList.add("drop-target");
  });
  wrapper.addEventListener("dragleave", (event) => {
    if (!wrapper.contains(event.relatedTarget)) wrapper.classList.remove("drop-target");
  });
  wrapper.addEventListener("drop", (event) => {
    wrapper.classList.remove("drop-target");
    const path = event.dataTransfer.getData("text/vault-tab");
    const sourceIndex = parseGroupSource(event.dataTransfer.getData("text/vault-tab-source"));
    if (!path || sourceIndex < 0) return;
    event.preventDefault();
    event.stopPropagation();
    if (sourceIndex !== index) moveTabBetweenGroups(sourceIndex, path, index);
  });
  const api = initLive({
    hostId: live.id,
    getText: () => {
      const file = groupIndexFile(index);
      return file ? file.text : "";
    },
    onChange: (text, prev) => handleExtraLiveChange(index, text, prev),
    onCursor: (line, ch) => {
      const node = $("stCursor");
      if (node) node.textContent = line + ":" + ch;
    },
    onOpenNote: openTargetNote,
    imageUrl: imageUrlFor,
    autoPairs: store.get("autoPairs", "1") !== "0",
    smartLists: store.get("smartLists", "1") !== "0",
    onLinkTrigger: (pos) => {
      activePane = index + 1;
      linkPane = index + 1;
      showSwitcher("link");
      linkPos = pos;
    },
    onFocus: () => { activePane = index + 1; },
  });
  const pane = { wrapper, splitter, tabs, editorHost, editor: textarea, hl: pre, liveHost, live, api };
  paneRefs[index] = pane;
  liveApis[index] = api;
  livePaths[index] = null;
  applySpellcheck();
  return pane;
}

function syncHighlightPane(index) {
  if (index === 0) { syncHighlight(); return; }
  if (index === 1) { syncHighlight2(); return; }
  const pane = getPane(index);
  if (!pane) return;
  pane.hl.innerHTML = highlightMarkdown(pane.editor.value) + "\n";
  pane.hl.style.transform = "translateY(" + -pane.editor.scrollTop + "px)";
}

function syncLiveCopies(exceptIndex, file) {
  for (let index = 0; index < state.groups.length; index++) {
    if (index === exceptIndex) continue;
    const api = index === 0 ? liveApi : index === 1 ? live2Api : liveApis[index];
    const path = index === 0 ? livePath : index === 1 ? live2Path : livePaths[index];
    if (api && path === file.path) api.setDoc(file.text);
    if (index === 0) $("editor").value = file.text;
    else {
      const pane = getPane(index);
      if (pane) pane.editor.value = file.text;
    }
  }
}

function paintExtra(index) {
  const group = state.groups[index];
  if (!group) return;
  const pane = getPane(index);
  if (!pane) return;
  const file = groupIndexFile(index);
  pane.editor.value = file ? file.text : "";
  pane.editor.readOnly = !file;
  syncHighlightPane(index);
  const api = liveApis[index];
  if (api) {
    const path = file ? file.path : null;
    if ((livePaths[index] || null) !== path) {
      api.reset(file ? file.text : "");
      livePaths[index] = path;
    } else {
      api.setDoc(file ? file.text : "");
    }
  }
  renderGroupTabsInto(index, pane.tabs);
}

function paintGroup(index) {
  if (index === 1) { paintSecond(); return; }
  if (index > 1) paintExtra(index);
}

function handleExtraInput(index) {
  const file = groupIndexFile(index);
  if (!file) return;
  const pane = getPane(index);
  file.text = pane.editor.value;
  file.dirty = true;
  state.index.set(file.path, file.text);
  setState("не збережено", "warn");
  syncHighlightPane(index);
  if (liveApis[index]) { livePaths[index] = file.path; liveApis[index].setDoc(file.text); }
  syncLiveCopies(index, file);
  if (activeGroupIndex() === index) renderTabs();
  else renderGroupTabsInto(index, pane.tabs);
  emit("modify", { path: file.path, text: file.text, prev: file.text });
  clearTimeout(pane._t);
  pane._t = setTimeout(() => saveNote(true, file), 1500);
}

function handleExtraLiveChange(index, text, prev) {
  const file = groupIndexFile(index);
  if (!file) return;
  const pane = getPane(index);
  file.text = text;
  if (pane) pane.editor.value = text;
  file.dirty = true;
  state.index.set(file.path, text);
  setState("не збережено", "warn");
  syncHighlightPane(index);
  syncLiveCopies(index, file);
  if (activeGroupIndex() === index) renderTabs();
  else if (pane) renderGroupTabsInto(index, pane.tabs);
  emit("modify", { path: file.path, text, prev });
  clearTimeout(pane ? pane._t : null);
  if (pane) pane._t = setTimeout(() => saveNote(true, file), 1500);
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
  document.body.classList.toggle("view-base", view === "base");
  document.body.classList.toggle("view-web", view === "web");
  document.body.classList.toggle("view-pdf", view === "pdf");
  document.body.classList.toggle("view-media", view === "media");
  emit("view", view);
}

async function openNote(path, pushHistory = true) {
  if (path.endsWith(".base")) { openBase(path); return; }
  if (path.endsWith(".canvas")) { openCanvas(path); return; }
  if (path.endsWith(".pdf")) { if (pdfApi) await pdfApi.open(path); return; }
  if (isMediaPath(path)) { if (mediaApi) await mediaApi.open(path); return; }
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
    syncSecond();
    if (!group.tabs.length) {
      closeGroup(groupIndex);
      return;
    }
  }
  if (!group1().tabs.length) state.active = group1().active;
  state.mobileGroup = Math.min(state.mobileGroup, state.groups.length);
  renderTabs(); renderTree(); paint(); updateSplitButtons();
  applyMobilePane();
  scheduleWorkspaceSave();
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
  const to = ensureGroupAt(toIndex);
  removeTab(from, path);
  addTab(to, path);
  if (fromIndex > 0 && !from.tabs.length) removeGroupAt(fromIndex);
  if (toIndex === 0) {
    state.active = path;
    pushHistoryState(path);
  } else {
    state.active = group1().active;
  }
  if (isMobileLayout()) state.mobileGroup = Math.max(1, Math.min(toIndex + 1, state.groups.length));
  syncSecond();
  renderTabs(); renderTree(); paint(); updateSplitButtons();
  applyMobilePane();
  scheduleWorkspaceSave();
}

function toggleStackedTabs(index = activeGroupIndex()) {
  const group = state.groups[index];
  if (!group) return false;
  group.stacked = !group.stacked;
  renderTabs();
  scheduleWorkspaceSave();
  toast(group.stacked ? "вкладки складені" : "вкладки розкладені");
  return group.stacked;
}

function renderTabs() {
  const titleIndex = activeGroupIndex();
  renderGroupTabsInto(titleIndex, $("tabs"));
  for (let index = 1; index < state.groups.length; index++) {
    const pane = getPane(index);
    if (pane) renderGroupTabsInto(index, pane.tabs);
  }
  scheduleWorkspaceSave();
}

function paint() {
  const file = currentFile();
  dbg("paint", "active=" + state.active, "fileLen=" + (file ? file.text.length : "none"), "editorBefore=" + $("editor").value.length);
  $("editor").value = file ? file.text : "";
  $("editor").readOnly = !file;
  $("stPath").textContent = state.view === "graph" ? "Graph view" :
    state.view === "canvas" ? ($("canvasName").textContent || "Canvas") :
    state.view === "web" ? (webView.url || "Web viewer") :
    state.view === "pdf" ? (pdfApi?.path || "PDF") :
    state.view === "media" ? (mediaApi?.path || "Файл") :
    (file ? file.path : "—");
  $("stBranch").textContent = state.repo.split("/")[1] + " · " + state.branch + " · " + BUILD;
  document.title = (file ? file.path.split("/").pop().replace(/\.md$/, "") + " · " : "") + "Vault";
  const mobTitle = $("mobSwitcher");
  if (mobTitle) mobTitle.textContent = file ? noteName(file.path) : "Vault";
  renderPreview();
  if (liveApi) {
    if (!file) { liveApi.setDoc(""); livePath = null; }
    else if (livePath !== file.path) { liveApi.reset(file.text); livePath = file.path; }
    else liveApi.setDoc(file.text);
  }
  renderRightTabs();
  renderRightPanels();
  scheduleBacklinkCount();
  syncHighlight();
  for (let index = 1; index < state.groups.length; index++) paintGroup(index);
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
    snapshotNote(file);
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
        snapshotNote(file);
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
  await createNoteNamed(raw);
}

async function createNoteNamed(raw) {
  let path = String(raw || "").trim().replace(/^\/+/, "");
  if (!path) return "";
  if (!path.includes("/")) {
    let folder = "";
    if (appCfg.newFileLocation === "current") {
      const file = currentFile();
      if (file && file.path.includes("/")) folder = file.path.slice(0, file.path.lastIndexOf("/"));
    } else if (appCfg.newFileLocation === "folder") {
      folder = String(appCfg.newFileFolderPath || "").replace(/^\/+|\/+$/g, "");
    }
    if (folder) path = folder + "/" + path;
  }
  if (!path.endsWith(".md")) path += ".md";
  try {
    await ghPut(path, "# " + path.split("/").pop().replace(/\.md$/, "") + "\n\n", null, "add " + path);
    state.pending.add(path);
    await loadTree();
    await openNote(path);
    emit("create", path);
    toast("створено " + path);
    return path;
  } catch (error) { toast("Не вийшло: " + error.message); return ""; }
}

/* ---------------- note composer ---------------- */
function activeSelectionRange() {
  if (state.mode === "live" && liveApi) return liveApi.selection();
  const ed = $("editor");
  const from = ed.selectionStart || 0;
  const to = ed.selectionEnd || 0;
  return { from, to, text: ed.value.slice(from, to) };
}

function replaceActiveSelection(text) {
  if (state.mode === "live" && liveApi) { liveApi.replaceSelection(text); return; }
  const ed = $("editor");
  const from = ed.selectionStart || 0;
  const to = ed.selectionEnd || 0;
  ed.value = ed.value.slice(0, from) + text + ed.value.slice(to);
  ed.selectionStart = ed.selectionEnd = from + text.length;
  ed.dispatchEvent(new Event("input", { bubbles: true }));
}

async function extractSelection() {
  const file = currentFile();
  if (!file) { toast("Спочатку відкрий нотатку"); return; }
  const selection = activeSelectionRange();
  if (!selection.text.trim()) { toast("Виділи текст для витягу"); return; }
  const raw = prompt("Назва нової нотатки:", "Витяг");
  if (!raw) return;
  let target = raw.trim().replace(/^\/+/, "");
  if (!target) return;
  if (!target.endsWith(".md")) target += ".md";
  try {
    const content = selection.text.replace(/^\n+|\n+$/g, "") + "\n";
    await ghPut(target, content, null, "extract " + target);
    state.pending.add(target);
    state.index.set(target, content);
    replaceActiveSelection("[[" + target.replace(/\.md$/, "") + "]]");
    await loadTree();
    renderTabs(); paint();
    emit("create", target);
    toast("витягнуто у " + target);
  } catch (error) { toast("Не вийшло: " + error.message); }
}

async function mergeIntoNote(targetPath) {
  const file = currentFile();
  if (!file) { toast("Спочатку відкрий нотатку"); return; }
  if (!targetPath || targetPath === file.path) { toast("Обери іншу нотатку"); return; }
  if (!confirm("Обʼєднати «" + noteName(file.path) + "» у «" + noteName(targetPath) + "»? Поточну нотатку буде видалено.")) return;
  try {
    setState("обʼєдную…");
    const target = await ghGet(targetPath);
    const merged = String(target.text || "").replace(/\s+$/, "") + "\n\n" + file.text.replace(/\s+$/, "") + "\n";
    await ghPut(targetPath, merged, target.sha, "merge " + file.path + " into " + targetPath);
    const source = await ghGet(file.path);
    await ghDelete(file.path, source.sha);
    state.pending.delete(file.path);
    state.index.delete(file.path);
    state.open = state.open.filter((item) => item.path !== file.path);
    for (const group of state.groups) {
      group.tabs = group.tabs.filter((path) => path !== file.path);
      if (group.active === file.path) group.active = group.tabs[0] || null;
    }
    for (let index = state.groups.length - 1; index > 0; index--) {
      if (!state.groups[index].tabs.length) state.groups.splice(index, 1);
    }
    destroyExtraPanes();
    for (let index = 2; index < state.groups.length; index++) getPane(index);
    if (state.groups.length === 1) {
      document.body.classList.remove("split");
      $("pane2").style.flex = "";
    }
    state.active = group1().active;
    syncSecond();
    await loadTree();
    await openNote(targetPath);
    renderTabs(); renderTree(); paint(); updateSplitButtons(); applyMobilePane();
    emit("delete", file.path);
    emit("modify", { path: targetPath, text: merged, prev: target.text });
    toast("обʼєднано у " + targetPath);
  } catch (error) { toast("Не вийшло: " + error.message); }
}

/* ---------------- file recovery ---------------- */
function readRecovery() {
  try {
    const data = JSON.parse(store.get("recovery", "{}"));
    return data && typeof data === "object" && !Array.isArray(data) ? data : {};
  } catch { return {}; }
}

function snapshotNote(file) {
  if (!file || !file.path) return;
  const map = readRecovery();
  const list = Array.isArray(map[file.path]) ? map[file.path] : [];
  const last = list[list.length - 1];
  if (last && last.text === file.text) return;
  list.push({ t: Date.now(), text: file.text });
  while (list.length > 20) list.shift();
  map[file.path] = list;
  let total = 0;
  for (const key of Object.keys(map)) {
    total += map[key].reduce((sum, item) => sum + (item.text ? item.text.length : 0), 0);
  }
  if (total > 1800000) {
    for (const key of Object.keys(map)) map[key] = map[key].slice(-5);
  }
  store.set("recovery", JSON.stringify(map));
}

function openRecovery() {
  const file = currentFile();
  if (!file) { toast("Спочатку відкрий нотатку"); return; }
  const host = $("recoveryList");
  const title = $("recoveryTitle");
  if (title) title.textContent = "File recovery · " + file.path;
  host.innerHTML = "";
  const map = readRecovery();
  const list = Array.isArray(map[file.path]) ? map[file.path].slice().reverse() : [];
  if (!list.length) {
    host.appendChild(el("div", "empty", "Ще немає збережених версій цієї нотатки."));
  }
  for (const item of list) {
    const row = el("div", "recovery-row");
    const time = new Date(item.t).toLocaleString();
    const meta = el("div", "recovery-meta");
    meta.append(el("span", "recovery-time", time), el("span", "recovery-len", (item.text || "").length + " симв."));
    const preview = el("div", "recovery-preview", (item.text || "").replace(/\s+/g, " ").slice(0, 180));
    const actions = el("div", "recovery-actions");
    const restore = el("button", "ghost-border", "Відновити");
    restore.onclick = () => {
      if (!confirm("Відновити версію від " + time + "?")) return;
      file.text = item.text || "";
      file.dirty = true;
      state.index.set(file.path, file.text);
      $("editor").value = file.text;
      if (liveApi && livePath === file.path) liveApi.setDoc(file.text);
      syncLiveCopies(0, file);
      syncHighlight();
      renderPreview(); renderTabs(); paint();
      setState("не збережено", "warn");
      closeModals();
      toast("версію відновлено — збережи нотатку");
    };
    const copy = el("button", "ghost-border", "Копіювати");
    copy.onclick = () => copyText(item.text || "");
    actions.append(restore, copy);
    row.append(meta, preview, actions);
    host.appendChild(row);
  }
  openModal("recoveryModal");
}

async function renameNote(path) {
  const next = prompt("Нове імʼя:", path);
  if (!next || next === path) return;
  let target = next.trim().replace(/^\/+/, "");
  if (!/\.(md|canvas|base)$/.test(target)) target += path.endsWith(".canvas") ? ".canvas" : path.endsWith(".base") ? ".base" : ".md";
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
    renameBookmarkPath(path, target);
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

async function loadAppConfig() {
  try {
    const raw = JSON.parse((await ghGet(".obsidian/app.json")).text);
    if (raw && typeof raw === "object") {
      appCfg = {
        newFileLocation: raw.newFileLocation || "root",
        newFileFolderPath: raw.newFileFolderPath || "",
        attachmentFolderPath: raw.attachmentFolderPath || "",
        useTab: raw.useTab === true,
        tabSize: Number(raw.tabSize) > 0 ? Number(raw.tabSize) : 4,
        strictLineBreaks: raw.strictLineBreaks === true,
        propertiesInDocument: ["visible", "hidden", "source"].includes(raw.propertiesInDocument) ? raw.propertiesInDocument : "visible",
      };
    }
  } catch { /* defaults */ }
}

async function loadPropertyTypes() {
  try {
    const raw = JSON.parse((await ghGet(".obsidian/types.json")).text);
    propertyTypes = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
  } catch { propertyTypes = {}; }
}

function attachmentFolder() {
  const setting = String(appCfg.attachmentFolderPath || "").replace(/\\/g, "/");
  if (setting === "./") {
    const file = currentFile();
    return file && file.path.includes("/") ? file.path.slice(0, file.path.lastIndexOf("/")) : "";
  }
  return setting.replace(/^\/+|\/+$/g, "");
}

async function uploadImage(file) {
  const folder = attachmentFolder();
  const name = (folder ? folder + "/" : "") + Date.now() + "-" + file.name.replace(/[^\w.\-]+/g, "_");
  const buffer = new Uint8Array(await file.arrayBuffer());
  setState("завантажую картинку…");
  await ghPutRaw(name, b64encode(buffer), null, "upload " + name);
  state.pending.add(name);
  insertAtCursor("\n![[" + name + "]]\n");
  await loadTree();
  setState("картинку вставлено", "ok");
  toast("+" + name);
  return name;
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
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/);
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

function noteAliases(text) {
  const parsed = parseProps(text || "");
  if (!parsed) return [];
  const aliases = [];
  for (const [key, value] of parsed.props) {
    if (!/^aliases?$/i.test(key)) continue;
    for (const part of String(value || "").split(",")) {
      const alias = part.trim().replace(/^\[|\]$/g, "").replace(/^["']|["']$/g, "");
      if (alias) aliases.push(alias);
    }
  }
  return aliases;
}

function aliasTarget(alias) {
  const key = String(alias || "").trim().toLowerCase();
  if (!key) return "";
  for (const path of state.files) {
    if (!path.endsWith(".md")) continue;
    const text = state.index.get(path);
    if (text == null) continue;
    if (noteAliases(text).some((item) => item.toLowerCase() === key)) return path;
  }
  return "";
}

function frontmatterBlock(text) {
  const match = String(text).match(/^---\r?\n([\s\S]*?)\r?\n---[ \t]*(\r?\n|$)/);
  if (!match) return null;
  return {
    eol: match[0].includes("\r\n") ? "\r\n" : "\n",
    lines: match[1].split(/\r?\n/),
    body: text.slice(match[0].length),
    raw: match[0],
  };
}

function propertyIsList(raw, key) {
  const block = frontmatterBlock(raw);
  if (!block) return false;
  for (let i = 0; i < block.lines.length; i++) {
    const match = block.lines[i].match(/^([A-Za-z0-9_\u0400-\u04FF-]+):/);
    if (!match || match[1] !== key) continue;
    return /^\s+-\s/.test(block.lines[i + 1] || "");
  }
  return false;
}

function inferPropertyType(key, value) {
  const override = propertyTypes[String(key || "")];
  if (override && ["text", "number", "checkbox", "date", "datetime"].includes(override)) return override;
  const text = String(value == null ? "" : value).trim();
  if (/^(true|false)$/i.test(text)) return "checkbox";
  if (/^-?\d+(?:\.\d+)?$/.test(text)) return "number";
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return "date";
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(text)) return "datetime";
  return "text";
}

function yamlScalar(value) {
  const text = String(value);
  if (!text) return "";
  if (/[:#\[\]{},&*!|>'"%@`]/.test(text) || /^\s|\s$/.test(text) || /^[-?]/.test(text)) {
    return JSON.stringify(text);
  }
  return text;
}

function applyFrontmatterEdit(file, nextText, prevText) {
  file.text = nextText;
  file.dirty = true;
  state.index.set(file.path, nextText);
  $("editor").value = nextText;
  if (liveApi && livePath === file.path) liveApi.setDoc(nextText);
  syncLiveCopies(0, file);
  renderPreview();
  setState("не збережено", "warn");
  clearTimeout($("editor")._t);
  $("editor")._t = setTimeout(() => saveNote(true, file), 1500);
  emit("modify", { path: file.path, text: nextText, prev: prevText });
}

async function setPropertyType(key, type) {
  if (type) propertyTypes[key] = type; else delete propertyTypes[key];
  renderPreview();
  try {
    let raw = {};
    try {
      const got = await ghGet(".obsidian/types.json");
      raw = JSON.parse(got.text) || {};
    } catch { raw = {}; }
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) raw = {};
    if (type) raw[key] = type; else delete raw[key];
    await writeVaultJson(".obsidian/types.json", raw);
    toast("тип " + key + ": " + type);
  } catch (error) { toast("Тип: " + error.message); }
}

function setFrontmatterProperty(file, key, value, nextKey) {
  const text = file.text;
  const block = frontmatterBlock(text);
  const eol = block ? block.eol : (text.includes("\r\n") ? "\r\n" : "\n");
  const lines = block ? block.lines.slice() : [];
  const target = String(nextKey || key).trim();
  if (!target) return false;
  const isList = Array.isArray(value);
  const items = isList ? value.map((item) => String(item).trim()).filter(Boolean) : [];
  let start = -1;
  for (let i = 0; i < lines.length; i++) {
    const match = lines[i].match(/^([A-Za-z0-9_\u0400-\u04FF-]+):/);
    if (match && match[1] === key) { start = i; break; }
  }
  const replacement = isList
    ? [target + ":"].concat(items.map((item) => "  - " + yamlScalar(item)))
    : [target + ": " + yamlScalar(value)];
  if (start >= 0) {
    let end = start + 1;
    while (end < lines.length && /^\s+-\s/.test(lines[end])) end++;
    lines.splice(start, end - start, ...replacement);
  } else {
    lines.push(...replacement);
  }
  const raw = "---" + eol + lines.join(eol) + eol + "---" + eol;
  applyFrontmatterEdit(file, raw + (block ? block.body : text), text);
  return true;
}

function removeFrontmatterProperty(file, key) {
  const block = frontmatterBlock(file.text);
  if (!block) return false;
  const lines = block.lines.slice();
  const start = lines.findIndex((line) => {
    const match = line.match(/^([A-Za-z0-9_\u0400-\u04FF-]+):/);
    return match && match[1] === key;
  });
  if (start < 0) return false;
  let end = start + 1;
  while (end < lines.length && /^\s+-\s/.test(lines[end])) end++;
  lines.splice(start, end - start);
  const raw = "---" + block.eol + lines.join(block.eol) + block.eol + "---" + block.eol;
  applyFrontmatterEdit(file, raw + block.body, file.text);
  return true;
}

const READING_TRIANGLE_SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="svg-icon right-triangle"><path d="M3 8L12 17L21 8"></path></svg>';

function highlightYaml(raw) {
  const body = String(raw).replace(/^---\r?\n/, "").replace(/\r?\n---[ \t]*\r?\n?$/, "");
  return body.split(/\r?\n/).map((line) => {
    const kv = line.match(/^([A-Za-z0-9_\u0400-\u04FF-]+):(.*)$/);
    if (kv) {
      const rest = kv[2];
      const commentAt = rest.search(/\s#/);
      const value = commentAt >= 0 ? rest.slice(0, commentAt) : rest;
      const comment = commentAt >= 0 ? rest.slice(commentAt + 1).trimStart() : "";
      return '<span class="token key atrule">' + escapeHtml(kv[1]) + '</span><span class="token punctuation">:</span>' + escapeHtml(value) +
        (comment ? ' <span class="token comment">' + escapeHtml(comment) + "</span>" : "");
    }
    const item = line.match(/^(\s*)-(\s*)(.*)$/);
    if (item) return escapeHtml(item[1]) + '<span class="token punctuation">-</span>' + escapeHtml(item[2] + item[3]);
    if (/^\s*#/.test(line)) return '<span class="token comment">' + escapeHtml(line) + "</span>";
    return escapeHtml(line);
  }).join("\n");
}

function buildReadingHeader(file, parsed) {
  const header = el("div", "mod-header mod-ui");
  const title = el("div", "inline-title", file.path.split("/").pop().replace(/\.md$/, ""));
  title.contentEditable = "false";
  title.spellcheck = true;
  title.tabIndex = -1;
  header.appendChild(title);
  if (appCfg.propertiesInDocument === "hidden") return header;
  if (!parsed) return header;
  if (appCfg.propertiesInDocument === "source") {
    const wrap = el("div", "el-pre mod-frontmatter mod-ui");
    const pre = el("pre", "frontmatter language-yaml");
    const code = document.createElement("code");
    code.className = "language-yaml is-loaded";
    code.innerHTML = highlightYaml(parsed.raw);
    pre.appendChild(code);
    wrap.appendChild(pre);
    header.appendChild(wrap);
    return header;
  }
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
    icon.setAttribute("aria-disabled", "false");
    const isList = key === "tags" || key === "aliases" || propertyIsList(parsed.raw, key);
    const propertyType = isList ? "tags" : inferPropertyType(key, value);
    if (isList) {
      icon.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="svg-icon lucide-tags"><path d="M13.172 2a2 2 0 0 1 1.414.586l6.71 6.71a2.4 2.4 0 0 1 0 3.408l-4.592 4.592a2.4 2.4 0 0 1-3.408 0l-6.71-6.71A2 2 0 0 1 5 9.172V4a2 2 0 0 1 2-2z"></path><path d="M7 7h.01"></path></svg>';
    } else if (propertyType === "checkbox") {
      icon.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="svg-icon lucide-check-square"><path d="m9 11 3 3L22 4"></path><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"></path></svg>';
    } else if (propertyType === "number") {
      icon.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="svg-icon lucide-hash"><line x1="4" x2="20" y1="9" y2="9"></line><line x1="4" x2="20" y1="15" y2="15"></line><line x1="10" x2="8" y1="3" y2="21"></line><line x1="16" x2="14" y1="3" y2="21"></line></svg>';
    } else if (propertyType === "date" || propertyType === "datetime") {
      icon.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="svg-icon lucide-calendar"><path d="M8 2v4"></path><path d="M16 2v4"></path><rect x="3" y="4" width="18" height="18" rx="2"></rect><path d="M3 10h18"></path></svg>';
    } else {
      icon.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="svg-icon lucide-text"><path d="M21 5H3"></path><path d="M15 12H3"></path><path d="M17 19H3"></path></svg>';
    }
    const input = document.createElement("input");
    input.className = "metadata-property-key-input";
    input.value = key;
    input.readOnly = false;
    input.spellcheck = false;
    input.setAttribute("aria-label", key);
    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter") { event.preventDefault(); input.blur(); }
      if (event.key === "Escape") { input.value = key; input.blur(); }
    });
    input.addEventListener("change", () => {
      const nextKey = input.value.trim();
      if (!nextKey || nextKey === key) { input.value = key; return; }
      const current = isList ? String(value).split(",").map((part) => part.trim()).filter(Boolean) : value;
      setFrontmatterProperty(file, key, current, nextKey);
    });
    keyEl.append(icon, input);
    const valueEl = el("div", "metadata-property-value");
    valueEl.dataset.propertyType = propertyType;
    if (isList) {
      const multi = el("div", "multi-select-container");
      const items = String(value).split(",").map((part) => part.trim()).filter(Boolean);
      for (const item of items) {
        const pill = el("div", "multi-select-pill");
        const pillContent = el("div", "multi-select-pill-content");
        pillContent.appendChild(el("span", null, item));
        pillContent.spellcheck = false;
        pillContent.ondblclick = (event) => {
          event.stopPropagation();
          const next = prompt("Значення " + key, item);
          if (next == null || !next.trim()) return;
          setFrontmatterProperty(file, key, items.map((part) => part === item ? next.trim() : part));
        };
        const remove = el("div", "multi-select-pill-remove-button");
        remove.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="svg-icon lucide-x"><path d="M18 6 6 18"></path><path d="m6 6 12 12"></path></svg>';
        remove.title = "Прибрати";
        remove.onclick = (event) => {
          event.stopPropagation();
          setFrontmatterProperty(file, key, items.filter((part) => part !== item));
        };
        pill.append(pillContent, remove);
        multi.appendChild(pill);
      }
      multi.ondblclick = (event) => {
        event.stopPropagation();
        const next = prompt("Додати до " + key, "");
        if (next == null || !next.trim()) return;
        setFrontmatterProperty(file, key, [...items, next.trim()]);
      };
      valueEl.appendChild(multi);
    } else if (propertyType === "checkbox") {
      const box = document.createElement("input");
      box.type = "checkbox";
      box.className = "metadata-input-checkbox";
      box.checked = /^true$/i.test(String(value).trim());
      box.setAttribute("aria-label", key);
      box.onchange = () => setFrontmatterProperty(file, key, box.checked ? "true" : "false");
      valueEl.appendChild(box);
    } else if (propertyType === "number") {
      const number = document.createElement("input");
      number.type = "number";
      number.step = "any";
      number.className = "metadata-input-number";
      number.value = String(value);
      number.setAttribute("aria-label", key);
      number.addEventListener("change", () => setFrontmatterProperty(file, key, number.value.trim()));
      valueEl.appendChild(number);
    } else if (propertyType === "date") {
      const date = document.createElement("input");
      date.type = "date";
      date.className = "metadata-input-date";
      date.value = /^\d{4}-\d{2}-\d{2}$/.test(String(value)) ? String(value) : "";
      date.setAttribute("aria-label", key);
      date.addEventListener("change", () => { if (date.value) setFrontmatterProperty(file, key, date.value); });
      valueEl.appendChild(date);
    } else if (propertyType === "datetime") {
      const stamp = document.createElement("input");
      stamp.type = "datetime-local";
      stamp.className = "metadata-input-datetime";
      stamp.value = String(value).slice(0, 16);
      stamp.setAttribute("aria-label", key);
      stamp.addEventListener("change", () => { if (stamp.value) setFrontmatterProperty(file, key, stamp.value); });
      valueEl.appendChild(stamp);
    } else {
      const text = el("div", "metadata-input-longtext", value);
      text.contentEditable = "true";
      text.spellcheck = true;
      text.tabIndex = 0;
      text.setAttribute("placeholder", "Empty");
      text.addEventListener("blur", () => {
        const next = text.textContent.replace(/\s+$/, "");
        if (next === String(value).trim()) return;
        setFrontmatterProperty(file, key, next);
      });
      text.addEventListener("keydown", (event) => {
        if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); text.blur(); }
        if (event.key === "Escape") { text.textContent = value; text.blur(); }
      });
      valueEl.appendChild(text);
    }
    const warning = el("div", "clickable-icon metadata-property-warning-icon");
    warning.style.display = "none";
    warning.setAttribute("aria-label", "Type mismatch");
    warning.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="svg-icon lucide-alert-triangle"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"></path><path d="M12 9v4"></path><path d="M12 17h.01"></path></svg>';
    prop.append(keyEl, valueEl, warning);
    prop.oncontextmenu = (event) => {
      event.preventDefault();
      event.stopPropagation();
      showCtx(event.clientX, event.clientY, [
        { label: "Текст", run: () => setPropertyType(key, "text") },
        { label: "Число", run: () => setPropertyType(key, "number") },
        { label: "Чекбокс", run: () => setPropertyType(key, "checkbox") },
        { label: "Дата", run: () => setPropertyType(key, "date") },
        { label: "Дата й час", run: () => setPropertyType(key, "datetime") },
        { sep: true },
        { label: "Видалити властивість", danger: true, run: () => removeFrontmatterProperty(file, key) },
      ]);
    };
    properties.appendChild(prop);
  }
  const addProperty = el("div", "metadata-add-button");
  addProperty.tabIndex = 0;
  addProperty.append(el("span", "metadata-add-button-icon", "＋"), el("span", null, "Додати властивість"));
  addProperty.onclick = () => {
    const key = prompt("Назва властивості:", "");
    if (!key || !key.trim()) return;
    const value = prompt("Значення для " + key.trim() + ":", "");
    if (value == null) return;
    setFrontmatterProperty(file, key.trim(), value.trim());
  };
  properties.appendChild(addProperty);
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
  host.querySelectorAll("h1, h2, h3, h4, h5, h6").forEach((heading) => {
    heading.setAttribute("dir", "auto");
    heading.setAttribute("data-heading", heading.textContent.trim());
    if (!heading.querySelector(".heading-collapse-indicator")) {
      const indicator = document.createElement("span");
      indicator.className = "heading-collapse-indicator collapse-indicator collapse-icon";
      indicator.innerHTML = READING_TRIANGLE_SVG;
      indicator.title = "Згорнути / розгорнути";
      indicator.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        toggleHeadingFold(heading);
      });
      heading.prepend(indicator);
    }
  });
  stripBlockIds(host);
  wireRendered(host, file.text, 0);
  resolveEmbeds(host);
  renderMathIn(host);
  renderMermaidIn(host);
}

function toggleHeadingFold(heading) {
  const level = Number(heading.tagName[1]);
  const parent = heading.parentElement;
  const wrapper = parent && /(^|\s)el-h[1-6](\s|$)/.test(parent.className) ? parent : heading;
  const collapsed = heading.classList.toggle("is-collapsed");
  const indicator = heading.querySelector(".heading-collapse-indicator");
  if (indicator) indicator.classList.toggle("is-collapsed", collapsed);
  let node = wrapper.nextElementSibling;
  while (node) {
    const match = [...node.classList].find((cls) => /^el-h[1-6]$/.test(cls));
    if (match && Number(match.slice(4)) <= level) break;
    node.style.display = collapsed ? "none" : "";
    node = node.nextElementSibling;
  }
}

function transformInlineBlocks(text) {
  let out = text.replace(/!\[\[([^\]]+)\]\]/g, (m, inner) => {
    const parts = inner.split("|").map((part) => part.trim());
    const name = parts[0];
    const size = parts[1] && /^\d+$/.test(parts[1]) ? parts[1] : "";
    const target = name.split("#")[0];
    const attr = ' data-vault-src="' + escapeAttr(target) + '"';
    if (/\.(svg|png|jpe?g|gif|webp|bmp|avif)$/i.test(name)) {
      return '<img class="vault-media"' + attr + ' alt="' + escapeAttr(name) + '"' + (size ? ' width="' + size + '"' : "") + ">";
    }
    if (/\.pdf$/i.test(name)) {
      return '<iframe class="pdf-embed vault-media"' + attr + (size ? ' width="' + size + '"' : "") + ' title="' + escapeAttr(name) + '"></iframe>';
    }
    if (/\.(mp3|wav|ogg|m4a|flac|aac|opus)$/i.test(name)) {
      return '<audio class="media-embed vault-media" controls preload="none"' + attr + (size ? ' style="width:' + size + 'px"' : "") + "></audio>";
    }
    if (/\.(mp4|webm|ogv|mov|mkv|m4v)$/i.test(name)) {
      return '<video class="media-embed vault-media" controls preload="none"' + attr + (size ? ' style="width:' + size + 'px"' : "") + "></video>";
    }
    return '<div class="embed-note" data-note="' + encodeURIComponent(name) + '">…</div>';
  });
  out = out.replace(/\[\[([^\]|]+)(\|[^\]]+)?\]\]/g, (m, t, l) => {
    const target = t.trim();
    const label = (l ? l.slice(1) : t).trim();
    const safe = target.replace(/"/g, "&quot;");
    return '<a class="internal-link" data-target="' + safe + '" data-href="' + safe + '" href="' + encodeURI(target) + '" aria-label="' + safe + '" data-tooltip-position="top" target="_blank" rel="noopener nofollow">' + escapeHtml(label) + "</a>";
  });
  out = out.replace(/(^|\s)#([A-Za-z0-9_\u0400-\u04FF][A-Za-z0-9_\u0400-\u04FF/-]{1,})/g, (m, pre, tag) =>
    pre + '<a class="tag" data-tag="' + escapeHtml(tag) + '" href="#' + escapeHtml(tag) + '" target="_blank" rel="noopener nofollow">#' + escapeHtml(tag) + "</a>");
  out = out.replace(/==([^=\n]+)==/g, '<mark data-highlight="">$1</mark>');
  out = out.replace(/^>\s*\[!(\w+)\]([+-]?)\s*(.*)$/gm, (m, kind, fold, title) =>
    "> <span class=\"callout-kind\" data-kind=\"" + kind.toLowerCase() + "\" data-fold=\"" + fold + "\">" + escapeHtml(title) + "</span>");
  return out;
}

function extractFootnotes(body) {
  const defs = new Map();
  const lines = String(body).split("\n");
  const kept = [];
  for (let i = 0; i < lines.length; i++) {
    const match = lines[i].match(/^\[\^([^\]\s]+)\]:[ \t]*(.*)$/);
    if (!match) { kept.push(lines[i]); continue; }
    let text = match[2];
    while (i + 1 < lines.length && /^(?: {2,}|\t)/.test(lines[i + 1])) {
      text += "\n" + lines[i + 1].replace(/^(?: {2,}|\t)/, "");
      i++;
    }
    defs.set(match[1], text);
  }
  return { body: kept.join("\n"), defs };
}

function markdownToHtml(body) {
  const fences = [];
  let src = body.replace(/(^|\n)(```|~~~)[\s\S]*?(?:\n\2\s*(?=\n|$)|$)/g, (m, pre) => {
    fences.push(m.slice(pre.length));
    return pre + "\u0000F" + (fences.length - 1) + "\u0000";
  });

  src = src.replace(/%%[\s\S]*?%%/g, "");
  const maths = [];
  src = src.replace(/\$\$([\s\S]+?)\$\$/g, (m, tex) => {
    maths.push({ tex: tex.trim(), display: true });
    return "\u0000D" + (maths.length - 1) + "\u0000";
  });
  src = src.replace(/(^|[^\\$])\$([^$\n]+?)\$(?!\d)/g, (m, pre, tex) => {
    maths.push({ tex: tex.trim(), display: false });
    return pre + "\u0000M" + (maths.length - 1) + "\u0000";
  });

  const footnote = extractFootnotes(src);
  src = footnote.body;
  const footnoteOrder = [];
  const footnoteCounts = new Map();
  const footnoteAnchors = new Map();
  src = src.replace(/\[\^([^\]\s]+)\]/g, (m, id) => {
    if (!footnote.defs.has(id)) return m;
    if (!footnoteOrder.includes(id)) footnoteOrder.push(id);
    const count = (footnoteCounts.get(id) || 0) + 1;
    footnoteCounts.set(id, count);
    const anchor = count === 1 ? "fnref-" + id : "fnref-" + id + "-" + count;
    if (!footnoteAnchors.has(id)) footnoteAnchors.set(id, []);
    footnoteAnchors.get(id).push(anchor);
    return "\u0000R" + footnoteOrder.indexOf(id) + ":" + count + "\u0000";
  });

  src = transformInlineBlocks(src);
  src = src.replace(/\u0000F(\d+)\u0000/g, (m, i) => fences[Number(i)]);

  let html;
  if (!window.marked) {
    html = '<div style="background:#5a2323;color:#fff;padding:8px 12px;border-radius:8px;margin-bottom:12px">' +
      'Markdown-рушій не завантажився. Онови сторінку з Ctrl+Shift+R.</div>' +
      "<pre>" + escapeHtml(src) + "</pre>";
  } else {
    html = marked.parse(src, { breaks: appCfg.strictLineBreaks !== true, mangle: false, headerIds: false });
  }
  html = html.replace(/\u0000R(\d+):(\d+)\u0000/g, (m, index, count) => {
    const id = footnoteOrder[Number(index)];
    if (id === undefined) return "";
    const number = Number(index) + 1;
    const anchor = Number(count) === 1 ? "fnref-" + id : "fnref-" + id + "-" + count;
    return '<sup class="footnote-ref"><a href="#fn-' + escapeAttr(id) + '" id="' + escapeAttr(anchor) + '" data-footnote-ref="' + escapeAttr(id) + '">' + number + "</a></sup>";
  });
  if (footnoteOrder.length && window.marked) {
    const items = footnoteOrder.map((id) => {
      const raw = footnote.defs.get(id) || "";
      const item = window.marked.parseInline(transformInlineBlocks(raw), { mangle: false, headerIds: false });
      const anchors = footnoteAnchors.get(id) || [];
      const backrefs = anchors.map((anchor, index) =>
        '<a href="#' + escapeAttr(anchor) + '" class="footnote-backref" data-footnote-backref="' + escapeAttr(anchor) + '">↩' + (index ? "<sup>" + (index + 1) + "</sup>" : "") + "</a>"
      ).join(" ");
      return '<li id="fn-' + escapeAttr(id) + '" data-footnote="' + escapeAttr(id) + '">' + item + " " + backrefs + "</li>";
    }).join("");
    html += '<section class="footnotes" data-footnotes="1"><hr><ol>' + items + "</ol></section>";
  }
  html = html.replace(/\u0000D(\d+)\u0000/g, (m, index) => {
    const tex = maths[Number(index)] ? maths[Number(index)].tex : "";
    return '<span class="math math-display" data-tex="' + escapeAttr(tex) + '"></span>';
  });
  html = html.replace(/\u0000M(\d+)\u0000/g, (m, index) => {
    const tex = maths[Number(index)] ? maths[Number(index)].tex : "";
    return '<span class="math math-inline" data-tex="' + escapeAttr(tex) + '"></span>';
  });
  html = html.replace(/<img([^>]*)>/g, (m, attrs) => {
    const alt = attrs.match(/alt="([^"]*)\|(\d+)"/);
    if (!alt) return m;
    return "<img" + attrs.replace(alt[0], 'alt="' + alt[1] + '" width="' + alt[2] + '"') + ">";
  });
  return html;
}

let turndownPromise = null;
function ensureTurndown() {
  if (window.TurndownService) return Promise.resolve(window.TurndownService);
  if (turndownPromise) return turndownPromise;
  turndownPromise = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "https://cdn.jsdelivr.net/npm/turndown@7.2.0/dist/turndown.js";
    script.async = true;
    script.onload = () => window.TurndownService ? resolve(window.TurndownService) : reject(new Error("Turndown missing"));
    script.onerror = () => reject(new Error("Turndown load failed"));
    document.head.appendChild(script);
  });
  return turndownPromise;
}

async function htmlToMarkdown(html) {
  const Service = await ensureTurndown();
  const service = new Service({ headingStyle: "atx", codeBlockStyle: "fenced", bulletListMarker: "-" });
  return service.turndown(String(html || ""))
    .replace(/^(\s*[-*+])\s{2,}/gm, "$1 ")
    .replace(/^(\s*\d+[.)])\s{2,}/gm, "$1 ")
    .trim();
}

function markdownToHtmlSource(md) {
  return window.marked ? window.marked.parse(md, { breaks: appCfg.strictLineBreaks !== true, mangle: false, headerIds: false }) : escapeHtml(md);
}

function replaceNoteSource(text) {
  const file = currentFile();
  if (!file) return false;
  const prev = file.text;
  file.text = text;
  file.dirty = true;
  state.index.set(file.path, text);
  $("editor").value = text;
  if (liveApi && livePath === file.path) liveApi.setDoc(text);
  syncLiveCopies(0, file);
  renderPreview();
  setState("не збережено", "warn");
  clearTimeout($("editor")._t);
  $("editor")._t = setTimeout(() => saveNote(true, file), 1500);
  emit("modify", { path: file.path, text, prev });
  return true;
}

async function convertHtmlToMarkdown() {
  const file = currentFile();
  if (!file) { toast("Спочатку відкрий нотатку"); return; }
  const selection = activeSelectionRange();
  const source = selection.text.trim() ? selection.text : file.text;
  if (!/<[a-z][\s\S]*>/i.test(source)) { toast("Немає HTML для конвертації"); return; }
  try {
    const md = await htmlToMarkdown(source);
    if (selection.text.trim()) replaceActiveSelection(md);
    else replaceNoteSource(md);
    toast("HTML → Markdown");
  } catch (error) { toast("Конвертація: " + error.message); }
}

function convertMarkdownToHtml() {
  const file = currentFile();
  if (!file) { toast("Спочатку відкрий нотатку"); return; }
  const selection = activeSelectionRange();
  const source = selection.text.trim() ? selection.text : file.text;
  const html = markdownToHtmlSource(source);
  if (selection.text.trim()) replaceActiveSelection(html);
  else replaceNoteSource(html);
  toast("Markdown → HTML");
}

async function importFiles(files) {
  const list = [...(files || [])].filter((file) => file && file.name);
  if (!list.length) return [];
  const imported = [];
  for (const file of list) {
    try {
      let text = await file.text();
      let name = file.name.replace(/\.[^.]+$/, "");
      if (/\.html?$/i.test(file.name)) text = await htmlToMarkdown(text);
      name = name.replace(/[\\/:*?"<>|]+/g, "_").trim() || "Imported";
      let path = "Imports/" + name + ".md";
      let suffix = 1;
      while (state.files.includes(path) || state.pending.has(path)) {
        suffix += 1;
        path = "Imports/" + name + " " + suffix + ".md";
      }
      await ghPut(path, text, null, "import " + path);
      state.pending.add(path);
      imported.push(path);
    } catch (error) {
      toast("Імпорт " + file.name + ": " + error.message);
    }
  }
  if (imported.length) {
    await loadTree();
    await openNote(imported[0]);
    toast("імпортовано: " + imported.length);
  }
  return imported;
}

function openImportPicker() {
  const input = document.createElement("input");
  input.type = "file";
  input.accept = ".md,.txt,.html,.htm,text/markdown,text/plain,text/html";
  input.multiple = true;
  input.onchange = () => {
    if (input.files && input.files.length) importFiles(input.files);
    input.remove();
  };
  document.body.appendChild(input);
  input.click();
}

let katexPromise = null;
function ensureKatex() {
  if (window.katex) return Promise.resolve(window.katex);
  if (katexPromise) return katexPromise;
  katexPromise = new Promise((resolve, reject) => {
    if (!document.querySelector("link[data-katex]")) {
      const link = document.createElement("link");
      link.rel = "stylesheet";
      link.href = "https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/katex.min.css";
      link.dataset.katex = "1";
      document.head.appendChild(link);
    }
    const script = document.createElement("script");
    script.src = "https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/katex.min.js";
    script.async = true;
    script.onload = () => window.katex ? resolve(window.katex) : reject(new Error("katex missing"));
    script.onerror = () => reject(new Error("katex load failed"));
    document.head.appendChild(script);
  });
  return katexPromise;
}

function renderMathIn(root) {
  const nodes = root.querySelectorAll(".math[data-tex]");
  if (!nodes.length) return;
  ensureKatex().then((katex) => {
    nodes.forEach((node) => {
      if (node.dataset.rendered === "1" || !node.isConnected) return;
      try {
        katex.render(node.dataset.tex || "", node, { displayMode: node.classList.contains("math-display"), throwOnError: false, strict: false });
        node.dataset.rendered = "1";
      } catch {
        node.textContent = node.dataset.tex || "";
      }
    });
  }).catch(() => {
    nodes.forEach((node) => { if (!node.textContent) node.textContent = node.dataset.tex || ""; });
  });
}

let mermaidPromise = null;
function ensureMermaid() {
  if (window.mermaid) {
    if (!window.__vaultMermaidReady) {
      window.mermaid.initialize({ startOnLoad: false, securityLevel: "strict", theme: document.documentElement.dataset.theme === "light" ? "default" : "dark" });
      window.__vaultMermaidReady = true;
    }
    return Promise.resolve(window.mermaid);
  }
  if (mermaidPromise) return mermaidPromise;
  mermaidPromise = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "https://cdn.jsdelivr.net/npm/mermaid@10.9.1/dist/mermaid.min.js";
    script.async = true;
    script.onload = () => {
      try {
        window.mermaid.initialize({ startOnLoad: false, securityLevel: "strict", theme: document.documentElement.dataset.theme === "light" ? "default" : "dark" });
        window.__vaultMermaidReady = true;
        resolve(window.mermaid);
      } catch (error) { reject(error); }
    };
    script.onerror = () => reject(new Error("mermaid load failed"));
    document.head.appendChild(script);
  });
  return mermaidPromise;
}

async function renderMermaidIn(root) {
  const codes = root.querySelectorAll("pre > code.language-mermaid, pre > code.lang-mermaid");
  if (!codes.length) return;
  const nodes = [];
  codes.forEach((code, index) => {
    const pre = code.parentElement;
    if (!pre) return;
    const div = document.createElement("div");
    div.className = "mermaid";
    div.dataset.src = code.textContent;
    div.id = "mermaid-" + Date.now() + "-" + index;
    pre.replaceWith(div);
    nodes.push(div);
  });
  try {
    const mermaid = await ensureMermaid();
    for (const node of nodes) {
      if (!node.isConnected) continue;
      try {
        const result = await mermaid.render(node.id + "-svg", node.dataset.src || "");
        node.innerHTML = result.svg;
        node.dataset.rendered = "1";
      } catch {
        node.textContent = node.dataset.src || "";
        node.classList.add("mermaid-error");
      }
    }
  } catch {
    nodes.forEach((node) => { node.textContent = node.dataset.src || ""; node.classList.add("mermaid-error"); });
  }
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
  root.querySelectorAll("ul, ol").forEach((list) => {
    if (list.querySelector("li")) list.classList.add("has-list-bullet");
    if (list.querySelector('input[type="checkbox"]')) list.classList.add("contains-task-list");
  });
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
    const list = li.closest("ul, ol");
    const siblings = list ? [...list.children].filter((child) => child.tagName === "LI") : [];
    const lineIndex = Math.max(0, siblings.indexOf(li));
    li.setAttribute("data-task", info.checked ? "x" : "");
    li.setAttribute("data-line", String(lineIndex));
    li.setAttribute("dir", "auto");
    box.setAttribute("data-line", String(lineIndex));
    box.title = info.checked ? "Зняти позначку" : "Позначити виконаним";
    if (info.checked) {
      li.classList.add("is-checked");
      box.setAttribute("checked", "");
    } else {
      box.removeAttribute("checked");
    }
    if (!li.querySelector(".list-bullet")) {
      const bullet = document.createElement("span");
      bullet.className = "list-bullet";
      li.prepend(bullet);
    }
    box.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      toggleTaskLine(info.line + lineOffset, info.prefixLen);
    });
  });

  root.querySelectorAll("li").forEach((li) => {
    const nested = li.querySelector(":scope > ul, :scope > ol");
    if (!nested) return;
    if (li.querySelector(":scope > .list-collapse-indicator")) return;
    const indicator = document.createElement("span");
    indicator.className = "list-collapse-indicator collapse-icon";
    indicator.innerHTML = READING_TRIANGLE_SVG;
    indicator.title = "Згорнути список";
    const bullet = li.querySelector(":scope > .list-bullet");
    if (bullet) bullet.before(indicator); else li.prepend(indicator);
    indicator.onclick = (event) => {
      event.preventDefault();
      event.stopPropagation();
      const collapsed = li.classList.toggle("is-collapsed");
      indicator.classList.toggle("is-collapsed", collapsed);
    };
  });

  root.querySelectorAll(".internal-link[data-target]").forEach((a) => {
    a.onclick = async (event) => {
      event.preventDefault();
      const raw = String(a.dataset.target || "");
      const sameNote = raw.startsWith("#");
      const clean = sameNote ? raw.slice(1) : raw;
      const [fileTarget, anchor] = sameNote ? [null, clean] : clean.split("#");
      if (!sameNote && /\.pdf$/i.test(fileTarget)) {
        const pdfHit = state.files.find((p) => p === fileTarget || p.endsWith("/" + fileTarget));
        if (pdfHit) { await openNote(pdfHit); return; }
      }
      if (!sameNote && /\.(svg|png|jpe?g|gif|webp|bmp|avif)$/i.test(fileTarget)) {
        const mediaHit = state.files.find((p) => p === fileTarget || p.endsWith("/" + fileTarget));
        if (mediaHit && mediaApi) { await mediaApi.open(mediaHit); return; }
        window.open(imageUrlFor(fileTarget), "_blank", "noopener");
        return;
      }
      if (sameNote) { jumpToAnchor(anchor); return; }
      let hit = state.files.find((p) => p === fileTarget + ".md" || p === fileTarget || p.endsWith("/" + fileTarget + ".md"));
      if (!hit) hit = aliasTarget(fileTarget);
      if (!hit) { toast("Немає такої нотатки: " + fileTarget); return; }
      await openNote(hit);
      if (anchor) setTimeout(() => jumpToAnchor(anchor), 120);
    };
  });
  root.querySelectorAll(".footnote-ref a, .footnote-backref").forEach((a) => {
    a.onclick = (event) => {
      event.preventDefault();
      event.stopPropagation();
      const href = a.getAttribute("href") || "";
      if (!href.startsWith("#")) return;
      const id = href.slice(1);
      const target = root.querySelector('[id="' + (window.CSS && CSS.escape ? CSS.escape(id) : id) + '"]');
      if (target) target.scrollIntoView({ block: "center", behavior: "smooth" });
    };
  });
  root.querySelectorAll("[data-vault-src]").forEach((node) => {
    const target = node.getAttribute("data-vault-src") || "";
    loadAttachment(target).then((url) => {
      node.src = url;
      node.removeAttribute("data-vault-src");
    }).catch(() => {
      node.classList.add("missing");
      node.removeAttribute("data-vault-src");
    });
  });
  root.querySelectorAll("img").forEach((img) => {
    if (img.hasAttribute("data-vault-src")) return;
    const src = img.getAttribute("src") || "";
    if (!src || /^(https?:|blob:|data:)/i.test(src)) return;
    loadAttachment(src.replace(/^\.?\//, "")).then((url) => { img.src = url; }).catch(() => {});
  });
  root.querySelectorAll("a[href]").forEach((a) => {
    if (a.classList.contains("internal-link") || a.classList.contains("tag")) return;
    const href = a.getAttribute("href") || "";
    if (store.get("webLinks", "0") === "1" && /^https?:/i.test(href)) {
      a.onclick = (event) => { event.preventDefault(); openWebViewer(href); };
      return;
    }
    a.target = "_blank";
    a.rel = "noopener";
  });
  root.querySelectorAll(".tag[data-tag]").forEach((t) => {
    t.onclick = (event) => {
      event.preventDefault();
      const input = $("searchInput");
      if (input) { input.value = "tag:#" + t.dataset.tag; showPane("search"); input.dispatchEvent(new Event("input")); }
    };
  });
}

/* ---------------- page preview ---------------- */
let previewShowTimer = null;
let previewHideTimer = null;
let previewAnchor = null;
let previewTarget = null;

function previewEnabled() { return isCoreEnabled("page-preview") && store.get("pagePreview", "1") !== "0"; }

function previewLinkFor(node) {
  if (!node || typeof node.closest !== "function") return null;
  return node.closest(".internal-link[data-target], .cm-wikilink[data-target]");
}

function hidePagePreview() {
  clearTimeout(previewShowTimer);
  clearTimeout(previewHideTimer);
  previewShowTimer = null;
  previewHideTimer = null;
  previewAnchor = null;
  previewTarget = null;
  const host = $("pagePreview");
  if (host) {
    host.classList.remove("show");
    host.setAttribute("aria-hidden", "true");
  }
}

function scheduleHidePagePreview() {
  clearTimeout(previewHideTimer);
  previewHideTimer = setTimeout(hidePagePreview, 300);
}

function placePagePreview(host, link) {
  const rect = link.getBoundingClientRect();
  const margin = 12;
  const width = host.offsetWidth;
  const height = host.offsetHeight;
  const left = Math.min(Math.max(margin, rect.left), window.innerWidth - width - margin);
  let top = rect.bottom + 8;
  if (top + height > window.innerHeight - margin) top = Math.max(margin, rect.top - height - 8);
  host.style.left = Math.round(left) + "px";
  host.style.top = Math.round(top) + "px";
}

function paintPagePreview(host, path, text) {
  const parsed = parseProps(text);
  host.innerHTML = "";
  host.appendChild(el("div", "inline-title", noteName(path)));
  const body = el("div", "markdown-preview-view markdown-rendered");
  const tmp = document.createElement("div");
  tmp.innerHTML = markdownToHtml(parsed ? parsed.body : text);
  styleCallouts(tmp);
  for (const child of [...tmp.children]) body.appendChild(child);
  body.querySelectorAll(".internal-link[data-target]").forEach((a) => {
    a.onclick = (event) => {
      event.preventDefault();
      hidePagePreview();
      const target = a.dataset.target.replace(/^#/, "");
      const hit = state.files.find((p) => p === target + ".md" || p === target || p.endsWith("/" + target + ".md"));
      if (hit) openNote(hit);
    };
  });
  body.querySelectorAll("img").forEach((img) => {
    const src = img.getAttribute("src") || "";
    if (!/^https?:/.test(src)) img.src = imageUrlFor(src);
  });
  body.querySelectorAll("a[href]").forEach((a) => {
    if (a.classList.contains("internal-link") || a.classList.contains("tag")) return;
    a.target = "_blank";
    a.rel = "noopener";
  });
  stripBlockIds(body);
  host.appendChild(body);
  renderMathIn(body);
  renderMermaidIn(body);
}

function showPagePreview(link) {
  const target = link.getAttribute("data-target");
  if (!target) return;
  const clean = String(target).split("|")[0].split("#")[0].replace(/\.md$/i, "").trim();
  const path = state.files.find((p) => p === clean + ".md" || p === clean || p.endsWith("/" + clean + ".md"));
  if (!path) return;
  const host = $("pagePreview");
  if (!host) return;
  previewTarget = target;
  previewAnchor = link;
  host.classList.add("show");
  host.setAttribute("aria-hidden", "false");
  host.style.visibility = "hidden";
  const cached = state.index.get(path);
  if (cached == null) {
    host.innerHTML = '<div class="empty">завантажую…</div>';
    placePagePreview(host, link);
    host.style.visibility = "";
    ghGet(path).then(({ text }) => {
      state.index.set(path, text);
      if (previewTarget === target && host.classList.contains("show")) {
        paintPagePreview(host, path, text);
        placePagePreview(host, link);
      }
    }).catch(() => {
      if (previewTarget === target) {
        host.innerHTML = '<div class="empty">не вдалося завантажити</div>';
        placePagePreview(host, link);
      }
    });
  } else {
    paintPagePreview(host, path, cached);
    placePagePreview(host, link);
    host.style.visibility = "";
  }
}

document.addEventListener("mouseover", (event) => {
  const host = $("pagePreview");
  if (host && event.target.closest && event.target.closest("#pagePreview")) {
    clearTimeout(previewHideTimer);
    return;
  }
  const link = previewLinkFor(event.target);
  if (!link || !previewEnabled()) return;
  if (previewAnchor === link && host && host.classList.contains("show")) return;
  clearTimeout(previewShowTimer);
  clearTimeout(previewHideTimer);
  previewAnchor = link;
  previewShowTimer = setTimeout(() => showPagePreview(link), 320);
});
document.addEventListener("mouseout", (event) => {
  const link = previewLinkFor(event.target);
  if (!link) return;
  const host = $("pagePreview");
  if (event.relatedTarget && (link.contains(event.relatedTarget) || (host && host.contains(event.relatedTarget)))) return;
  clearTimeout(previewShowTimer);
  if (previewAnchor === link) scheduleHidePagePreview();
});
$("pagePreview").addEventListener("mouseenter", () => clearTimeout(previewHideTimer));
$("pagePreview").addEventListener("mouseleave", () => scheduleHidePagePreview());
document.addEventListener("keydown", (event) => { if (event.key === "Escape") hidePagePreview(); });
document.addEventListener("mousedown", (event) => {
  const host = $("pagePreview");
  if (host && !host.contains(event.target)) hidePagePreview();
});
window.addEventListener("scroll", (event) => {
  if (event.target && event.target.closest && event.target.closest("#pagePreview")) return;
  hidePagePreview();
}, true);

function resolveEmbeds(root) {
  root.querySelectorAll(".embed-note").forEach((box) => {
    const raw = decodeURIComponent(box.dataset.note || "");
    const [name, anchor] = raw.split("#");
    const hit = state.files.find((p) => p === name + ".md" || p === name || p.endsWith("/" + name + ".md"));
    if (!hit) { box.textContent = "немає нотатки: " + name; box.classList.add("missing"); return; }
    const paintEmbed = (text) => {
      const parsed = parseProps(text);
      let body = parsed ? parsed.body : text;
      if (anchor) body = extractSection(body, anchor);
      box.innerHTML = '<div class="embed-title">' + escapeHtml(hit.split("/").pop().replace(/\.md$/, "")) + (anchor ? " › " + escapeHtml(anchor.replace(/^\^/, "")) : "") + "</div>" + markdownToHtml(body);
      styleCallouts(box);
      stripBlockIds(box);
      wireRendered(box, body, 0);
      renderMathIn(box);
      renderMermaidIn(box);
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

/* ---------------- right sidebar ---------------- */
const RIGHT_TABS = [
  { id: "backlink", label: "Backlinks" },
  { id: "outgoing-link", label: "Outgoing links" },
  { id: "tag", label: "Tags" },
  { id: "all-properties", label: "All properties" },
  { id: "outline", label: "Outline" },
];

const RIGHT_ICONS = {
  backlink: '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="svg-icon links-coming-in"><path d="M8.70467 12C8.21657 11.6404 7.81269 11.1817 7.52044 10.6549C7.22819 10.1281 7.0544 9.54553 7.01086 8.94677C6.96732 8.348 7.05504 7.74701 7.26808 7.18456C7.48112 6.62212 7.81449 6.11138 8.24558 5.68697L10.7961 3.17516C11.5978 2.41258 12.6716 1.99062 13.7861 2.00016C14.9007 2.0097 15.9668 2.44997 16.755 3.22615C17.5431 4.00234 17.9902 5.05233 17.9998 6.14998C18.0095 7.24763 17.5811 8.30511 16.8067 9.09467L15.9014 10"></path><path d="M11.2953 8C11.7834 8.35957 12.1873 8.81831 12.4796 9.34512C12.7718 9.87192 12.9456 10.4545 12.9891 11.0532C13.0327 11.652 12.945 12.253 12.7319 12.8154C12.5189 13.3779 12.1855 13.8886 11.7544 14.313L9.20392 16.8248C8.40221 17.5874 7.32844 18.0094 6.21389 17.9998C5.09933 17.9903 4.03318 17.55 3.24504 16.7738C2.4569 15.9977 2.00985 14.9477 2.00016 13.85C1.99047 12.7524 2.41893 11.6949 3.19326 10.9053L4.09859 10"></path><path d="M17 21L14 18L17 15"></path><path d="M21 18H14"></path></svg>',
  "outgoing-link": '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="svg-icon links-going-out"><path d="M8.70467 12C8.21657 11.6404 7.81269 11.1817 7.52044 10.6549C7.22819 10.1281 7.0544 9.54553 7.01086 8.94677C6.96732 8.348 7.05504 7.74701 7.26808 7.18456C7.48112 6.62212 7.81449 6.11138 8.24558 5.68697L10.7961 3.17516C11.5978 2.41258 12.6716 1.99062 13.7861 2.00016C14.9007 2.0097 15.9668 2.44997 16.755 3.22615C17.5431 4.00234 17.9902 5.05233 17.9998 6.14998C18.0095 7.24763 17.5811 8.30511 16.8067 9.09467L15.9014 10"></path><path d="M11.2953 8C11.7834 8.35957 12.1873 8.81831 12.4796 9.34512C12.7718 9.87192 12.9456 10.4545 12.9891 11.0532C13.0327 11.652 12.945 12.253 12.7319 12.8154C12.5189 13.3779 12.1855 13.8886 11.7544 14.313L9.20392 16.8248C8.40221 17.5874 7.32844 18.0094 6.21389 17.9998C5.09933 17.9903 4.03318 17.55 3.24504 16.7738C2.4569 15.9977 2.00985 14.9477 2.00016 13.85C1.99047 12.7524 2.41893 11.6949 3.19326 10.9053L4.09859 10"></path><path d="M17 3L20 6L17 9"></path><path d="M10 6H20"></path></svg>',
  tag: '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="svg-icon lucide-tags"><path d="M13.172 2a2 2 0 0 1 1.414.586l6.71 6.71a2.4 2.4 0 0 1 0 3.408l-4.592 4.592a2.4 2.4 0 0 1-3.408 0l-6.71-6.71A2 2 0 0 1 5 9.172V4a2 2 0 0 1 2-2z"></path><path d="M7 7h.01"></path></svg>',
  "all-properties": '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="svg-icon lucide-text"><path d="M21 5H3"></path><path d="M15 12H3"></path><path d="M17 19H3"></path></svg>',
  outline: '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="svg-icon lucide-list"><path d="M3 5h.01"></path><path d="M3 12h.01"></path><path d="M3 19h.01"></path><path d="M8 5h13"></path><path d="M8 12h13"></path><path d="M8 19h13"></path></svg>',
};

let rightTab = store.get("rightTab", "backlink");
let rightClosed = [];
try {
  const savedClosed = JSON.parse(store.get("rightClosed", "[]"));
  if (Array.isArray(savedClosed)) rightClosed = savedClosed.filter((id) => RIGHT_TABS.some((tab) => tab.id === id));
} catch { rightClosed = []; }
let backlinkMoreContext = false;
let backlinkSort = "name";
const backlinkCollapsed = new Set();

function persistRightSidebar() {
  store.set("rightTab", rightTab);
  store.set("rightClosed", JSON.stringify(rightClosed));
}

function renderRightTabs() {
  const host = $("rightTabs");
  if (!host) return;
  const pluginFor = { backlink: "backlink", "outgoing-link": "outgoing-link", tag: "tag-pane", "all-properties": "properties", outline: "outline" };
  const available = RIGHT_TABS.filter((tab) => !rightClosed.includes(tab.id) && isCoreEnabled(pluginFor[tab.id]));
  if (!available.some((tab) => tab.id === rightTab)) rightTab = available.length ? available[0].id : "";
  host.innerHTML = "";
  for (const tab of available) {
    const head = el("div", "workspace-tab-header tappable" + (tab.id === rightTab ? " is-active" : ""));
    head.dataset.type = tab.id;
    head.setAttribute("aria-label", tab.label);
    head.title = tab.label;
    const inner = el("div", "workspace-tab-header-inner");
    const icon = el("div", "workspace-tab-header-inner-icon");
    icon.innerHTML = RIGHT_ICONS[tab.id] || RIGHT_ICONS.outline;
    const title = el("div", "workspace-tab-header-inner-title", tab.label);
    const status = el("div", "workspace-tab-header-status-container");
    const close = el("div", "workspace-tab-header-inner-close-button");
    close.setAttribute("aria-label", "Close");
    close.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="svg-icon lucide-x"><path d="M18 6 6 18"></path><path d="m6 6 12 12"></path></svg>';
    close.onclick = (event) => { event.stopPropagation(); closeRightTab(tab.id); };
    inner.append(icon, title, status, close);
    head.appendChild(inner);
    head.onclick = () => switchRightTab(tab.id);
    host.appendChild(head);
  }
  const empty = $("rightEmpty");
  const panels = $("rightPanels");
  if (empty) empty.style.display = available.length ? "none" : "flex";
  if (panels) panels.style.display = available.length ? "flex" : "none";
  document.querySelectorAll("#right .right-panel").forEach((panel) => {
    panel.classList.toggle("is-active", panel.dataset.tab === rightTab);
  });
  persistRightSidebar();
}

function switchRightTab(id) {
  if (!RIGHT_TABS.some((tab) => tab.id === id)) return;
  rightClosed = rightClosed.filter((item) => item !== id);
  rightTab = id;
  persistRightSidebar();
  renderRightTabs();
  renderRightPanels();
}

function closeRightTab(id) {
  if (!rightClosed.includes(id)) rightClosed.push(id);
  if (rightTab === id) {
    const available = RIGHT_TABS.filter((tab) => !rightClosed.includes(tab.id));
    rightTab = available.length ? available[0].id : "";
  }
  persistRightSidebar();
  renderRightTabs();
  renderRightPanels();
}

function openRightTab(id) {
  if (!RIGHT_TABS.some((tab) => tab.id === id)) return;
  rightClosed = rightClosed.filter((item) => item !== id);
  switchRightTab(id);
}

function renderRightPanels() {
  if (!rightTab) return;
  if (rightTab === "outline") renderOutline();
  else if (rightTab === "backlink") renderBacklinks();
  else if (rightTab === "outgoing-link") renderOutgoingLinks();
  else if (rightTab === "tag") renderTagPanel();
  else if (rightTab === "all-properties") renderAllProperties();
}

function noteName(path) { return String(path || "").split("/").pop().replace(/\.md$/, ""); }

let backlinkCountTimer = null;
function scheduleBacklinkCount() {
  clearTimeout(backlinkCountTimer);
  const node = $("stBacklinks");
  if (!node) return;
  const file = currentFile();
  if (!file) { node.textContent = ""; return; }
  node.textContent = "…";
  backlinkCountTimer = setTimeout(async () => {
    try { await ensureIndex(file.path); } catch { /* ignore */ }
    const current = currentFile();
    if (!current || current.path !== file.path) return;
    let count = 0;
    for (const [path, text] of state.index) {
      if (path === file.path || !text) continue;
      if (wikiLinks(text).some((link) => resolveLinkTarget(link.target) === file.path)) count++;
    }
    if (!currentFile() || currentFile().path !== file.path) return;
    node.textContent = count ? count + (count === 1 ? " backlink" : " backlinks") : "No backlinks";
  }, 300);
}

function escapeRegExp(value) { return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }

function resolveLinkTarget(target) {
  const clean = String(target || "").split("|")[0].split("#")[0].replace(/\.md$/i, "").trim();
  if (!clean) return null;
  return state.files.find((path) => path === clean + ".md" || path === clean || path.endsWith("/" + clean + ".md")) || null;
}

function wikiLinks(text) {
  const links = [];
  const re = /\[\[([^\]]+)\]\]/g;
  let match;
  while ((match = re.exec(text)) !== null) {
    const target = match[1].split("|")[0].trim();
    if (!target) continue;
    links.push({ target, raw: match[0], start: match.index, end: match.index + match[0].length });
  }
  return links;
}

function lineAt(text, index) {
  const before = text.slice(0, index);
  const start = before.lastIndexOf("\n") + 1;
  const end = text.indexOf("\n", index);
  return {
    line: before.split("\n").length - 1,
    start,
    text: text.slice(start, end < 0 ? text.length : end),
  };
}

function snippetPieces(lineText, from, to, wide) {
  const width = wide ? 150 : 90;
  let start = Math.max(0, from - Math.floor((width - (to - from)) / 2));
  let end = Math.min(lineText.length, to + Math.floor((width - (to - from)) / 2));
  if (end - start < width) start = Math.max(0, end - width);
  if (end - start < width) end = Math.min(lineText.length, start + width);
  return [
    { text: (start > 0 ? "…" : "") + lineText.slice(start, from) },
    { text: lineText.slice(from, to), match: true },
    { text: lineText.slice(to) + (end < lineText.length ? "…" : "") },
  ];
}

function renderGroupSection(container, sectionKey, label, groups, emptyText) {
  const head = el("div", "tree-item-self is-clickable");
  head.setAttribute("aria-label", "Click to collapse");
  head.dataset.section = sectionKey;
  const icon = el("span", "tree-item-icon collapse-icon");
  icon.innerHTML = READING_TRIANGLE_SVG;
  const inner = el("div", "tree-item-inner", label);
  const flair = el("div", "tree-item-flair-outer");
  flair.appendChild(el("span", "tree-item-flair", String(groups.size)));
  head.append(icon, inner, flair);
  const holder = el("div", "search-result-container");
  const children = el("div", "search-results-children");
  const collapsed = backlinkCollapsed.has(sectionKey);
  head.classList.toggle("is-collapsed", collapsed);
  holder.style.display = collapsed ? "none" : "";
  head.onclick = () => {
    if (backlinkCollapsed.has(sectionKey)) backlinkCollapsed.delete(sectionKey);
    else backlinkCollapsed.add(sectionKey);
    const nowCollapsed = backlinkCollapsed.has(sectionKey);
    head.classList.toggle("is-collapsed", nowCollapsed);
    holder.style.display = nowCollapsed ? "none" : "";
  };
  if (!groups.size) children.appendChild(el("div", "empty", emptyText));
  const entries = [...groups.entries()];
  if (backlinkSort === "count") entries.sort((a, b) => b[1].length - a[1].length || noteName(a[0]).localeCompare(noteName(b[0])));
  else entries.sort((a, b) => noteName(a[0]).localeCompare(noteName(b[0])));
  for (const [fileKey, hits] of entries) {
    const resolved = state.files.includes(fileKey) ? fileKey : resolveLinkTarget(fileKey);
    const item = el("div", "tree-item search-result");
    const title = el("div", "tree-item-self search-result-file-title is-clickable" + (resolved ? "" : " is-unresolved"));
    title.draggable = true;
    title.title = resolved || fileKey;
    const tri = el("div", "tree-item-icon collapse-icon");
    tri.innerHTML = READING_TRIANGLE_SVG;
    const name = el("div", "tree-item-inner", noteName(fileKey));
    const count = el("div", "tree-item-flair-outer");
    count.appendChild(el("span", "tree-item-flair", String(hits.length)));
    title.append(tri, name, count);
    const matches = el("div", "search-result-file-matches");
    title.onclick = () => {
      const next = !title.classList.contains("is-collapsed");
      title.classList.toggle("is-collapsed", next);
      matches.style.display = next ? "none" : "";
    };
    title.ondblclick = () => { if (resolved) openNote(resolved); };
    for (const hit of hits.slice(0, 40)) {
      const row = el("div", "search-result-file-match tappable");
      for (const piece of hit.pieces) {
        if (!piece.text) continue;
        row.appendChild(el("span", piece.match ? "search-result-file-matched-text" : null, piece.text));
      }
      row.title = resolved ? "Відкрити " + resolved : "Немає нотатки: " + fileKey;
      row.onclick = async () => {
        if (!resolved) { toast("Немає нотатки: " + fileKey); return; }
        await openNote(resolved);
        jumpToLine(hit.line);
      };
      matches.appendChild(row);
    }
    item.append(title, matches);
    children.appendChild(item);
  }
  holder.appendChild(children);
  container.append(head, holder);
}

async function renderBacklinks() {
  const host = $("backlinks");
  if (!host) return;
  const file = currentFile();
  if (!file) { host.innerHTML = ""; host.appendChild(el("div", "empty", "Немає відкритої нотатки")); return; }
  host.innerHTML = "";
  host.appendChild(el("div", "empty", "шукаю звʼязки…"));
  await ensureIndex(file.path);
  if (rightTab !== "backlink") return;
  const current = currentFile();
  if (!current || current.path !== file.path) return;
  host.innerHTML = "";
  const name = noteName(file.path);
  const filter = ($("blFilter")?.value || "").trim().toLowerCase();
  const linked = new Map();
  const unlinked = new Map();
  for (const [path, text] of state.index) {
    if (path === file.path || !text) continue;
    const linkedHits = [];
    for (const link of wikiLinks(text)) {
      if (resolveLinkTarget(link.target) !== file.path) continue;
      const info = lineAt(text, link.start);
      const from = link.start - info.start;
      linkedHits.push({ line: info.line, pieces: snippetPieces(info.text, from, from + link.raw.length, backlinkMoreContext) });
    }
    if (linkedHits.length) linked.set(path, linkedHits);
    if (name.length > 1) {
      const stripped = text.replace(/\[\[[^\]]+\]\]/g, (value) => " ".repeat(value.length));
      const plainHits = [];
      const re = new RegExp("(?<![\\p{L}\\p{N}_])" + escapeRegExp(name) + "(?![\\p{L}\\p{N}_])", "giu");
      let match;
      while ((match = re.exec(stripped)) !== null) {
        const info = lineAt(stripped, match.index);
        const from = match.index - info.start;
        plainHits.push({ line: info.line, pieces: snippetPieces(info.text, from, from + match[0].length, backlinkMoreContext) });
        if (plainHits.length >= 40) break;
      }
      if (plainHits.length) unlinked.set(path, plainHits);
    }
  }
  if (filter) {
    const keep = (groups) => {
      for (const [path, hits] of [...groups]) {
        const text = hits.map((hit) => hit.pieces.map((piece) => piece.text).join("")).join(" ").toLowerCase();
        if (!noteName(path).toLowerCase().includes(filter) && !text.includes(filter)) groups.delete(path);
      }
    };
    keep(linked);
    keep(unlinked);
  }
  const pane = el("div", "backlink-pane node-insert-event");
  renderGroupSection(pane, "backlink:Linked mentions", "Linked mentions", linked, "Немає згадок");
  renderGroupSection(pane, "backlink:Unlinked mentions", "Unlinked mentions", unlinked, "Немає непривʼязаних згадок");
  host.appendChild(pane);
}

async function renderOutgoingLinks() {
  const host = $("outgoing");
  if (!host) return;
  const file = currentFile();
  if (!file) { host.innerHTML = ""; host.appendChild(el("div", "empty", "Немає відкритої нотатки")); return; }
  host.innerHTML = "";
  const links = new Map();
  for (const link of wikiLinks(file.text)) {
    const resolved = resolveLinkTarget(link.target);
    const key = resolved || link.target.split("|")[0].trim();
    const info = lineAt(file.text, link.start);
    const from = link.start - info.start;
    const hits = links.get(key) || [];
    hits.push({ line: info.line, pieces: snippetPieces(info.text, from, from + link.raw.length, false) });
    links.set(key, hits);
  }
  const unlinked = new Map();
  const stripped = file.text.replace(/\[\[[^\]]+\]\]/g, (value) => " ".repeat(value.length));
  for (const path of state.files) {
    if (!path.endsWith(".md") || path === file.path) continue;
    const otherName = noteName(path);
    if (otherName.length < 2) continue;
    const re = new RegExp("(?<![\\p{L}\\p{N}_])" + escapeRegExp(otherName) + "(?![\\p{L}\\p{N}_])", "giu");
    const hits = [];
    let match;
    while ((match = re.exec(stripped)) !== null) {
      const info = lineAt(stripped, match.index);
      const from = match.index - info.start;
      hits.push({ line: info.line, pieces: snippetPieces(info.text, from, from + match[0].length, false) });
      if (hits.length >= 40) break;
    }
    if (hits.length) unlinked.set(path, hits);
  }
  const pane = el("div", "outgoing-link-pane node-insert-event");
  renderGroupSection(pane, "outgoing:Links", "Links", links, "Немає посилань");
  renderGroupSection(pane, "outgoing:Unlinked mentions", "Unlinked mentions", unlinked, "Немає непривʼязаних згадок");
  host.appendChild(pane);
}

function noteTags(text) {
  const tags = new Set();
  const parsed = parseProps(String(text || ""));
  if (parsed) {
    for (const [key, value] of parsed.props) {
      const lowerKey = key.toLowerCase();
      if (lowerKey !== "tags" && lowerKey !== "tag") continue;
      for (const part of String(value).split(/[,\s]+/)) {
        const tag = part.replace(/^#/, "").replace(/^["']|["']$/g, "").trim();
        if (tag) tags.add(tag);
      }
    }
  }
  for (const match of String(text || "").matchAll(/(^|\s)#([A-Za-z0-9_\u0400-\u04FF][A-Za-z0-9_\u0400-\u04FF/-]*)/g)) {
    tags.add(match[2]);
  }
  return tags;
}

function renderTagPanel() {
  const host = $("tagPanel");
  if (!host) return;
  const filter = ($("tagFilter")?.value || "").trim().toLowerCase().replace(/^#/, "");
  const counts = new Map();
  for (const [, text] of state.index) {
    if (!text) continue;
    for (const tag of noteTags(text)) counts.set(tag, (counts.get(tag) || 0) + 1);
  }
  host.innerHTML = "";
  const rows = [...counts.entries()]
    .filter(([tag]) => !filter || tag.toLowerCase().includes(filter))
    .sort((a, b) => a[0].localeCompare(b[0]));
  if (!rows.length) { host.appendChild(el("div", "empty", counts.size ? "Нічого не знайдено" : "Немає тегів")); return; }
  for (const [tag, count] of rows) {
    const item = el("div", "tree-item");
    const self = el("div", "tree-item-self is-clickable");
    const icon = el("div", "tree-item-icon");
    icon.innerHTML = RIGHT_ICONS.tag;
    const inner = el("div", "tree-item-inner");
    inner.appendChild(el("div", "tree-item-inner-text", "#" + tag));
    const flair = el("div", "tree-item-flair-outer");
    flair.appendChild(el("span", "tree-item-flair", String(count)));
    self.append(icon, inner, flair);
    self.onclick = () => {
      $("searchInput").value = "tag:#" + tag;
      runSearch();
      showPane("search");
    };
    item.appendChild(self);
    host.appendChild(item);
  }
}

function renderAllProperties() {
  const host = $("allProps");
  if (!host) return;
  const filter = ($("propFilter")?.value || "").trim().toLowerCase();
  const counts = new Map();
  for (const [, text] of state.index) {
    if (!text) continue;
    const parsed = parseProps(text);
    if (!parsed) continue;
    for (const [key] of parsed.props) counts.set(key, (counts.get(key) || 0) + 1);
  }
  host.innerHTML = "";
  const rows = [...counts.entries()].filter(([key]) => !filter || key.toLowerCase().includes(filter)).sort((a, b) => a[0].localeCompare(b[0]));
  if (!rows.length) { host.appendChild(el("div", "empty", counts.size ? "Нічого не знайдено" : "Немає властивостей")); return; }
  for (const [key, count] of rows) {
    const item = el("div", "tree-item");
    const self = el("div", "tree-item-self tappable is-clickable");
    const icon = el("div", "tree-item-icon");
    icon.innerHTML = /date|time|created|updated/i.test(key)
      ? '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="svg-icon lucide-calendar"><path d="M8 2v4"></path><path d="M16 2v4"></path><rect x="3" y="4" width="18" height="18" rx="2"></rect><path d="M3 10h18"></path></svg>'
      : key === "tags" || key === "aliases"
        ? RIGHT_ICONS.tag
        : RIGHT_ICONS["all-properties"];
    const inner = el("div", "tree-item-inner");
    inner.appendChild(el("div", "tree-item-inner-text", key));
    const flair = el("div", "tree-item-flair-outer");
    flair.appendChild(el("span", "tree-item-flair", String(count)));
    self.append(icon, inner, flair);
    self.onclick = () => {
      $("searchInput").value = '["' + key + '"]';
      runSearch();
      showPane("search");
    };
    item.appendChild(self);
    host.appendChild(item);
  }
}

let tagSort = store.get("tagSort", "name");
let tagCollapsed = new Set();
try {
  const savedTagCollapsed = JSON.parse(store.get("tagCollapsed", "[]"));
  if (Array.isArray(savedTagCollapsed)) tagCollapsed = new Set(savedTagCollapsed);
} catch { tagCollapsed = new Set(); }

function renderTagChildren(node, host, depth) {
  const children = [...node.children.values()].sort((a, b) => {
    if (tagSort === "count") return b.total - a.total || a.label.localeCompare(b.label, "uk", { numeric: true });
    return a.label.localeCompare(b.label, "uk", { numeric: true });
  });
  for (const child of children) {
    const hasChildren = child.children.size > 0;
    const collapsed = tagCollapsed.has(child.tag);
    const row = el("div", "tag-row");
    row.style.paddingLeft = 6 + depth * 12 + "px";
    const chev = el("span", "tag-chev" + (hasChildren ? "" : " is-empty"), hasChildren ? (collapsed ? "▸" : "▾") : "");
    if (hasChildren) {
      chev.onclick = (event) => {
        event.stopPropagation();
        if (tagCollapsed.has(child.tag)) tagCollapsed.delete(child.tag);
        else tagCollapsed.add(child.tag);
        store.set("tagCollapsed", JSON.stringify([...tagCollapsed]));
        renderTags();
      };
    }
    const label = el("a", "tag tag-pane-tag", "#" + child.label);
    const count = el("span", "tag-count", String(child.total));
    row.append(chev, label, count);
    row.title = "#" + child.tag;
    row.onclick = () => {
      $("searchInput").value = "tag:#" + child.tag;
      showPane("search");
      runSearch();
    };
    host.appendChild(row);
    if (hasChildren && !collapsed) renderTagChildren(child, host, depth + 1);
  }
}

function renderTags() {
  const host = $("tagsPane");
  host.innerHTML = "";
  const counts = new Map();
  for (const [, text] of state.index) {
    if (!text) continue;
    for (const tag of noteTags(text)) counts.set(tag, (counts.get(tag) || 0) + 1);
  }
  if (!counts.size) { host.appendChild(el("div", "empty", "Тегів ще нема. Відкрий кілька нотаток — індекс збереться.")); return; }
  const root = { children: new Map(), own: 0, total: 0 };
  for (const [tag, count] of counts) {
    const parts = tag.split("/");
    let node = root;
    for (let i = 0; i < parts.length; i++) {
      const full = parts.slice(0, i + 1).join("/");
      if (!node.children.has(full)) node.children.set(full, { tag: full, label: parts[i], children: new Map(), own: 0, total: 0 });
      node = node.children.get(full);
    }
    node.own += count;
  }
  const total = (node) => {
    let sum = node.own;
    for (const child of node.children.values()) sum += total(child);
    node.total = sum;
    return sum;
  };
  total(root);
  const head = el("div", "tag-head");
  head.appendChild(el("span", "tag-summary", counts.size + " тегів"));
  const sortBtn = el("button", "clickable-icon", "⇅");
  sortBtn.title = "Сортування тегів";
  sortBtn.onclick = (event) => {
    event.stopPropagation();
    const rect = sortBtn.getBoundingClientRect();
    showCtx(rect.left, rect.bottom + 4, [
      { label: (tagSort === "name" ? "✓ " : "") + "За назвою", run: () => { tagSort = "name"; store.set("tagSort", tagSort); renderTags(); } },
      { label: (tagSort === "count" ? "✓ " : "") + "За кількістю", run: () => { tagSort = "count"; store.set("tagSort", tagSort); renderTags(); } },
    ]);
  };
  head.appendChild(sortBtn);
  host.appendChild(head);
  renderTagChildren(root, host, 0);
}

async function runSearch() {
  const raw = $("searchInput").value.trim();
  const host = $("searchResults");
  host.innerHTML = "";
  syncSearchOptions();
  if (raw.length < 2) { host.appendChild(el("div", "empty", "мінімум 2 символи")); if ($("searchSummary")) $("searchSummary").textContent = ""; return; }
  host.appendChild(el("div", "empty", "шукаю…"));
  await ensureIndex();

  const alternatives = raw.split(/\s+OR\s+/).map(parseSearchQuery);
  const caseSensitive = store.get("searchCase", "0") === "1";
  const sortMode = store.get("searchSort", "name");
  const collapseAll = store.get("searchCollapse", "0") === "1";
  const results = [];
  for (const [path, text] of state.index) {
    if (!text) continue;
    const parsed = alternatives.find((query) => searchQueryMatches(query, path, text, query.caseOverride != null ? query.caseOverride : caseSensitive));
    if (!parsed) continue;
    const queryCase = parsed.caseOverride != null ? parsed.caseOverride : caseSensitive;
    const hay = queryCase ? text : text.toLowerCase();
    const groupWords = [...parsed.line, ...parsed.section]
      .flatMap((group) => group.split(/\s+/))
      .filter(Boolean);
    const searchNeedles = [...parsed.phrases, ...parsed.terms, ...groupWords]
      .map((needle) => queryCase ? needle : needle.toLowerCase());
    const hits = [];
    for (const needle of searchNeedles) {
      let at = hay.indexOf(needle);
      while (at !== -1 && hits.length < 200) {
        const info = lineAt(text, at);
        const from = at - info.start;
        hits.push({ line: info.line, pieces: snippetPieces(info.text, from, from + needle.length, true) });
        at = hay.indexOf(needle, at + Math.max(1, needle.length));
      }
    }
    const aliasText = noteAliases(text).join(" ");
    if (aliasText) {
      const aliasHay = queryCase ? aliasText : aliasText.toLowerCase();
      for (const needle of searchNeedles) {
        const at = aliasHay.indexOf(needle);
        if (at < 0) continue;
        hits.push({ line: 0, pieces: snippetPieces(aliasText, at, at + needle.length, true) });
      }
    }
    for (const spec of parsed.regex) {
      let re;
      try {
        const flags = (spec.flags.includes("g") ? spec.flags : spec.flags + "g") + (queryCase || spec.flags.includes("i") ? "" : "i");
        re = new RegExp(spec.source, flags);
      } catch { continue; }
      re.lastIndex = 0;
      let match;
      while ((match = re.exec(text)) !== null && hits.length < 200) {
        const info = lineAt(text, match.index);
        const from = match.index - info.start;
        hits.push({ line: info.line, pieces: snippetPieces(info.text, from, from + match[0].length, true) });
        if (match.index === re.lastIndex) re.lastIndex++;
      }
    }
    if (!hits.length && !searchNeedles.length && !parsed.regex.length) {
      const info = lineAt(text, 0);
      hits.push({ line: 0, pieces: [{ text: info.text.slice(0, 160) }] });
    }
    if (!hits.length) continue;
    results.push({ path, hits: hits.slice(0, 100), count: hits.length });
  }
  host.innerHTML = "";
  if (!results.length) {
    host.appendChild(el("div", "empty", "нічого не знайдено"));
    if ($("searchSummary")) $("searchSummary").textContent = "0 файлів · 0 збігів";
    return;
  }
  if (sortMode === "hits") results.sort((a, b) => b.count - a.count || noteName(a.path).localeCompare(noteName(b.path)));
  else results.sort((a, b) => noteName(a.path).localeCompare(noteName(b.path)));
  const total = results.reduce((sum, result) => sum + result.count, 0);
  if ($("searchSummary")) $("searchSummary").textContent = results.length + " файлів · " + total + " збігів";

  for (const result of results) {
    const item = el("div", "tree-item search-result");
    const title = el("div", "tree-item-self search-result-file-title is-clickable");
    title.title = result.path;
    const tri = el("div", "tree-item-icon collapse-icon");
    tri.innerHTML = READING_TRIANGLE_SVG;
    const name = el("div", "tree-item-inner", noteName(result.path));
    const flair = el("div", "tree-item-flair-outer");
    flair.appendChild(el("span", "tree-item-flair", String(result.count)));
    title.append(tri, name, flair);
    const matches = el("div", "search-result-file-matches");
    const collapsed = collapseAll;
    title.classList.toggle("is-collapsed", collapsed);
    matches.style.display = collapsed ? "none" : "";
    title.onclick = () => {
      const next = !title.classList.contains("is-collapsed");
      title.classList.toggle("is-collapsed", next);
      matches.style.display = next ? "none" : "";
    };
    title.ondblclick = () => openNote(result.path);
    for (const hit of result.hits) {
      const row = el("div", "search-result-file-match tappable");
      for (const piece of hit.pieces) {
        if (!piece.text) continue;
        row.appendChild(el("span", piece.match ? "search-result-file-matched-text" : null, piece.text));
      }
      row.title = "Відкрити " + result.path + " · рядок " + (hit.line + 1);
      row.onclick = async () => {
        await openNote(result.path);
        jumpToLine(hit.line);
      };
      matches.appendChild(row);
    }
    item.append(title, matches);
    host.appendChild(item);
  }
}

function syncSearchOptions() {
  const caseBtn = $("searchCase");
  if (caseBtn) caseBtn.classList.toggle("active", store.get("searchCase", "0") === "1");
  const sortBtn = $("searchSort");
  if (sortBtn) {
    const mode = store.get("searchSort", "name");
    sortBtn.classList.toggle("active", mode === "hits");
    sortBtn.title = mode === "hits" ? "Сортування: за кількістю збігів" : "Сортування: за назвою";
  }
  const collapseBtn = $("searchCollapse");
  if (collapseBtn) collapseBtn.classList.toggle("active", store.get("searchCollapse", "0") === "1");
}

function parseSearchQuery(raw) {
  const out = { terms: [], phrases: [], path: [], file: [], tags: [], props: [], not: [], regex: [], line: [], section: [], tasks: [], blocks: [], caseOverride: null };
  let rest = String(raw || "");
  rest = rest.replace(/\b(line|section):\(([^)]*)\)/gi, (match, kind, inner) => {
    const group = inner.trim().replace(/^["']|["']$/g, "");
    if (group) out[kind.toLowerCase()].push(group);
    return " ";
  });
  rest = rest.replace(/\b(task-todo|task-done|task|block):\(([^)]*)\)/gi, (match, kind, inner) => {
    const key = kind.toLowerCase();
    const value = inner.trim().replace(/^["']|["']$/g, "");
    if (key === "block") {
      if (value) out.blocks.push(value);
    } else {
      out.tasks.push({ state: key === "task-todo" ? "todo" : key === "task-done" ? "done" : "any", text: value });
    }
    return " ";
  });
  const re = /(-?)("([^"]+)"|(\[[^\]]+\])|(\S+))/g;
  let m;
  while ((m = re.exec(rest)) !== null) {
    const neg = m[1] === "-";
    const token = (m[3] || m[4] || m[5] || "").trim();
    if (!token) continue;
    if (neg) { out.not.push(token); continue; }
    if (/^match-case:$/i.test(token)) { out.caseOverride = true; continue; }
    if (/^ignore-case:$/i.test(token)) { out.caseOverride = false; continue; }
    if (token.startsWith("/") && token.length > 2) {
      const end = token.lastIndexOf("/");
      if (end > 0) {
        const source = token.slice(1, end);
        const flags = token.slice(end + 1).replace(/[^gimsuy]/g, "");
        if (source) out.regex.push({ source, flags });
        continue;
      }
    }
    if (/^path:/i.test(token)) { out.path.push(token.slice(5).toLowerCase()); continue; }
    if (/^file:/i.test(token)) { out.file.push(token.slice(5).toLowerCase()); continue; }
    if (/^tag:/i.test(token)) { out.tags.push(token.slice(4).replace(/^#/, "").toLowerCase()); continue; }
    if (/^content:/i.test(token)) {
      const value = token.slice(8);
      if (value) out.terms.push(value);
      continue;
    }
    if (/^\[[^\]]+\]$/.test(token)) {
      let inner = token.slice(1, -1).trim();
      if ((inner.startsWith('"') && inner.endsWith('"')) || (inner.startsWith("'") && inner.endsWith("'"))) inner = inner.slice(1, -1);
      if (inner) out.props.push(inner.toLowerCase());
      continue;
    }
    if (m[3]) out.phrases.push(token);
    else out.terms.push(token);
  }
  return out;
}

function sectionContains(text, words, caseSensitive) {
  const lines = String(text || "").split(/\r?\n/);
  const sections = [];
  let current = null;
  for (const line of lines) {
    const heading = line.match(/^(#{1,6})\s+(.*)$/);
    if (heading) {
      if (current) sections.push(current);
      current = { level: heading[1].length, text: heading[2] + "\n" };
      continue;
    }
    if (current) current.text += line + "\n";
  }
  if (current) sections.push(current);
  if (!sections.length) sections.push({ level: 0, text: String(text || "") });
  for (const section of sections) {
    const hay = caseSensitive ? section.text : section.text.toLowerCase();
    if (words.every((word) => hay.includes(word))) return true;
  }
  return false;
}

function searchQueryMatches(parsed, path, text, caseSensitive) {
  const aliases = noteAliases(text);
  const aliasText = aliases.join(" ");
  const searchable = aliasText ? text + "\n" + aliasText : text;
  const hay = caseSensitive ? searchable : searchable.toLowerCase();
  const pathLower = path.toLowerCase();
  const nameLower = path.split("/").pop().toLowerCase();
  if (parsed.path.some((p) => !pathLower.includes(p))) return false;
  if (parsed.file.some((p) => !nameLower.includes(p))) return false;
  if (parsed.tags.some((t) => {
    for (const tag of noteTags(text)) {
      if (tag === t || tag.startsWith(t + "/")) return false;
    }
    return true;
  })) return false;
  if (parsed.props.some((spec) => {
    const parsedProps = parseProps(text);
    if (!parsedProps) return true;
    const splitAt = spec.indexOf(":");
    const key = splitAt >= 0 ? spec.slice(0, splitAt) : spec;
    const wanted = splitAt >= 0 ? spec.slice(splitAt + 1) : null;
    const found = parsedProps.props.find(([name]) => name.toLowerCase() === key);
    if (!found) return true;
    return wanted != null && !String(found[1]).toLowerCase().includes(wanted);
  })) return false;
  for (const id of parsed.blocks) {
    const needle = caseSensitive ? id : id.toLowerCase();
    if (!hay.includes("^" + needle)) return false;
  }
  for (const spec of parsed.tasks) {
    const words = spec.text.split(/\s+/).filter(Boolean).map((word) => caseSensitive ? word : word.toLowerCase());
    let found = false;
    for (const line of searchable.split(/\r?\n/)) {
      const match = line.match(/^\s*(?:[-*+]|\d+[.)])\s+\[(.)\]\s+(.*)$/);
      if (!match) continue;
      const done = match[1] !== " ";
      if (spec.state === "todo" && done) continue;
      if (spec.state === "done" && !done) continue;
      const body = caseSensitive ? match[2] : match[2].toLowerCase();
      if (words.every((word) => body.includes(word))) { found = true; break; }
    }
    if (!found) return false;
  }
  if (parsed.not.some((t) => hay.includes(caseSensitive ? t : t.toLowerCase()))) return false;
  for (const spec of parsed.regex) {
    let re;
    try {
      const flags = spec.flags.replace(/g/g, "") + (caseSensitive || spec.flags.includes("i") ? "" : "i");
      re = new RegExp(spec.source, flags);
    } catch { return false; }
    if (!re.test(searchable)) return false;
  }
  for (const group of parsed.line) {
    if (!group) continue;
    const words = group.split(/\s+/).filter(Boolean).map((word) => caseSensitive ? word : word.toLowerCase());
    if (!words.length) continue;
    let found = false;
    for (const line of searchable.split(/\r?\n/)) {
      const hayLine = caseSensitive ? line : line.toLowerCase();
      if (words.every((word) => hayLine.includes(word))) { found = true; break; }
    }
    if (!found) return false;
  }
  for (const group of parsed.section) {
    if (!group) continue;
    const words = group.split(/\s+/).filter(Boolean).map((word) => caseSensitive ? word : word.toLowerCase());
    if (words.length && !sectionContains(searchable, words, caseSensitive)) return false;
  }
  const needles = [...parsed.phrases, ...parsed.terms].map((needle) => caseSensitive ? needle : needle.toLowerCase());
  if (needles.some((needle) => !hay.includes(needle))) return false;
  return true;
}

/* ---------------- workspaces ---------------- */
function readWorkspaces() {
  try {
    const data = JSON.parse(store.get("workspaces", "{}"));
    return data && typeof data === "object" && !Array.isArray(data) ? data : {};
  } catch { return {}; }
}

function snapshotWorkspace() {
  const widths = state.groups.map((_, index) => {
    if (index === 0) return null;
    if (index === 1) {
      const match = String($("pane2").style.flex || "").match(/(\d+)px/);
      return match ? Number(match[1]) : null;
    }
    const pane = getPane(index);
    const width = pane && pane.wrapper ? pane.wrapper.getBoundingClientRect().width : 0;
    return width > 0 ? Math.round(width) : null;
  });
  return {
    groups: state.groups.map((group) => ({ tabs: group.tabs.slice(), active: group.active, stacked: !!group.stacked })),
    pane2Width: widths[1],
    widths,
    mode: state.mode,
    leftTab: store.get("leftTab", "files"),
    rightTab: store.get("rightTab", "backlink"),
    noLeft: document.body.classList.contains("no-left"),
    noRight: document.body.classList.contains("no-right"),
    mobileGroup: state.mobileGroup,
  };
}

function saveWorkspaceNamed(name) {
  const clean = String(name || "").trim();
  if (!clean) return false;
  const map = readWorkspaces();
  map[clean] = { at: Date.now(), layout: snapshotWorkspace() };
  store.set("workspaces", JSON.stringify(map));
  return true;
}

async function applyWorkspaceLayout(layout) {
  if (!layout || !Array.isArray(layout.groups)) return false;
  store.set("workspace", JSON.stringify({ v: 1, groups: layout.groups, pane2Width: layout.pane2Width, widths: layout.widths }));
  const restored = await restoreWorkspace();
  if (!restored) return false;
  if (layout.mode) setMode(layout.mode);
  if (layout.leftTab) showPane(layout.leftTab);
  if (layout.rightTab) openRightTab(layout.rightTab);
  document.body.classList.toggle("no-left", !!layout.noLeft);
  document.body.classList.toggle("no-right", !!layout.noRight);
  applyMobilePane();
  return true;
}

async function loadWorkspaceNamed(name) {
  const entry = readWorkspaces()[name];
  if (!entry) { toast("Немає workspace: " + name); return false; }
  const ok = await applyWorkspaceLayout(entry.layout);
  if (ok) toast("workspace: " + name);
  return ok;
}

function deleteWorkspaceNamed(name) {
  const map = readWorkspaces();
  delete map[name];
  store.set("workspaces", JSON.stringify(map));
}

function renderWorkspaces() {
  const host = $("workspacesList");
  if (!host) return;
  host.innerHTML = "";
  const entries = Object.entries(readWorkspaces()).sort((a, b) => (b[1].at || 0) - (a[1].at || 0));
  if (!entries.length) { host.appendChild(el("div", "empty", "Ще немає збережених розкладок.")); return; }
  for (const [name, entry] of entries) {
    const row = el("div", "recovery-row");
    const meta = el("div", "recovery-meta");
    meta.append(el("span", "recovery-time", name), el("span", "recovery-len", entry.at ? new Date(entry.at).toLocaleString() : ""));
    const actions = el("div", "recovery-actions");
    const open = el("button", "ghost-border", "Відкрити");
    open.onclick = async () => { await loadWorkspaceNamed(name); closeModals(); };
    const del = el("button", "ghost-border", "Видалити");
    del.onclick = () => { deleteWorkspaceNamed(name); renderWorkspaces(); };
    actions.append(open, del);
    row.append(meta, actions);
    host.appendChild(row);
  }
}

function openWorkspacesModal() {
  renderWorkspaces();
  openModal("workspacesModal");
}

function saveCurrentWorkspace() {
  const raw = prompt("Назва розкладки:", "Розкладка " + new Date().toLocaleDateString());
  if (!raw || !raw.trim()) return;
  if (saveWorkspaceNamed(raw)) {
    renderWorkspaces();
    toast("workspace збережено: " + raw.trim());
  }
}

function openRandomNote() {
  const notes = state.files.filter((path) => path.endsWith(".md"));
  if (!notes.length) { toast("Немає нотаток"); return; }
  openNote(notes[Math.floor(Math.random() * notes.length)]);
}

/* ---------------- web viewer ---------------- */
const webView = { history: [], index: -1, url: "" };

function normalizeUrl(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  if (/^https?:\/\//i.test(raw)) return raw;
  if (/^[\w-]+(\.[\w-]+)+/.test(raw)) return "https://" + raw;
  return "";
}

function updateWebNav() {
  const back = $("webBack");
  const forward = $("webForward");
  if (!back || !forward) return;
  back.disabled = webView.index <= 0;
  forward.disabled = webView.index >= webView.history.length - 1;
}

function webNavigate(url, push = true) {
  const clean = normalizeUrl(url);
  if (!clean) { toast("Потрібен http(s) URL"); return ""; }
  if (push) {
    webView.history = webView.history.slice(0, webView.index + 1);
    if (webView.history[webView.history.length - 1] !== clean) webView.history.push(clean);
    webView.index = webView.history.length - 1;
  }
  webView.url = clean;
  $("webAddress").value = clean;
  $("webFrame").src = clean;
  updateWebNav();
  setView("web");
  $("stPath").textContent = clean;
  document.title = clean + " · Vault";
  return clean;
}

function openWebViewer(url) {
  webView.history = [];
  webView.index = -1;
  return webNavigate(url);
}

function webBack() {
  if (webView.index <= 0) return;
  webView.index -= 1;
  webView.url = webView.history[webView.index];
  $("webAddress").value = webView.url;
  $("webFrame").src = webView.url;
  updateWebNav();
  $("stPath").textContent = webView.url;
}

function webForward() {
  if (webView.index >= webView.history.length - 1) return;
  webView.index += 1;
  webView.url = webView.history[webView.index];
  $("webAddress").value = webView.url;
  $("webFrame").src = webView.url;
  updateWebNav();
  $("stPath").textContent = webView.url;
}

function webReload() {
  if (webView.url) $("webFrame").src = webView.url;
}

function closeWebViewer() {
  $("webFrame").src = "about:blank";
  updateWebNav();
  setView("note");
  paint();
}

function initWebViewer() {
  if (!$("webHost")) return;
  $("webGo").onclick = () => webNavigate($("webAddress").value);
  $("webAddress").addEventListener("keydown", (event) => {
    if (event.key === "Enter") { event.preventDefault(); webNavigate($("webAddress").value); }
  });
  $("webBack").onclick = webBack;
  $("webForward").onclick = webForward;
  $("webReload").onclick = webReload;
  $("webExternal").onclick = () => { if (webView.url) window.open(webView.url, "_blank", "noopener"); };
  $("webClose").onclick = closeWebViewer;
}

/* ---------------- slides ---------------- */
const slides = { open: false, items: [], index: 0, path: null };

function splitSlides(body) {
  const lines = String(body).split(/\r?\n/);
  const out = [];
  let current = [];
  for (const line of lines) {
    if (/^---\s*$/.test(line)) {
      out.push(current.join("\n"));
      current = [];
    } else {
      current.push(line);
    }
  }
  out.push(current.join("\n"));
  return out;
}

function renderSlide() {
  const stage = $("slidesStage");
  if (!stage) return;
  const md = slides.items[slides.index] || "";
  stage.innerHTML = "";
  const article = document.createElement("article");
  article.className = "markdown-preview-view";
  const sizer = document.createElement("div");
  sizer.className = "markdown-preview-sizer";
  sizer.innerHTML = markdownToHtml(md);
  article.appendChild(sizer);
  stage.appendChild(article);
  styleCallouts(sizer);
  wireRendered(sizer, md);
  renderMathIn(sizer);
  renderMermaidIn(sizer);
  sizer.querySelectorAll(".internal-link[data-target]").forEach((a) => {
    const previous = a.onclick;
    a.onclick = async (event) => {
      stopSlides();
      if (previous) await previous(event);
    };
  });
  $("slidesCounter").textContent = (slides.index + 1) + " / " + slides.items.length;
}

function startSlides() {
  const file = currentFile();
  if (!file) { toast("Спочатку відкрий нотатку"); return; }
  if (!/\.md$/i.test(file.path)) { toast("Слайди працюють лише для Markdown-нотаток"); return; }
  const parsed = parseProps(file.text);
  const body = parsed ? parsed.body : file.text;
  slides.items = splitSlides(body);
  if (!slides.items.length) slides.items = [""];
  slides.index = 0;
  slides.path = file.path;
  slides.open = true;
  $("slidesHost").classList.add("show");
  $("slidesHost").setAttribute("aria-hidden", "false");
  document.body.classList.add("slides-open");
  renderSlide();
}

function stopSlides() {
  if (!slides.open) return;
  slides.open = false;
  $("slidesHost").classList.remove("show");
  $("slidesHost").setAttribute("aria-hidden", "true");
  document.body.classList.remove("slides-open");
  $("slidesStage").innerHTML = "";
  if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
}

function slideStep(delta) {
  if (!slides.open) return;
  const next = Math.max(0, Math.min(slides.items.length - 1, slides.index + delta));
  if (next === slides.index) return;
  slides.index = next;
  renderSlide();
}

function toggleSlidesFullscreen() {
  if (document.fullscreenElement) {
    document.exitFullscreen().catch(() => {});
  } else if (document.documentElement.requestFullscreen) {
    document.documentElement.requestFullscreen().catch(() => {});
  }
}

function handleSlidesKey(event) {
  if (!slides.open) return false;
  const key = event.key;
  if (key === "Escape") { event.preventDefault(); event.stopImmediatePropagation(); stopSlides(); return true; }
  if (["ArrowRight", "ArrowDown", "PageDown", " ", "Enter"].includes(key)) { event.preventDefault(); event.stopImmediatePropagation(); slideStep(1); return true; }
  if (["ArrowLeft", "ArrowUp", "PageUp", "Backspace"].includes(key)) { event.preventDefault(); event.stopImmediatePropagation(); slideStep(-1); return true; }
  if (key === "Home") { event.preventDefault(); event.stopImmediatePropagation(); slides.index = 0; renderSlide(); return true; }
  if (key === "End") { event.preventDefault(); event.stopImmediatePropagation(); slides.index = slides.items.length - 1; renderSlide(); return true; }
  if (key.toLowerCase() === "f") { event.preventDefault(); event.stopImmediatePropagation(); toggleSlidesFullscreen(); return true; }
  return false;
}

function initSlides() {
  const host = $("slidesHost");
  if (!host) return;
  $("slidesPrev").onclick = (event) => { event.stopPropagation(); slideStep(-1); };
  $("slidesNext").onclick = (event) => { event.stopPropagation(); slideStep(1); };
  $("slidesClose").onclick = (event) => { event.stopPropagation(); stopSlides(); };
  $("slidesFull").onclick = (event) => { event.stopPropagation(); toggleSlidesFullscreen(); };
  host.addEventListener("click", (event) => {
    if (!slides.open) return;
    if (event.target.closest("a, button, input, textarea, select, video, audio, iframe")) return;
    const rect = host.getBoundingClientRect();
    slideStep(event.clientX >= rect.left + rect.width / 2 ? 1 : -1);
  });
}

/* ---------------- palette / switcher ---------------- */
let paletteItems = [], paletteActive = 0, switcherItems = [], switcherActive = 0;

function openModal(id) { $("overlay").classList.add("show"); $(id).classList.add("show"); }
function closeModals() { $("overlay").classList.remove("show"); ["palette", "switcher", "settings", "collabModal", "recoveryModal", "workspacesModal"].forEach((id) => $(id).classList.remove("show")); }

function showPalette() {
  $("paletteInput").value = "";
  paletteActive = 0;
  renderPalette();
  openModal("palette");
  $("paletteInput").focus();
}
function fuzzyScore(text, query) {
  if (!query) return 1;
  const hay = String(text || "").toLowerCase();
  let score = 0;
  let at = 0;
  let streak = 0;
  for (const ch of query) {
    const idx = hay.indexOf(ch, at);
    if (idx < 0) return 0;
    score += 2;
    if (idx === at) { streak += 1; score += streak; } else { streak = 0; }
    if (idx === 0 || /[\s\-_/]/.test(hay[idx - 1])) score += 3;
    at = idx + 1;
  }
  return score;
}

function readRecentCommands() {
  try {
    const list = JSON.parse(store.get("recentCommands", "[]"));
    return Array.isArray(list) ? list.filter((id) => typeof id === "string") : [];
  } catch { return []; }
}

function rememberCommand(id) {
  if (!id) return;
  const list = readRecentCommands().filter((item) => item !== id);
  list.unshift(id);
  store.set("recentCommands", JSON.stringify(list.slice(0, 12)));
}

function runPaletteCommand(cmd) {
  if (!cmd) return;
  rememberCommand(cmd.id);
  closeModals();
  cmd.run();
}

function renderPalette() {
  const q = $("paletteInput").value.trim().toLowerCase();
  const list = $("paletteList");
  list.innerHTML = "";
  const recent = readRecentCommands();
  const ranked = state.commands
    .filter((c) => !c.plugin || isCoreEnabled(c.plugin))
    .map((cmd) => ({ cmd, score: q ? fuzzyScore(cmd.label, q) : 1 }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => {
      if (!q) {
        const ai = recent.indexOf(a.cmd.id);
        const bi = recent.indexOf(b.cmd.id);
        if (ai >= 0 && bi < 0) return -1;
        if (bi >= 0 && ai < 0) return 1;
        if (ai >= 0 && bi >= 0) return ai - bi;
      }
      return b.score - a.score || a.cmd.label.localeCompare(b.cmd.label, "uk");
    });
  paletteItems = ranked.map((entry) => entry.cmd);
  paletteActive = Math.min(paletteActive, Math.max(0, paletteItems.length - 1));
  paletteItems.forEach((cmd, i) => {
    const item = el("div", "item" + (i === paletteActive ? " active" : ""), cmd.label);
    if (cmd.hint) item.appendChild(el("span", "hint", cmd.hint));
    item.onclick = () => runPaletteCommand(cmd);
    list.appendChild(item);
  });
  if (!paletteItems.length) list.appendChild(el("div", "empty", "нічого не знайдено"));
}

let switcherMode = "open";
let linkPos = null;
function showSwitcher(mode) {
  switcherMode = mode === "link" ? "link" : mode === "template" ? "template" : mode === "merge" ? "merge" : "open";
  linkPos = null;
  if (switcherMode === "link") linkPane = activePane;
  $("switcherInput").value = "";
  $("switcherInput").placeholder = switcherMode === "link" ? "Вставити [[посилання]] на…" : switcherMode === "template" ? "Вставити шаблон…" : switcherMode === "merge" ? "Обʼєднати з нотаткою…" : "Перейти до нотатки…";
  switcherActive = 0;
  renderSwitcher();
  openModal("switcher");
  $("switcherInput").focus();
}
function chooseSwitcherItem(path) {
  if (!path) return;
  if (path.startsWith("__new__:")) {
    const name = path.slice(8);
    closeModals();
    createNoteNamed(name);
    return;
  }
  closeModals();
  if (switcherMode === "template") {
    switcherMode = "open";
    if (dailyApi) dailyApi.insertTemplate(path);
    return;
  }
  if (switcherMode === "merge") {
    switcherMode = "open";
    mergeIntoNote(path);
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
      const aliases = switcherMode === "open" ? noteAliases(state.index.get(path) || "") : [];
      const aliasHit = aliases.find((alias) => alias.toLowerCase().includes(q)) || "";
      let score = 0;
      if (!q) score = 1;
      else if (name === q) score = 100;
      else if (name.startsWith(q)) score = 80;
      else if (name.includes(q)) score = 60;
      else if (aliasHit && aliasHit.toLowerCase() === q) score = 55;
      else if (aliasHit) score = 45;
      else if (path.toLowerCase().includes(q)) score = 30;
      return { path, score, aliasHit };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score);
  switcherItems = scored.map((s) => s.path);
  const createName = switcherMode === "open" ? q : "";
  if (createName && !switcherItems.some((path) => path.split("/").pop().replace(/\.md$/i, "").toLowerCase() === createName)) {
    switcherItems.push("__new__:" + createName);
  }
  switcherActive = Math.min(switcherActive, Math.max(0, switcherItems.length - 1));
  switcherItems.slice(0, 80).forEach((path, i) => {
    const item = el("div", "item" + (i === switcherActive ? " active" : ""));
    if (path.startsWith("__new__:")) {
      item.appendChild(el("span", null, "➕"));
      item.appendChild(el("span", null, "Створити нотатку «" + path.slice(8) + "»"));
    } else {
      item.appendChild(el("span", null, switcherMode === "template" ? "🧾" : path.endsWith(".canvas") ? "🎨" : path.endsWith(".base") ? "🗃" : "📄"));
      item.appendChild(el("span", null, switcherMode === "template" ? path.replace(/\.md$/, "") : path.replace(/\.(md|canvas)$/, "")));
      const info = scored.find((entry) => entry.path === path);
      if (info && info.aliasHit) item.appendChild(el("span", "hint", info.aliasHit));
    }
    item.onclick = () => {
      chooseSwitcherItem(path);
    };
    list.appendChild(item);
  });
  if (!switcherItems.length) list.appendChild(el("div", "empty", switcherMode === "template" ? "нема шаблонів у теці" : "нічого не знайдено"));
}

/* ---------------- panes / modes ---------------- */
const LEFT_TAB_PLUGINS = { files: "file-explorer", search: "global-search", bookmarks: "bookmarks", tags: "tag-pane", plugins: null };

function showPane(pane) {
  const LEFT_TABS = ["files", "search", "bookmarks", "tags", "plugins"].filter((id) => !LEFT_TAB_PLUGINS[id] || isCoreEnabled(LEFT_TAB_PLUGINS[id]));
  if (!LEFT_TABS.length) LEFT_TABS.push("files");
  if (!LEFT_TABS.includes(pane)) pane = LEFT_TABS[0];
  store.set("leftTab", pane);
  ["files", "search", "bookmarks", "tags", "plugins"].forEach((p) => { const node = $(p + "Pane"); if (node) node.style.display = p === pane ? "" : "none"; });
  const toolbar = $("leftToolbar");
  if (toolbar) toolbar.style.display = pane === "files" ? "flex" : "none";
  renderLeftTabs();
  if (pane === "tags") renderTags();
  if (pane === "bookmarks") renderBookmarks();
  if (pane === "plugins") emit("plugins:pane");
}

function renderLeftTabs() {
  const host = $("leftTabs");
  if (!host) return;
  const tabs = [
    { id: "files", label: "Files", icon: "🗂", plugin: "file-explorer" },
    { id: "search", label: "Search", icon: "🔍", plugin: "global-search" },
    { id: "bookmarks", label: "Bookmarks", icon: "🔖", plugin: "bookmarks" },
    { id: "tags", label: "Tags", icon: "🏷", plugin: "tag-pane" },
    { id: "plugins", label: "Plugins", icon: "🧩", plugin: null },
  ].filter((tab) => !tab.plugin || isCoreEnabled(tab.plugin));
  const stored = store.get("leftTab", "files");
  const active = tabs.some((tab) => tab.id === stored) ? stored : (tabs[0] ? tabs[0].id : "files");
  host.innerHTML = "";
  for (const tab of tabs) {
    const head = el("div", "workspace-tab-header tappable" + (tab.id === active ? " is-active" : ""));
    head.dataset.type = tab.id;
    head.setAttribute("aria-label", tab.label);
    head.title = tab.label;
    const inner = el("div", "workspace-tab-header-inner");
    const icon = el("div", "workspace-tab-header-inner-icon", tab.icon);
    const title = el("div", "workspace-tab-header-inner-title", tab.label);
    inner.append(icon, title);
    head.appendChild(inner);
    head.onclick = () => showPane(tab.id);
    host.appendChild(head);
  }
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
const toggleTheme = () => {
  const actual = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
  store.set("theme", actual);
  theme();
};

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

/* ---------------- bases ---------------- */
let jsyamlPromise = null;
let basePath = null;
let baseConfig = null;
let baseViewIndex = 0;
let baseSort = null;
let baseCollapsedGroups = new Set();

const BASE_DEFAULT_YAML = [
  "filters:",
  "  and: []",
  "views:",
  "  - type: table",
  "    name: Table",
  "    order:",
  "      - file.name",
  "      - tags",
  "      - status",
  "      - project",
  "",
].join("\n");

function ensureJsYaml() {
  if (window.jsyaml) return Promise.resolve(window.jsyaml);
  if (jsyamlPromise) return jsyamlPromise;
  jsyamlPromise = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "https://cdn.jsdelivr.net/npm/js-yaml@4.1.0/dist/js-yaml.min.js";
    script.async = true;
    script.onload = () => window.jsyaml ? resolve(window.jsyaml) : reject(new Error("js-yaml missing"));
    script.onerror = () => reject(new Error("js-yaml load failed"));
    document.head.appendChild(script);
  });
  return jsyamlPromise;
}

function baseNormalizeKey(key) {
  const text = String(key || "").trim();
  if (text === "file.name" || text === "name") return { key: "name", label: "Файл", source: "file" };
  if (text === "file.path" || text === "path") return { key: "path", label: "Шлях", source: "file" };
  if (text === "file.tags" || text === "tags") return { key: "tags", label: "Теги", source: "tags" };
  if (text === "file.ext") return { key: "ext", label: "Тип", source: "file" };
  if (text.startsWith("file.")) return { key: text.slice(5), label: text.slice(5), source: "file" };
  if (text.startsWith("note.")) return { key: text.slice(5), label: text.slice(5), source: "prop" };
  if (text.startsWith("formula.")) return { key: text.slice(8), label: text.slice(8), source: "formula" };
  return { key: text, label: text, source: "prop" };
}

function baseCellValue(row, column) {
  if (!row || !column) return "";
  if (column.source === "file") return row.file[column.key] ?? "";
  if (column.source === "tags") return row.tags.join(", ");
  if (column.source === "formula") return row.formulas ? (row.formulas[column.key] ?? "") : "";
  if (column.source === "prop") return row.props[column.key] ?? "";
  return "";
}

function baseProperty(row, key) {
  const text = String(key || "");
  if (text === "file.name") return row.file.name;
  if (text === "file.path") return row.file.path;
  if (text === "file.folder") return row.file.path.includes("/") ? row.file.path.slice(0, row.file.path.lastIndexOf("/")) : "";
  if (text === "file.ext") return row.file.ext;
  if (text === "tags" || text === "file.tags") return row.tags;
  if (text.startsWith("note.")) return row.props[text.slice(5)] ?? "";
  return row.props[text] ?? "";
}

function baseNumber(value) {
  if (typeof value === "number") return value;
  if (typeof value === "boolean") return value ? 1 : 0;
  const number = Number(String(value ?? "").trim().replace(",", "."));
  return Number.isFinite(number) ? number : 0;
}

function baseText(value) {
  if (value == null) return "";
  if (Array.isArray(value)) return value.join(", ");
  if (typeof value === "boolean") return value ? "true" : "false";
  return String(value);
}

function baseTruthy(value) {
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === "string") return value.trim() !== "" && value.trim() !== "false" && value.trim() !== "0";
  return !!value;
}

function baseTokenize(source) {
  const text = String(source || "");
  const tokens = [];
  const re = /\s*(?:(\d+(?:\.\d+)?)|("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')|([A-Za-z_\u0400-\u04FF][A-Za-z0-9_.\u0400-\u04FF-]*)|(==|!=|>=|<=|&&|\|\||[-+*/%<>!(),]))/g;
  let index = 0;
  let match;
  while ((match = re.exec(text))) {
    if (match.index !== index) throw new Error("unexpected token");
    index = re.lastIndex;
    if (match[1] !== undefined) tokens.push({ type: "number", value: Number(match[1]) });
    else if (match[2] !== undefined) tokens.push({ type: "string", value: match[2].slice(1, -1).replace(/\\(.)/g, "$1") });
    else if (match[3] !== undefined) tokens.push({ type: "ident", value: match[3] });
    else tokens.push({ type: "op", value: match[4] });
  }
  if (text.slice(index).trim()) throw new Error("unexpected token");
  return tokens;
}

function baseEvalFormula(expression, row, resolveFormula) {
  let tokens = [];
  try { tokens = baseTokenize(expression); } catch { return ""; }
  let pos = 0;
  const peek = () => tokens[pos];
  const take = (value) => {
    const token = tokens[pos];
    if (!token) return null;
    if (value != null && token.value !== value) return null;
    pos += 1;
    return token;
  };
  function resolve(name) {
    if (name === "true") return true;
    if (name === "false") return false;
    if (name === "null") return null;
    if (name.startsWith("formula.")) return resolveFormula ? resolveFormula(name.slice(8)) : "";
    return baseProperty(row, name);
  }
  function call(name, args) {
    const lower = String(name).toLowerCase();
    if (lower === "if") return baseTruthy(args[0]) ? args[1] : args[2];
    if (lower === "round") {
      const digits = args[1] == null ? 0 : Math.max(0, Math.min(10, baseNumber(args[1])));
      const factor = Math.pow(10, digits);
      return Math.round(baseNumber(args[0]) * factor) / factor;
    }
    if (lower === "min") return Math.min(...args.map(baseNumber));
    if (lower === "max") return Math.max(...args.map(baseNumber));
    if (lower === "number") return baseNumber(args[0]);
    if (lower === "string") return baseText(args[0]);
    if (lower === "upper") return baseText(args[0]).toUpperCase();
    if (lower === "lower") return baseText(args[0]).toLowerCase();
    if (lower === "length") return Array.isArray(args[0]) ? args[0].length : baseText(args[0]).length;
    if (lower === "contains") return baseText(args[0]).toLowerCase().includes(baseText(args[1]).toLowerCase());
    if (lower === "startswith") return baseText(args[0]).toLowerCase().startsWith(baseText(args[1]).toLowerCase());
    if (lower === "endswith") return baseText(args[0]).toLowerCase().endsWith(baseText(args[1]).toLowerCase());
    if (lower === "coalesce") return args.find((value) => baseTruthy(value)) ?? "";
    if (lower === "default") return baseTruthy(args[0]) ? args[0] : args[1];
    if (lower === "now") return new Date().toISOString();
    if (lower === "today") return new Date().toISOString().slice(0, 10);
    return "";
  }
  function primary() {
    const token = peek();
    if (!token) throw new Error("end");
    if (token.type === "number" || token.type === "string") { pos += 1; return token.value; }
    if (token.value === "(") { pos += 1; const value = expressionValue(); if (!take(")")) throw new Error(")"); return value; }
    if (token.value === "!") { pos += 1; return !baseTruthy(primary()); }
    if (token.value === "-") { pos += 1; return -baseNumber(primary()); }
    if (token.type === "ident") {
      pos += 1;
      if (peek() && peek().value === "(") {
        pos += 1;
        const args = [];
        if (!(peek() && peek().value === ")")) {
          args.push(expressionValue());
          while (take(",")) args.push(expressionValue());
        }
        take(")");
        return call(token.value, args);
      }
      return resolve(token.value);
    }
    throw new Error("primary");
  }
  function product() {
    let value = primary();
    for (;;) {
      const token = peek();
      if (!token || !["*", "/", "%"].includes(token.value)) break;
      pos += 1;
      const right = primary();
      if (token.value === "*") value = baseNumber(value) * baseNumber(right);
      else if (token.value === "/") value = baseNumber(right) === 0 ? 0 : baseNumber(value) / baseNumber(right);
      else value = baseNumber(value) % baseNumber(right);
    }
    return value;
  }
  function sum() {
    let value = product();
    for (;;) {
      const token = peek();
      if (!token || (token.value !== "+" && token.value !== "-")) break;
      pos += 1;
      const right = product();
      if (token.value === "+") {
        const a = baseText(value);
        const b = baseText(right);
        const leftNumber = Number(a.trim().replace(",", "."));
        const rightNumber = Number(b.trim().replace(",", "."));
        const numeric = a.trim() !== "" && b.trim() !== "" && Number.isFinite(leftNumber) && Number.isFinite(rightNumber);
        value = numeric ? leftNumber + rightNumber : a + b;
      } else {
        value = baseNumber(value) - baseNumber(right);
      }
    }
    return value;
  }
  function compare() {
    let value = sum();
    for (;;) {
      const token = peek();
      if (!token || !["<", ">", "<=", ">="].includes(token.value)) break;
      pos += 1;
      const right = sum();
      const a = baseNumber(value);
      const b = baseNumber(right);
      if (token.value === "<") value = a < b;
      else if (token.value === ">") value = a > b;
      else if (token.value === "<=") value = a <= b;
      else value = a >= b;
    }
    return value;
  }
  function equality() {
    let value = compare();
    for (;;) {
      const token = peek();
      if (!token || (token.value !== "==" && token.value !== "!=")) break;
      pos += 1;
      const right = compare();
      const a = baseText(value);
      const b = baseText(right);
      const leftNumber = Number(a.trim().replace(",", "."));
      const rightNumber = Number(b.trim().replace(",", "."));
      const equal = a.toLowerCase() === b.toLowerCase() ||
        (a.trim() !== "" && b.trim() !== "" && Number.isFinite(leftNumber) && Number.isFinite(rightNumber) && leftNumber === rightNumber);
      value = token.value === "==" ? equal : !equal;
    }
    return value;
  }
  function andValue() {
    let value = equality();
    while (peek() && peek().value === "&&") {
      pos += 1;
      const right = equality();
      value = baseTruthy(value) && baseTruthy(right);
    }
    return value;
  }
  function expressionValue() {
    let value = andValue();
    while (peek() && peek().value === "||") {
      pos += 1;
      const right = andValue();
      value = baseTruthy(value) || baseTruthy(right);
    }
    return value;
  }
  try {
    const value = expressionValue();
    return pos === tokens.length ? baseText(value) : baseText(value);
  } catch { return ""; }
}

function baseComputeFormulas(config, rows) {
  const defs = config && config.formulas && typeof config.formulas === "object" ? config.formulas : {};
  const names = Object.keys(defs);
  if (!names.length) return;
  const cache = new WeakMap();
  function valueFor(row, name, stack) {
    if (cache.has(row) && cache.get(row).has(name)) return cache.get(row).get(name);
    if (stack.includes(name)) return "";
    const next = stack.concat(name);
    let value = "";
    try { value = baseEvalFormula(defs[name], row, (key) => valueFor(row, key, next)); } catch { value = ""; }
    if (!cache.has(row)) cache.set(row, new Map());
    cache.get(row).set(name, value);
    return value;
  }
  for (const row of rows) {
    row.formulas = {};
    for (const name of names) row.formulas[name] = valueFor(row, name, []);
  }
}

function baseSummaryValue(rows, column, spec) {
  const name = String(spec || "").trim().toLowerCase();
  const values = rows.map((row) => baseCellValue(row, column));
  const numbers = values
    .map((value) => Number(String(value ?? "").trim().replace(",", ".")))
    .filter((value) => Number.isFinite(value));
  if (name === "sum") return String(numbers.reduce((a, b) => a + b, 0));
  if (name === "average" || name === "avg" || name === "mean") {
    return numbers.length ? String(Math.round((numbers.reduce((a, b) => a + b, 0) / numbers.length) * 100) / 100) : "";
  }
  if (name === "min") return numbers.length ? String(Math.min(...numbers)) : "";
  if (name === "max") return numbers.length ? String(Math.max(...numbers)) : "";
  if (name === "count") return String(values.filter((value) => baseText(value).trim() !== "").length);
  if (name === "empty") return String(values.filter((value) => baseText(value).trim() === "").length);
  if (name === "unique") return String(new Set(values.map((value) => baseText(value)).filter(Boolean)).size);
  if (name === "checked") return String(values.filter((value) => baseTruthy(value)).length);
  if (name === "unchecked") return String(values.filter((value) => !baseTruthy(value)).length);
  return "";
}

function baseFilterMatch(expr, row) {
  if (expr == null) return true;
  if (Array.isArray(expr)) return expr.every((item) => baseFilterMatch(item, row));
  if (typeof expr === "object") {
    if (Array.isArray(expr.and) && !expr.and.every((item) => baseFilterMatch(item, row))) return false;
    if (Array.isArray(expr.or) && !expr.or.some((item) => baseFilterMatch(item, row))) return false;
    if (Array.isArray(expr.not) && expr.not.some((item) => baseFilterMatch(item, row))) return false;
    return true;
  }
  const text = String(expr).trim();
  if (!text) return true;
  if (text.startsWith("!")) return !baseFilterMatch(text.slice(1), row);
  if (text === "true") return true;
  if (text === "false") return false;
  let match = text.match(/^file\.hasTag\(["'](.*?)["']\)$/i);
  if (match) return row.tags.some((tag) => tag === match[1] || tag.startsWith(match[1] + "/"));
  match = text.match(/^file\.inFolder\(["'](.*?)["']\)$/i);
  if (match) return row.file.path.startsWith(match[1].replace(/\/+$/, "") + "/");
  match = text.match(/^file\.name\s*(==|!=)\s*["'](.*?)["']$/i);
  if (match) return (row.file.name === match[2]) === (match[1] === "==");
  match = text.match(/^([A-Za-z0-9_\u0400-\u04FF-]+)\.contains\(["'](.*?)["']\)$/i);
  if (match) return String(row.props[match[1]] ?? "").toLowerCase().includes(match[2].toLowerCase());
  match = text.match(/^([A-Za-z0-9_\u0400-\u04FF-]+)\s*(==|!=)\s*["']?(.*?)["']?$/);
  if (match) {
    const value = String(row.props[match[1]] ?? "").trim();
    return (value === String(match[3]).trim()) === (match[2] === "==");
  }
  return true;
}

function baseRowsFromDocs(docs) {
  return docs.map(({ path, text }) => {
    const parsed = parseProps(text || "");
    const props = {};
    if (parsed) for (const [key, value] of parsed.props) props[key] = value;
    return {
      path,
      file: { name: noteName(path), path, ext: path.split(".").pop() || "" },
      props,
      tags: [...noteTags(text || "")],
    };
  });
}

function baseColumns(view, rows) {
  let order = Array.isArray(view.order) ? view.order.slice() : [];
  if (!order.length) {
    order = ["file.name"];
    const seen = new Set(["name"]);
    for (const row of rows) {
      for (const key of Object.keys(row.props)) {
        if (seen.has(key)) continue;
        seen.add(key);
        order.push(key);
        if (order.length >= 7) break;
      }
      if (order.length >= 7) break;
    }
  }
  return order.map((entry) => {
    if (entry && typeof entry === "object" && entry.property) {
      const column = baseNormalizeKey(entry.property);
      if (entry.displayName) column.label = entry.displayName;
      return column;
    }
    return baseNormalizeKey(entry);
  });
}

function baseBuild(config, docs) {
  const rows = baseRowsFromDocs(docs);
  baseComputeFormulas(config, rows);
  const views = Array.isArray(config.views) && config.views.length ? config.views : [{ type: "table", name: "Table", order: [] }];
  const view = views[Math.min(Math.max(0, baseViewIndex), views.length - 1)] || views[0];
  let filtered = rows.filter((row) => baseFilterMatch(config.filters, row));
  const columns = baseColumns(view, filtered);
  const search = ($("baseSearch")?.value || "").trim().toLowerCase();
  if (search) {
    filtered = filtered.filter((row) => columns.some((column) => String(baseCellValue(row, column)).toLowerCase().includes(search)));
  }
  const sortSpecs = [];
  if (baseSort) {
    sortSpecs.push(baseSort);
  } else if (Array.isArray(view.sort)) {
    for (const item of view.sort) {
      if (typeof item === "string") sortSpecs.push({ key: item.replace(/^-/, ""), dir: item.startsWith("-") ? -1 : 1 });
      else if (item && item.property) sortSpecs.push({ key: item.property, dir: String(item.direction).toLowerCase() === "desc" ? -1 : 1 });
    }
  }
  if (sortSpecs.length) {
    filtered = filtered.slice().sort((a, b) => {
      for (const spec of sortSpecs) {
        const column = baseNormalizeKey(spec.key);
        const av = String(baseCellValue(a, column)).toLowerCase();
        const bv = String(baseCellValue(b, column)).toLowerCase();
        if (av < bv) return -1 * spec.dir;
        if (av > bv) return 1 * spec.dir;
      }
      return 0;
    });
  }
  return { rows: filtered, columns, view, views };
}

function renderBaseCards(data) {
  const host = $("baseCards");
  if (!host) return;
  host.innerHTML = "";
  for (const row of data.rows.slice(0, 300)) {
    const card = el("div", "base-card");
    card.onclick = () => openNote(row.path);
    card.appendChild(el("div", "base-card-title", row.file.name));
    for (const column of data.columns) {
      if (column.source === "file" && column.key === "name") continue;
      const line = el("div", "base-card-prop");
      line.appendChild(el("span", "key", column.label));
      const value = el("span", "val");
      if (column.source === "tags") {
        for (const tag of row.tags) {
          const chip = el("a", "tag", "#" + tag);
          chip.onclick = (event) => {
            event.stopPropagation();
            $("searchInput").value = "tag:#" + tag;
            showPane("search");
            runSearch();
          };
          value.appendChild(chip);
        }
      } else {
        value.textContent = String(baseCellValue(row, column));
      }
      line.appendChild(value);
      card.appendChild(line);
    }
    host.appendChild(card);
  }
}

function renderBaseView(data) {
  const isCards = (data.view.type || "table") === "cards";
  const table = $("baseTable");
  const cards = $("baseCards");
  if (table) table.style.display = isCards ? "none" : "";
  if (cards) cards.style.display = isCards ? "grid" : "none";
  if (isCards) renderBaseCards(data);
  else renderBaseTable(data);
  const empty = $("baseEmpty");
  if (empty) {
    empty.style.display = data.rows.length ? "none" : "";
    empty.textContent = data.rows.length ? "" : "Немає рядків за цим фільтром";
  }
  const count = $("baseCount");
  if (count) count.textContent = data.rows.length + " рядків";
}

function renderBaseTable(data) {
  const table = $("baseTable");
  if (!table) return;
  const thead = table.querySelector("thead");
  const tbody = table.querySelector("tbody");
  thead.innerHTML = "";
  tbody.innerHTML = "";
  const headRow = document.createElement("tr");
  for (const column of data.columns) {
    const th = el("th", null, column.label);
    th.title = "Сортувати за " + column.label;
    th.onclick = () => {
      const same = baseSort && baseSort.key === column.key;
      baseSort = { key: column.key, dir: same && baseSort.dir === 1 ? -1 : 1 };
      renderBase();
    };
    headRow.appendChild(th);
  }
  thead.appendChild(headRow);
  const buildRow = (row) => {
    const tr = document.createElement("tr");
    for (const column of data.columns) {
      const td = document.createElement("td");
      if (column.source === "file" && column.key === "name") {
        td.className = "base-file";
        td.textContent = row.file.name;
      } else if (column.source === "tags") {
        for (const tag of row.tags) {
          const chip = el("a", "tag", "#" + tag);
          chip.onclick = (event) => {
            event.stopPropagation();
            $("searchInput").value = "tag:#" + tag;
            showPane("search");
            runSearch();
          };
          td.appendChild(chip);
        }
      } else {
        td.textContent = String(baseCellValue(row, column));
      }
      tr.appendChild(td);
    }
    tr.onclick = () => openNote(row.path);
    return tr;
  };
  const rows = data.rows.slice(0, 500);
  const groupSpec = data.view && data.view.groupBy;
  const groupKey = typeof groupSpec === "string" ? groupSpec : (groupSpec && groupSpec.property ? groupSpec.property : "");
  const groupColumn = groupKey ? baseNormalizeKey(groupKey) : null;
  if (groupColumn) {
    const groups = new Map();
    for (const row of rows) {
      const value = String(baseCellValue(row, groupColumn)).trim() || "—";
      if (!groups.has(value)) groups.set(value, []);
      groups.get(value).push(row);
    }
    const entries = [...groups.entries()].sort((a, b) => a[0].localeCompare(b[0], "uk", { numeric: true }));
    for (const [value, list] of entries) {
      const collapsed = baseCollapsedGroups.has(value);
      const head = document.createElement("tr");
      head.className = "base-group-row" + (collapsed ? " is-collapsed" : "");
      const cell = document.createElement("td");
      cell.colSpan = Math.max(1, data.columns.length);
      cell.append(
        el("span", "base-group-toggle", collapsed ? "▸" : "▾"),
        el("span", "base-group-name", value),
        el("span", "base-group-count", String(list.length))
      );
      head.appendChild(cell);
      head.onclick = (event) => {
        event.stopPropagation();
        if (baseCollapsedGroups.has(value)) baseCollapsedGroups.delete(value);
        else baseCollapsedGroups.add(value);
        renderBaseTable(data);
      };
      tbody.appendChild(head);
      if (!collapsed) for (const row of list) tbody.appendChild(buildRow(row));
    }
  } else {
    for (const row of rows) tbody.appendChild(buildRow(row));
  }
  let tfoot = table.querySelector("tfoot");
  if (!tfoot) { tfoot = document.createElement("tfoot"); table.appendChild(tfoot); }
  tfoot.innerHTML = "";
  const summaries = data.view && data.view.summaries && typeof data.view.summaries === "object" ? data.view.summaries : null;
  if (summaries) {
    const footRow = document.createElement("tr");
    for (const column of data.columns) {
      const td = document.createElement("td");
      const candidates = [
        column.source === "formula" ? "formula." + column.key : column.source === "file" ? "file." + column.key : column.source === "tags" ? "tags" : column.key,
        column.key,
        "property." + column.key,
      ];
      const key = candidates.find((item) => Object.prototype.hasOwnProperty.call(summaries, item));
      if (key) td.textContent = baseSummaryValue(data.rows, column, summaries[key]);
      footRow.appendChild(td);
    }
    tfoot.appendChild(footRow);
  }
  const empty = $("baseEmpty");
  if (empty) {
    empty.style.display = data.rows.length ? "none" : "";
    empty.textContent = data.rows.length ? "" : "Немає рядків за цим фільтром";
  }
  const count = $("baseCount");
  if (count) count.textContent = data.rows.length + " рядків";
}

function baseColumnKey(column) {
  if (column.source === "formula") return "formula." + column.key;
  if (column.source === "file") return "file." + column.key;
  if (column.source === "tags") return "tags";
  return column.key;
}

function renderBaseControls(data) {
  const select = $("baseViewSelect");
  if (select) {
    select.innerHTML = "";
    data.views.forEach((view, index) => {
      const option = document.createElement("option");
      option.value = String(index);
      option.textContent = view.name || ("View " + (index + 1));
      select.appendChild(option);
    });
    select.value = String(Math.min(baseViewIndex, data.views.length - 1));
  }
  const groupSelect = $("baseGroupBy");
  if (groupSelect) {
    groupSelect.innerHTML = "";
    const none = document.createElement("option");
    none.value = "";
    none.textContent = "Без груп";
    groupSelect.appendChild(none);
    for (const column of data.columns) {
      const option = document.createElement("option");
      option.value = baseColumnKey(column);
      option.textContent = column.label;
      groupSelect.appendChild(option);
    }
    const groupBy = data.view && data.view.groupBy;
    const current = groupBy ? (typeof groupBy === "string" ? groupBy : (groupBy.property || "")) : "";
    groupSelect.value = current;
  }
  const summarySelect = $("baseSummary");
  if (summarySelect) {
    const summaries = data.view && data.view.summaries;
    const values = summaries && typeof summaries === "object" ? Object.values(summaries).filter((value) => typeof value === "string") : [];
    summarySelect.value = values.length && values.every((value) => value.toLowerCase() === values[0].toLowerCase()) ? values[0].toLowerCase() : "";
  }
}

function baseDocs() {
  const docs = [];
  for (const path of state.files) {
    if (!path.endsWith(".md")) continue;
    const text = state.index.get(path);
    if (text != null) docs.push({ path, text });
  }
  return docs;
}

async function renderBase() {
  if (!baseConfig) return;
  await ensureIndex();
  const docs = baseDocs();
  const data = baseBuild(baseConfig, docs);
  renderBaseControls(data);
  const filterInput = $("baseFilter");
  if (filterInput && document.activeElement !== filterInput) {
    const filters = baseConfig.filters;
    filterInput.value = typeof filters === "string"
      ? filters
      : Array.isArray(filters) && filters.every((item) => typeof item === "string")
        ? filters.join(" ")
        : "";
  }
  const name = $("baseName");
  if (name) name.textContent = (basePath ? noteName(basePath) : "Base") + " · " + (data.view.name || "Table");
  renderBaseView(data);
}

async function openBase(path) {
  let text = state.index.get(path);
  if (text == null) {
    try {
      const got = await ghGet(path);
      text = got.text;
      state.index.set(path, text);
    } catch (error) { toast("Не відкрилось: " + error.message); return; }
  }
  let config = {};
  try {
    const yaml = await ensureJsYaml();
    const parsed = yaml.load(text);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) config = parsed;
  } catch { config = {}; }
  basePath = path;
  baseConfig = config;
  baseViewIndex = 0;
  baseSort = null;
  setView("base");
  await renderBase();
}

async function createBase() {
  const raw = prompt("Назва бази (можна з текою):", "Нова база");
  if (!raw) return;
  let path = raw.trim().replace(/^\/+/, "");
  if (!path) return;
  if (!path.endsWith(".base")) path += ".base";
  try {
    await ghPut(path, BASE_DEFAULT_YAML, null, "add base " + path);
    state.pending.add(path);
    await loadTree();
    await openBase(path);
    toast("базу створено: " + path);
  } catch (error) { toast("Не вийшло: " + error.message); }
}

function renderBasePreview(config, docs, viewIndex = 0) {
  basePath = null;
  baseConfig = config || {};
  baseViewIndex = Math.max(0, Number(viewIndex) || 0);
  baseSort = null;
  setView("base");
  const data = baseBuild(baseConfig, docs || []);
  renderBaseControls(data);
  renderBaseView(data);
  return {
    rows: data.rows.length,
    columns: data.columns.length,
    keys: data.columns.map((column) => column.source + ":" + column.key),
    paths: data.rows.map((row) => row.path),
    viewType: data.view.type || "table",
  };
}

/* ---------------- API for modules ---------------- */
export const Vault = {
  state, api, ghGet, ghPut, ghPutRaw, ghDelete, b64encode, b64decode,
  contentsPath, loadAttachment, showCtx, hideCtx, openNote, openCanvas, openGraph, toast, setState, currentFile,
  saveNote, ensureIndex, registerCommand, addRibbonButton, on, emit, loadTree, listAll,
  renderTree, renderTabs, paint, renderPreview, renderRightPanels, renderTags, showPane, showSwitcher,
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

function escapeAttr(value) {
  return escapeHtml(String(value)).replace(/"/g, "&quot;").replace(/'/g, "&#39;");
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
    const row = el("div", "tree-item");
    const btn = el("div", "tree-item-self is-clickable outline-item l" + item.level);
    btn.style.paddingInlineStart = 6 + (item.level - 1) * 14 + "px";
    const inner = el("div", "tree-item-inner", item.text);
    btn.appendChild(inner);
    btn.title = "рядок " + (item.line + 1);
    btn.onclick = () => jumpToLine(item.line);
    row.appendChild(btn);
    host.appendChild(row);
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
  syncLiveCopies(0, file);
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
    const unit = editorIndentUnit();
    const s = ed.selectionStart;
    const t = ed.selectionEnd;
    if (e.shiftKey) {
      const start = ed.value.lastIndexOf("\n", s - 1) + 1;
      let end = ed.value.indexOf("\n", t);
      if (end === -1) end = ed.value.length;
      const block = ed.value.slice(start, end);
      const next = block.split("\n").map((line) => line.replace(/^(\t| {1,4})/, "")).join("\n");
      if (next !== block) {
        ed.value = ed.value.slice(0, start) + next + ed.value.slice(end);
        ed.selectionStart = start;
        ed.selectionEnd = start + next.length;
        ed.dispatchEvent(new Event("input"));
      }
      return;
    }
    if (s !== t && ed.value.slice(s, t).includes("\n")) {
      const start = ed.value.lastIndexOf("\n", s - 1) + 1;
      let end = ed.value.indexOf("\n", t);
      if (end === -1) end = ed.value.length;
      const block = ed.value.slice(start, end);
      const next = block.split("\n").map((line) => unit + line).join("\n");
      ed.value = ed.value.slice(0, start) + next + ed.value.slice(end);
      ed.selectionStart = start;
      ed.selectionEnd = start + next.length;
    } else {
      ed.value = ed.value.slice(0, s) + unit + ed.value.slice(t);
      ed.selectionStart = ed.selectionEnd = s + unit.length;
    }
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
  if (e.altKey && e.key === "Enter") {
    e.preventDefault();
    followLinkUnderCursor();
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

function editorLiveActive() {
  const file = currentFile();
  return !!(file && state.mode === "live" && liveApi && livePath === file.path);
}

function currentEditorText() {
  if (editorLiveActive()) return liveApi.getText();
  return $("editor").value;
}

function applyEditorTextChange(from, to, insert, selFrom, selTo) {
  const file = currentFile();
  if (!file) { toast("Спочатку відкрий нотатку"); return false; }
  if (editorLiveActive()) {
    liveApi.replaceRange(from, to, insert);
    if (Number.isFinite(selFrom)) liveApi.select(selFrom, Number.isFinite(selTo) ? selTo : selFrom);
    return true;
  }
  const ed = $("editor");
  const text = ed.value;
  ed.value = text.slice(0, from) + insert + text.slice(to);
  const anchor = Number.isFinite(selFrom) ? selFrom : from + insert.length;
  const head = Number.isFinite(selTo) ? selTo : anchor;
  ed.selectionStart = Math.min(anchor, head);
  ed.selectionEnd = Math.max(anchor, head);
  ed.dispatchEvent(new Event("input", { bubbles: true }));
  ed.focus();
  return true;
}

function selectionLineContext() {
  const file = currentFile();
  if (!file) { toast("Спочатку відкрий нотатку"); return null; }
  if (editorLiveActive()) {
    const sel = liveApi.selection();
    const text = liveApi.getText();
    const start = sel.from === 0 ? 0 : text.lastIndexOf("\n", sel.from - 1) + 1;
    let endIndex = text.indexOf("\n", sel.to);
    let end = endIndex === -1 ? text.length : endIndex;
    if (sel.to > sel.from && text[sel.to - 1] === "\n" && sel.to - 1 >= start) end = sel.to - 1;
    return { text, from: sel.from, to: sel.to, start, end };
  }
  const ed = $("editor");
  const text = ed.value;
  const start = ed.selectionStart === 0 ? 0 : text.lastIndexOf("\n", ed.selectionStart - 1) + 1;
  let endIndex = text.indexOf("\n", ed.selectionEnd);
  let end = endIndex === -1 ? text.length : endIndex;
  if (ed.selectionEnd > ed.selectionStart && text[ed.selectionEnd - 1] === "\n" && ed.selectionEnd - 1 >= start) end = ed.selectionEnd - 1;
  return { text, from: ed.selectionStart, to: ed.selectionEnd, start, end };
}

function transformSelectedLines(transform) {
  const ctx = selectionLineContext();
  if (!ctx) return;
  const block = ctx.text.slice(ctx.start, ctx.end);
  const lines = block.split("\n");
  const next = transform(lines);
  if (!next) return;
  const insert = next.join("\n");
  if (insert === block) return;
  const multi = lines.length > 1;
  const fullLines = ctx.from === ctx.start && ctx.to === ctx.end;
  let anchor;
  let head;
  if (multi || fullLines) {
    anchor = ctx.start;
    head = ctx.start + insert.length;
  } else {
    const delta = insert.length - block.length;
    anchor = Math.max(ctx.start, Math.min(ctx.start + insert.length, ctx.from + delta));
    head = Math.max(anchor, Math.min(ctx.start + insert.length, ctx.to + delta));
  }
  applyEditorTextChange(ctx.start, ctx.end, insert, anchor, head);
}

function stripListPrefix(line) {
  return line.replace(/^(\s*)(?:[-*+]|\d+[.)])\s+(?:\[.\]\s+)?/, "$1");
}

function toggleHeading(level) {
  if (!level) {
    transformSelectedLines((lines) => {
      const filled = lines.filter((line) => line.trim());
      if (!filled.length) return null;
      return lines.map((line) => (line.trim() ? line.replace(/^#{1,6}\s+/, "") : line));
    });
    return;
  }
  transformSelectedLines((lines) => {
    const filled = lines.filter((line) => line.trim());
    if (!filled.length) return null;
    const active = filled.every((line) => new RegExp("^#{" + level + "}\\s+").test(line));
    return lines.map((line) => {
      if (!line.trim()) return line;
      const bare = line.replace(/^#{1,6}\s+/, "");
      return active ? bare : "#".repeat(level) + " " + bare;
    });
  });
}

function toggleList(kind) {
  const patterns = {
    bullet: /^(\s*)([-*+])\s+(?!\[.\]\s)/,
    numbered: /^(\s*)\d+[.)]\s+/,
    task: /^(\s*)([-*+])\s+\[.\]\s+/,
  };
  const pattern = patterns[kind];
  transformSelectedLines((lines) => {
    const filled = lines.filter((line) => line.trim());
    if (!filled.length) return null;
    const all = filled.every((line) => pattern.test(line));
    let counter = 1;
    return lines.map((line) => {
      if (!line.trim()) return line;
      const indent = (line.match(/^\s*/) || [""])[0];
      const body = stripListPrefix(line).slice(indent.length);
      if (all) return indent + body;
      if (kind === "bullet") return indent + "- " + body;
      if (kind === "numbered") return indent + (counter++) + ". " + body;
      return indent + "- [ ] " + body;
    });
  });
}

function toggleQuote() {
  transformSelectedLines((lines) => {
    const filled = lines.filter((line) => line.trim());
    if (!filled.length) return null;
    const all = filled.every((line) => /^>\s?/.test(line));
    return lines.map((line) => {
      if (!line.trim()) return line;
      return all ? line.replace(/^>\s?/, "") : "> " + line;
    });
  });
}

function insertCallout() {
  const ctx = selectionLineContext();
  if (!ctx) return;
  const selected = ctx.text.slice(ctx.from, ctx.to);
  if (selected) {
    const insert = "> [!note]\n> " + selected.replace(/\n/g, "\n> ");
    applyEditorTextChange(ctx.from, ctx.to, insert, ctx.from + 3);
    return;
  }
  const prefix = ctx.from > 0 && ctx.text[ctx.from - 1] !== "\n" ? "\n" : "";
  const insert = prefix + "> [!note]\n> ";
  applyEditorTextChange(ctx.from, ctx.from, insert, ctx.from + insert.length);
}

function toggleCodeBlock() {
  const ctx = selectionLineContext();
  if (!ctx) return;
  const selected = ctx.text.slice(ctx.from, ctx.to);
  if (!selected) {
    const prefix = ctx.from > 0 && ctx.text[ctx.from - 1] !== "\n" ? "\n" : "";
    const insert = prefix + "```\n\n```";
    applyEditorTextChange(ctx.from, ctx.from, insert, ctx.from + prefix.length + 4, ctx.from + prefix.length + 4);
    return;
  }
  const stripped = selected.replace(/^```[^\n]*\n?/, "").replace(/\n?```\s*$/, "");
  if (stripped !== selected) {
    applyEditorTextChange(ctx.from, ctx.to, stripped, ctx.from, ctx.from + stripped.length);
    return;
  }
  const insert = "```\n" + selected + "\n```";
  applyEditorTextChange(ctx.from, ctx.to, insert, ctx.from + 4, ctx.from + 4 + selected.length);
}

function toggleMathBlock() {
  const ctx = selectionLineContext();
  if (!ctx) return;
  const selected = ctx.text.slice(ctx.from, ctx.to);
  if (!selected) {
    const prefix = ctx.from > 0 && ctx.text[ctx.from - 1] !== "\n" ? "\n" : "";
    const insert = prefix + "$$\n\n$$";
    applyEditorTextChange(ctx.from, ctx.from, insert, ctx.from + prefix.length + 3, ctx.from + prefix.length + 3);
    return;
  }
  const stripped = selected.replace(/^\$\$\n?/, "").replace(/\n?\$\$\s*$/, "");
  if (stripped !== selected) {
    applyEditorTextChange(ctx.from, ctx.to, stripped, ctx.from, ctx.from + stripped.length);
    return;
  }
  const insert = "$$\n" + selected + "\n$$";
  applyEditorTextChange(ctx.from, ctx.to, insert, ctx.from + 3, ctx.from + 3 + selected.length);
}

function toggleInline(marker) {
  const ctx = selectionLineContext();
  if (!ctx) return;
  const { text, from, to } = ctx;
  if (from === to) {
    applyEditorTextChange(from, from, marker + marker, from + marker.length, from + marker.length);
    return;
  }
  const selected = text.slice(from, to);
  const before = text.slice(Math.max(0, from - marker.length), from);
  const after = text.slice(to, to + marker.length);
  if (selected.length >= marker.length * 2 && selected.startsWith(marker) && selected.endsWith(marker)) {
    const inner = selected.slice(marker.length, selected.length - marker.length);
    applyEditorTextChange(from, to, inner, from, from + inner.length);
  } else if (before === marker && after === marker) {
    applyEditorTextChange(from - marker.length, to + marker.length, selected, from - marker.length, to - marker.length);
  } else {
    applyEditorTextChange(from, to, marker + selected + marker, from + marker.length, to + marker.length);
  }
}

function insertHorizontalRule() {
  const ctx = selectionLineContext();
  if (!ctx) return;
  const prefix = ctx.from > 0 && ctx.text[ctx.from - 1] !== "\n" ? "\n" : "";
  const insert = prefix + "---\n";
  applyEditorTextChange(ctx.from, ctx.from, insert, ctx.from + insert.length);
}

function insertTable() {
  const ctx = selectionLineContext();
  if (!ctx) return;
  const prefix = ctx.from > 0 && ctx.text[ctx.from - 1] !== "\n" ? "\n" : "";
  const table = "| Колонка 1 | Колонка 2 |\n| --- | --- |\n|  |  |";
  const insert = prefix + table + "\n";
  const firstCell = ctx.from + prefix.length + 2;
  applyEditorTextChange(ctx.from, ctx.from, insert, firstCell, firstCell + "Колонка 1".length);
}

function insertFootnote() {
  const ctx = selectionLineContext();
  if (!ctx) return;
  const used = [...ctx.text.matchAll(/\[\^(\d+)\]/g)].map((match) => Number(match[1]));
  const number = used.length ? Math.max(...used) + 1 : 1;
  const selected = ctx.text.slice(ctx.from, ctx.to);
  const ref = "[^" + number + "]" + (selected ? " " + selected : "");
  applyEditorTextChange(ctx.from, ctx.to, ref, ctx.from + ref.length);
  const text = currentEditorText();
  const suffix = (text.endsWith("\n") ? "" : "\n") + "\n[^" + number + "]: ";
  applyEditorTextChange(text.length, text.length, suffix, text.length + suffix.length);
}

function duplicateLines() {
  const ctx = selectionLineContext();
  if (!ctx) return;
  const block = ctx.text.slice(ctx.start, ctx.end);
  const insert = "\n" + block;
  applyEditorTextChange(ctx.end, ctx.end, insert, ctx.end + 1, ctx.end + 1 + block.length);
}

function moveLines(direction) {
  const ctx = selectionLineContext();
  if (!ctx) return;
  const text = ctx.text;
  const block = text.slice(ctx.start, ctx.end);
  if (direction < 0) {
    if (ctx.start === 0) return;
    const prevStart = text.lastIndexOf("\n", ctx.start - 2) + 1;
    const prev = text.slice(prevStart, ctx.start - 1);
    const insert = block + "\n" + prev;
    applyEditorTextChange(prevStart, ctx.end, insert, prevStart, prevStart + block.length);
    return;
  }
  if (ctx.end >= text.length) return;
  const nextEndNl = text.indexOf("\n", ctx.end + 1);
  const nextEnd = nextEndNl === -1 ? text.length : nextEndNl;
  const next = text.slice(ctx.end + 1, nextEnd);
  const insert = next + "\n" + block;
  const base = ctx.start + next.length + 1;
  applyEditorTextChange(ctx.start, nextEnd, insert, base, base + block.length);
}

function clearFormatting() {
  const ctx = selectionLineContext();
  if (!ctx) return;
  const selected = ctx.text.slice(ctx.from, ctx.to);
  if (!selected) return;
  const cleaned = selected
    .replace(/\*\*([^*\n]+)\*\*/g, "$1")
    .replace(/__([^_\n]+)__/g, "$1")
    .replace(/~~([^~\n]+)~~/g, "$1")
    .replace(/==([^=\n]+)==/g, "$1")
    .replace(/`([^`\n]+)`/g, "$1")
    .replace(/\$([^$\n]+)\$/g, "$1")
    .replace(/\*([^*\n]+)\*/g, "$1")
    .replace(/_([^_\n]+)_/g, "$1");
  applyEditorTextChange(ctx.from, ctx.to, cleaned, ctx.from, ctx.from + cleaned.length);
}

function followLinkUnderCursor() {
  const ctx = selectionLineContext();
  if (!ctx) return;
  const text = ctx.text;
  const pos = ctx.from;
  const re = /\[\[([^\]]+)\]\]/g;
  let match;
  while ((match = re.exec(text)) !== null) {
    if (pos < match.index || pos > match.index + match[0].length) continue;
    const target = match[1].split("|")[0].trim();
    const path = resolveLinkTarget(target);
    if (path) openNote(path);
    else toast("Не знайдено: " + target);
    return;
  }
  toast("Курсор не на посиланні");
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
  if (liveApis[1]) { livePaths[1] = file.path; liveApis[1].setDoc(file.text); }
  syncLiveCopies(1, file);
  renderTabs();
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

const mainDropZone = document.querySelector('main > .editor-host[data-pane="1"]');
if (mainDropZone) {
  mainDropZone.addEventListener("dragover", (event) => {
    if (![...event.dataTransfer.types].includes("text/vault-tab")) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    mainDropZone.classList.add("drop-target");
  });
  mainDropZone.addEventListener("dragleave", (event) => {
    if (!mainDropZone.contains(event.relatedTarget)) mainDropZone.classList.remove("drop-target");
  });
  mainDropZone.addEventListener("drop", (event) => {
    mainDropZone.classList.remove("drop-target");
    const path = event.dataTransfer.getData("text/vault-tab");
    const sourceIndex = parseGroupSource(event.dataTransfer.getData("text/vault-tab-source"));
    if (!path || sourceIndex <= 0) return;
    event.preventDefault();
    moveTabBetweenGroups(sourceIndex, path, 0);
  });
}

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
  const sourceIndex = parseGroupSource(event.dataTransfer.getData("text/vault-tab-source"));
  if (!path || sourceIndex < 0) return;
  event.preventDefault();
  if (sourceIndex !== 1) moveTabBetweenGroups(sourceIndex, path, 1);
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
  if (handleSlidesKey(e)) return;
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
  if (e.key === "Enter") { const cmd = paletteItems[paletteActive]; if (cmd) runPaletteCommand(cmd); }
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
$("recoveryClose").onclick = closeModals;
$("workspacesClose").onclick = closeModals;
$("workspacesSave").onclick = saveCurrentWorkspace;
$("stBacklinks").onclick = () => { if (currentFile()) openRightTab("backlink"); };
document.addEventListener("wheel", (event) => {
  const bar = event.target && event.target.closest && event.target.closest(".tabs");
  if (!bar || !event.deltaY || event.deltaX) return;
  if (bar.scrollWidth <= bar.clientWidth) return;
  event.preventDefault();
  bar.scrollLeft += event.deltaY;
}, { passive: false });
$("newNote").onclick = newNote;
$("splitBtn").onclick = () => {
  if (state.active) addPane(state.active);
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
$("searchCase").onclick = () => { store.set("searchCase", store.get("searchCase", "0") === "1" ? "0" : "1"); runSearch(); };
$("searchSort").onclick = () => { store.set("searchSort", store.get("searchSort", "name") === "hits" ? "name" : "hits"); runSearch(); };
$("searchCollapse").onclick = () => { store.set("searchCollapse", store.get("searchCollapse", "0") === "1" ? "0" : "1"); runSearch(); };
syncSearchOptions();
$("rebuildIndex").onclick = async () => { state.index.clear(); await ensureIndex(); renderRightPanels(); renderTags(); toast("індекс оновлено"); };
$("blCollapse").onclick = () => {
  const keys = ["backlink:Linked mentions", "backlink:Unlinked mentions", "outgoing:Links", "outgoing:Unlinked mentions"];
  const allCollapsed = keys.every((key) => backlinkCollapsed.has(key));
  for (const key of keys) {
    if (allCollapsed) backlinkCollapsed.delete(key);
    else backlinkCollapsed.add(key);
  }
  renderRightPanels();
};
$("blContext").onclick = () => { backlinkMoreContext = !backlinkMoreContext; renderRightPanels(); };
$("blSort").onclick = () => { backlinkSort = backlinkSort === "name" ? "count" : "name"; renderRightPanels(); };
$("blFilter").oninput = () => { clearTimeout($("blFilter")._t); $("blFilter")._t = setTimeout(renderBacklinks, 150); };
$("tagFilter").oninput = () => { clearTimeout($("tagFilter")._t); $("tagFilter")._t = setTimeout(renderTagPanel, 120); };
$("propFilter").oninput = () => { clearTimeout($("propFilter")._t); $("propFilter")._t = setTimeout(renderAllProperties, 120); };
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
$("vaultBtn").onclick = openVaultMenu;
$("openGraph").onclick = () => setView(state.view === "graph" ? "note" : "graph");
$("openCanvas").onclick = () => { const c = state.files.find((p) => p.endsWith(".canvas")); if (c) openCanvas(c); else toast("Нема .canvas — створи 🎨"); };
$("newCanvas").onclick = () => { if (canvasApi) canvasApi.create(); };
$("openBase").onclick = createBase;
$("baseViewSelect").onchange = () => { baseViewIndex = Number($("baseViewSelect").value) || 0; baseSort = null; renderBase(); };
$("baseGroupBy").onchange = () => {
  if (!baseConfig) return;
  if (!Array.isArray(baseConfig.views) || !baseConfig.views.length) {
    baseConfig.views = [{ type: "table", name: "Table", order: [] }];
  }
  const view = baseConfig.views[Math.min(baseViewIndex, baseConfig.views.length - 1)];
  const value = $("baseGroupBy").value;
  if (value) view.groupBy = value; else delete view.groupBy;
  renderBase();
};
$("baseSummary").onchange = () => {
  if (!baseConfig) return;
  if (!Array.isArray(baseConfig.views) || !baseConfig.views.length) {
    baseConfig.views = [{ type: "table", name: "Table", order: [] }];
  }
  const view = baseConfig.views[Math.min(baseViewIndex, baseConfig.views.length - 1)];
  const value = $("baseSummary").value;
  if (!value) {
    delete view.summaries;
  } else {
    const data = baseBuild(baseConfig, baseDocs());
    const numericOnly = ["sum", "average", "min", "max"].includes(value);
    view.summaries = {};
    for (const column of data.columns) {
      if (numericOnly && !data.rows.some((row) => {
        const raw = String(baseCellValue(row, column) ?? "").trim().replace(",", ".");
        return raw !== "" && Number.isFinite(Number(raw));
      })) continue;
      view.summaries[baseColumnKey(column)] = value;
    }
  }
  renderBase();
};
$("baseSave").onclick = async () => {
  if (!basePath || !baseConfig) { toast("Немає .base для збереження"); return; }
  try {
    const yaml = await ensureJsYaml();
    const text = yaml.dump(baseConfig, { lineWidth: 120 });
    const got = await ghGet(basePath);
    await ghPut(basePath, text, got.sha, "base: " + basePath);
    toast("базу збережено");
  } catch (error) { toast("Не збереглось: " + error.message); }
};
$("baseSearch").oninput = () => { clearTimeout($("baseSearch")._t); $("baseSearch")._t = setTimeout(renderBase, 150); };
$("baseFilter").oninput = () => {
  clearTimeout($("baseFilter")._t);
  $("baseFilter")._t = setTimeout(() => {
    if (!baseConfig) return;
    const value = $("baseFilter").value.trim();
    if (value) baseConfig.filters = [value];
    else delete baseConfig.filters;
    renderBase();
  }, 250);
};
$("baseRefresh").onclick = () => renderBase();
$("baseSource").onclick = () => { if (basePath) window.open(imageUrlFor(basePath), "_blank", "noopener"); };
$("newFolderBtn").onclick = () => newFolder();
$("fileSortBtn").onclick = (event) => {
  event.stopPropagation();
  const rect = event.currentTarget.getBoundingClientRect();
  const mode = store.get("fileSort", "name-asc");
  const first = store.get("foldersFirst", "1") === "1";
  showCtx(rect.left, rect.bottom + 4, [
    { label: (mode === "name-asc" ? "✓ " : "") + "Назва A→Z", run: () => { store.set("fileSort", "name-asc"); renderTree(); } },
    { label: (mode === "name-desc" ? "✓ " : "") + "Назва Z→A", run: () => { store.set("fileSort", "name-desc"); renderTree(); } },
    { sep: true },
    { label: (first ? "✓ " : "") + "Теки спочатку", run: () => { store.set("foldersFirst", first ? "0" : "1"); renderTree(); } },
  ]);
};
$("leftAddTab").onclick = (event) => {
  event.stopPropagation();
  const rect = event.currentTarget.getBoundingClientRect();
  showCtx(rect.left, rect.bottom + 4, [
    { label: "Files", run: () => showPane("files") },
    { label: "Search", run: () => showPane("search") },
    { label: "Bookmarks", run: () => showPane("bookmarks") },
    { label: "Tags", run: () => showPane("tags") },
    { label: "Plugins", run: () => showPane("plugins") },
  ]);
};
$("collapseAll").onclick = () => {
  const all = [];
  const walk = (node, prefix) => {
    for (const key of Object.keys(node)) {
      if (node[key] === null) continue;
      const full = prefix ? prefix + "/" + key : key;
      all.push(full);
      walk(node[key], full);
    }
  };
  const files = state.files.filter((p) => p.endsWith(".md") || p.endsWith(".canvas"));
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
    for (const part of parts) { if (!node[part] || node[part] === null) node[part] = {}; node = node[part]; }
  }
  walk(tree, "");
  store.set("collapsed", JSON.stringify(all));
  renderTree();
};

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

const SETTINGS_TABS = [
  { id: "about", label: "About" },
  { id: "appearance", label: "Appearance" },
  { id: "editor", label: "Editor" },
  { id: "files", label: "Files and links" },
  { id: "daily", label: "Daily notes" },
  { id: "templates", label: "Templates" },
  { id: "unique", label: "Unique note creator" },
  { id: "recorder", label: "Audio recorder" },
  { id: "hotkeys", label: "Hotkeys" },
  { id: "core", label: "Core plugins" },
  { id: "plugins", label: "Community plugins" },
];

function renderSettingsNav() {
  const host = $("settingsNav");
  if (!host) return;
  host.innerHTML = "";
  const active = store.get("settingsTab", "appearance");
  for (const tab of SETTINGS_TABS) {
    const btn = el("button", tab.id === active ? "active" : null, tab.label);
    btn.onclick = () => {
      store.set("settingsTab", tab.id);
      renderSettingsNav();
      showSettingsSection(tab.id);
    };
    host.appendChild(btn);
  }
}

function showSettingsSection(id) {
  let found = false;
  document.querySelectorAll("#settingsBody .settings-section").forEach((section) => {
    const active = section.dataset.settings === id;
    section.classList.toggle("active", active);
    if (active) found = true;
  });
  if (!found) {
    const first = document.querySelector("#settingsBody .settings-section");
    if (first) first.classList.add("active");
  }
  const title = $("settingsTitle");
  if (title) {
    const tab = SETTINGS_TABS.find((item) => item.id === id);
    title.textContent = tab ? tab.label : "Налаштування";
  }
}

function renderCorePlugins() {
  const host = $("corePluginsList");
  if (!host) return;
  host.innerHTML = "";
  for (const plugin of CORE_PLUGINS) {
    const row = el("label", "core-plugin-row");
    const input = document.createElement("input");
    input.type = "checkbox";
    input.checked = isCoreEnabled(plugin.id);
    input.onchange = () => setCoreEnabled(plugin.id, input.checked);
    const text = el("span");
    text.append(el("b", null, plugin.label), el("small", null, plugin.desc));
    row.append(input, text);
    host.appendChild(row);
  }
}

function renderCommunityPlugins() {
  const host = $("communityPluginsList");
  if (!host) return;
  host.innerHTML = "";
  const list = pluginsApi && pluginsApi.list ? pluginsApi.list() : [];
  if (!list.length) {
    host.appendChild(el("div", "empty", "Немає встановлених плагінів у .obsidian/plugins"));
    return;
  }
  for (const plugin of list) {
    const row = el("div", "plugin-row");
    const box = document.createElement("input");
    box.type = "checkbox";
    box.checked = !!plugin.enabled;
    box.onchange = async () => {
      if (!pluginsApi) return;
      if (box.checked) await pluginsApi.enable(plugin.id);
      else pluginsApi.disable(plugin.id);
      renderCommunityPlugins();
    };
    const info = el("div", "plugin-info");
    const meta = plugin.meta || {};
    info.append(el("b", null, meta.name || plugin.id), el("small", null, "v" + (meta.version || "?") + (meta.description ? " · " + meta.description : "")));
    row.append(box, info);
    host.appendChild(row);
  }
}

let snippets = [];
let snippetsLoaded = false;

async function loadSnippets() {
  const host = $("snippetList");
  if (host && !snippetsLoaded) host.textContent = "завантажую…";
  try {
    const data = await api("/repos/" + state.repo + "/contents/.obsidian/snippets?ref=" + encodeURIComponent(state.branch));
    snippets = (Array.isArray(data) ? data : []).filter((item) => item.type === "file" && item.name.endsWith(".css"));
  } catch { snippets = []; }
  snippetsLoaded = true;
  renderSnippets();
  await applySnippets();
}

function renderSnippets() {
  const host = $("snippetList");
  if (!host) return;
  host.innerHTML = "";
  if (!snippets.length) {
    host.appendChild(el("div", "empty", "Немає CSS-сніпетів у .obsidian/snippets"));
    return;
  }
  const enabled = new Set(JSON.parse(store.get("snippets", "[]")));
  for (const item of snippets) {
    const row = el("label", "snippet-row");
    const input = document.createElement("input");
    input.type = "checkbox";
    input.checked = enabled.has(item.name);
    input.onchange = () => {
      const next = new Set(JSON.parse(store.get("snippets", "[]")));
      if (input.checked) next.add(item.name); else next.delete(item.name);
      store.set("snippets", JSON.stringify([...next]));
      applySnippets();
    };
    row.append(input, el("span", null, item.name));
    host.appendChild(row);
  }
}

async function applySnippets() {
  document.querySelectorAll("style[data-snippet]").forEach((node) => node.remove());
  let names = [];
  try { names = JSON.parse(store.get("snippets", "[]")); } catch { names = []; }
  for (const name of names) {
    const item = snippets.find((entry) => entry.name === name);
    if (!item || !item.download_url) continue;
    try {
      const res = await fetch(item.download_url);
      if (!res.ok) continue;
      const style = document.createElement("style");
      style.dataset.snippet = name;
      style.textContent = await res.text();
      document.head.appendChild(style);
    } catch { /* skip */ }
  }
}

function openSettings() {
  $("setRepo").value = state.repo;
  $("setBranch").value = state.branch;
  $("setToken").value = state.token;
  $("setTheme").value = store.get("theme", "dark");
  renderThemeOptions(activeThemeName);
  listThemes().then(() => renderThemeOptions(activeThemeName)).catch(() => {});
  $("setFont").value = store.get("font", "15");
  $("setWidth").value = store.get("width", "46rem");
  $("setGraphForce").value = store.get("graphForce", "120");
  $("setPagePreview").checked = previewEnabled();
  $("setDefaultMode").value = store.get("defaultMode", "live");
  $("setSpellcheck").checked = store.get("spellcheck", "1") !== "0";
  $("setWebLinks").checked = store.get("webLinks", "0") === "1";
  $("setAutoPairs").checked = store.get("autoPairs", "1") !== "0";
  $("setSmartLists").checked = store.get("smartLists", "1") !== "0";
  $("setStrictBreaks").checked = appCfg.strictLineBreaks === true;
  $("setUseTabs").checked = appCfg.useTab === true;
  $("setTabSize").value = String(appCfg.tabSize || 4);
  $("setPropertiesInDocument").value = appCfg.propertiesInDocument || "visible";
  $("setRecorderFolder").value = recorderApi && recorderApi.config ? recorderApi.config.folder || "" : "";
  $("setNewFileLocation").value = appCfg.newFileLocation || "root";
  $("setNewFileFolder").value = appCfg.newFileFolderPath || "";
  $("setAttachmentFolder").value = appCfg.attachmentFolderPath || "";
  const noteCfg = dailyApi && dailyApi.config ? dailyApi.config : null;
  if (noteCfg) {
    $("setDailyFolder").value = noteCfg.daily.folder || "";
    $("setDailyFormat").value = noteCfg.daily.format || "YYYY-MM-DD";
    $("setDailyTemplate").value = noteCfg.daily.template || "";
    $("setTplFolder").value = noteCfg.templates.folder || "";
    $("setTplDateFormat").value = noteCfg.templates.dateFormat || "YYYY-MM-DD";
    $("setTplTimeFormat").value = noteCfg.templates.timeFormat || "HH:mm";
    $("setUniqueFolder").value = noteCfg.unique.folder || "";
    $("setUniqueFormat").value = noteCfg.unique.format || "YYYYMMDDHHmm";
    $("setUniqueTemplate").value = noteCfg.unique.template || "";
  }
  const computed = getComputedStyle(document.documentElement).getPropertyValue("--accent").trim();
  $("setAccent").value = /^#[0-9a-f]{6}$/i.test(computed) ? computed : "#a882ff";
  renderAccentPresets();
  renderHotkeysSettings();
  renderSettingsNav();
  renderCorePlugins();
  renderCommunityPlugins();
  showSettingsSection(store.get("settingsTab", "appearance"));
  const version = $("settingsVersion");
  if (version) version.textContent = "Vault · " + BUILD + " · " + state.repo + " · " + state.branch;
  if (!snippetsLoaded) loadSnippets().catch(() => {});
  else renderSnippets();
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
$("setThemeName").addEventListener("change", () => {
  applyThemeByName($("setThemeName").value);
});
$("reloadThemes").onclick = async () => {
  const themes = await listThemes();
  renderThemeOptions(activeThemeName);
  toast("знайдено тем: " + themes.length);
};
async function writeVaultJson(path, data) {
  let sha = null;
  try {
    const got = await ghGet(path);
    sha = got.sha || null;
  } catch { sha = null; }
  await ghPut(path, JSON.stringify(data, null, 2) + "\n", sha, "settings: " + path);
}

$("saveSettings").onclick = async () => {
  store.set("repo", $("setRepo").value.trim());
  store.set("branch", $("setBranch").value.trim());
  store.set("token", $("setToken").value.trim());
  store.set("theme", $("setTheme").value);
  store.set("font", $("setFont").value);
  store.set("width", $("setWidth").value);
  store.set("accent", $("setAccent").value);
  store.set("graphForce", $("setGraphForce").value);
  store.set("pagePreview", $("setPagePreview").checked ? "1" : "0");
  store.set("defaultMode", $("setDefaultMode").value);
  store.set("spellcheck", $("setSpellcheck").checked ? "1" : "0");
  store.set("webLinks", $("setWebLinks").checked ? "1" : "0");
  store.set("autoPairs", $("setAutoPairs").checked ? "1" : "0");
  store.set("smartLists", $("setSmartLists").checked ? "1" : "0");
  appCfg.strictLineBreaks = $("setStrictBreaks").checked;
  appCfg.useTab = $("setUseTabs").checked;
  appCfg.tabSize = Number($("setTabSize").value) || 4;
  appCfg.propertiesInDocument = $("setPropertiesInDocument").value;
  store.set("hotkeys", JSON.stringify(hotkeys));
  try {
    await writeVaultJson(".obsidian/daily-notes.json", {
      folder: $("setDailyFolder").value.trim(),
      format: $("setDailyFormat").value.trim() || "YYYY-MM-DD",
      template: $("setDailyTemplate").value.trim(),
    });
    await writeVaultJson(".obsidian/templates.json", {
      folder: $("setTplFolder").value.trim() || "templates",
      dateFormat: $("setTplDateFormat").value.trim() || "YYYY-MM-DD",
      timeFormat: $("setTplTimeFormat").value.trim() || "HH:mm",
    });
    await writeVaultJson(".obsidian/zk-prefixer.json", {
      folder: $("setUniqueFolder").value.trim(),
      format: $("setUniqueFormat").value.trim() || "YYYYMMDDHHmm",
      template: $("setUniqueTemplate").value.trim(),
    });
    await writeVaultJson(".obsidian/audio-recorder.json", {
      folder: $("setRecorderFolder").value.trim(),
    });
    let appRaw = {};
    try {
      const got = await ghGet(".obsidian/app.json");
      appRaw = JSON.parse(got.text) || {};
      if (!appRaw || typeof appRaw !== "object" || Array.isArray(appRaw)) appRaw = {};
    } catch { appRaw = {}; }
    appRaw.newFileLocation = $("setNewFileLocation").value;
    appRaw.newFileFolderPath = $("setNewFileFolder").value.trim();
    appRaw.attachmentFolderPath = $("setAttachmentFolder").value.trim();
    appRaw.strictLineBreaks = appCfg.strictLineBreaks;
    appRaw.useTab = appCfg.useTab;
    appRaw.tabSize = appCfg.tabSize;
    appRaw.propertiesInDocument = appCfg.propertiesInDocument;
    await writeVaultJson(".obsidian/app.json", appRaw);
    let appearanceRaw = {};
    try {
      const got = await ghGet(".obsidian/appearance.json");
      appearanceRaw = JSON.parse(got.text) || {};
      if (!appearanceRaw || typeof appearanceRaw !== "object" || Array.isArray(appearanceRaw)) appearanceRaw = {};
    } catch { appearanceRaw = {}; }
    appearanceRaw.cssTheme = $("setThemeName").value;
    await writeVaultJson(".obsidian/appearance.json", appearanceRaw);
  } catch (error) {
    toast("Налаштування нотаток: " + error.message);
  }
  theme(); applyPrefs();
  saveVault();
  closeModals();
  location.reload();
};
$("openPluginsPane").onclick = () => { closeModals(); showPane("plugins"); };
$("reloadPlugins").onclick = async () => {
  if (!pluginsApi) { renderCommunityPlugins(); return; }
  try { await pluginsApi.rescan(); } catch { /* ignore */ }
  renderCommunityPlugins();
};
$("reloadSnippets").onclick = () => { snippetsLoaded = false; loadSnippets(); };
$("mobLeft").onclick = toggleLeft;
$("mobBack").onclick = goBack;
$("mobFwd").onclick = goFwd;
$("mobSwitcher").onclick = () => showSwitcher();
$("mobNew").onclick = newNote;
$("mobMenu").onclick = (event) => {
  event.stopPropagation();
  const rect = event.currentTarget.getBoundingClientRect();
  showCtx(rect.left, rect.top - 8, [
    { label: "Палітра команд", run: showPalette },
    { label: "Пошук", run: () => { showPane("search"); setTimeout(() => $("searchInput")?.focus(), 60); } },
    { label: "Налаштування", run: openSettings },
    { label: "Права панель", run: toggleRight },
    { label: "Тема", run: toggleTheme },
    { sep: true },
    { label: "Зберегти", run: () => saveNote() },
  ]);
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
    saveVault();
    await loadTree();
    if (dailyApi) await dailyApi.loadConfigs();
    else dailyApi = await initDaily(Vault);
    window.__daily = dailyApi;
    await loadAppConfig();
    await loadAppearanceConfig();
    await loadPropertyTypes();
    recorderApi = await initRecorder(Vault);
    window.__recorder = recorderApi;
    pdfApi = initPdfViewer(Vault);
    mediaApi = initMediaViewer(Vault);
    const restored = await restoreWorkspace();
    if (!restored) {
      const first = state.files.find((p) => p.endsWith(".md"));
      if (first) await openNote(first);
      applyMobilePane();
    }
    showPane("files");
    ensureIndex().then(() => { renderTags(); renderRightPanels(); emit("index"); }).catch(() => {});
    initGraph(Vault);
    canvasApi = initCanvas(Vault);
    initSlides();
    initWebViewer();
    initCollab(Vault);
    initPlugins(Vault).then((api) => { pluginsApi = api; renderCommunityPlugins(); }).catch(() => {});
    loadSnippets().catch(() => {});
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
registerCommand({ id: "web-viewer", label: "Відкрити Web viewer", hint: "URL", plugin: "webviewer", run: () => {
  const url = prompt("URL для Web viewer:", "https://");
  if (url) openWebViewer(url);
} });
registerCommand({ id: "slides", label: "Почати презентацію", hint: "Slides", plugin: "slides", run: startSlides });
registerCommand({ id: "format-html-md", label: "Форматування: HTML → Markdown", plugin: "format-converter", run: convertHtmlToMarkdown });
registerCommand({ id: "format-md-html", label: "Форматування: Markdown → HTML", plugin: "format-converter", run: convertMarkdownToHtml });
registerCommand({ id: "import-files", label: "Імпортувати файли", plugin: "importer", run: openImportPicker });
registerCommand({ id: "stack-tabs", label: "Скласти / розкласти вкладки", hint: "Stack tabs", run: () => toggleStackedTabs() });
registerCommand({ id: "graph", label: "Graph view", hint: "Ctrl+G", plugin: "graph", run: () => {
  const localToggle = $("graphLocal");
  if (state.view === "graph") { setView("note"); return; }
  if (localToggle) { localToggle.checked = false; localToggle.dispatchEvent(new Event("change")); }
  setView("graph");
} });
registerCommand({ id: "local-graph", label: "Відкрити локальний граф", hint: "Local graph", plugin: "graph", run: () => {
  const localToggle = $("graphLocal");
  if (localToggle) { localToggle.checked = true; localToggle.dispatchEvent(new Event("change")); }
  setView("graph");
} });
registerCommand({ id: "canvas", label: "Відкрити canvas", run: () => { const c = state.files.find((p) => p.endsWith(".canvas")); if (c) openCanvas(c); else toast("Нема .canvas"); } });
registerCommand({ id: "create-base", label: "Bases: створити базу", run: createBase });
registerCommand({ id: "base-refresh", label: "Bases: оновити базу", run: () => { if (state.view === "base") renderBase(); } });
registerCommand({ id: "bookmark", label: "Додати/зняти закладку", run: () => { if (state.active) toggleBookmark(state.active); } });
registerCommand({ id: "bookmark-heading", label: "Bookmarks: додати поточний заголовок", plugin: "bookmarks", run: bookmarkCurrentHeading });
registerCommand({ id: "bookmark-search", label: "Bookmarks: додати поточний пошук", plugin: "bookmarks", run: bookmarkCurrentSearch });
registerCommand({ id: "bookmark-group", label: "Bookmarks: нова група", plugin: "bookmarks", run: createBookmarkGroup });
registerCommand({ id: "split", label: "Друга панель (розділити екран)", run: () => { if (state.active) addPane(state.active); else toast("відкрий нотатку"); } });
registerCommand({ id: "new-folder", label: "Нова тека", run: newFolder });
registerCommand({ id: "task", label: "Вставити чекбокс", hint: "- [ ]", run: () => insertAtCursor("\n- [ ] ") });
registerCommand({ id: "bold", label: "Жирний", hint: "Ctrl+B", run: () => { wrapSelection("**"); } });
registerCommand({ id: "italic", label: "Курсив", hint: "Ctrl+I", run: () => { wrapSelection("*"); } });
registerCommand({ id: "fmt-heading-1", label: "Форматування: заголовок 1", run: () => toggleHeading(1) });
registerCommand({ id: "fmt-heading-2", label: "Форматування: заголовок 2", run: () => toggleHeading(2) });
registerCommand({ id: "fmt-heading-3", label: "Форматування: заголовок 3", run: () => toggleHeading(3) });
registerCommand({ id: "fmt-heading-4", label: "Форматування: заголовок 4", run: () => toggleHeading(4) });
registerCommand({ id: "fmt-heading-5", label: "Форматування: заголовок 5", run: () => toggleHeading(5) });
registerCommand({ id: "fmt-heading-6", label: "Форматування: заголовок 6", run: () => toggleHeading(6) });
registerCommand({ id: "fmt-heading-none", label: "Форматування: прибрати заголовок", run: () => toggleHeading(0) });
registerCommand({ id: "fmt-list-bullet", label: "Форматування: маркований список", run: () => toggleList("bullet") });
registerCommand({ id: "fmt-list-number", label: "Форматування: нумерований список", run: () => toggleList("numbered") });
registerCommand({ id: "fmt-list-task", label: "Форматування: список завдань", run: () => toggleList("task") });
registerCommand({ id: "fmt-quote", label: "Форматування: цитата", run: toggleQuote });
registerCommand({ id: "fmt-callout", label: "Форматування: вставити виноску-блок", run: insertCallout });
registerCommand({ id: "fmt-code-block", label: "Форматування: блок коду", run: toggleCodeBlock });
registerCommand({ id: "fmt-math-block", label: "Форматування: блок формул", run: toggleMathBlock });
registerCommand({ id: "fmt-inline-code", label: "Форматування: код у рядку", hint: "`", run: () => toggleInline("`") });
registerCommand({ id: "fmt-strike", label: "Форматування: закреслений", run: () => toggleInline("~~") });
registerCommand({ id: "fmt-highlight", label: "Форматування: виділений", run: () => toggleInline("==") });
registerCommand({ id: "fmt-math", label: "Форматування: формула в рядку", run: () => toggleInline("$") });
registerCommand({ id: "fmt-comment", label: "Форматування: коментар", run: () => toggleInline("%%") });
registerCommand({ id: "fmt-hr", label: "Форматування: горизонтальна лінія", run: insertHorizontalRule });
registerCommand({ id: "fmt-table", label: "Форматування: вставити таблицю", run: insertTable });
registerCommand({ id: "fmt-footnote", label: "Форматування: вставити виноску", run: insertFootnote });
registerCommand({ id: "fmt-clear", label: "Форматування: очистити форматування", run: clearFormatting });
registerCommand({ id: "line-duplicate", label: "Рядок: дублювати", run: duplicateLines });
registerCommand({ id: "line-move-up", label: "Рядок: перемістити вгору", run: () => moveLines(-1) });
registerCommand({ id: "line-move-down", label: "Рядок: перемістити вниз", run: () => moveLines(1) });
registerCommand({ id: "follow-link", label: "Перейти за посиланням під курсором", hint: "Alt+Enter", run: followLinkUnderCursor });
registerCommand({ id: "find", label: "Знайти в нотатці", hint: "Ctrl+F", run: openFind });
registerCommand({ id: "replace", label: "Замінити в нотатці", hint: "Ctrl+H", run: () => { openFind(); $("replaceInput").focus(); } });
registerCommand({ id: "link-note", label: "Вставити [[посилання]]", hint: "[[", run: () => showSwitcher("link") });
registerCommand({ id: "outline-copy", label: "Скопіювати заголовки нотатки", run: () => $("copyOutline").click() });
registerCommand({ id: "theme", label: "Перемкнути тему", run: toggleTheme });
registerCommand({ id: "left", label: "Показати/сховати ліву панель", hint: "Ctrl+B", run: toggleLeft });
registerCommand({ id: "right", label: "Показати/сховати праву панель", run: toggleRight });
registerCommand({ id: "reload", label: "Оновити список файлів", run: () => loadTree() });
registerCommand({ id: "index", label: "Перебудувати індекс звʼязків", run: async () => { state.index.clear(); await ensureIndex(); renderRightPanels(); renderTags(); toast("індекс оновлено"); } });
registerCommand({ id: "show-backlinks", label: "Backlinks: показати згадки", run: () => openRightTab("backlink") });
registerCommand({ id: "show-outgoing", label: "Outgoing links: показати посилання", run: () => openRightTab("outgoing-link") });
registerCommand({ id: "show-tags", label: "Tags: показати теги", run: () => openRightTab("tag") });
registerCommand({ id: "show-properties", label: "Properties: усі властивості", run: () => openRightTab("all-properties") });
registerCommand({ id: "show-outline", label: "Outline: показати структуру", run: () => openRightTab("outline") });
registerCommand({ id: "extract", label: "Note composer: витягнути виділене", run: extractSelection });
registerCommand({ id: "merge", label: "Note composer: обʼєднати з іншою нотаткою", run: () => showSwitcher("merge") });
registerCommand({ id: "recovery", label: "File recovery: історія версій", run: openRecovery });
registerCommand({ id: "collab", label: "Спільна робота (real-time)", hint: "👥", run: () => emit("collab:open") });
registerCommand({ id: "workspaces-save", label: "Workspaces: зберегти поточний", plugin: "workspaces", run: saveCurrentWorkspace });
registerCommand({ id: "workspaces-open", label: "Workspaces: відкрити", plugin: "workspaces", run: openWorkspacesModal });
registerCommand({ id: "random-note", label: "Random note: випадкова нотатка", plugin: "random-note", run: openRandomNote });
registerCommand({ id: "logout", label: "Забути токен і вийти", run: () => { store.del("token"); location.reload(); } });

liveApi = initLive({
  getText: () => (currentFile() ? currentFile().text : ""),
  onChange: (text, prev) => {
    const file = currentFile();
    if (!file) return;
    file.text = text;
    $("editor").value = text;
    if (live2Path === file.path) live2Api?.setDoc(text);
    syncLiveCopies(0, file);
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
  autoPairs: store.get("autoPairs", "1") !== "0",
  smartLists: store.get("smartLists", "1") !== "0",
  indentUnit: editorIndentUnit(),
  onLinkTrigger: (pos) => { linkPane = 1; showSwitcher("link"); linkPos = pos; },
  onFocus: () => { activePane = 1; },
  onFollowLink: followLinkUnderCursor,
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
    file.dirty = true;
    state.index.set(file.path, text);
    setState("не збережено", "warn");
    syncHighlight2();
    syncLiveCopies(1, file);
    renderTabs();
    clearTimeout($("editor2")._t);
    $("editor2")._t = setTimeout(() => saveNote(true, file), 1500);
    emit("modify", { path: file.path, text, prev });
  },
  onCursor: (line, ch) => {
    const node = $("stCursor");
    if (node) node.textContent = line + ":" + ch;
  },
  onOpenNote: openTargetNote,
  imageUrl: imageUrlFor,
  autoPairs: store.get("autoPairs", "1") !== "0",
  smartLists: store.get("smartLists", "1") !== "0",
  indentUnit: editorIndentUnit(),
  onLinkTrigger: (pos) => { linkPane = 2; showSwitcher("link"); linkPos = pos; },
  onFocus: () => { activePane = 2; },
});

setupPaneRefs();

theme();
applyPrefs();
setMode(store.get("mode", store.get("defaultMode", window.innerWidth <= 980 ? "edit" : "live")));
renderBookmarks();
renderVaultButton();
updateSplitButtons();$("repo").value = state.repo;
$("branch").value = state.branch;
$("token").value = state.token;
$("connect").onclick = () => connect($("repo").value, $("branch").value, $("token").value, true);
$("token").addEventListener("keydown", (e) => { if (e.key === "Enter") $("connect").click(); });
$("forget").onclick = () => { store.del("token"); $("token").value = ""; toast("токен видалено"); };
if (state.token) connect(state.repo, state.branch, state.token, false);
window.__vaultDebug = { markdownToHtml, renderMathIn, renderMermaidIn, parseProps, extractSection, anchorLine, scrollToAnchor, wireRendered, baseBuild, baseRowsFromDocs, baseFilterMatch, renderBasePreview, liveApi, live2Api, snapshotWorkspace, toggleStackedTabs, htmlToMarkdown, importFiles, saveWorkspaceNamed, loadWorkspaceNamed, applyWorkspaceLayout, readWorkspaces, openWorkspacesModal, openRandomNote, setCoreEnabled, startSlides, stopSlides, slideStep, splitSlides, slidesState: () => ({ open: slides.open, index: slides.index, count: slides.items.length, path: slides.path }), openWebViewer, closeWebViewer, webNavigate, webBack, webForward, webState: () => ({ url: webView.url, index: webView.index, history: [...webView.history], view: state.view }), openPdf: (p) => pdfApi && pdfApi.open(p), closePdf: () => pdfApi && pdfApi.close(), pdfState: () => (pdfApi ? pdfApi.state() : null), openMedia: (p) => mediaApi && mediaApi.open(p), closeMedia: () => mediaApi && mediaApi.close(), mediaState: () => (mediaApi ? mediaApi.state() : null), createNoteNamed, appConfig: () => ({ ...appCfg }), loadAppConfig, listThemes, applyThemeByName, loadAppearanceConfig, activeTheme: () => activeThemeName, bookmarkItems: () => JSON.parse(JSON.stringify(bookmarkItems)), toggleBookmark, bookmarkCurrentHeading, bookmarkCurrentSearch, createBookmarkGroup, renderBookmarks, openBookmark, addFolderBookmark, removeBookmarkItem };
