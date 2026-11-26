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
let selectedEdge = null;
let resizing = null;
let connectMode = false;
let connectFrom = null;
let dragging = null;
let panning = null;
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
  render();
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
  none.onclick = action(() => { delete edge.color; dirty = true; refresh(); });
  bar.appendChild(none);
  for (const [key, color] of Object.entries(CANVAS_COLORS)) {
    const swatch = document.createElement("button");
    swatch.className = "cv-swatch" + (edge.color === key ? " on" : "");
    swatch.style.background = color;
    swatch.title = "Колір " + key;
    swatch.onclick = action(() => { edge.color = key; dirty = true; refresh(); });
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
      render();
      showEdgeBar(e, ev.clientX, ev.clientY);
    });
    p.addEventListener("dblclick", (ev) => {
      ev.stopPropagation();
      const label = prompt("Підпис ребра (порожньо — без підпису):", e.label || "");
      if (label === null) return;
      if (label.trim()) e.label = label.trim(); else delete e.label;
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
    node.className = "cv-node" + (isGroup ? " cv-group" : "") + (isLink ? " cv-link" : "") + (selected === n.id ? " selected" : "");
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
      e.stopPropagation();
      selected = n.id;
      const children = isGroup
        ? model.nodes.filter((other) => other.id !== n.id && other.type !== "group" && isInsideGroup(other, n)).map((other) => ({ node: other, x: other.x, y: other.y }))
        : [];
      dragging = { node: n, startX: e.clientX, startY: e.clientY, origX: n.x, origY: n.y, children };
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
      ta.oninput = () => { n.text = ta.value; dirty = true; };
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
      e.stopPropagation();
      e.preventDefault();
      resizing = { node: n, startX: e.clientX, startY: e.clientY, w: n.width || 320, h: n.height || 200 };
    };
    node.appendChild(handle);

    node.onclick = (e) => {
      e.stopPropagation();
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
          connectFrom = null;
          connectMode = false;
          dirty = true;
          Vault.toast("звʼязок додано");
        }
        render();
        return;
      }
      selected = n.id;
      render();
    };
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
      updateEdgePaths();
    } else if (panning) {
      view.x = e.clientX - panning.x;
      view.y = e.clientY - panning.y;
      applyTransform();
    }
  });

  window.addEventListener("mouseup", () => {
    if (resizing) { resizing = null; render(); }
    if (dragging) { dragging = null; }
    if (panning) { panning = null; board.classList.remove("dragging"); }
  });

  document.getElementById("cvAddText").onclick = () => {
    if (Vault.state.view !== "canvas") return;
    const w = toWorld(board.getBoundingClientRect().left + 120, board.getBoundingClientRect().top + 120);
    model.nodes.push({ id: uid(), type: "text", text: "", x: Math.round(w.x), y: Math.round(w.y), width: 300, height: 160 });
    dirty = true;
    render();
  };

  document.getElementById("cvAddGroup").onclick = () => {
    if (Vault.state.view !== "canvas") return;
    const rect = board.getBoundingClientRect();
    const w = toWorld(rect.left + 100, rect.top + 100);
    model.nodes.push({ id: uid(), type: "group", label: "Група", x: Math.round(w.x), y: Math.round(w.y), width: 480, height: 340 });
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

  document.addEventListener("keydown", (e) => {
    if (Vault.state.view !== "canvas") return;
    if (e.key === "Escape") {
      hideEdgeBar();
      selectedEdge = null;
      selected = null;
      render();
      return;
    }
    if (e.key === "Delete" && selectedEdge) {
      model.edges = model.edges.filter((ed) => ed.id !== selectedEdge);
      selectedEdge = null;
      dirty = true;
      render();
      Vault.toast("звʼязок видалено");
      return;
    }
    if (e.key === "Delete" && selected) {
      model.nodes = model.nodes.filter((n) => n.id !== selected);
      model.edges = model.edges.filter((ed) => ed.fromNode !== selected && ed.toNode !== selected);
      selected = null;
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
      render();
    },
    getModel() { return JSON.parse(JSON.stringify(model)); },
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
