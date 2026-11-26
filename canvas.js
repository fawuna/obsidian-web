// Canvas view: Obsidian-compatible .canvas boards (JSON with nodes + edges).
let Vault = null;
let board = null;
let world = null;
let svg = null;
let model = { nodes: [], edges: [] };
let path = null;
let sha = null;
let dirty = false;
let view = { x: 60, y: 60, k: 1 };
let selected = null;
let selectedNodes = new Set();
let selectedEdge = null;
let skipClick = false;
let resizing = null;
let connectMode = false;
let connectFrom = null;
let dragging = null;
let panning = null;
let historyStack = [];
let historyIndex = -1;
const excerpts = new Map();

const uid = () => Math.random().toString(36).slice(2, 10);

const CANVAS_COLORS = {
  "1": "#e5686c",
  "2": "#e0b458",
  "3": "#52c98a",
  "4": "#5d9cff",
  "5": "#a882ff",
  "6": "#9a9a9a",
};

function cycleColor(node) {
  const keys = Object.keys(CANVAS_COLORS);
  const at = node.color ? keys.indexOf(node.color) : -1;
  const next = at + 1;
  if (next >= keys.length) delete node.color;
  else node.color = keys[next];
  dirty = true;
  pushHistory();
  render();
}

function snapshotModel() {
  return JSON.stringify({ nodes: model.nodes, edges: model.edges });
}

function pushHistory() {
  const snap = snapshotModel();
  if (historyIndex >= 0 && historyStack[historyIndex] === snap) return;
  historyStack = historyStack.slice(0, historyIndex + 1);
  historyStack.push(snap);
  historyIndex = historyStack.length - 1;
  if (historyStack.length > 100) { historyStack.shift(); historyIndex -= 1; }
}

function restoreHistory(index) {
  if (index < 0 || index >= historyStack.length) return;
  historyIndex = index;
  try { model = JSON.parse(historyStack[index]); } catch { return; }
  if (!Array.isArray(model.nodes)) model.nodes = [];
  if (!Array.isArray(model.edges)) model.edges = [];
  selected = null;
  selectedNodes.clear();
  selectedEdge = null;
  dirty = true;
  render();
}

function undoCanvas() {
  if (historyIndex > 0) restoreHistory(historyIndex - 1);
}

function redoCanvas() {
  if (historyIndex < historyStack.length - 1) restoreHistory(historyIndex + 1);
}

function applyTransform() {
  world.style.transform = "translate(" + view.x + "px," + view.y + "px) scale(" + view.k + ")";
}

function setCanvasName(text) {
  document.getElementById("canvasName").textContent = text;
}

function sidePoint(node, side) {
  const width = node.width || 320;
  const height = node.height || 200;
  if (side === "top") return { x: node.x + width / 2, y: node.y };
  if (side === "bottom") return { x: node.x + width / 2, y: node.y + height };
  if (side === "left") return { x: node.x, y: node.y + height / 2 };
  return { x: node.x + width, y: node.y + height / 2 };
}

function nearestSides(a, b) {
  const ax = a.x + (a.width || 320) / 2, ay = a.y + (a.height || 200) / 2;
  const bx = b.x + (b.width || 320) / 2, by = b.y + (b.height || 200) / 2;
  const dx = bx - ax, dy = by - ay;
  if (Math.abs(dx) >= Math.abs(dy)) return dx >= 0 ? ["right", "left"] : ["left", "right"];
  return dy >= 0 ? ["bottom", "top"] : ["top", "bottom"];
}

function edgeGeometry(a, b, edge) {
  let fromSide = edge.fromSide;
  let toSide = edge.toSide;
  if (!fromSide || !toSide) {
    const auto = nearestSides(a, b);
    fromSide = fromSide || auto[0];
    toSide = toSide || auto[1];
  }
  const p1 = sidePoint(a, fromSide);
  const p2 = sidePoint(b, toSide);
  const distance = Math.hypot(p2.x - p1.x, p2.y - p1.y);
  const pull = Math.max(40, Math.min(220, distance * 0.45));
  const normal = (side, sign) => side === "right" ? [sign, 0] :
    side === "left" ? [-sign, 0] :
    side === "bottom" ? [0, sign] : [0, -sign];
  const [n1x, n1y] = normal(fromSide, pull);
  const [n2x, n2y] = normal(toSide, pull);
  const c1x = p1.x + n1x, c1y = p1.y + n1y;
  const c2x = p2.x + n2x, c2y = p2.y + n2y;
  return {
    d: "M " + p1.x + " " + p1.y + " C " + c1x + " " + c1y + ", " + c2x + " " + c2y + ", " + p2.x + " " + p2.y,
    labelX: (p1.x + 3 * c1x + 3 * c2x + p2.x) / 8,
    labelY: (p1.y + 3 * c1y + 3 * c2y + p2.y) / 8,
  };
}

function edgeStroke(edge) {
  return CANVAS_COLORS[edge.color] || (/^#[0-9a-f]{3,8}$/i.test(edge.color || "") ? edge.color : null);
}

function edgeMarkerId(edge, defs, hexMarkers) {
  if (selectedEdge === edge.id) return "cv-arrow-sel";
  if (CANVAS_COLORS[edge.color]) return "cv-arrow-" + edge.color;
  if (/^#[0-9a-f]{3,8}$/i.test(edge.color || "")) {
    const id = "cv-arrow-hex-" + edge.color.slice(1).toLowerCase();
    if (!hexMarkers.has(id)) {
      hexMarkers.add(id);
      addArrowMarker(defs, id, edge.color);
    }
    return id;
  }
  return "cv-arrow-default";
}

function addArrowMarker(defs, id, fill, opacity) {
  const ns = "http://www.w3.org/2000/svg";
  const marker = document.createElementNS(ns, "marker");
  marker.setAttribute("id", id);
  marker.setAttribute("viewBox", "0 0 10 10");
  marker.setAttribute("refX", "9");
  marker.setAttribute("refY", "5");
  marker.setAttribute("markerWidth", "7");
  marker.setAttribute("markerHeight", "7");
  marker.setAttribute("orient", "auto-start-reverse");
  const shape = document.createElementNS(ns, "path");
  shape.setAttribute("d", "M 0 0 L 10 5 L 0 10 z");
  shape.setAttribute("fill", fill);
  if (opacity) shape.setAttribute("fill-opacity", opacity);
  marker.appendChild(shape);
  defs.appendChild(marker);
}

function updateEdgePaths() {
  if (!svg) return;
  const byId = new Map(model.nodes.map((n) => [n.id, n]));
  for (const p of svg.querySelectorAll(".cv-edge")) {
    const edge = model.edges.find((ed) => ed.id === p.dataset.id);
    if (!edge) continue;
    const a = byId.get(edge.fromNode), b = byId.get(edge.toNode);
    if (!a || !b) continue;
    const geo = edgeGeometry(a, b, edge);
    p.setAttribute("d", geo.d);
    const label = svg.querySelector('.cv-edge-label[data-id="' + edge.id + '"]');
    if (label) {
      label.setAttribute("x", String(geo.labelX));
      label.setAttribute("y", String(geo.labelY));
    }
  }
}

let edgeBar = null;

function hideEdgeBar() {
  if (edgeBar) {
    edgeBar.remove();
    edgeBar = null;
  }
}

function showEdgeBar(edge, clientX, clientY) {
  hideEdgeBar();
  if (!board) return;
  const rect = board.getBoundingClientRect();
  const bar = document.createElement("div");
  bar.className = "cv-edge-bar";
  const refresh = () => { render(); showEdgeBar(edge, clientX, clientY); };
  const action = (fn) => (event) => {
    event.preventDefault();
    event.stopPropagation();
    fn();
  };

  const none = document.createElement("button");
  none.className = "cv-swatch cv-swatch-none" + (!edge.color ? " on" : "");
  none.title = "Без кольору";
  none.onclick = action(() => { delete edge.color; pushHistory(); dirty = true; refresh(); });
  bar.appendChild(none);
  for (const [key, color] of Object.entries(CANVAS_COLORS)) {
    const swatch = document.createElement("button");
    swatch.className = "cv-swatch" + (edge.color === key ? " on" : "");
    swatch.style.background = color;
    swatch.title = "Колір " + key;
    swatch.onclick = action(() => { edge.color = key; pushHistory(); dirty = true; refresh(); });
    bar.appendChild(swatch);
  }

  const arrowState = edge.toEnd === "arrow"
    ? (edge.fromEnd === "arrow" ? "both" : "to")
    : (edge.fromEnd === "arrow" ? "from" : "none");
  const dir = document.createElement("button");
  dir.className = "cv-bar-btn";
  dir.textContent = arrowState === "both" ? "↔" : arrowState === "to" ? "→" : arrowState === "from" ? "←" : "—";
  dir.title = "Напрямок стрілки";
  dir.onclick = action(() => {
    const next = { none: "to", to: "both", both: "none", from: "none" }[arrowState] || "to";
    edge.toEnd = next === "to" || next === "both" ? "arrow" : "none";
    edge.fromEnd = next === "both" ? "arrow" : "none";
    pushHistory();
    dirty = true;
    refresh();
  });
  bar.appendChild(dir);

  const label = document.createElement("button");
  label.className = "cv-bar-btn";
  label.textContent = "T";
  label.title = "Підпис ребра";
  label.onclick = action(() => {
    const text = prompt("Підпис ребра (порожньо — без підпису):", edge.label || "");
    if (text === null) return;
    if (text.trim()) edge.label = text.trim(); else delete edge.label;
    pushHistory();
    dirty = true;
    refresh();
  });
  bar.appendChild(label);

  const remove = document.createElement("button");
  remove.className = "cv-bar-btn cv-bar-danger";
  remove.textContent = "🗑";
  remove.title = "Видалити звʼязок";
  remove.onclick = action(() => {
    model.edges = model.edges.filter((item) => item.id !== edge.id);
    selectedEdge = null;
    pushHistory();
    dirty = true;
    render();
  });
  bar.appendChild(remove);

  edgeBar = bar;
  board.appendChild(bar);
  const width = bar.offsetWidth, height = bar.offsetHeight;
  bar.style.left = Math.max(8, Math.min(rect.width - width - 8, clientX - rect.left - width / 2)) + "px";
  bar.style.top = Math.max(8, Math.min(rect.height - height - 8, clientY - rect.top - height - 12)) + "px";
}

function linkHost(url) {
  try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return url; }
}

function isInsideGroup(node, group) {
  const gx = group.x, gy = group.y;
  const gw = group.width || 480, gh = group.height || 340;
  return node.x >= gx && node.y >= gy && node.x + (node.width || 320) <= gx + gw && node.y + (node.height || 200) <= gy + gh;
}

function render() {
  hideEdgeBar();
  const alignBar = document.getElementById("cvAlign");
  if (alignBar) alignBar.style.display = selectedNodes.size >= 2 ? "" : "none";
  world.innerHTML = "";
  svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("class", "cv-svg");
  svg.style.position = "absolute";
  svg.style.left = "0";
  svg.style.top = "0";
  svg.style.width = "1px";
  svg.style.height = "1px";
  svg.style.overflow = "visible";
  world.appendChild(svg);

  const defs = document.createElementNS("http://www.w3.org/2000/svg", "defs");
  svg.appendChild(defs);
  addArrowMarker(defs, "cv-arrow-default", "var(--accent)", "0.6");
  addArrowMarker(defs, "cv-arrow-sel", "var(--accent)");
  for (const [key, color] of Object.entries(CANVAS_COLORS)) addArrowMarker(defs, "cv-arrow-" + key, color);
  const hexMarkers = new Set();

  const byId = new Map(model.nodes.map((n) => [n.id, n]));
  for (const e of model.edges) {
    const a = byId.get(e.fromNode), b = byId.get(e.toNode);
    if (!a || !b) continue;
    const geo = edgeGeometry(a, b, e);
    const p = document.createElementNS("http://www.w3.org/2000/svg", "path");
    p.setAttribute("d", geo.d);
    p.setAttribute("class", "cv-edge" + (selectedEdge === e.id ? " sel" : ""));
    p.dataset.id = e.id;
    const tone = edgeStroke(e);
    if (tone && selectedEdge !== e.id) p.style.stroke = tone;
    const marker = "url(#" + edgeMarkerId(e, defs, hexMarkers) + ")";
    if (e.toEnd === "arrow") p.setAttribute("marker-end", marker);
    if (e.fromEnd === "arrow") p.setAttribute("marker-start", marker);
    p.addEventListener("click", (ev) => {
      ev.stopPropagation();
      selectedEdge = e.id;
      selected = null;
      selectedNodes.clear();
      render();
      showEdgeBar(e, ev.clientX, ev.clientY);
    });
    p.addEventListener("dblclick", (ev) => {
      ev.stopPropagation();
      const label = prompt("Підпис ребра (порожньо — без підпису):", e.label || "");
      if (label === null) return;
      if (label.trim()) e.label = label.trim(); else delete e.label;
      pushHistory();
      dirty = true;
      render();
    });
    svg.appendChild(p);

    if (e.label) {
      const t = document.createElementNS("http://www.w3.org/2000/svg", "text");
      t.setAttribute("x", String(geo.labelX));
      t.setAttribute("y", String(geo.labelY));
      t.setAttribute("class", "cv-edge-label");
      t.dataset.id = e.id;
      t.textContent = e.label;
      svg.appendChild(t);
    }
  }

  const ordered = [...model.nodes].sort((a, b) => (a.type === "group" ? 0 : 1) - (b.type === "group" ? 0 : 1));
  for (const n of ordered) {
    const isGroup = n.type === "group";
    const isLink = n.type === "link";
    const node = document.createElement("div");
    node.className = "cv-node" + (isGroup ? " cv-group" : "") + (isLink ? " cv-link" : "") + (selectedNodes.has(n.id) || selected === n.id ? " selected" : "");
    node.style.left = n.x + "px";
    node.style.top = n.y + "px";
    node.style.width = (n.width || 320) + "px";
    node.style.height = (n.height || 200) + "px";
    node.dataset.id = n.id;
    if (n.color && CANVAS_COLORS[n.color]) {
      node.style.borderColor = CANVAS_COLORS[n.color];
      node.style.boxShadow = "0 0 0 1px " + CANVAS_COLORS[n.color] + ", 0 6px 18px rgba(0,0,0,.35)";
      node.dataset.color = n.color;
    }

    const head = document.createElement("div");
    head.className = "cv-head";
    head.textContent = (isGroup ? "🗂 " : isLink ? "🌐 " : n.type === "file" ? "📄 " : "📝 ") + (isGroup ? (n.label || "Група") : isLink ? (n.title || linkHost(n.url)) : (n.file || "text"));
    const dot = document.createElement("span");
    dot.className = "cv-color";
    dot.title = "Колір картки";
    dot.style.background = n.color ? CANVAS_COLORS[n.color] : "transparent";
    dot.style.border = "1px solid " + (n.color ? "transparent" : "var(--line)");
    dot.onclick = (e) => { e.stopPropagation(); cycleColor(n); };
    head.appendChild(dot);
    head.onmousedown = (e) => {
      if (e.button !== 0) return;
      e.stopPropagation();
      selectedEdge = null;
      hideEdgeBar();
      if (e.shiftKey) {
        if (selectedNodes.has(n.id)) selectedNodes.delete(n.id); else selectedNodes.add(n.id);
        selected = selectedNodes.has(n.id) ? n.id : (selectedNodes.values().next().value || null);
        skipClick = true;
        dragging = null;
        render();
        return;
      }
      if (!selectedNodes.has(n.id)) selectedNodes = new Set([n.id]);
      selected = n.id;
      const peers = [...selectedNodes]
        .filter((id) => id !== n.id)
        .map((id) => model.nodes.find((item) => item.id === id))
        .filter(Boolean)
        .map((node) => ({ node, x: node.x, y: node.y }));
      const children = isGroup
        ? model.nodes.filter((other) => other.id !== n.id && other.type !== "group" && isInsideGroup(other, n)).map((other) => ({ node: other, x: other.x, y: other.y }))
        : [];
      dragging = { node: n, startX: e.clientX, startY: e.clientY, origX: n.x, origY: n.y, children, peers };
      render();
    };
    if (isGroup) {
      head.ondblclick = (e) => {
        e.stopPropagation();
        const label = prompt("Назва групи:", n.label || "Група");
        if (label !== null) { n.label = label.trim() || "Група"; dirty = true; render(); }
      };
    } else if (isLink) {
      head.ondblclick = (e) => { e.stopPropagation(); window.open(n.url, "_blank", "noopener"); };
    }
    node.appendChild(head);

    const body = document.createElement("div");
    body.className = "cv-body" + (isGroup ? " cv-group-body" : "");
    if (isGroup) {
      // group cards are visual containers
    } else if (isLink) {
      const frame = document.createElement("iframe");
      frame.className = "cv-iframe";
      frame.src = n.url;
      frame.loading = "lazy";
      frame.setAttribute("sandbox", "allow-scripts allow-popups allow-forms");
      frame.referrerPolicy = "no-referrer";
      body.appendChild(frame);
    } else if (n.type === "text") {
      const ta = document.createElement("textarea");
      ta.value = n.text || "";
      let histTimer = null;
      ta.oninput = () => {
        n.text = ta.value;
        dirty = true;
        clearTimeout(histTimer);
        histTimer = setTimeout(pushHistory, 600);
      };
      ta.onblur = () => { clearTimeout(histTimer); pushHistory(); };
      ta.onmousedown = (e) => e.stopPropagation();
      body.appendChild(ta);
    } else {
      const text = excerpts.get(n.file);
      if (text === undefined) {
        body.textContent = "завантажую…";
        Vault.ghGet(n.file).then(({ text }) => { excerpts.set(n.file, text.slice(0, 600)); render(); }).catch(() => { excerpts.set(n.file, ""); render(); });
      } else {
        body.textContent = text.slice(0, 600) || "(порожньо)";
      }
      body.ondblclick = () => { Vault.openNote(n.file); };
    }
    node.appendChild(body);

    const handle = document.createElement("div");
    handle.className = "cv-resize";
    handle.title = "Потягни, щоб змінити розмір";
    handle.onmousedown = (e) => {
      if (e.button !== 0) return;
      e.stopPropagation();
      e.preventDefault();
      resizing = { node: n, startX: e.clientX, startY: e.clientY, w: n.width || 320, h: n.height || 200 };
    };
    node.appendChild(handle);

    node.onclick = (e) => {
      e.stopPropagation();
      if (skipClick) { skipClick = false; return; }
      selectedEdge = null;
      if (connectMode) {
        if (!connectFrom) { connectFrom = n.id; selected = n.id; Vault.toast("тепер тицьни другу картку"); }
        else if (connectFrom !== n.id) {
          const fromNode = model.nodes.find((item) => item.id === connectFrom);
          const sides = fromNode ? nearestSides(fromNode, n) : ["right", "left"];
          model.edges.push({
            id: uid(),
            fromNode: connectFrom,
            toNode: n.id,
            fromSide: sides[0],
            toSide: sides[1],
            fromEnd: "none",
            toEnd: "arrow",
          });
          pushHistory();
          connectFrom = null;
          connectMode = false;
          dirty = true;
          Vault.toast("звʼязок додано");
        }
        render();
        return;
      }
      if (e.shiftKey) {
        if (selectedNodes.has(n.id)) selectedNodes.delete(n.id); else selectedNodes.add(n.id);
        selected = selectedNodes.has(n.id) ? n.id : (selectedNodes.values().next().value || null);
        render();
        return;
      }
      selectedNodes = new Set([n.id]);
      selected = n.id;
      render();
    };
    node.oncontextmenu = (event) => nodeContext(event, n);
    world.appendChild(node);
  }
  applyTransform();
}

function toWorld(sx, sy) {
  const rect = board.getBoundingClientRect();
  return { x: (sx - rect.left - view.x) / view.k, y: (sy - rect.top - view.y) / view.k };
}

async function save(silent) {
  if (!path) return;
  try {
    const json = JSON.stringify({ nodes: model.nodes, edges: model.edges }, null, 2);
    const res = await Vault.ghPut(path, json, sha, "canvas: " + path);
    sha = res.content.sha;
    dirty = false;
    if (!silent) Vault.toast("canvas збережено");
  } catch (error) {
    if (error.status === 409 || error.status === 422) {
      const fresh = await Vault.ghGet(path).catch(() => null);
      if (fresh) { sha = fresh.sha; return save(silent); }
    }
    Vault.toast("Не збереглось: " + error.message);
  }
}

async function open(p) {
  Vault.setView("canvas");
  path = p;
  setCanvasName(p);
  Vault.state.active = null;
  if (model.nodes.length && dirty) await save(true);
  try {
    const data = await Vault.ghGet(p);
    sha = data.sha;
    try { model = JSON.parse(data.text); } catch { model = { nodes: [], edges: [] }; }
    if (!model.nodes) model.nodes = [];
    if (!model.edges) model.edges = [];
  } catch (error) {
    Vault.toast("Не відкрилось: " + error.message);
    model = { nodes: [], edges: [] };
  }
  dirty = false;
  selected = null;
  selectedEdge = null;
  selectedNodes.clear();
  historyStack = [];
  historyIndex = -1;
  pushHistory();
  view = { x: 60, y: 60, k: 1 };
  render();
  Vault.paint();
}

async function create() {
  const name = prompt("Назва canvas (без .canvas):", "Нова дошка");
  if (!name) return;
  const p = name.trim().replace(/^\/+/, "").replace(/\.canvas$/, "") + ".canvas";
  try {
    await Vault.ghPut(p, JSON.stringify({ nodes: [], edges: [] }, null, 2), null, "add " + p);
    Vault.state.pending.add(p);
    await Vault.loadTree();
    await open(p);
    Vault.toast("створено " + p);
  } catch (error) {
    Vault.toast("Не створилось: " + error.message);
  }
}

function alignSelection(mode) {
  const nodes = model.nodes.filter((n) => selectedNodes.has(n.id));
  if (nodes.length < 2) { Vault.toast("Вибери 2+ картки"); return false; }
  const minX = Math.min(...nodes.map((n) => n.x));
  const minY = Math.min(...nodes.map((n) => n.y));
  const maxX = Math.max(...nodes.map((n) => n.x + (n.width || 320)));
  const maxY = Math.max(...nodes.map((n) => n.y + (n.height || 200)));
  for (const n of nodes) {
    const w = n.width || 320;
    const h = n.height || 200;
    if (mode === "left") n.x = minX;
    else if (mode === "hcenter") n.x = Math.round((minX + maxX) / 2 - w / 2);
    else if (mode === "right") n.x = maxX - w;
    else if (mode === "top") n.y = minY;
    else if (mode === "vcenter") n.y = Math.round((minY + maxY) / 2 - h / 2);
    else if (mode === "bottom") n.y = maxY - h;
  }
  pushHistory();
  dirty = true;
  render();
  return true;
}

function roundedPath(ctx, x, y, w, h, r) {
  const radius = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
}

function canvasImageDataUrl() {
  if (!model.nodes.length) return "";
  const pad = 40;
  const minX = Math.min(...model.nodes.map((n) => n.x)) - pad;
  const minY = Math.min(...model.nodes.map((n) => n.y)) - pad;
  const maxX = Math.max(...model.nodes.map((n) => n.x + (n.width || 320))) + pad;
  const maxY = Math.max(...model.nodes.map((n) => n.y + (n.height || 200))) + pad;
  const width = Math.max(1, maxX - minX);
  const height = Math.max(1, maxY - minY);
  const scale = 2;
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(width * scale);
  canvas.height = Math.round(height * scale);
  const ctx = canvas.getContext("2d");
  ctx.scale(scale, scale);
  ctx.translate(-minX, -minY);
  const css = getComputedStyle(document.documentElement);
  const bg = css.getPropertyValue("--bg").trim() || "#111";
  const bg2 = css.getPropertyValue("--bg-2").trim() || "#1c1c1f";
  const text = css.getPropertyValue("--text").trim() || "#ddd";
  const line = css.getPropertyValue("--line").trim() || "#333";
  const accent = css.getPropertyValue("--accent").trim() || "#a882ff";
  ctx.fillStyle = bg;
  ctx.fillRect(minX, minY, width, height);
  const byId = new Map(model.nodes.map((n) => [n.id, n]));
  for (const e of model.edges) {
    const a = byId.get(e.fromNode), b = byId.get(e.toNode);
    if (!a || !b) continue;
    const geo = edgeGeometry(a, b, e);
    ctx.strokeStyle = CANVAS_COLORS[e.color] || accent;
    ctx.lineWidth = 2;
    ctx.stroke(new Path2D(geo.d));
    if (e.label) {
      ctx.fillStyle = text;
      ctx.font = "11px sans-serif";
      ctx.textAlign = "center";
      ctx.fillText(e.label, geo.labelX, geo.labelY - 4);
    }
  }
  const ordered = [...model.nodes].sort((a, b) => (a.type === "group" ? 0 : 1) - (b.type === "group" ? 0 : 1));
  for (const n of ordered) {
    const w = n.width || 320;
    const h = n.height || 200;
    const tone = n.color && CANVAS_COLORS[n.color] ? CANVAS_COLORS[n.color] : line;
    roundedPath(ctx, n.x, n.y, w, h, n.type === "group" ? 14 : 10);
    ctx.fillStyle = n.type === "group" ? "rgba(168,130,255,.08)" : bg2;
    ctx.fill();
    ctx.strokeStyle = tone;
    ctx.lineWidth = n.type === "group" ? 2 : 1;
    ctx.setLineDash(n.type === "group" ? [6, 4] : []);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = n.type === "group" ? text : accent;
    ctx.font = "600 13px sans-serif";
    ctx.textAlign = "left";
    const title = n.type === "group" ? (n.label || "Група") : n.type === "link" ? (n.title || linkHost(n.url)) : (n.file || "text");
    ctx.fillText(String(title).slice(0, 60), n.x + 12, n.y + 22);
    const body = n.type === "text" ? (n.text || "") : n.type === "file" ? (excerpts.get(n.file) || "") : n.type === "link" ? n.url : "";
    if (body) {
      ctx.fillStyle = text;
      ctx.font = "12px sans-serif";
      const words = String(body).replace(/\s+/g, " ").slice(0, 240).split(" ");
      let lineText = "";
      let y = n.y + 44;
      for (const word of words) {
        const test = lineText ? lineText + " " + word : word;
        if (ctx.measureText(test).width > w - 24) {
          ctx.fillText(lineText, n.x + 12, y);
          y += 16;
          lineText = word;
          if (y > n.y + h - 12) break;
        } else {
          lineText = test;
        }
      }
      if (lineText && y <= n.y + h - 12) ctx.fillText(lineText, n.x + 12, y);
    }
  }
  return canvas.toDataURL("image/png");
}

function deleteSelection() {
  if (!selectedNodes.size) return;
  const ids = new Set(selectedNodes);
  model.nodes = model.nodes.filter((n) => !ids.has(n.id));
  model.edges = model.edges.filter((edge) => !ids.has(edge.fromNode) && !ids.has(edge.toNode));
  selectedNodes.clear();
  selected = null;
  pushHistory();
  dirty = true;
  render();
}

function duplicateSelection() {
  const list = model.nodes.filter((n) => selectedNodes.has(n.id));
  if (!list.length) return;
  const map = new Map();
  for (const node of list) {
    const copy = { ...node, id: uid(), x: node.x + 40, y: node.y + 40 };
    map.set(node.id, copy.id);
    model.nodes.push(copy);
  }
  for (const edge of [...model.edges]) {
    if (map.has(edge.fromNode) && map.has(edge.toNode)) {
      model.edges.push({ ...edge, id: uid(), fromNode: map.get(edge.fromNode), toNode: map.get(edge.toNode) });
    }
  }
  selectedNodes = new Set(map.values());
  selected = selectedNodes.values().next().value || null;
  pushHistory();
  dirty = true;
  render();
}

function bringSelectionToFront() {
  if (!selectedNodes.size) return;
  const chosen = model.nodes.filter((n) => selectedNodes.has(n.id));
  model.nodes = model.nodes.filter((n) => !selectedNodes.has(n.id)).concat(chosen);
  pushHistory();
  dirty = true;
  render();
}

function sendSelectionToBack() {
  if (!selectedNodes.size) return;
  const chosen = model.nodes.filter((n) => selectedNodes.has(n.id));
  model.nodes = chosen.concat(model.nodes.filter((n) => !selectedNodes.has(n.id)));
  pushHistory();
  dirty = true;
  render();
}

function cycleSelectionColor() {
  const keys = Object.keys(CANVAS_COLORS);
  for (const node of model.nodes.filter((n) => selectedNodes.has(n.id))) {
    const at = node.color ? keys.indexOf(node.color) : -1;
    const next = at + 1;
    if (next >= keys.length) delete node.color;
    else node.color = keys[next];
  }
  pushHistory();
  dirty = true;
  render();
}

function nodeContext(event, node) {
  event.preventDefault();
  event.stopPropagation();
  if (!selectedNodes.has(node.id)) {
    selectedNodes = new Set([node.id]);
    selected = node.id;
    render();
  }
  const items = [];
  if (node.type === "file") items.push({ label: "Відкрити нотатку", run: () => Vault.openNote(node.file) });
  else if (node.type === "link") items.push({ label: "Відкрити посилання", run: () => window.open(node.url, "_blank", "noopener") });
  else if (node.type === "group") {
    items.push({ label: "Перейменувати групу", run: () => {
      const label = prompt("Назва групи:", node.label || "Група");
      if (label !== null) { node.label = label.trim() || "Група"; pushHistory(); dirty = true; render(); }
    } });
  } else {
    items.push({ label: "Редагувати текст", run: () => {
      const ta = document.querySelector('.cv-node[data-id="' + node.id + '"] textarea');
      if (ta) ta.focus();
    } });
  }
  items.push({ sep: true });
  items.push({ label: "Дублювати", run: duplicateSelection });
  items.push({ label: "На передній план", run: bringSelectionToFront });
  items.push({ label: "Назад", run: sendSelectionToBack });
  items.push({ label: "Наступний колір", run: cycleSelectionColor });
  items.push({ sep: true });
  items.push({ label: "Видалити", danger: true, run: deleteSelection });
  Vault.showCtx(event.clientX, event.clientY, items);
}

export function initCanvas(vault) {
  Vault = vault;
  board = document.getElementById("canvasBoard");
  world = document.getElementById("canvasWorld");

  board.addEventListener("wheel", (e) => {
    if (Vault.state.view !== "canvas") return;
    e.preventDefault();
    const rect = board.getBoundingClientRect();
    const mx = e.clientX - rect.left, my = e.clientY - rect.top;
    const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1;
    const k2 = Math.max(0.3, Math.min(2.5, view.k * factor));
    view.x = mx - (mx - view.x) * (k2 / view.k);
    view.y = my - (my - view.y) * (k2 / view.k);
    view.k = k2;
    applyTransform();
  }, { passive: false });

  board.addEventListener("mousedown", (e) => {
    if (e.target !== board && e.target !== world && e.target.tagName !== "svg") return;
    panning = { x: e.clientX - view.x, y: e.clientY - view.y };
    board.classList.add("dragging");
    selected = null;
    selectedEdge = null;
    selectedNodes.clear();
    render();
  });

  window.addEventListener("mousemove", (e) => {
    if (Vault.state.view !== "canvas") return;
    if (resizing) {
      const dx = (e.clientX - resizing.startX) / view.k;
      const dy = (e.clientY - resizing.startY) / view.k;
      resizing.node.width = Math.max(160, Math.round(resizing.w + dx));
      resizing.node.height = Math.max(90, Math.round(resizing.h + dy));
      dirty = true;
      const nodeEl = world.querySelector('[data-id="' + resizing.node.id + '"]');
      if (nodeEl) {
        nodeEl.style.width = resizing.node.width + "px";
        nodeEl.style.height = resizing.node.height + "px";
      }
      updateEdgePaths();
    } else if (dragging) {
      const dx = (e.clientX - dragging.startX) / view.k;
      const dy = (e.clientY - dragging.startY) / view.k;
      dragging.node.x = Math.round(dragging.origX + dx);
      dragging.node.y = Math.round(dragging.origY + dy);
      dirty = true;
      const nodeEl = world.querySelector('[data-id="' + dragging.node.id + '"]');
      if (nodeEl) { nodeEl.style.left = dragging.node.x + "px"; nodeEl.style.top = dragging.node.y + "px"; }
      if (dragging.children && dragging.children.length) {
        for (const child of dragging.children) {
          child.node.x = Math.round(child.x + dx);
          child.node.y = Math.round(child.y + dy);
          const childEl = world.querySelector('[data-id="' + child.node.id + '"]');
          if (childEl) { childEl.style.left = child.node.x + "px"; childEl.style.top = child.node.y + "px"; }
        }
      }
      if (dragging.peers && dragging.peers.length) {
        for (const peer of dragging.peers) {
          peer.node.x = Math.round(peer.x + dx);
          peer.node.y = Math.round(peer.y + dy);
          const peerEl = world.querySelector('[data-id="' + peer.node.id + '"]');
          if (peerEl) { peerEl.style.left = peer.node.x + "px"; peerEl.style.top = peer.node.y + "px"; }
        }
      }
      updateEdgePaths();
    } else if (panning) {
      view.x = e.clientX - panning.x;
      view.y = e.clientY - panning.y;
      applyTransform();
    }
  });

  window.addEventListener("mouseup", () => {
    if (resizing) { resizing = null; pushHistory(); render(); }
    if (dragging) { dragging = null; pushHistory(); }
    if (panning) { panning = null; board.classList.remove("dragging"); }
  });

  document.getElementById("cvAddText").onclick = () => {
    if (Vault.state.view !== "canvas") return;
    const w = toWorld(board.getBoundingClientRect().left + 120, board.getBoundingClientRect().top + 120);
    model.nodes.push({ id: uid(), type: "text", text: "", x: Math.round(w.x), y: Math.round(w.y), width: 300, height: 160 });
    pushHistory();
    dirty = true;
    render();
  };

  document.getElementById("cvAddGroup").onclick = () => {
    if (Vault.state.view !== "canvas") return;
    const rect = board.getBoundingClientRect();
    const w = toWorld(rect.left + 100, rect.top + 100);
    model.nodes.push({ id: uid(), type: "group", label: "Група", x: Math.round(w.x), y: Math.round(w.y), width: 480, height: 340 });
    pushHistory();
    dirty = true;
    render();
  };

  document.getElementById("cvAddLink").onclick = () => {
    if (Vault.state.view !== "canvas") return;
    const url = prompt("URL для веб-картки:", "https://");
    if (!url) return;
    const clean = url.trim();
    if (!/^https?:\/\//i.test(clean)) { Vault.toast("потрібен http(s) URL"); return; }
    const rect = board.getBoundingClientRect();
    const w = toWorld(rect.left + 200, rect.top + 200);
    model.nodes.push({ id: uid(), type: "link", url: clean, x: Math.round(w.x), y: Math.round(w.y), width: 400, height: 300 });
    pushHistory();
    dirty = true;
    render();
  };

  document.getElementById("cvAddNote").onclick = () => {
    if (Vault.state.view !== "canvas") return;
    const list = Vault.files.filter((f) => f.endsWith(".md")).map((f) => f.replace(/\.md$/, ""));
    const raw = prompt("Нотатка для картки (назва або шлях):\n" + list.slice(0, 12).join(", "), list[0] || "");
    if (!raw) return;
    const hit = Vault.files.find((p) => p === raw + ".md" || p === raw || p.endsWith("/" + raw + ".md"));
    if (!hit) { Vault.toast("Нема такої нотатки"); return; }
    const w = toWorld(board.getBoundingClientRect().left + 160, board.getBoundingClientRect().top + 160);
    model.nodes.push({ id: uid(), type: "file", file: hit, x: Math.round(w.x), y: Math.round(w.y), width: 320, height: 220 });
    pushHistory();
    dirty = true;
    render();
  };

  document.getElementById("cvConnect").onclick = () => {
    connectMode = !connectMode;
    connectFrom = null;
    Vault.toast(connectMode ? "тицьни першу картку" : "звʼязування вимкнено");
  };

  document.getElementById("cvFit").onclick = () => {
    if (!model.nodes.length) return;
    const xs = model.nodes.map((n) => n.x), ys = model.nodes.map((n) => n.y);
    const xe = model.nodes.map((n) => n.x + (n.width || 320)), ye = model.nodes.map((n) => n.y + (n.height || 200));
    const minX = Math.min(...xs), minY = Math.min(...ys), maxX = Math.max(...xe), maxY = Math.max(...ye);
    const rect = board.getBoundingClientRect();
    const k = Math.min(rect.width / (maxX - minX + 80), rect.height / (maxY - minY + 80), 1.4);
    view.k = Math.max(0.2, k);
    view.x = rect.width / 2 - ((minX + maxX) / 2) * view.k;
    view.y = rect.height / 2 - ((minY + maxY) / 2) * view.k;
    applyTransform();
  };

  document.getElementById("cvSave").onclick = () => save(false);
  document.getElementById("cvUndo").onclick = undoCanvas;
  document.getElementById("cvRedo").onclick = redoCanvas;
  document.querySelectorAll("#cvAlign [data-align]").forEach((btn) => {
    btn.onclick = () => alignSelection(btn.dataset.align);
  });
  document.getElementById("cvExport").onclick = () => {
    if (Vault.state.view !== "canvas") return;
    const data = canvasImageDataUrl();
    if (!data) { Vault.toast("Порожній canvas"); return; }
    const link = document.createElement("a");
    link.href = data;
    link.download = (path ? path.split("/").pop().replace(/\.canvas$/i, "") : "canvas") + ".png";
    link.click();
  };

  document.addEventListener("keydown", (e) => {
    if (Vault.state.view !== "canvas") return;
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") {
      e.preventDefault();
      if (e.shiftKey) redoCanvas(); else undoCanvas();
      return;
    }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "y") {
      e.preventDefault();
      redoCanvas();
      return;
    }
    if (e.key === "Escape") {
      hideEdgeBar();
      selectedEdge = null;
      selected = null;
      selectedNodes.clear();
      render();
      return;
    }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "a") {
      e.preventDefault();
      selectedNodes = new Set(model.nodes.map((n) => n.id));
      selected = null;
      render();
      return;
    }
    if (e.key === "Delete" && selectedNodes.size) {
      deleteSelection();
      return;
    }
    if (e.key === "Delete" && selectedEdge) {
      model.edges = model.edges.filter((ed) => ed.id !== selectedEdge);
      selectedEdge = null;
      pushHistory();
      dirty = true;
      render();
      Vault.toast("звʼязок видалено");
      return;
    }
    if (e.key === "Delete" && selected) {
      model.nodes = model.nodes.filter((n) => n.id !== selected);
      model.edges = model.edges.filter((ed) => ed.fromNode !== selected && ed.toNode !== selected);
      selected = null;
      pushHistory();
      dirty = true;
      render();
    }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") { e.preventDefault(); save(false); }
  });

  window.__canvasTest = {
    show() { Vault.setView("canvas"); },
    setModel(next) {
      model = next && Array.isArray(next.nodes) ? next : { nodes: [], edges: [] };
      if (!Array.isArray(model.edges)) model.edges = [];
      historyStack = [];
      historyIndex = -1;
      pushHistory();
      render();
    },
    getModel() { return JSON.parse(JSON.stringify(model)); },
    selection() { return [...selectedNodes]; },
    select(ids) {
      selectedNodes = new Set(Array.isArray(ids) ? ids : []);
      selected = selectedNodes.values().next().value || null;
      selectedEdge = null;
      render();
      return [...selectedNodes];
    },
    align(mode) { return alignSelection(mode); },
    duplicate: duplicateSelection,
    deleteSelection,
    bringToFront: bringSelectionToFront,
    sendToBack: sendSelectionToBack,
    exportDataUrl: canvasImageDataUrl,
    undo: undoCanvas,
    redo: redoCanvas,
    history: () => ({ index: historyIndex, length: historyStack.length }),
    addGroup(label, x = 40, y = 40, width = 480, height = 340) {
      const node = { id: uid(), type: "group", label: label || "Група", x, y, width, height };
      model.nodes.push(node);
      render();
      return node;
    },
    addLink(url, x = 100, y = 100, width = 400, height = 300) {
      const node = { id: uid(), type: "link", url, x, y, width, height };
      model.nodes.push(node);
      render();
      return node;
    },
    render,
  };

  return { open, create };
}
