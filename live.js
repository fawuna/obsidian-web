// Live preview editor: CodeMirror 6 with Obsidian-style inline markdown.
// Inactive lines are rendered (markup hidden), the line with the caret shows raw source.
import {
  EditorState,
  EditorView,
  Decoration,
  WidgetType,
  ViewPlugin,
  keymap,
  drawSelection,
  history,
  historyKeymap,
  defaultKeymap,
  indentWithTab,
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

function buildDecorations(editorView) {
  const doc = editorView.state.doc;
  const activeFrom = doc.lineAt(editorView.state.selection.main.head).from;
  const decos = [];
  let inCode = false;
  let inFront = doc.lines > 0 && doc.line(1).text.trim() === "---";

  for (let n = 1; n <= doc.lines; n++) {
    const line = doc.line(n);
    const text = line.text;
    const isActive = line.from === activeFrom;

    if (inFront) {
      decos.push(Decoration.line({ class: "cm-frontmatter-line" }).range(line.from));
      if (n > 1 && text.trim() === "---") inFront = false;
      continue;
    }

    if (/^\s*(```|~~~)/.test(text)) {
      decos.push(Decoration.line({ class: "cm-code-fence" }).range(line.from));
      inCode = !inCode;
      continue;
    }
    if (inCode) {
      decos.push(Decoration.line({ class: "cm-code-line" }).range(line.from));
      continue;
    }
    if (!text.trim()) continue;

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
  }
  return Decoration.set(decos, true);
}

const liveDecorations = ViewPlugin.fromClass(class {
  constructor(editorView) { this.decorations = buildDecorations(editorView); }
  update(update) {
    if (update.docChanged || update.selectionSet || update.viewportChanged) {
      this.decorations = buildDecorations(update.view);
    }
  }
}, { decorations: (value) => value.decorations });

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
