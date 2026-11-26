// Live preview editor: CodeMirror 6 with Obsidian-style inline markdown.
// Inactive lines are rendered (markup hidden), the line with the caret shows raw source.
import {
  EditorState,
  EditorView,
  Decoration,
  WidgetType,
  keymap,
  drawSelection,
  history,
  historyKeymap,
  defaultKeymap,
  indentWithTab,
  StateField,
} from "./vendor/cm6.js";

const IMAGE_RE = /\.(svg|png|jpe?g|gif|webp|bmp|avif)$/i;

function mark(decos, from, to, cls, attrs) {
  if (to > from) decos.push(Decoration.mark(attrs ? { class: cls, attributes: attrs } : { class: cls }).range(from, to));
}

function hide(decos, from, to) {
  if (to > from) decos.push(Decoration.replace({}).range(from, to));
}

class CheckboxWidget extends WidgetType {
  constructor(lineFrom, checked) {
    super();
    this.lineFrom = lineFrom;
    this.checked = checked;
  }
  eq(other) { return other.lineFrom === this.lineFrom && other.checked === this.checked; }
  toDOM(editorView) {
    const box = document.createElement("input");
    box.type = "checkbox";
    box.className = "cm-task";
    box.checked = this.checked;
    box.addEventListener("mousedown", (e) => e.preventDefault());
    box.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      const line = editorView.state.doc.lineAt(this.lineFrom);
      const open = line.text.indexOf("[");
      if (open < 0) return;
      const at = line.from + open + 1;
      const ch = editorView.state.sliceDoc(at, at + 1);
      editorView.dispatch({ changes: { from: at, to: at + 1, insert: ch === " " ? "x" : " " } });
      editorView.focus();
    });
    return box;
  }
  ignoreEvent() { return false; }
}

class BulletWidget extends WidgetType {
  eq() { return true; }
  toDOM() {
    const span = document.createElement("span");
    span.className = "cm-bullet";
    span.textContent = "•";
    return span;
  }
  ignoreEvent() { return true; }
}

class ImageWidget extends WidgetType {
  constructor(name) {
    super();
    this.name = name;
  }
  eq(other) { return other.name === this.name; }
  toDOM() {
    const img = document.createElement("img");
    img.className = "cm-inline-img vault-media";
    img.alt = this.name;
    img.loading = "lazy";
    if (window.Vault && typeof window.Vault.loadAttachment === "function") {
      window.Vault.loadAttachment(this.name).then((url) => { img.src = url; }).catch(() => { img.alt = "немає файлу"; });
    }
    return img;
  }
  ignoreEvent() { return true; }
}

const AUDIO_RE = /\.(mp3|wav|ogg|m4a|flac|aac|opus)$/i;
const VIDEO_RE = /\.(mp4|webm|ogv|mov|mkv|m4v)$/i;

class MediaWidget extends WidgetType {
  constructor(name, kind) {
    super();
    this.name = name;
    this.kind = kind;
  }
  eq(other) { return other.name === this.name && other.kind === this.kind; }
  toDOM() {
    const media = document.createElement(this.kind);
    media.className = "cm-media-embed vault-media";
    media.controls = true;
    media.preload = "none";
    if (window.Vault && typeof window.Vault.loadAttachment === "function") {
      window.Vault.loadAttachment(this.name).then((url) => { media.src = url; }).catch(() => { media.title = "немає файлу"; });
    }
    return media;
  }
  ignoreEvent() { return true; }
}

const noteEmbedCache = new Map();
class NoteEmbedWidget extends WidgetType {
  constructor(name) {
    super();
    this.name = name;
  }
  eq(other) { return other.name === this.name; }
  toDOM() {
    const box = document.createElement("span");
    box.className = "cm-embed-note";
    const title = document.createElement("span");
    title.className = "cm-embed-title";
    title.textContent = "📄 " + this.name;
    box.appendChild(title);
    const body = document.createElement("span");
    body.className = "cm-embed-body";
    box.appendChild(body);
    const files = (window.Vault && window.Vault.state && window.Vault.state.files) || [];
    const path = files.find((p) => p === this.name + ".md" || p === this.name || p.endsWith("/" + this.name + ".md")) || null;
    if (!path) {
      box.classList.add("missing");
      body.textContent = "немає нотатки";
      return box;
    }
    const cached = noteEmbedCache.get(path);
    if (cached) {
      body.textContent = cached;
    } else if (window.Vault && typeof window.Vault.ghGet === "function") {
      body.textContent = "завантажую…";
      window.Vault.ghGet(path).then(({ text }) => {
        const snippet = String(text || "").replace(/^---\r?\n[\s\S]*?\r?\n---[ \t]*\r?\n?/, "").slice(0, 400);
        noteEmbedCache.set(path, snippet);
        if (box.isConnected) body.textContent = snippet || "(порожньо)";
      }).catch(() => { if (box.isConnected) body.textContent = "не завантажилось"; });
    }
    box.title = "Відкрити " + path;
    box.onclick = (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (window.Vault && typeof window.Vault.openNote === "function") window.Vault.openNote(path);
    };
    return box;
  }
  ignoreEvent() { return false; }
}

let katexLoader = null;
function ensureKatex() {
  if (window.katex) return Promise.resolve(window.katex);
  if (katexLoader) return katexLoader;
  katexLoader = new Promise((resolve, reject) => {
    if (!document.querySelector("link[data-katex]")) {
      const link = document.createElement("link");
      link.rel = "stylesheet";
      link.href = "https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/katex.min.css";
      link.dataset.katex = "1";
      document.head.appendChild(link);
    }
    const script = document.createElement("script");
    script.src = "https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/katex.min.js";
    script.onload = () => window.katex ? resolve(window.katex) : reject(new Error("katex missing"));
    script.onerror = () => reject(new Error("katex load failed"));
    document.head.appendChild(script);
  });
  return katexLoader;
}

let mermaidLoader = null;
function ensureMermaid() {
  if (window.mermaid) {
    if (!window.__vaultMermaidReady) {
      window.mermaid.initialize({ startOnLoad: false, securityLevel: "strict", theme: document.documentElement.dataset.theme === "light" ? "default" : "dark" });
      window.__vaultMermaidReady = true;
    }
    return Promise.resolve(window.mermaid);
  }
  if (mermaidLoader) return mermaidLoader;
  mermaidLoader = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "https://cdn.jsdelivr.net/npm/mermaid@10.9.1/dist/mermaid.min.js";
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
  return mermaidLoader;
}

let mermaidSeq = 0;
class MathWidget extends WidgetType {
  constructor(tex, display) {
    super();
    this.tex = tex;
    this.display = !!display;
  }
  eq(other) { return other.tex === this.tex && other.display === this.display; }
  toDOM() {
    const node = document.createElement(this.display ? "div" : "span");
    node.className = "cm-math " + (this.display ? "cm-math-display" : "cm-math-inline");
    node.textContent = this.tex;
    ensureKatex().then((katex) => {
      try {
        katex.render(this.tex, node, { displayMode: this.display, throwOnError: false, strict: false });
        node.dataset.rendered = "1";
      } catch { /* keep source text */ }
    });
    return node;
  }
  ignoreEvent() { return true; }
}

class MermaidWidget extends WidgetType {
  constructor(src) {
    super();
    this.src = src;
    this.id = "cm-mermaid-" + (++mermaidSeq);
  }
  eq(other) { return other.src === this.src; }
  toDOM() {
    const node = document.createElement("div");
    node.className = "cm-mermaid";
    node.textContent = this.src;
    ensureMermaid().then((mermaid) => mermaid.render(this.id + "-svg", this.src)).then((result) => {
      node.innerHTML = result.svg;
      node.dataset.rendered = "1";
    }).catch(() => { /* keep source text */ });
    return node;
  }
  ignoreEvent() { return true; }
}

const INLINE_RE = /\*\*([^*\n]+)\*\*|__([^_\n]+)__|(?<![*_])\*([^*\n]+)\*(?![*_])|(?<![*_])_([^_\n]+)_(?![*_])|`([^`\n]+)`|==([^=\n]+)==|~~([^~\n]+)~~|!\[\[([^\]\n]+?)\]\]|\[\[([^\]\n]+?)\]\]|\[([^\]\n]+)\]\(([^)\s]+)\)|(?<!\\)\$([^$\n]+?)\$(?!\d)/g;
const TAG_RE = /(^|[\s(])#([A-Za-z0-9_\u0400-\u04FF][A-Za-z0-9_\u0400-\u04FF/-]*)/g;

function decorateInline(decos, text, lineFrom, imageUrl) {
  INLINE_RE.lastIndex = 0;
  let m;
  while ((m = INLINE_RE.exec(text))) {
    const at = lineFrom + m.index;
    const full = m[0];
    if (m[1] !== undefined || m[2] !== undefined) {
      const body = m[1] !== undefined ? m[1] : m[2];
      hide(decos, at, at + 2);
      mark(decos, at + 2, at + 2 + body.length, "cm-strong");
      hide(decos, at + 2 + body.length, at + full.length);
    } else if (m[3] !== undefined || m[4] !== undefined) {
      const body = m[3] !== undefined ? m[3] : m[4];
      hide(decos, at, at + 1);
      mark(decos, at + 1, at + 1 + body.length, "cm-em");
      hide(decos, at + 1 + body.length, at + full.length);
    } else if (m[5] !== undefined) {
      hide(decos, at, at + 1);
      mark(decos, at + 1, at + 1 + m[5].length, "cm-inline-code");
      hide(decos, at + 1 + m[5].length, at + full.length);
    } else if (m[6] !== undefined) {
      hide(decos, at, at + 2);
      mark(decos, at + 2, at + 2 + m[6].length, "cm-mark");
      hide(decos, at + 2 + m[6].length, at + full.length);
    } else if (m[7] !== undefined) {
      hide(decos, at, at + 2);
      mark(decos, at + 2, at + 2 + m[7].length, "cm-strike");
      hide(decos, at + 2 + m[7].length, at + full.length);
    } else if (m[8] !== undefined) {
      const name = m[8].split("|")[0].trim();
      if (IMAGE_RE.test(name)) {
        decos.push(Decoration.replace({ widget: new ImageWidget(name) }).range(at, at + full.length));
      } else if (AUDIO_RE.test(name)) {
        decos.push(Decoration.replace({ widget: new MediaWidget(name, "audio") }).range(at, at + full.length));
      } else if (VIDEO_RE.test(name)) {
        decos.push(Decoration.replace({ widget: new MediaWidget(name, "video") }).range(at, at + full.length));
      } else if (name) {
        decos.push(Decoration.replace({ widget: new NoteEmbedWidget(name) }).range(at, at + full.length));
      }
    } else if (m[9] !== undefined) {
      const inner = m[9];
      const bar = inner.indexOf("|");
      const target = (bar >= 0 ? inner.slice(0, bar) : inner).trim();
      const displayStart = at + 2 + (bar >= 0 ? bar + 1 : 0);
      const displayEnd = at + 2 + inner.length;
      hide(decos, at, displayStart);
      mark(decos, displayStart, displayEnd, "cm-wikilink", { "data-target": target });
      hide(decos, displayEnd, at + full.length);
    } else if (m[10] !== undefined) {
      const label = m[10];
      mark(decos, at + 1, at + 1 + label.length, "cm-md-link");
      hide(decos, at, at + 1);
      hide(decos, at + 1 + label.length, at + full.length);
    } else if (m[12] !== undefined) {
      decos.push(Decoration.replace({ widget: new MathWidget(m[12], false) }).range(at, at + full.length));
    }
  }
  TAG_RE.lastIndex = 0;
  let t;
  while ((t = TAG_RE.exec(text))) {
    const start = lineFrom + t.index + t[1].length;
    mark(decos, start, start + t[0].length - t[1].length, "cm-tag");
  }
}

const CALLOUT_TITLES = { note: "Нотатка", tip: "Порада", info: "Інфо", success: "Готово", warning: "Увага", danger: "Небезпека", bug: "Баг", example: "Приклад", quote: "Цитата", todo: "Зробити" };

const escapeHtml = (value) => String(value).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

function mdBlock(text) {
  if (window.marked) return window.marked.parse(text, { breaks: true, mangle: false, headerIds: false });
  return escapeHtml(text).split("\n").join("<br>");
}

function mdInline(text) {
  let html = escapeHtml(text);
  html = html.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  html = html.replace(/`([^`]+)`/g, "<code>$1</code>");
  html = html.replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (m, target, alias) => '<span class="cm-wikilink">' + escapeHtml((alias || target).trim()) + "</span>");
  return html;
}

function splitYamlComment(text) {
  let quote = null;
  let depth = 0;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quote) {
      if (ch === quote && text[i - 1] !== "\\") quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") { quote = ch; continue; }
    if (ch === "[" || ch === "{") { depth++; continue; }
    if (ch === "]" || ch === "}") { depth = Math.max(0, depth - 1); continue; }
    if (ch === "#" && depth === 0 && (i === 0 || /\s/.test(text[i - 1]))) {
      return { value: text.slice(0, i).replace(/\s+$/, ""), comment: text.slice(i) };
    }
  }
  return { value: text.replace(/\s+$/, ""), comment: "" };
}

function unquote(text) {
  const value = String(text).trim();
  if (value.length >= 2 && ((value[0] === '"' && value[value.length - 1] === '"') || (value[0] === "'" && value[value.length - 1] === "'"))) {
    return value.slice(1, -1).replace(/\\(["'\\])/g, "$1");
  }
  return value;
}

function parseFrontmatter(doc) {
  if (doc.lines < 2 || doc.line(1).text.trim() !== "---") return null;
  let end = -1;
  for (let n = 2; n <= doc.lines; n++) if (doc.line(n).text.trim() === "---") { end = n; break; }
  if (end < 0) return null;
  const props = [];
  let n = 2;
  while (n < end) {
    const line = doc.line(n);
    const raw = line.text;
    if (!raw.trim() || raw.trim().startsWith("#")) { n++; continue; }
    const kv = raw.match(/^([A-Za-z0-9_\u0400-\u04FF-]+):(\s*)(.*)$/);
    if (!kv) { n++; continue; }
    const key = kv[1];
    const gap = kv[2];
    const split = splitYamlComment(kv[3]);
    const valueFrom = line.from + key.length + 1 + gap.length;
    const valueTo = valueFrom + split.value.length;
    const trimmed = split.value.trim();
    const flow = trimmed.match(/^\[(.*)\]$/);
    if (flow) {
      const items = flow[1].split(",").map((v) => unquote(v.trim())).filter(Boolean);
      props.push({
        key, value: items.join(", "), items, list: true, style: "flow",
        keyLine: n, keyFrom: line.from, keyTo: line.to, valueFrom, valueTo, gap, comment: split.comment,
        flowFrom: valueFrom + split.value.indexOf("[") + 1,
        flowTo: valueFrom + split.value.lastIndexOf("]"),
      });
      n++;
      continue;
    }
    const itemLines = [];
    let j = n + 1;
    while (j < end) {
      const itemLine = doc.line(j);
      const im = itemLine.text.match(/^(\s*)-(\s*)(.*)$/);
      if (!im) break;
      const itemSplit = splitYamlComment(im[3]);
      const itemValue = itemSplit.value.trim();
      const itemFrom = itemLine.from + im[1].length + 1 + im[2].length;
      const itemTo = itemFrom + itemSplit.value.length;
      itemLines.push({ line: j, from: itemFrom, to: itemTo, value: unquote(itemValue), rawValue: itemValue, raw: itemLine.text });
      j++;
    }
    if (itemLines.length) {
      props.push({
        key, value: itemLines.map((it) => it.value).join(", "), items: itemLines.map((it) => it.value),
        list: true, style: "block", keyLine: n, keyFrom: line.from, keyTo: line.to,
        valueFrom, valueTo, gap, comment: split.comment,
        blockFrom: line.from, blockTo: doc.line(j - 1).to, itemLines,
      });
      n = j;
      continue;
    }
    props.push({
      key, value: unquote(trimmed), rawValue: trimmed, list: false,
      keyLine: n, keyFrom: line.from, keyTo: line.to, valueFrom, valueTo, gap, comment: split.comment,
    });
    n++;
  }
  return { from: doc.line(1).from, to: doc.line(end).to, props };
}

function yamlScalar(value) {
  const text = String(value).trim();
  if (!text) return "";
  if (/^[A-Za-z0-9_\u0400-\u04FF]/.test(text) && !/[:#\[\]{}&*!|>'"%@`]/.test(text)) return text;
  return JSON.stringify(text);
}

class PropsWidget extends WidgetType {
  constructor(from, to, props) {
    super();
    this.from = from;
    this.to = to;
    this.props = props;
  }
  eq(other) { return other.from === this.from && other.to === this.to && JSON.stringify(other.props) === JSON.stringify(this.props); }
  commit(view, prop, rawInput) {
    const changes = [];
    if (prop.list) {
      const items = String(rawInput).split(",").map((v) => v.trim()).filter(Boolean);
      if (prop.style === "flow") {
        if (JSON.stringify(items) === JSON.stringify(prop.items)) return;
        changes.push({ from: prop.flowFrom, to: prop.flowTo, insert: items.map(yamlScalar).join(", ") });
      } else if (items.length === prop.itemLines.length) {
        prop.itemLines.forEach((item, index) => {
          if (items[index] === item.value) return;
          changes.push({ from: item.from, to: item.to, insert: yamlScalar(items[index]) });
        });
      } else {
        const lines = [prop.key + ":" + (prop.comment ? " " + prop.comment : "")];
        for (const item of items) lines.push("  - " + yamlScalar(item));
        changes.push({ from: prop.blockFrom, to: prop.blockTo, insert: lines.join("\n") });
      }
    } else {
      if (rawInput === prop.value) return;
      let insert = yamlScalar(rawInput);
      if (prop.valueFrom === prop.valueTo) {
        insert = (prop.gap ? "" : " ") + insert + (prop.comment ? " " : "");
      }
      changes.push({ from: prop.valueFrom, to: prop.valueTo, insert });
    }
    if (!changes.length) return;
    changes.sort((a, b) => a.from - b.from);
    view.dispatch({ changes });
  }
  toDOM(view) {
    const box = document.createElement("div");
    box.className = "cm-props";
    const title = document.createElement("div");
    title.className = "cm-props-title";
    title.textContent = "Властивості";
    box.appendChild(title);
    this.props.forEach((prop) => {
      const row = document.createElement("div");
      row.className = "cm-props-row";
      const key = document.createElement("span");
      key.className = "cm-props-key";
      key.textContent = prop.key;
      const input = document.createElement("input");
      input.className = "cm-props-value";
      input.spellcheck = false;
      input.value = prop.value;
      input.addEventListener("change", () => this.commit(view, prop, input.value));
      input.addEventListener("keydown", (event) => {
        if (event.key === "Enter") { event.preventDefault(); input.blur(); }
        if (event.key === "Escape") { input.value = prop.value; input.blur(); }
      });
      row.append(key, input);
      box.appendChild(row);
    });
    return box;
  }
  ignoreEvent() { return true; }
}

class CalloutWidget extends WidgetType {
  constructor(kind, title, body, from) {
    super();
    this.kind = kind;
    this.title = title;
    this.body = body;
    this.from = from;
  }
  eq(other) { return other.kind === this.kind && other.title === this.title && other.body === this.body && other.from === this.from; }
  toDOM(view) {
    const box = document.createElement("div");
    box.className = "cm-callout cm-callout-" + this.kind;
    box.title = "Клік — редагувати";
    const head = document.createElement("div");
    head.className = "cm-callout-title";
    head.textContent = this.title || CALLOUT_TITLES[this.kind] || this.kind;
    box.appendChild(head);
    const body = document.createElement("div");
    body.className = "cm-callout-body";
    body.innerHTML = mdBlock(this.body);
    box.appendChild(body);
    box.addEventListener("mousedown", (event) => {
      event.preventDefault();
      view.dispatch({ selection: { anchor: Math.min(this.from + 2, view.state.doc.length) }, scrollIntoView: true });
      view.focus();
    });
    return box;
  }
  ignoreEvent() { return true; }
}

class TableWidget extends WidgetType {
  constructor(source, from) {
    super();
    this.source = source;
    this.from = from;
  }
  eq(other) { return other.source === this.source && other.from === this.from; }
  toDOM(view) {
    const rows = this.source.split("\n").map((line) => line.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((cell) => cell.trim()));
    const table = document.createElement("table");
    const thead = document.createElement("thead");
    const headerRow = document.createElement("tr");
    (rows[0] || []).forEach((cell) => {
      const th = document.createElement("th");
      th.innerHTML = mdInline(cell);
      headerRow.appendChild(th);
    });
    thead.appendChild(headerRow);
    table.appendChild(thead);
    const tbody = document.createElement("tbody");
    rows.slice(2).forEach((row) => {
      const tr = document.createElement("tr");
      row.forEach((cell) => {
        const td = document.createElement("td");
        td.innerHTML = mdInline(cell);
        tr.appendChild(td);
      });
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    const box = document.createElement("div");
    box.className = "cm-table-widget";
    box.title = "Клік — редагувати";
    box.appendChild(table);
    box.addEventListener("mousedown", (event) => {
      event.preventDefault();
      view.dispatch({ selection: { anchor: this.from }, scrollIntoView: true });
      view.focus();
    });
    return box;
  }
  ignoreEvent() { return true; }
}


function buildDecorations(state, imageUrl) {
  const doc = state.doc;
  const head = state.selection.main.head;
  const activeFrom = doc.lineAt(head).from;
  const decos = [];
  const skip = [];
  const inSkip = (pos) => skip.some(([from, to]) => pos >= from && pos <= to);
  const active = (from, to) => head >= from && head <= to;

  const front = parseFrontmatter(doc);
  if (front) {
    if (!active(front.from, front.to)) {
      decos.push(Decoration.replace({ widget: new PropsWidget(front.from, front.to, front.props), block: true }).range(front.from, front.to));
      skip.push([front.from, front.to]);
    } else {
      for (let n = 1; n <= doc.lines; n++) {
        const line = doc.line(n);
        if (line.from >= front.from && line.from <= front.to) decos.push(Decoration.line({ class: "cm-frontmatter-line" }).range(line.from));
      }
    }
  }

  let inCode = false;
  let n = 1;
  while (n <= doc.lines) {
    const line = doc.line(n);
    if (inSkip(line.from)) { n++; continue; }
    if (front && line.from >= front.from && line.from <= front.to) { n++; continue; }

    const callout = line.text.match(/^\s*>\s*\[!([A-Za-z0-9_-]+)\]([+-]?)\s*(.*)$/);
    if (callout) {
      let end = n;
      while (end + 1 <= doc.lines && /^\s*>/.test(doc.line(end + 1).text)) end++;
      const from = line.from;
      const to = doc.line(end).to;
      if (!active(from, to)) {
        const body = [];
        for (let k = n + 1; k <= end; k++) body.push(doc.line(k).text.replace(/^\s*>\s?/, ""));
        decos.push(Decoration.replace({ widget: new CalloutWidget(callout[1].toLowerCase(), callout[3], body.join("\n"), from), block: true }).range(from, to));
        skip.push([from, to]);
      } else {
        for (let k = n; k <= end; k++) decos.push(Decoration.line({ class: "cm-quote-line" }).range(doc.line(k).from));
      }
      n = end + 1;
      continue;
    }

    if (line.text.includes("|") && n + 1 <= doc.lines) {
      const next = doc.line(n + 1).text;
      if (next.includes("|") && /^\s*\|?\s*:?-{3,}/.test(next)) {
        let end = n + 1;
        while (end + 1 <= doc.lines) {
          const row = doc.line(end + 1).text;
          if (!row.trim() || !row.includes("|")) break;
          end++;
        }
        const from = line.from;
        const to = doc.line(end).to;
        if (!active(from, to)) {
          const source = [];
          for (let k = n; k <= end; k++) source.push(doc.line(k).text);
          decos.push(Decoration.replace({ widget: new TableWidget(source.join("\n"), from), block: true }).range(from, to));
          skip.push([from, to]);
        }
        n = end + 1;
        continue;
      }
    }

    const text = line.text;
    const isActive = line.from === activeFrom;

    if (!inCode && text.trim().startsWith("$$")) {
      const first = text.trim().slice(2);
      const same = first.endsWith("$$");
      let end = n;
      let tex = same ? first.slice(0, -2) : first;
      if (!same) {
        const parts = [first];
        end = n + 1;
        while (end <= doc.lines && !doc.line(end).text.trim().endsWith("$$")) { parts.push(doc.line(end).text); end++; }
        if (end <= doc.lines) {
          const tail = doc.line(end).text.trim();
          if (tail.length > 2) parts.push(tail.slice(0, -2));
          tex = parts.join("\n");
        }
      }
      if (same || (end <= doc.lines && doc.line(end).text.trim().endsWith("$$"))) {
        const from = line.from;
        const to = doc.line(end).to;
        if (!active(from, to)) {
          decos.push(Decoration.replace({ widget: new MathWidget(tex.trim(), true), block: true }).range(from, to));
          skip.push([from, to]);
        } else {
          for (let k = n; k <= end; k++) decos.push(Decoration.line({ class: "cm-math-src" }).range(doc.line(k).from));
        }
        n = end + 1;
        continue;
      }
    }

    if (!inCode) {
      const fenced = text.match(/^\s*(```|~~~)\s*mermaid\b/i);
      if (fenced) {
        const marker = fenced[1];
        const closeRe = new RegExp("^\\s*" + marker + "\\s*$");
        let end = n + 1;
        while (end <= doc.lines && !closeRe.test(doc.line(end).text)) end++;
        if (end <= doc.lines) {
          const from = line.from;
          const to = doc.line(end).to;
          if (!active(from, to)) {
            const src = [];
            for (let k = n + 1; k < end; k++) src.push(doc.line(k).text);
            decos.push(Decoration.replace({ widget: new MermaidWidget(src.join("\n")), block: true }).range(from, to));
            skip.push([from, to]);
          } else {
            for (let k = n; k <= end; k++) decos.push(Decoration.line({ class: "cm-code-line" }).range(doc.line(k).from));
          }
          n = end + 1;
          continue;
        }
      }
    }

    if (/^\s*(```|~~~)/.test(text)) {
      decos.push(Decoration.line({ class: "cm-code-fence" }).range(line.from));
      inCode = !inCode;
      n++;
      continue;
    }
    if (inCode) {
      decos.push(Decoration.line({ class: "cm-code-line" }).range(line.from));
      n++;
      continue;
    }
    if (!text.trim()) { n++; continue; }

    const heading = text.match(/^(#{1,6})\s+/);
    if (heading) {
      decos.push(Decoration.line({ class: "cm-line-h" + heading[1].length }).range(line.from));
      if (!isActive) hide(decos, line.from, line.from + heading[0].length);
    } else {
      const quote = text.match(/^\s*>\s?/);
      if (quote) {
        decos.push(Decoration.line({ class: "cm-quote-line" }).range(line.from));
        if (!isActive) hide(decos, line.from, line.from + quote[0].length);
      }
    }

    if (!isActive) {
      const task = text.match(/^(\s*)- \[( |x|X)\]\s/);
      const bullet = task ? null : text.match(/^(\s*)([-*+])\s+/);
      if (task) {
        const start = line.from + task[1].length;
        decos.push(Decoration.replace({ widget: new CheckboxWidget(line.from, task[2] !== " ") }).range(start, start + task[0].length - task[1].length));
      } else if (bullet) {
        const start = line.from + bullet[1].length;
        decos.push(Decoration.replace({ widget: new BulletWidget() }).range(start, start + bullet[0].length - bullet[1].length));
      }
      decorateInline(decos, text, line.from, imageUrl);
    }
    n++;
  }
  return Decoration.set(decos, true);
}

function makeDecorations(imageUrl) {
  return StateField.define({
    create(state) { return buildDecorations(state, imageUrl); },
    update(decorations, tr) {
      if (tr.docChanged || tr.selection) return buildDecorations(tr.state, imageUrl);
      return decorations;
    },
    provide: (field) => EditorView.decorations.from(field),
  });
}

function wrapSelection(editorView, before, after) {
  const { from, to } = editorView.state.selection.main;
  const selected = editorView.state.sliceDoc(from, to);
  editorView.dispatch({
    changes: { from, to, insert: before + selected + after },
    selection: { anchor: from + before.length, head: to + before.length },
  });
  return true;
}

function continueList(editorView) {
  const state = editorView.state;
  const pos = state.selection.main.head;
  const line = state.doc.lineAt(pos);
  const before = line.text.slice(0, pos - line.from);
  const match = before.match(/^(\s*)(?:([-*+])|(\d+)([.)]))\s+(\[[ xX]\]\s+)?/);
  if (!match) return false;
  const prefix = match[0];
  const content = before.slice(prefix.length);
  if (!content.trim()) {
    editorView.dispatch({ changes: { from: line.from, to: pos, insert: "" }, selection: { anchor: line.from } });
    return true;
  }
  const marker = match[2] ? match[2] : String(Number(match[3]) + 1) + match[4];
  const task = match[5] ? "[ ] " : "";
  const insert = "\n" + match[1] + marker + " " + task;
  editorView.dispatch({ changes: { from: pos, insert }, selection: { anchor: pos + insert.length }, scrollIntoView: true });
  return true;
}

function indentList(editorView, outdent) {
  const state = editorView.state;
  const changes = [];
  for (const range of state.selection.ranges) {
    const line = state.doc.lineAt(range.from);
    if (!/^\s*(?:[-*+]|\d+[.)])\s+/.test(line.text)) continue;
    if (outdent) {
      const remove = line.text.match(/^(\t| {1,4})/);
      if (remove) changes.push({ from: line.from, to: line.from + remove[1].length, insert: "" });
    } else {
      changes.push({ from: line.from, insert: "  " });
    }
  }
  if (!changes.length) return false;
  editorView.dispatch({ changes });
  return true;
}

const AUTO_PAIRS = { "(": ")", "[": "]", "{": "}" };
const AUTO_QUOTES = { '"': '"', "'": "'", "`": "`", "*": "*", "_": "_", "$": "$" };

function autoPair(editorView, from, to, text) {
  if (from !== to) return false;
  const state = editorView.state;
  const next = state.sliceDoc(to, to + 1);
  const prev = state.sliceDoc(Math.max(0, from - 1), from);
  if (AUTO_QUOTES[text]) {
    if (next === text) { editorView.dispatch({ selection: { anchor: from + 1 } }); return true; }
    if (/[\w\u0400-\u04FF]/.test(prev)) return false;
  } else if (AUTO_PAIRS[text]) {
    if (next === AUTO_PAIRS[text]) { editorView.dispatch({ selection: { anchor: from + 1 } }); return true; }
    if (next && !/[\s)\]}>.,;:!?]/.test(next)) return false;
  } else {
    return false;
  }
  const close = AUTO_QUOTES[text] || AUTO_PAIRS[text];
  editorView.dispatch({ changes: { from, insert: text + close }, selection: { anchor: from + 1 } });
  return true;
}

const SLASH_ITEMS = [
  { id: "h1", label: "Заголовок 1", hint: "#", insert: "# " },
  { id: "h2", label: "Заголовок 2", hint: "##", insert: "## " },
  { id: "h3", label: "Заголовок 3", hint: "###", insert: "### " },
  { id: "bullet", label: "Маркований список", hint: "-", insert: "- " },
  { id: "number", label: "Нумерований список", hint: "1.", insert: "1. " },
  { id: "task", label: "Завдання", hint: "[ ]", insert: "- [ ] " },
  { id: "quote", label: "Цитата", hint: ">", insert: "> " },
  { id: "callout", label: "Callout", hint: "> [!note]", insert: "> [!note] " },
  { id: "code", label: "Блок коду", hint: "```", insert: "```\n\n```", cursor: 3 },
  { id: "math", label: "Формула", hint: "$$", insert: "$$\n\n$$", cursor: 2 },
  { id: "table", label: "Таблиця", hint: "|", insert: "| Column | Column |\n| --- | --- |\n|  |  |" },
  { id: "divider", label: "Розділювач", hint: "---", insert: "---\n" },
  { id: "template", label: "Вставити шаблон", hint: "🧾", template: true },
];

const slashMenu = { open: false, view: null, index: 0, start: 0, query: "", host: null, items: [] };

function slashHost() {
  if (!slashMenu.host) {
    slashMenu.host = document.createElement("div");
    slashMenu.host.className = "slash-menu";
    slashMenu.host.style.display = "none";
    document.body.appendChild(slashMenu.host);
  }
  return slashMenu.host;
}

function slashCandidates(query) {
  const q = String(query || "").toLowerCase();
  return SLASH_ITEMS.filter((item) => !q || item.label.toLowerCase().includes(q) || item.id.includes(q) || String(item.hint).toLowerCase().includes(q));
}

function hideSlashMenu() {
  slashMenu.open = false;
  slashMenu.view = null;
  slashMenu.items = [];
  if (slashMenu.host) slashMenu.host.style.display = "none";
}

function renderSlashMenu(view, start, query) {
  const items = slashCandidates(query);
  if (!items.length) { hideSlashMenu(); return; }
  slashMenu.open = true;
  slashMenu.view = view;
  slashMenu.start = start;
  slashMenu.query = query;
  slashMenu.items = items;
  slashMenu.index = Math.max(0, Math.min(slashMenu.index, items.length - 1));
  const host = slashHost();
  host.innerHTML = "";
  items.forEach((item, index) => {
    const row = document.createElement("div");
    row.className = "slash-item" + (index === slashMenu.index ? " active" : "");
    const label = document.createElement("span");
    label.textContent = item.label;
    const hint = document.createElement("span");
    hint.className = "slash-hint";
    hint.textContent = item.hint;
    row.append(label, hint);
    row.addEventListener("mousedown", (event) => event.preventDefault());
    row.addEventListener("click", (event) => { event.preventDefault(); runSlash(item); });
    host.appendChild(row);
  });
  const coords = view.coordsAtPos(view.state.selection.main.head) || { left: 40, bottom: 90 };
  if (coords) {
    host.style.display = "block";
    const width = host.offsetWidth || 240;
    const height = host.offsetHeight || 280;
    host.style.left = Math.max(8, Math.min(window.innerWidth - width - 8, coords.left)) + "px";
    host.style.top = Math.max(8, Math.min(window.innerHeight - height - 8, coords.bottom + 6)) + "px";
  }
}

function updateSlashMenu(view) {
  const head = view.state.selection.main.head;
  const line = view.state.doc.lineAt(head);
  const before = line.text.slice(0, head - line.from);
  const match = before.match(/^(\s*)\/([A-Za-z0-9_\u0400-\u04FF-]*)$/);
  if (!match) { hideSlashMenu(); return; }
  renderSlashMenu(view, line.from + match[1].length, match[2]);
}

function runSlash(item) {
  const view = slashMenu.view;
  if (!view) return;
  const head = view.state.selection.main.head;
  const start = slashMenu.start;
  hideSlashMenu();
  if (item.template) {
    if (window.Vault && typeof window.Vault.showSwitcher === "function") window.Vault.showSwitcher("template");
    return;
  }
  const insert = item.insert || "";
  const caret = start + (item.cursor == null ? insert.length : item.cursor);
  view.dispatch({ changes: { from: start, to: head, insert }, selection: { anchor: caret }, scrollIntoView: true });
  view.focus();
}

function slashMove(view, delta) {
  if (!slashMenu.open || slashMenu.view !== view) return false;
  slashMenu.index = (slashMenu.index + delta + slashMenu.items.length) % slashMenu.items.length;
  renderSlashMenu(view, slashMenu.start, slashMenu.query);
  return true;
}

function slashAccept(view) {
  if (!slashMenu.open || slashMenu.view !== view) return false;
  const item = slashMenu.items[slashMenu.index];
  if (!item) { hideSlashMenu(); return false; }
  runSlash(item);
  return true;
}

function slashCancel(view) {
  if (!slashMenu.open || slashMenu.view !== view) return false;
  hideSlashMenu();
  return true;
}

const tagMenu = { open: false, view: null, index: 0, start: 0, query: "", host: null, items: [] };

function collectTags() {
  const tags = new Set();
  const index = window.Vault && window.Vault.index;
  if (!index || typeof index.values !== "function") return [];
  const sources = [];
  for (const text of index.values()) sources.push(text);
  for (const file of (window.Vault && window.Vault.state && window.Vault.state.open) || []) sources.push(file.text);
  for (const text of sources) {
    const lines = String(text || "").split(/\r?\n/);
    let inFront = lines[0] && lines[0].trim() === "---";
    let tagBlock = false;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (i === 0 && line.trim() === "---") { inFront = true; continue; }
      if (inFront && line.trim() === "---") { inFront = false; continue; }
      if (inFront) {
        const head = line.match(/^tags?:\s*(.*)$/i);
        if (head) {
          tagBlock = true;
          for (const part of head[1].replace(/^\[|\]$/g, "").split(",")) {
            const tag = part.trim().replace(/^#/, "").replace(/^["']|["']$/g, "");
            if (tag) tags.add(tag);
          }
          continue;
        }
        if (tagBlock) {
          const item = line.match(/^\s*-\s*(.*)$/);
          if (item) {
            const tag = item[1].trim().replace(/^#/, "").replace(/^["']|["']$/g, "");
            if (tag) tags.add(tag);
            continue;
          }
          tagBlock = false;
        }
        continue;
      }
      for (const m of line.matchAll(/(^|[\s(])#([A-Za-z0-9_\u0400-\u04FF][A-Za-z0-9_\u0400-\u04FF/-]*)/g)) tags.add(m[2]);
    }
  }
  return [...tags].sort((a, b) => a.localeCompare(b, "uk", { numeric: true }));
}

function tagHost() {
  if (!tagMenu.host) {
    tagMenu.host = document.createElement("div");
    tagMenu.host.className = "slash-menu tag-menu";
    tagMenu.host.style.display = "none";
    document.body.appendChild(tagMenu.host);
  }
  return tagMenu.host;
}

function hideTagMenu() {
  tagMenu.open = false;
  tagMenu.view = null;
  tagMenu.items = [];
  if (tagMenu.host) tagMenu.host.style.display = "none";
}

function renderTagMenu(view, start, items) {
  tagMenu.open = true;
  tagMenu.view = view;
  tagMenu.start = start;
  tagMenu.items = items;
  tagMenu.index = Math.max(0, Math.min(tagMenu.index, items.length - 1));
  const host = tagHost();
  host.innerHTML = "";
  items.forEach((tag, index) => {
    const row = document.createElement("div");
    row.className = "slash-item" + (index === tagMenu.index ? " active" : "");
    const label = document.createElement("span");
    label.textContent = "#" + tag;
    row.appendChild(label);
    row.addEventListener("mousedown", (event) => event.preventDefault());
    row.addEventListener("click", (event) => { event.preventDefault(); runTag(tag); });
    host.appendChild(row);
  });
  const coords = view.coordsAtPos(view.state.selection.main.head) || { left: 40, bottom: 90 };
  if (coords) {
    host.style.display = "block";
    const width = host.offsetWidth || 220;
    const height = host.offsetHeight || 240;
    host.style.left = Math.max(8, Math.min(window.innerWidth - width - 8, coords.left)) + "px";
    host.style.top = Math.max(8, Math.min(window.innerHeight - height - 8, coords.bottom + 6)) + "px";
  }
}

function updateTagMenu(view) {
  const head = view.state.selection.main.head;
  const line = view.state.doc.lineAt(head);
  const before = line.text.slice(0, head - line.from);
  const match = before.match(/(^|\s)#([A-Za-z0-9_\u0400-\u04FF/-]*)$/);
  if (!match) { hideTagMenu(); return; }
  const query = match[2];
  const tags = collectTags()
    .filter((tag) => tag.toLowerCase() !== query.toLowerCase())
    .filter((tag) => tag.toLowerCase().includes(query.toLowerCase()))
    .slice(0, 40);
  if (!tags.length) { hideTagMenu(); return; }
  hideSlashMenu();
  const start = line.from + before.length - query.length - 1;
  renderTagMenu(view, start, tags);
}

function runTag(tag) {
  const view = tagMenu.view;
  if (!view) return;
  const head = view.state.selection.main.head;
  const start = tagMenu.start;
  hideTagMenu();
  const insert = "#" + tag + " ";
  view.dispatch({ changes: { from: start, to: head, insert }, selection: { anchor: start + insert.length }, scrollIntoView: true });
  view.focus();
}

function tagMove(view, delta) {
  if (!tagMenu.open || tagMenu.view !== view) return false;
  tagMenu.index = (tagMenu.index + delta + tagMenu.items.length) % tagMenu.items.length;
  renderTagMenu(view, tagMenu.start, tagMenu.items);
  return true;
}

function tagAccept(view) {
  if (!tagMenu.open || tagMenu.view !== view) return false;
  const tag = tagMenu.items[tagMenu.index];
  if (!tag) { hideTagMenu(); return false; }
  const head = view.state.selection.main.head;
  const start = tagMenu.start;
  hideTagMenu();
  const insert = "#" + tag + " ";
  view.dispatch({ changes: { from: start, to: head, insert }, selection: { anchor: start + insert.length }, scrollIntoView: true });
  view.focus();
  return true;
}

function tagCancel(view) {
  if (!tagMenu.open || tagMenu.view !== view) return false;
  hideTagMenu();
  return true;
}

function makeExtensions(options, instance) {
  const smartLists = options.smartLists !== false;
  const autoPairs = options.autoPairs !== false;
  return [
    history(),
    drawSelection(),
    EditorView.lineWrapping,
    keymap.of([
      { key: "ArrowDown", run: (v) => tagMove(v, 1) },
      { key: "ArrowUp", run: (v) => tagMove(v, -1) },
      { key: "Enter", run: tagAccept },
      { key: "Tab", run: tagAccept },
      { key: "Escape", run: tagCancel },
      { key: "ArrowDown", run: (v) => slashMove(v, 1) },
      { key: "ArrowUp", run: (v) => slashMove(v, -1) },
      { key: "Enter", run: slashAccept },
      { key: "Tab", run: slashAccept },
      { key: "Escape", run: slashCancel },
    ]),
    keymap.of([
      ...(smartLists ? [
        { key: "Enter", run: continueList },
        { key: "Tab", run: (v) => indentList(v, false) },
        { key: "Shift-Tab", run: (v) => indentList(v, true) },
      ] : []),
      { key: "Mod-b", run: (v) => wrapSelection(v, "**", "**") },
      { key: "Mod-i", run: (v) => wrapSelection(v, "*", "*") },
      { key: "Mod-k", run: (v) => wrapSelection(v, "[[", "]]") },
      indentWithTab,
      ...defaultKeymap,
      ...historyKeymap,
    ]),
    ...(autoPairs ? [EditorView.inputHandler.of((view, from, to, text) => autoPair(view, from, to, text))] : []),
    makeDecorations(options.imageUrl),
    EditorView.contentAttributes.of({ spellcheck: "false", autocapitalize: "off", autocorrect: "off" }),
    EditorView.domEventHandlers({
      mousedown(event) {
        const link = event.target.closest && event.target.closest(".cm-wikilink");
        if (link && (event.metaKey || event.ctrlKey)) {
          event.preventDefault();
          options.onOpenNote(link.dataset.target || "");
          return true;
        }
        return false;
      },
    }),
    EditorView.updateListener.of((update) => {
      if (update.docChanged && !instance.suppress) {
        const text = update.state.doc.toString();
        const prev = instance.lastText;
        instance.lastText = text;
        options.onChange(text, prev);
        const head = update.state.selection.main.head;
        const typed = update.transactions.some((tr) => tr.isUserEvent("input.type"));
        if (typed && !instance.linkPending && head >= 2 && update.state.sliceDoc(head - 2, head) === "[[") {
          instance.linkPending = true;
          const from = head - 2;
          setTimeout(() => {
            instance.linkPending = false;
            if (!instance.view) return;
            const at = Math.min(from, instance.view.state.doc.length);
            if (instance.view.state.sliceDoc(at, at + 2) === "[[") {
              instance.view.dispatch({ changes: { from: at, to: at + 2 } });
            }
            options.onLinkTrigger(from);
          }, 0);
        }
      }
      if ((update.selectionSet || update.docChanged) && update.view.hasFocus) {
        const head = update.state.selection.main.head;
        const line = update.state.doc.lineAt(head);
        options.onCursor(line.number, head - line.from + 1);
      }
      if (!instance.suppress && update.view.hasFocus) {
        updateSlashMenu(update.view);
        updateTagMenu(update.view);
      }
    }),
  ];
}

export function initLive(options) {
  const host = document.getElementById(options.hostId || "live");
  if (!host) return null;

  const instance = { view: null, lastText: "", suppress: false, linkPending: false };
  const state = EditorState.create({
    doc: options.getText(),
    extensions: makeExtensions(options, instance),
  });

  const view = new EditorView({ state, parent: host });
  instance.view = view;
  instance.lastText = view.state.doc.toString();
  host.classList.add("cm-host");
  document.addEventListener("mousedown", (event) => {
    if (!slashMenu.open && !tagMenu.open) return;
    if (slashMenu.host && slashMenu.host.contains(event.target)) return;
    if (tagMenu.host && tagMenu.host.contains(event.target)) return;
    if (view.dom.contains(event.target)) return;
    hideSlashMenu();
    hideTagMenu();
  });
  view.scrollDOM.addEventListener("wheel", () => {
    if (slashMenu.view === view) hideSlashMenu();
    if (tagMenu.view === view) hideTagMenu();
  }, { passive: true });
  view.dom.addEventListener("focusin", () => { if (options.onFocus) options.onFocus(); });
  view.dom.addEventListener("mousedown", () => { if (options.onFocus) options.onFocus(); });

  return {
    reset(text) {
      instance.suppress = true;
      view.setState(EditorState.create({ doc: text, extensions: makeExtensions(options, instance) }));
      instance.suppress = false;
      instance.lastText = text;
      view.scrollDOM.scrollTop = 0;
      options.onCursor(1, 1);
    },
    setDoc(text) {
      if (view.state.doc.toString() === text) { instance.lastText = text; return; }
      instance.suppress = true;
      const head = Math.min(view.state.selection.main.head, text.length);
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: text },
        selection: { anchor: head },
      });
      instance.suppress = false;
      instance.lastText = text;
    },
    getText() { return view.state.doc.toString(); },
    focus() { view.focus(); },
    caret() {
      const head = view.state.selection.main.head;
      const line = view.state.doc.lineAt(head);
      return { pos: head, line: line.number, ch: head - line.from + 1 };
    },
    goToLine(n) {
      const number = Math.max(1, Math.min(view.state.doc.lines, n));
      const line = view.state.doc.line(number);
      view.dispatch({ selection: { anchor: line.from }, scrollIntoView: true });
      view.focus();
    },
    insertAtCaret(text) {
      const head = view.state.selection.main.head;
      view.dispatch({ changes: { from: head, insert: text }, selection: { anchor: head + text.length } });
      view.focus();
    },
    insertAt(pos, text) {
      const at = Math.max(0, Math.min(pos, view.state.doc.length));
      view.dispatch({ changes: { from: at, insert: text }, selection: { anchor: at + text.length } });
      view.focus();
    },
    wrap(marker) { wrapSelection(view, marker, marker); },
    select(from, to) {
      view.dispatch({ selection: { anchor: from, head: to }, scrollIntoView: true });
    },
    selection() {
      const main = view.state.selection.main;
      return { from: main.from, to: main.to, text: view.state.sliceDoc(main.from, main.to) };
    },
    replaceSelection(text) {
      const main = view.state.selection.main;
      view.dispatch({ changes: { from: main.from, to: main.to, insert: text }, selection: { anchor: main.from + text.length } });
    },
    replaceAll(query, replacement) {
      if (!query) return 0;
      const text = view.state.doc.toString();
      const hay = text.toLowerCase();
      const needle = query.toLowerCase();
      const changes = [];
      let at = hay.indexOf(needle);
      while (at !== -1) {
        changes.push({ from: at, to: at + query.length, insert: replacement });
        at = hay.indexOf(needle, at + Math.max(1, needle.length));
      }
      if (changes.length) view.dispatch({ changes });
      return changes.length;
    },
    view() { return view; },
  };
}
