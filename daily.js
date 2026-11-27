// Daily notes + templates, reading Obsidian's .obsidian/daily-notes.json and .obsidian/templates.json.
let Vault = null;

let dailyCfg = { folder: "", format: "YYYY-MM-DD", template: "" };
let tplCfg = { folder: "templates", dateFormat: "YYYY-MM-DD", timeFormat: "HH:mm" };
let uniqueCfg = { folder: "", format: "YYYYMMDDHHmm", template: "" };

const MONTHS = ["січня", "лютого", "березня", "квітня", "травня", "червня", "липня", "серпня", "вересня", "жовтня", "листопада", "грудня"];
const MONTHS_SHORT = ["січ", "лют", "бер", "кві", "тра", "чер", "лип", "сер", "вер", "жов", "лис", "гру"];
const DAYS = ["неділя", "понеділок", "вівторок", "середа", "четвер", "п'ятниця", "субота"];
const DAYS_SHORT = ["нд", "пн", "вт", "ср", "чт", "пт", "сб"];

const pad2 = (value) => String(value).padStart(2, "0");

function formatDate(date, format) {
  const fmt = String(format || "YYYY-MM-DD");
  return fmt.replace(/\[([^\]]+)\]|YYYY|YY|MMMM|MMM|MM|M|DD|D|dddd|ddd|HH|H|mm|m|ss|s/g, (token, literal) => {
    if (literal) return literal;
    switch (token) {
      case "YYYY": return String(date.getFullYear());
      case "YY": return String(date.getFullYear()).slice(-2);
      case "MMMM": return MONTHS[date.getMonth()];
      case "MMM": return MONTHS_SHORT[date.getMonth()];
      case "MM": return pad2(date.getMonth() + 1);
      case "M": return String(date.getMonth() + 1);
      case "DD": return pad2(date.getDate());
      case "D": return String(date.getDate());
      case "dddd": return DAYS[date.getDay()];
      case "ddd": return DAYS_SHORT[date.getDay()];
      case "HH": return pad2(date.getHours());
      case "H": return String(date.getHours());
      case "mm": return pad2(date.getMinutes());
      case "m": return String(date.getMinutes());
      case "ss": return pad2(date.getSeconds());
      case "s": return String(date.getSeconds());
      default: return token;
    }
  });
}

function applyVars(text, title, now) {
  const dateFormat = String(tplCfg.dateFormat || "YYYY-MM-DD");
  const timeFormat = String(tplCfg.timeFormat || "HH:mm");
  return String(text == null ? "" : text)
    .replace(/\{\{\s*title\s*\}\}/gi, title)
    .replace(/\{\{\s*date(?::([^}]+))?\s*\}\}/gi, (match, fmt) => formatDate(now, fmt ? fmt.trim() : dateFormat))
    .replace(/\{\{\s*time(?::([^}]+))?\s*\}\}/gi, (match, fmt) => formatDate(now, fmt ? fmt.trim() : timeFormat));
}

const cleanFolder = (value) => String(value || "").replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");

function dailyPath(now) {
  const folder = cleanFolder(dailyCfg.folder);
  const name = formatDate(now, dailyCfg.format || "YYYY-MM-DD").replace(/\.md$/i, "").replace(/^\/+/, "");
  return (folder ? folder + "/" : "") + name + ".md";
}

function uniquePath(now) {
  const folder = cleanFolder(uniqueCfg.folder);
  const name = formatDate(now, uniqueCfg.format || "YYYYMMDDHHmm").replace(/\.md$/i, "").replace(/^\/+/, "");
  return (folder ? folder + "/" : "") + name + ".md";
}

function resolveTemplate(name) {
  const clean = String(name || "").trim().replace(/\.md$/i, "");
  if (!clean) return "";
  const folder = cleanFolder(tplCfg.folder);
  const candidates = [clean + ".md"];
  if (folder) candidates.push(folder + "/" + clean + ".md");
  for (const candidate of candidates) if (Vault.files.includes(candidate)) return candidate;
  return Vault.files.find((path) => path.endsWith("/" + clean + ".md")) || "";
}

function templateFiles() {
  const folder = cleanFolder(tplCfg.folder);
  return Vault.files.filter((path) => path.endsWith(".md") && (!folder || path.startsWith(folder + "/")));
}

async function loadConfigs() {
  try {
    const raw = JSON.parse((await Vault.ghGet(".obsidian/daily-notes.json")).text);
    if (raw && typeof raw === "object") dailyCfg = { ...dailyCfg, ...raw };
  } catch { /* use defaults */ }
  try {
    const raw = JSON.parse((await Vault.ghGet(".obsidian/templates.json")).text);
    if (raw && typeof raw === "object") tplCfg = { ...tplCfg, ...raw };
  } catch { /* use defaults */ }
  for (const file of [".obsidian/zk-prefixer.json", ".obsidian/unique-note.json"]) {
    try {
      const raw = JSON.parse((await Vault.ghGet(file)).text);
      if (raw && typeof raw === "object") {
        uniqueCfg = { ...uniqueCfg, ...raw };
        break;
      }
    } catch { /* try next */ }
  }
}

async function openDailyNote() {
  const now = new Date();
  const path = dailyPath(now);
  const title = path.split("/").pop().replace(/\.md$/i, "");
  try {
    let exists = Vault.files.includes(path);
    if (!exists) {
      try { await Vault.ghGet(path); exists = true; } catch { exists = false; }
    }
    if (!exists) {
      let content = "# " + title + "\n\n";
      const templatePath = resolveTemplate(dailyCfg.template);
      if (templatePath) {
        try { content = applyVars((await Vault.ghGet(templatePath)).text, title, now); } catch { /* fallback */ }
      }
      await Vault.ghPut(path, content, null, "daily: " + path);
      Vault.state.pending.add(path);
      await Vault.loadTree();
      Vault.toast("щоденна нотатка створена: " + path);
    }
    await Vault.openNote(path);
    return path;
  } catch (error) {
    Vault.toast("Daily: " + error.message);
    return "";
  }
}

async function openUniqueNote() {
  const now = new Date();
  const path = uniquePath(now);
  const title = path.split("/").pop().replace(/\.md$/i, "");
  try {
    let exists = Vault.files.includes(path);
    if (!exists) {
      try { await Vault.ghGet(path); exists = true; } catch { exists = false; }
    }
    if (!exists) {
      let content = "";
      const templatePath = resolveTemplate(uniqueCfg.template);
      if (templatePath) {
        try { content = applyVars((await Vault.ghGet(templatePath)).text, title, now); } catch { /* empty note */ }
      }
      await Vault.ghPut(path, content, null, "unique: " + path);
      Vault.state.pending.add(path);
      await Vault.loadTree();
      Vault.toast("унікальна нотатка створена: " + path);
    }
    await Vault.openNote(path);
    return path;
  } catch (error) {
    Vault.toast("Unique note: " + error.message);
    return "";
  }
}

async function insertTemplate(path) {
  if (!path) return;
  const file = Vault.currentFile();
  if (!file) { Vault.toast("Спочатку відкрий нотатку"); return; }
  try {
    const { text } = await Vault.ghGet(path);
    const title = file.path.split("/").pop().replace(/\.md$/i, "");
    Vault.insertAtCursor(applyVars(text, title, new Date()));
    Vault.toast("шаблон вставлено: " + path.split("/").pop().replace(/\.md$/i, ""));
  } catch (error) {
    Vault.toast("Шаблон: " + error.message);
  }
}

function insertCurrentDate() {
  if (!Vault.currentFile()) { Vault.toast("Спочатку відкрий нотатку"); return; }
  Vault.insertAtCursor(formatDate(new Date(), tplCfg.dateFormat || "YYYY-MM-DD"));
}

function insertCurrentTime() {
  if (!Vault.currentFile()) { Vault.toast("Спочатку відкрий нотатку"); return; }
  Vault.insertAtCursor(formatDate(new Date(), tplCfg.timeFormat || "HH:mm"));
}

export async function initDaily(vault) {
  Vault = vault;
  await loadConfigs();
  Vault.registerCommand({ id: "daily", label: "Щоденна нотатка: сьогодні", hint: "daily", plugin: "daily-notes", run: openDailyNote });
  Vault.registerCommand({ id: "template", label: "Вставити шаблон", hint: "template", plugin: "templates", run: () => Vault.showSwitcher("template") });
  Vault.registerCommand({ id: "template-date", label: "Templates: вставити поточну дату", plugin: "templates", run: insertCurrentDate });
  Vault.registerCommand({ id: "template-time", label: "Templates: вставити поточний час", plugin: "templates", run: insertCurrentTime });
  Vault.registerCommand({ id: "unique-note", label: "Створити унікальну нотатку", hint: "unique", plugin: "unique-note", run: openUniqueNote });
  Vault.addRibbonButton({ id: "daily", icon: "📅", title: "Щоденна нотатка (сьогодні)", run: openDailyNote });
  Vault.addRibbonButton({ id: "template", icon: "🧾", title: "Вставити шаблон", run: () => Vault.showSwitcher("template") });
  return {
    openDailyNote,
    openUniqueNote,
    insertTemplate,
    insertCurrentDate,
    insertCurrentTime,
    templateFiles,
    loadConfigs,
    get config() { return { daily: { ...dailyCfg }, templates: { ...tplCfg }, unique: { ...uniqueCfg } }; },
  };
}
