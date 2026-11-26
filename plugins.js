// Plugin host: loads JS plugins listed in web-plugins.json from the vault (or any https URL).
let Vault = null;
let loaded = [];

const MANIFEST = "web-plugins.json";

function pluginApi(meta) {
  return {
    id: meta.id,
    name: meta.name,
    addCommand: (cmd) => Vault.registerCommand({ ...cmd, id: meta.id + ":" + cmd.id, hint: "плагін" }),
    addRibbonButton: (btn) => Vault.addRibbonButton({ ...btn, id: meta.id + ":" + (btn.id || "btn") }),
    on: (event, fn) => Vault.on(event, fn),
    toast: (msg) => Vault.toast(msg),
    openNote: (path) => Vault.openNote(path),
    files: () => Vault.files.slice(),
    getActive: () => {
      const file = Vault.currentFile();
      return file ? { path: file.path, text: file.text } : null;
    },
    readNote: async (path) => (await Vault.ghGet(path)).text,
    writeNote: async (path, text) => {
      let sha = null;
      try { sha = (await Vault.ghGet(path)).sha; } catch { /* new file */ }
      await Vault.ghPut(path, text, sha, "plugin(" + meta.id + "): " + path);
      await Vault.loadTree();
    },
    insertText: (text) => Vault.insertAtCursor(text),
  };
}

async function loadPlugin(meta) {
  const record = { id: meta.id, name: meta.name || meta.id, status: "loading", error: null };
  loaded.push(record);
  try {
    let module;
    if (meta.url && /^https?:/.test(meta.url)) {
      module = await import(meta.url);
    } else if (meta.path) {
      const { text } = await Vault.ghGet(meta.path);
      const blob = new Blob([text], { type: "text/javascript" });
      const url = URL.createObjectURL(blob);
      try { module = await import(url); } finally { setTimeout(() => URL.revokeObjectURL(url), 5000); }
    } else {
      throw new Error("нема url або path");
    }
    if (typeof module.activate !== "function") throw new Error("нема export activate(api)");
    await module.activate(pluginApi(meta));
    record.status = "ok";
    record.activate = module.activate;
    record.deactivate = module.deactivate;
  } catch (error) {
    record.status = "error";
    record.error = String(error.message || error);
  }
  return record;
}

function renderPane() {
  const host = document.getElementById("pluginsPane");
  if (!host) return;
  host.innerHTML = "";
  const head = document.createElement("div");
  head.className = "pane-head";
  head.style.borderBottom = "none";
  const title = document.createElement("span");
  title.className = "title";
  title.textContent = "Плагіни (" + loaded.filter((p) => p.status === "ok").length + ")";
  const reload = document.createElement("button");
  reload.className = "icon-btn";
  reload.textContent = "⟳";
  reload.title = "Перезавантажити (потрібен reload сторінки для команд)";
  reload.onclick = () => location.reload();
  head.append(title, reload);
  host.appendChild(head);

  if (!loaded.length) {
    const empty = document.createElement("div");
    empty.className = "empty";
    empty.innerHTML = "Нема плагінів. Додай у корінь волта <b>web-plugins.json</b>:<br><br>" +
      "<code>[{ \"id\": \"hello\", \"name\": \"Hello\", \"path\": \"plugins/hello.js\" }]</code><br><br>" +
      "Плагін — це ES-модуль з <code>export function activate(api)</code>.";
    host.appendChild(empty);
    return;
  }

  for (const p of loaded) {
    const card = document.createElement("div");
    card.className = "plugin-card";
    const b = document.createElement("b");
    b.textContent = p.name;
    const st = document.createElement("div");
    st.className = "muted";
    st.textContent = p.status === "ok" ? "працює" : p.status === "loading" ? "завантажую…" : "помилка: " + p.error;
    if (p.status === "error") st.style.color = "var(--red)";
    card.append(b, st);
    host.appendChild(card);
  }
}

export async function initPlugins(vault) {
  Vault = vault;
  Vault.on("plugins:pane", renderPane);

  try {
    const { text } = await Vault.ghGet(MANIFEST);
    const list = JSON.parse(text);
    if (!Array.isArray(list)) throw new Error("web-plugins.json має бути масивом");
    for (const meta of list) await loadPlugin(meta);
  } catch (error) {
    if (error.status !== 404) console.warn("plugins:", error.message);
  }
  renderPane();
  const ok = loaded.filter((p) => p.status === "ok").length;
  if (ok) Vault.toast("плагінів завантажено: " + ok);
  return { loaded, reload: () => location.reload() };
}
