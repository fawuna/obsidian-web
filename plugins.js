// Plugin host with an Obsidian-like API.
// Discovers .obsidian/plugins/<id>/manifest.json + main.js, loads enabled plugins,
// exposes app.vault (read/create/modify/delete/events), commands, ribbon icons and settings tabs.
let Vault = null;
let app = null;

const LEGACY_MANIFEST = "web-plugins.json";
const ENABLE_KEY = "vw-plugins-enabled";
const records = [];
let enabledIds = new Set();
try { enabledIds = new Set(JSON.parse(localStorage.getItem(ENABLE_KEY) || "[]")); } catch { enabledIds = new Set(); }

function persistEnabled() {
  localStorage.setItem(ENABLE_KEY, JSON.stringify([...enabledIds]));
}

function el(tag, cls, text) {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text != null) node.textContent = text;
  return node;
}

function normalizePath(path) {
  return String(path || "").replace(/\\/g, "/").replace(/^\/+/, "").replace(/\/+/g, "/");
}

class TFile {
  constructor(path) {
    const clean = normalizePath(path);
    const name = clean.split("/").pop();
    const dot = name.lastIndexOf(".");
    this.path = clean;
    this.name = name;
    this.basename = dot > 0 ? name.slice(0, dot) : name;
    this.extension = dot > 0 ? name.slice(dot + 1) : "";
    this.stat = { ctime: 0, mtime: 0, size: 0 };
  }
}

class TFolder {
  constructor(path) {
    this.path = normalizePath(path);
    this.name = this.path.split("/").pop();
    this.children = [];
  }
}

function fileObj(path) { return new TFile(path); }

/* ---------------- Obsidian API shim ---------------- */
class Notice {
  constructor(message) { if (Vault) Vault.toast(String(message)); }
}

class PluginSettingTab {
  constructor(appInstance, plugin) {
    this.app = appInstance;
    this.plugin = plugin;
    this.containerEl = document.createElement("div");
  }
  display() {}
  hide() {}
}

class Setting {
  constructor(containerEl) {
    this.settingEl = el("div", "setting-item");
    this.infoEl = el("div", "setting-item-info");
    this.nameEl = el("div", "setting-item-name");
    this.descEl = el("div", "setting-item-description");
    this.infoEl.append(this.nameEl, this.descEl);
    this.controlEl = el("div", "setting-item-control");
    this.settingEl.append(this.infoEl, this.controlEl);
    const parent = containerEl || document.createElement("div");
    parent.appendChild(this.settingEl);
  }
  setName(name) { this.nameEl.textContent = name; return this; }
  setDesc(desc) { this.descEl.textContent = desc; return this; }
  setHeading() { this.settingEl.classList.add("setting-item-heading"); return this; }
  setClass(cls) { this.settingEl.classList.add(cls); return this; }
  addText(cb) { const c = new TextComponent(this.controlEl); if (cb) cb(c); return this; }
  addTextArea(cb) { const c = new TextAreaComponent(this.controlEl); if (cb) cb(c); return this; }
  addToggle(cb) { const c = new ToggleComponent(this.controlEl); if (cb) cb(c); return this; }
  addButton(cb) { const c = new ButtonComponent(this.controlEl); if (cb) cb(c); return this; }
  addDropdown(cb) { const c = new DropdownComponent(this.controlEl); if (cb) cb(c); return this; }
  addSlider(cb) { const c = new SliderComponent(this.controlEl); if (cb) cb(c); return this; }
}

class TextComponent {
  constructor(parent) {
    this.inputEl = el("input", "plugin-input");
    this.inputEl.type = "text";
    parent.appendChild(this.inputEl);
  }
  setValue(value) { this.inputEl.value = value == null ? "" : String(value); return this; }
  setPlaceholder(text) { this.inputEl.placeholder = text; return this; }
  onChange(fn) { this.inputEl.addEventListener("input", () => fn(this.inputEl.value)); return this; }
}

class TextAreaComponent {
  constructor(parent) {
    this.inputEl = el("textarea", "plugin-textarea");
    parent.appendChild(this.inputEl);
  }
  setValue(value) { this.inputEl.value = value == null ? "" : String(value); return this; }
  setPlaceholder(text) { this.inputEl.placeholder = text; return this; }
  onChange(fn) { this.inputEl.addEventListener("input", () => fn(this.inputEl.value)); return this; }
}

class ToggleComponent {
  constructor(parent) {
    this.toggleEl = el("input", "plugin-toggle");
    this.toggleEl.type = "checkbox";
    parent.appendChild(this.toggleEl);
  }
  setValue(value) { this.toggleEl.checked = !!value; return this; }
  onChange(fn) { this.toggleEl.addEventListener("change", () => fn(this.toggleEl.checked)); return this; }
}

class ButtonComponent {
  constructor(parent) {
    this.buttonEl = el("button", "plugin-button");
    parent.appendChild(this.buttonEl);
  }
  setButtonText(text) { this.buttonEl.textContent = text; return this; }
  setCta() { this.buttonEl.classList.add("primary"); return this; }
  onClick(fn) { this.buttonEl.addEventListener("click", () => fn()); return this; }
}

class DropdownComponent {
  constructor(parent) {
    this.selectEl = el("select", "plugin-select");
    parent.appendChild(this.selectEl);
  }
  addOption(value, label) {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = label;
    this.selectEl.appendChild(option);
    return this;
  }
  addOptions(options) {
    for (const [value, label] of Object.entries(options)) this.addOption(value, label);
    return this;
  }
  setValue(value) { this.selectEl.value = value; return this; }
  onChange(fn) { this.selectEl.addEventListener("change", () => fn(this.selectEl.value)); return this; }
}

class SliderComponent {
  constructor(parent) {
    this.sliderEl = el("input", "plugin-slider");
    this.sliderEl.type = "range";
    this.sliderEl.min = "0";
    this.sliderEl.max = "100";
    this.sliderEl.step = "1";
    parent.appendChild(this.sliderEl);
  }
  setLimits(min, max, step) {
    this.sliderEl.min = String(min);
    this.sliderEl.max = String(max);
    this.sliderEl.step = String(step);
    return this;
  }
  setValue(value) { this.sliderEl.value = String(value); return this; }
  onChange(fn) { this.sliderEl.addEventListener("input", () => fn(Number(this.sliderEl.value))); return this; }
}

class Modal {
  constructor(appInstance) { this.app = appInstance; this.containerEl = document.createElement("div"); }
  open() {}
  close() {}
  onOpen() {}
  onClose() {}
}

class Plugin {
  constructor(appInstance, manifest) {
    this.app = appInstance;
    this.manifest = manifest;
    this._host = null;
    this._disposers = [];
    this._settingTabs = [];
  }
  async onload() {}
  async onunload() {}
  addCommand(cmd) {
    if (!this._host) throw new Error("plugin not booted");
    return this._host.addCommand(this.manifest.id, cmd);
  }
  addRibbonIcon(icon, title, callback) {
    if (!this._host) throw new Error("plugin not booted");
    return this._host.addRibbon(this.manifest.id, icon, title, callback);
  }
  addSettingTab(tab) { this._settingTabs.push(tab); }
  registerEvent(ref) {
    if (typeof ref === "function") this._disposers.push(ref);
    else if (ref && typeof ref.unload === "function") this._disposers.push(() => ref.unload());
    return ref;
  }
  registerInterval(id) {
    this._disposers.push(() => clearInterval(id));
    return id;
  }
  registerDomEvent(target, type, callback) {
    target.addEventListener(type, callback);
    const off = () => target.removeEventListener(type, callback);
    this._disposers.push(off);
    return off;
  }
  async loadData() {
    const raw = localStorage.getItem("vw-plugin-data:" + this.manifest.id);
    return raw ? JSON.parse(raw) : null;
  }
  async saveData(data) {
    localStorage.setItem("vw-plugin-data:" + this.manifest.id, JSON.stringify(data));
  }
}

const shim = {
  Plugin,
  PluginSettingTab,
  Setting,
  Notice,
  TFile,
  TFolder,
  Modal,
  MarkdownView: class MarkdownView {},
  ItemView: class ItemView {},
  normalizePath,
  Platform: { isDesktop: true, isMobile: false, isMobileApp: false },
  requestUrl: async (options) => {
    const res = await fetch(options.url, { method: options.method || "GET", headers: options.headers, body: options.body });
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch { /* not json */ }
    return { status: res.status, text, json, headers: {} };
  },
};

/* ---------------- vault event adapter ---------------- */
function subscribeVault(event, callback) {
  const internal = { open: "open", modify: "modify", save: "saved", create: "create", delete: "delete", rename: "rename" }[event];
  if (!internal) return () => {};
  return Vault.on(internal, (payload) => {
    try {
      if (event === "modify") callback(fileObj(payload.path), payload.text);
      else if (event === "save") callback(fileObj(payload));
      else if (event === "open") callback(fileObj(payload));
      else if (event === "create" || event === "delete") callback(fileObj(payload));
      else if (event === "rename") callback(fileObj(payload.to), payload.from);
    } catch (error) {
      console.warn("plugin event " + event, error);
    }
  });
}

/* ---------------- app object ---------------- */
function makeApp() {
  const pathOf = (file) => normalizePath(typeof file === "string" ? file : file && file.path);

  const read = async (file) => (await Vault.ghGet(pathOf(file))).text;
  const create = async (file, text) => {
    const path = pathOf(file);
    await Vault.ghPut(path, String(text == null ? "" : text), null, "plugin: create " + path);
    Vault.state.pending.add(path);
    await Vault.loadTree();
    Vault.emit("create", path);
    return fileObj(path);
  };
  const modify = async (file, text) => {
    const path = pathOf(file);
    const { sha } = await Vault.ghGet(path);
    const res = await Vault.ghPut(path, String(text == null ? "" : text), sha, "plugin: modify " + path);
    const open = Vault.state.open.find((f) => f.path === path);
    if (open) {
      open.text = String(text == null ? "" : text);
      open.sha = res.content.sha;
      open.dirty = false;
    }
    await Vault.loadTree();
    if (Vault.state.active === path) Vault.paint();
    Vault.emit("modify", { path, text: String(text == null ? "" : text), prev: "" });
    return fileObj(path);
  };
  const remove = async (file) => {
    const path = pathOf(file);
    const { sha } = await Vault.ghGet(path);
    await Vault.ghDelete(path, sha);
    await Vault.loadTree();
    Vault.emit("delete", path);
  };

  return {
    vault: {
      read,
      cachedRead: async (file) => {
        const path = pathOf(file);
        const cached = Vault.index.get(path);
        return cached === undefined ? read(path) : cached;
      },
      create,
      modify,
      delete: remove,
      adapter: {
        exists: async (path) => {
          try { await Vault.ghGet(normalizePath(path)); return true; } catch { return false; }
        },
        read: (path) => read(path),
        write: async (path, text) => {
          try { return await modify(path, text); } catch { return await create(path, text); }
        },
        mkdir: async () => {},
      },
      getFiles: () => Vault.files.slice().map(fileObj),
      getMarkdownFiles: () => Vault.files.filter((p) => p.endsWith(".md")).map(fileObj),
      getAbstractFileByPath: (path) => {
        const clean = normalizePath(path);
        return Vault.files.includes(clean) ? fileObj(clean) : null;
      },
      on: (event, callback) => subscribeVault(event, callback),
      getName: () => Vault.repo.split("/").pop(),
    },
    workspace: {
      getActiveFile: () => {
        const file = Vault.currentFile();
        return file ? fileObj(file.path) : null;
      },
      openLinkText: (link) => {
        const name = String(link || "").replace(/^#/, "");
        const hit = Vault.files.find((p) => p === name + ".md" || p === name || p.endsWith("/" + name + ".md"));
        if (!hit) return false;
        Vault.openNote(hit);
        return true;
      },
      on: (event, callback) => {
        if (event === "file-open" || event === "active-leaf-change" || event === "quick-preview") return subscribeVault("open", callback);
        return () => {};
      },
      getLeavesOfType: () => [],
    },
    commands: {
      addCommand: (cmd) => {
        const un = Vault.registerCommand({
          id: cmd.id,
          label: cmd.name || cmd.id,
          hint: "плагін",
          run: () => {
            try {
              if (typeof cmd.callback === "function") return cmd.callback();
              if (typeof cmd.checkCallback === "function" && cmd.checkCallback(false)) return cmd.checkCallback(true);
            } catch (error) { Vault.toast("Плагін: " + error.message); }
          },
        });
        return un;
      },
      executeCommandById: (id) => {
        const cmd = Vault.state.commands.find((c) => c.id === id);
        if (!cmd) return false;
        cmd.run();
        return true;
      },
      listCommands: () => Vault.state.commands.map((c) => ({ id: c.id, name: c.label })),
    },
    metadataCache: {
      getFileCache: (file) => {
        const path = typeof file === "string" ? normalizePath(file) : file && file.path;
        const text = Vault.index.get(path);
        if (!text) return null;
        const fm = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
        const frontmatter = {};
        if (fm) {
          for (const line of fm[1].split(/\r?\n/)) {
            const at = line.indexOf(":");
            if (at > 0) frontmatter[line.slice(0, at).trim()] = line.slice(at + 1).trim();
          }
        }
        const tags = [...text.matchAll(/(?:^|\s)#([A-Za-z0-9_\u0400-\u04FF/-]+)/g)].map((m) => ({ tag: "#" + m[1] }));
        return { frontmatter, tags, links: [], headings: [] };
      },
    },
    setting: {
      open: () => Vault.showPane("plugins"),
      openTabById: () => Vault.showPane("plugins"),
      close: () => {},
    },
  };
}

/* ---------------- per-plugin host ---------------- */
function makeHost(record) {
  return {
    addCommand: (pluginId, cmd) => {
      const id = pluginId + ":" + (cmd.id || cmd.name || "cmd");
      const un = Vault.registerCommand({
        id,
        label: cmd.name || cmd.id,
        hint: "плагін",
        run: () => {
          try {
            if (typeof cmd.callback === "function") return cmd.callback();
            if (typeof cmd.checkCallback === "function" && cmd.checkCallback(false)) return cmd.checkCallback(true);
          } catch (error) {
            Vault.toast("Плагін " + pluginId + ": " + error.message);
          }
        },
      });
      record.disposers.push(un);
      return cmd;
    },
    addRibbon: (pluginId, icon, title, callback) => {
      const un = Vault.addRibbonButton({
        id: pluginId + ":" + (title || icon),
        icon: icon || "◆",
        title: title || pluginId,
        run: callback,
      });
      record.disposers.push(un);
      return un;
    },
  };
}

function ensureShape(instance, record) {
  instance.app = instance.app || app;
  instance.manifest = instance.manifest || record.meta;
  instance._host = makeHost(record);
  instance._disposers = instance._disposers || [];
  instance._settingTabs = instance._settingTabs || [];
  if (typeof instance.addCommand !== "function") instance.addCommand = (cmd) => instance._host.addCommand(record.id, cmd);
  if (typeof instance.addRibbonIcon !== "function") instance.addRibbonIcon = (icon, title, cb) => instance._host.addRibbon(record.id, icon, title, cb);
  if (typeof instance.addSettingTab !== "function") instance.addSettingTab = (tab) => instance._settingTabs.push(tab);
  if (typeof instance.registerEvent !== "function") instance.registerEvent = (ref) => {
    if (typeof ref === "function") instance._disposers.push(ref);
    else if (ref && typeof ref.unload === "function") instance._disposers.push(() => ref.unload());
    return ref;
  };
  if (typeof instance.loadData !== "function") instance.loadData = async () => {
    const raw = localStorage.getItem("vw-plugin-data:" + record.id);
    return raw ? JSON.parse(raw) : null;
  };
  if (typeof instance.saveData !== "function") instance.saveData = async (data) => {
    localStorage.setItem("vw-plugin-data:" + record.id, JSON.stringify(data));
  };
  record.settingTabs = instance._settingTabs;
}

function makeLegacyApi(record) {
  const host = makeHost(record);
  return {
    id: record.id,
    name: record.meta.name || record.id,
    app,
    vault: app.vault,
    addCommand: (cmd) => host.addCommand(record.id, cmd),
    addRibbonButton: (btn) => host.addRibbon(record.id, btn.icon, btn.title, btn.run),
    on: (event, fn) => {
      const un = subscribeVault(event, fn);
      record.disposers.push(un);
      return un;
    },
    toast: (message) => Vault.toast(message),
    openNote: (path) => Vault.openNote(path),
    files: () => Vault.files.slice(),
    getActive: () => {
      const file = Vault.currentFile();
      return file ? { path: file.path, text: file.text } : null;
    },
    readNote: (path) => app.vault.read(path),
    writeNote: async (path, text) => {
      try { await app.vault.modify(path, text); } catch { await app.vault.create(path, text); }
    },
    insertText: (text) => Vault.insertAtCursor(text),
  };
}

/* ---------------- discovery ---------------- */
async function discoverAll() {
  const found = [];
  let allPaths = [];
  try { allPaths = await Vault.listAll(); } catch { allPaths = Vault.files.slice(); }
  const manifests = allPaths.filter((p) => /^\.obsidian\/plugins\/[^/]+\/manifest\.json$/.test(p));
  for (const manifestPath of manifests) {
    try {
      const meta = JSON.parse((await Vault.ghGet(manifestPath)).text);
      const id = meta.id || manifestPath.split("/")[2];
      const dir = manifestPath.slice(0, manifestPath.lastIndexOf("/"));
      found.push({
        id,
        meta: { id, name: meta.name || id, version: meta.version || "0.0.0", description: meta.description || "", author: meta.author || "" },
        dir,
        mainPath: dir + "/main.js",
        status: "available",
        enabled: enabledIds.has(id),
        legacy: false,
        disposers: [],
        settingTabs: [],
      });
    } catch (error) {
      console.warn("plugin manifest", manifestPath, error);
    }
  }
  try {
    const list = JSON.parse((await Vault.ghGet(LEGACY_MANIFEST)).text);
    if (Array.isArray(list)) {
      for (const meta of list) {
        if (found.some((r) => r.id === meta.id)) continue;
        found.push({
          id: meta.id,
          meta: { id: meta.id, name: meta.name || meta.id, version: "legacy", description: "web-plugins.json" },
          dir: "",
          mainPath: meta.path || "",
          url: meta.url || "",
          status: "available",
          enabled: true,
          legacy: true,
          disposers: [],
          settingTabs: [],
        });
      }
    }
  } catch { /* no legacy manifest */ }
  return found;
}

async function rescan() {
  const found = await discoverAll();
  for (const record of found) {
    const at = records.findIndex((r) => r.id === record.id);
    if (at < 0) records.push(record);
    else if (!records[at].enabled) Object.assign(records[at], record);
  }
  renderPane();
  return records;
}

/* ---------------- loading ---------------- */
function isCommonJs(code) {
  return /\bmodule\.exports\b|\bexports\.[A-Za-z_$]|\brequire\s*\(/.test(code);
}

async function evaluateCode(code, record) {
  if (isCommonJs(code)) {
    const moduleObj = { exports: {} };
    const requireFn = (name) => {
      if (name === "obsidian") return shim;
      throw new Error("require('" + name + "') не підтримується у веб-версії");
    };
    const fn = new Function("module", "exports", "require", "app", code + "\n//# sourceURL=plugin:" + record.id);
    fn(moduleObj, moduleObj.exports, requireFn, app);
    const exported = moduleObj.exports;
    if (typeof exported === "function") {
      const instance = new exported(app, record.meta);
      ensureShape(instance, record);
      await instance.onload();
      return instance;
    }
    if (exported && typeof exported.onload === "function") {
      ensureShape(exported, record);
      await exported.onload();
      return exported;
    }
    throw new Error("main.js не експортує Plugin");
  }

  const blob = new Blob([code], { type: "text/javascript" });
  const url = URL.createObjectURL(blob);
  try {
    const module = await import(url);
    if (typeof module.activate === "function") {
      const api = makeLegacyApi(record);
      const instance = { legacy: true, api, onunload: module.deactivate, _disposers: [], _settingTabs: [] };
      record.instance = instance;
      await module.activate(api);
      return instance;
    }
    if (typeof module.default === "function") {
      const instance = new module.default(app, record.meta);
      ensureShape(instance, record);
      await instance.onload();
      return instance;
    }
    if (typeof module.onload === "function") {
      const instance = module;
      ensureShape(instance, record);
      await instance.onload();
      return instance;
    }
    throw new Error("нема export onload/activate");
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  }
}

async function loadRecord(record) {
  if (record.status === "loading" || record.status === "ok") return record;
  record.status = "loading";
  record.error = null;
  record.disposers = [];
  renderPane();
  try {
    if (record.url && /^https?:/.test(record.url)) {
      const module = await import(record.url);
      if (typeof module.activate === "function") {
        const api = makeLegacyApi(record);
        record.instance = { legacy: true, api, onunload: module.deactivate, _disposers: [], _settingTabs: [] };
        await module.activate(api);
      } else {
        throw new Error("нема activate");
      }
    } else if (record.mainPath) {
      const { text } = await Vault.ghGet(record.mainPath);
      record.instance = await evaluateCode(text, record);
    } else {
      throw new Error("нема main.js");
    }
    record.enabled = true;
    enabledIds.add(record.id);
    persistEnabled();
    record.status = "ok";
  } catch (error) {
    record.status = "error";
    record.error = String(error.message || error);
    console.warn("plugin " + record.id + ":", error);
    for (const off of record.disposers.splice(0)) {
      try { off(); } catch { /* ignore */ }
    }
    record.instance = null;
  }
  renderPane();
  return record;
}

async function disable(id) {
  const record = records.find((r) => r.id === id);
  if (!record || !record.enabled) return;
  const instance = record.instance;
  if (instance) {
    try { if (typeof instance.onunload === "function") await instance.onunload(); } catch (error) { console.warn(error); }
    for (const off of instance._disposers || []) {
      try { off(); } catch { /* ignore */ }
    }
    instance._disposers = [];
  }
  for (const off of record.disposers.splice(0)) {
    try { off(); } catch { /* ignore */ }
  }
  record.instance = null;
  record.settingTabs = [];
  record.enabled = false;
  record.status = "available";
  enabledIds.delete(id);
  persistEnabled();
  renderPane();
}

/* ---------------- plugin pane ---------------- */
function renderPane() {
  const host = document.getElementById("pluginsPane");
  if (!host) return;
  host.innerHTML = "";
  const head = el("div", "pane-head");
  head.style.borderBottom = "none";
  const active = records.filter((r) => r.status === "ok").length;
  head.appendChild(el("span", "title", "Плагіни (" + active + "/" + records.length + ")"));
  const reload = el("button", "icon-btn", "⟳");
  reload.title = "Пересканувати .obsidian/plugins";
  reload.onclick = () => rescan();
  head.appendChild(reload);
  host.appendChild(head);

  if (!records.length) {
    const empty = el("div", "empty");
    empty.innerHTML = "Плагіни не знайдено. Додай теку <b>.obsidian/plugins/&lt;id&gt;/</b> з <b>manifest.json</b> і <b>main.js</b>.";
    host.appendChild(empty);
    return;
  }

  for (const record of records) {
    const card = el("div", "plugin-card");
    const title = el("div", "plugin-title");
    title.appendChild(el("b", null, record.meta.name || record.id));
    title.appendChild(el("span", "plugin-badge", "v" + (record.meta.version || "?")));
    card.appendChild(title);
    if (record.meta.description) card.appendChild(el("div", "muted", record.meta.description));
    const status = el("div", "plugin-status");
    if (record.status === "ok") status.textContent = "працює";
    else if (record.status === "loading") status.textContent = "завантажую…";
    else if (record.status === "error") { status.textContent = "помилка: " + record.error; status.classList.add("err"); }
    else status.textContent = record.enabled ? "вимкнено" : "не завантажено";
    card.appendChild(status);

    const actions = el("div", "plugin-actions");
    const toggle = el("button", "ghost-border", record.enabled ? "Вимкнути" : "Увімкнути");
    toggle.onclick = () => { if (record.enabled) disable(record.id); else loadRecord(record); };
    actions.appendChild(toggle);

    const tabs = record.settingTabs && record.settingTabs.length ? record.settingTabs : (record.instance && record.instance._settingTabs) || [];
    if (tabs.length) {
      const openSettings = el("button", "ghost-border", "Налаштування");
      const settingsHost = el("div", "plugin-settings");
      openSettings.onclick = () => {
        if (settingsHost.classList.contains("open")) {
          settingsHost.classList.remove("open");
          settingsHost.innerHTML = "";
          return;
        }
        settingsHost.classList.add("open");
        settingsHost.innerHTML = "";
        settingsHost.empty = () => { settingsHost.innerHTML = ""; };
        settingsHost.createEl = (tag, opts = {}) => {
          const node = document.createElement(tag);
          if (opts.text) node.textContent = opts.text;
          if (opts.cls) node.className = opts.cls;
          settingsHost.appendChild(node);
          return node;
        };
        settingsHost.createDiv = (opts = {}) => settingsHost.createEl("div", opts);
        for (const tab of tabs) {
          tab.containerEl = settingsHost;
          try { tab.display(); } catch (error) {
            settingsHost.appendChild(el("div", "plugin-status err", "Помилка налаштувань: " + error.message));
          }
        }
      };
      actions.appendChild(openSettings);
      card.appendChild(actions);
      card.appendChild(settingsHost);
    } else {
      card.appendChild(actions);
    }
    host.appendChild(card);
  }
}

/* ---------------- init ---------------- */
export async function initPlugins(vault) {
  Vault = vault;
  app = makeApp();
  Vault.on("plugins:pane", renderPane);

  records.push(...(await discoverAll()));
  for (const record of records.slice()) {
    if (record.enabled) await loadRecord(record);
  }
  renderPane();

  const api = {
    list: () => records.slice(),
    enable: (id) => {
      const record = records.find((r) => r.id === id);
      return record ? loadRecord(record) : Promise.resolve(null);
    },
    disable,
    rescan,
    app,
  };
  window.WebPlugins = api;
  window.__plugins = records;
  const ok = records.filter((r) => r.status === "ok").length;
  if (ok) Vault.toast("плагінів завантажено: " + ok);
  return api;
}
