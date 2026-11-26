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

let cfg = null;
let view = null;
let lastText = "";
let suppress = false;
let linkPending = false;

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
  toDOM() {
    const box = document.createElement("input");
    box.type = "checkbox";
    box.className = "cm-task";
    box.checked = this.checked;
    box.addEventListener("mousedown", (e) => e.preventDefault());
    box.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (!view) return;
      const line = view.state.doc.lineAt(this.lineFrom);
      const open = line.text.indexOf("[");
      if (open < 0) return;
      const at = line.from + open + 1;
      const ch = view.state.sliceDoc(at, at + 1);
      view.dispatch({ changes: { from: at, to: at + 1, insert: ch === " " ? "x" : " " } });
      view.focus();
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
  constructor(src, alt) {
    super();
    this.src = src;
    this.alt = alt;
  }
  eq(other) { return other.src === this.src; }
  toDOM() {
    const img = document.createElement("img");
    img.className = "cm-inline-img";
    img.src = this.src;
    img.alt = this.alt;
    img.loading = "lazy";
    return img;
  }
  ignoreEvent() { return true; }
}

const INLINE_RE = /\*\*([^*\n]+)\*\*|__([^_\n]+)__|(?<![*_])\*([^*\n]+)\*(?![*_])|(?<![*_])_([^_\n]+)_(?![*_])|`([^`\n]+)`|==([^=\n]+)==|~~([^~\n]+)~~|!\[\[([^\]\n]+?)\]\]|\[\[([^\]\n]+?)\]\]|\[([^\]\n]+)\]\(([^)\s]+)\)/g;
const TAG_RE = /(^|[\s(])#([A-Za-z0-9_\u0400-\u04FF][A-Za-z0-9_\u0400-\u04FF/-]*)/g;

function decorateInline(decos, text, lineFrom) {
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
        const src = cfg.imageUrl(name);
        decos.push(Decoration.replace({ widget: new ImageWidget(src, name) }).range(at, at + full.length));
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


function buildDecorations(state) {
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
      decorateInline(decos, text, line.from);
    }
    n++;
  }
  return Decoration.set(decos, true);
}

const liveDecorations = StateField.define({
  create(state) { return buildDecorations(state); },
  update(decorations, tr) {
    if (tr.docChanged || tr.selection) return buildDecorations(tr.state);
    return decorations;
  },
  provide: (field) => EditorView.decorations.from(field),
});

function wrapSelection(editorView, before, after) {
  const { from, to } = editorView.state.selection.main;
  const selected = editorView.state.sliceDoc(from, to);
  editorView.dispatch({
    changes: { from, to, insert: before + selected + after },
    selection: { anchor: from + before.length, head: to + before.length },
  });
  return true;
}

function buildExtensions() {
  return [
    history(),
    drawSelection(),
    EditorView.lineWrapping,
    keymap.of([
      { key: "Mod-b", run: (v) => wrapSelection(v, "**", "**") },
      { key: "Mod-i", run: (v) => wrapSelection(v, "*", "*") },
      { key: "Mod-k", run: (v) => wrapSelection(v, "[[", "]]") },
      indentWithTab,
      ...defaultKeymap,
      ...historyKeymap,
    ]),
    liveDecorations,
    EditorView.contentAttributes.of({ spellcheck: "false", autocapitalize: "off", autocorrect: "off" }),
    EditorView.domEventHandlers({
      mousedown(event) {
        const link = event.target.closest && event.target.closest(".cm-wikilink");
        if (link && (event.metaKey || event.ctrlKey)) {
          event.preventDefault();
          cfg.onOpenNote(link.dataset.target || "");
          return true;
        }
        return false;
      },
    }),
    EditorView.updateListener.of((update) => {
      if (update.docChanged && !suppress) {
        const text = update.state.doc.toString();
        const prev = lastText;
        lastText = text;
        cfg.onChange(text, prev);
        const head = update.state.selection.main.head;
        const typed = update.transactions.some((tr) => tr.isUserEvent("input.type"));
        if (typed && !linkPending && head >= 2 && update.state.sliceDoc(head - 2, head) === "[[") {
          linkPending = true;
          const from = head - 2;
          setTimeout(() => {
            linkPending = false;
            if (!view) return;
            const at = Math.min(from, view.state.doc.length);
            if (view.state.sliceDoc(at, at + 2) === "[[") {
              view.dispatch({ changes: { from: at, to: at + 2 } });
            }
            cfg.onLinkTrigger(from);
          }, 0);
        }
      }
      if ((update.selectionSet || update.docChanged) && update.view.hasFocus) {
        const head = update.state.selection.main.head;
        const line = update.state.doc.lineAt(head);
        cfg.onCursor(line.number, head - line.from + 1);
      }
    }),
  ];
}

export function initLive(options) {
  cfg = options;
  const host = document.getElementById("live");
  if (!host) return null;

  const state = EditorState.create({
    doc: options.getText(),
    extensions: buildExtensions(),
  });

  view = new EditorView({ state, parent: host });
  lastText = view.state.doc.toString();
  host.classList.add("cm-live-host");

  return {
    reset(text) {
      if (!view) return;
      suppress = true;
      view.setState(EditorState.create({ doc: text, extensions: buildExtensions() }));
      suppress = false;
      lastText = text;
      view.scrollDOM.scrollTop = 0;
      cfg.onCursor(1, 1);
    },
    setDoc(text) {
      if (!view) return;
      if (view.state.doc.toString() === text) { lastText = text; return; }
      suppress = true;
      const head = Math.min(view.state.selection.main.head, text.length);
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: text },
        selection: { anchor: head },
      });
      suppress = false;
      lastText = text;
    },
    getText() { return view ? view.state.doc.toString() : ""; },
    focus() { if (view) view.focus(); },
    caret() {
      if (!view) return null;
      const head = view.state.selection.main.head;
      const line = view.state.doc.lineAt(head);
      return { pos: head, line: line.number, ch: head - line.from + 1 };
    },
    goToLine(n) {
      if (!view) return;
      const number = Math.max(1, Math.min(view.state.doc.lines, n));
      const line = view.state.doc.line(number);
      view.dispatch({ selection: { anchor: line.from }, scrollIntoView: true });
      view.focus();
    },
    insertAtCaret(text) {
      if (!view) return;
      const head = view.state.selection.main.head;
      view.dispatch({ changes: { from: head, insert: text }, selection: { anchor: head + text.length } });
      view.focus();
    },
    insertAt(pos, text) {
      if (!view) return;
      const at = Math.max(0, Math.min(pos, view.state.doc.length));
      view.dispatch({ changes: { from: at, insert: text }, selection: { anchor: at + text.length } });
      view.focus();
    },
    wrap(marker) { if (view) wrapSelection(view, marker, marker); },
    select(from, to) {
      if (!view) return;
      view.dispatch({ selection: { anchor: from, head: to }, scrollIntoView: true });
    },
    selection() {
      if (!view) return null;
      const main = view.state.selection.main;
      return { from: main.from, to: main.to, text: view.state.sliceDoc(main.from, main.to) };
    },
    replaceSelection(text) {
      if (!view) return;
      const main = view.state.selection.main;
      view.dispatch({ changes: { from: main.from, to: main.to, insert: text }, selection: { anchor: main.from + text.length } });
    },
    replaceAll(query, replacement) {
      if (!view || !query) return 0;
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
