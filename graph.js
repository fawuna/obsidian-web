// Graph view: force-directed map of notes and [[wikilinks]] on a canvas.
let Vault = null;
let canvas = null;
let ctx = null;
let nodes = [];
let edges = [];
let view = { x: 0, y: 0, k: 1 };
let alpha = 1;
let raf = null;
let dragging = null;
let panning = null;
let hovered = null;
let needsRebuild = true;

const FORCE = () => Number(localStorage.getItem("vw-graphForce") || 120);

function tagsOfNote(text) {
  const tags = new Set();
  const lines = String(text || "").split(/\r?\n/);
  let inFront = false;
  let frontKey = "";
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (i === 0 && line.trim() === "---") { inFront = true; continue; }
    if (inFront && line.trim() === "---") { inFront = false; continue; }
    if (inFront) {
      const kv = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
      if (kv) {
        frontKey = kv[1].toLowerCase();
        if (frontKey === "tags" || frontKey === "tag") {
          for (const part of kv[2].replace(/^\[|\]$/g, "").split(",")) {
            const tag = part.trim().replace(/^#/, "").replace(/^["']|["']$/g, "");
            if (tag) tags.add(tag);
          }
        }
        continue;
      }
      const item = line.match(/^\s*-\s*(.*)$/);
      if (item && (frontKey === "tags" || frontKey === "tag")) {
        const tag = item[1].trim().replace(/^#/, "").replace(/^["']|["']$/g, "");
        if (tag) tags.add(tag);
      }
      continue;
    }
    for (const m of line.matchAll(/(^|\s)#([A-Za-z0-9_\u0400-\u04FF][A-Za-z0-9_\u0400-\u04FF/-]*)/g)) tags.add(m[2]);
  }
  return [...tags];
}

function buildGraph() {
  const onlyMd = Vault.files.filter((p) => p.endsWith(".md"));
  const active = Vault.state.active;
  const index = Vault.index;
  const local = document.getElementById("graphLocal")?.checked === true && active;

  const links = [];
  for (const [path, text] of index) {
    if (!text) continue;
    const name = path.split("/").pop().replace(/\.md$/, "");
    for (const m of text.matchAll(/\[\[([^\]|#]+)/g)) {
      const target = m[1].trim();
      const hit = onlyMd.find((p) => p === target + ".md" || p.endsWith("/" + target + ".md") || p.split("/").pop() === target + ".md");
      if (hit && hit !== path) links.push([path, hit]);
    }
  }

  const depthInput = document.getElementById("graphDepth");
  const depthHops = Math.max(1, Math.min(3, Number(depthInput && depthInput.value) || 1));

  let keep = new Set(onlyMd);
  if (local && active) {
    keep = new Set([active]);
    for (let depth = 0; depth < depthHops; depth++) {
      const next = [];
      for (const [a, b] of links) {
        if (keep.has(a) && !keep.has(b)) { keep.add(b); next.push(b); }
        if (keep.has(b) && !keep.has(a)) { keep.add(a); next.push(a); }
      }
      if (!next.length) break;
    }
  }

  const list0 = onlyMd.filter((p) => keep.has(p));
  let list = list0;

  const query = (document.getElementById("graphQuery")?.value || "").trim().toLowerCase();
  const tag = (document.getElementById("graphTag")?.value || "").trim().replace(/^#/, "").toLowerCase();

  if (query || tag) {
    const match = new Set();
    for (const path of list) {
      const name = path.split("/").pop().replace(/\.md$/, "").toLowerCase();
      let ok = true;
      if (query && !(name.includes(query) || path.toLowerCase().includes(query))) ok = false;
      if (ok && tag) {
        const text = (index.get(path) || "").toLowerCase();
        if (!text.includes("#" + tag) && !text.includes(tag)) ok = false;
      }
      if (ok) match.add(path);
    }
    const withNeighbors = new Set(match);
    for (const [a, b] of links) {
      if (match.has(a)) withNeighbors.add(b);
      if (match.has(b)) withNeighbors.add(a);
    }
    list = list.filter((p) => withNeighbors.has(p));
  }
  const showOrphans = document.getElementById("graphOrphans")?.checked !== false;
  if (!showOrphans) {
    const listSet = new Set(list);
    const connected = new Set();
    for (const [a, b] of links) {
      if (listSet.has(a) && listSet.has(b)) { connected.add(a); connected.add(b); }
    }
    if (local && active && listSet.has(active)) connected.add(active);
    list = list.filter((p) => connected.has(p));
  }
  const showTags = document.getElementById("graphTags")?.checked === true;
  const tagSet = new Set();
  const tagLinks = [];
  if (showTags) {
    for (const path of list) {
      const text = index.get(path) || "";
      for (const tag of tagsOfNote(text)) {
        tagSet.add(tag);
        tagLinks.push([path, "tag:" + tag]);
      }
    }
  }
  const cx = 0, cy = 0, radius = 90 + (list.length + tagSet.size) * 6;
  nodes = list.map((path, i) => {
    const angle = (i / list.length) * Math.PI * 2;
    return {
      id: path,
      label: path.split("/").pop().replace(/\.md$/, ""),
      folder: path.includes("/") ? path.split("/")[0] : "",
      x: cx + Math.cos(angle) * radius * (0.6 + Math.random() * 0.6),
      y: cy + Math.sin(angle) * radius * (0.6 + Math.random() * 0.6),
      vx: 0, vy: 0,
      r: 7 + Math.min(6, path.split("/").length),
    };
  });
  for (const tag of tagSet) {
    const angle = Math.random() * Math.PI * 2;
    nodes.push({
      id: "tag:" + tag,
      label: "#" + tag,
      type: "tag",
      folder: "",
      x: cx + Math.cos(angle) * radius * (0.6 + Math.random() * 0.6),
      y: cy + Math.sin(angle) * radius * (0.6 + Math.random() * 0.6),
      vx: 0, vy: 0,
      r: 5,
    });
  }
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const seen = new Set();
  edges = [];
  const allLinks = links.concat(tagLinks);
  for (const [a, b] of allLinks) {
    const key = a < b ? a + "|" + b : b + "|" + a;
    if (seen.has(key)) continue;
    seen.add(key);
    if (byId.has(a) && byId.has(b)) edges.push({ a, b });
  }

  const activeNode = byId.get(active);
  if (activeNode) { activeNode.x = 0; activeNode.y = 0; }

  const noteCount = nodes.filter((n) => n.type !== "tag").length;
  const tagCount = nodes.length - noteCount;
  document.getElementById("graphInfo").textContent = noteCount + " нотаток" + (tagCount ? " · " + tagCount + " тегів" : "") + " · " + edges.length + " звʼязків";
  alpha = 1;
  needsRebuild = false;
  fit();
}

function resize() {
  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  canvas.width = Math.max(1, Math.floor(rect.width * dpr));
  canvas.height = Math.max(1, Math.floor(rect.height * dpr));
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

function toWorld(sx, sy) {
  const rect = canvas.getBoundingClientRect();
  return { x: (sx - rect.left - view.x) / view.k, y: (sy - rect.top - view.y) / view.k };
}

function fit() {
  if (!nodes.length) return;
  const xs = nodes.map((n) => n.x), ys = nodes.map((n) => n.y);
  const minX = Math.min(...xs) - 60, maxX = Math.max(...xs) + 60;
  const minY = Math.min(...ys) - 60, maxY = Math.max(...ys) + 60;
  const rect = canvas.getBoundingClientRect();
  const k = Math.min(rect.width / (maxX - minX || 1), rect.height / (maxY - minY || 1), 2);
  view.k = Math.max(0.15, k);
  view.x = rect.width / 2 - ((minX + maxX) / 2) * view.k;
  view.y = rect.height / 2 - ((minY + maxY) / 2) * view.k;
}

function tick() {
  const R = FORCE();
  const repulsion = R * R;
  for (let i = 0; i < nodes.length; i++) {
    const a = nodes[i];
    for (let j = i + 1; j < nodes.length; j++) {
      const b = nodes[j];
      let dx = a.x - b.x, dy = a.y - b.y;
      let d2 = dx * dx + dy * dy;
      if (d2 < 1) { dx = Math.random() - 0.5; dy = Math.random() - 0.5; d2 = 1; }
      const d = Math.sqrt(d2);
      const force = repulsion / d2;
      const fx = (dx / d) * force, fy = (dy / d) * force;
      a.vx += fx; a.vy += fy;
      b.vx -= fx; b.vy -= fy;
    }
  }

  const byId = new Map(nodes.map((n) => [n.id, n]));
  const ideal = Number(document.getElementById("graphDistance")?.value) || 110;
  for (const e of edges) {
    const a = byId.get(e.a), b = byId.get(e.b);
    if (!a || !b) continue;
    const dx = b.x - a.x, dy = b.y - a.y;
    const d = Math.sqrt(dx * dx + dy * dy) || 1;
    const force = (d - ideal) * 0.02;
    const fx = (dx / d) * force, fy = (dy / d) * force;
    a.vx += fx; a.vy += fy;
    b.vx -= fx; b.vy -= fy;
  }

  for (const n of nodes) {
    n.vx -= n.x * 0.0016;
    n.vy -= n.y * 0.0016;
    if (n === dragging) { n.vx = 0; n.vy = 0; continue; }
    n.x += n.vx * alpha;
    n.y += n.vy * alpha;
    n.vx *= 0.86;
    n.vy *= 0.86;
  }
  alpha = Math.max(0.02, alpha * 0.994);
}

function draw() {
  const rect = canvas.getBoundingClientRect();
  ctx.clearRect(0, 0, rect.width, rect.height);
  ctx.save();
  ctx.translate(view.x, view.y);
  ctx.scale(view.k, view.k);

  const byId = new Map(nodes.map((n) => [n.id, n]));
  const accent = getComputedStyle(document.documentElement).getPropertyValue("--accent").trim() || "#a882ff";
  const line = getComputedStyle(document.documentElement).getPropertyValue("--line").trim() || "#3a3a3a";
  const muted = getComputedStyle(document.documentElement).getPropertyValue("--muted").trim() || "#8f8f8f";
  const text = getComputedStyle(document.documentElement).getPropertyValue("--text").trim() || "#dadada";
  const arrows = document.getElementById("graphArrows")?.checked;
  const fade = Number(document.getElementById("graphTextFade")?.value) || 0;
  const labelThreshold = 0.55 + (fade / 100) * 1.6;
  const nodeScale = (Number(document.getElementById("graphNodeSize")?.value) || 100) / 100;
  const linkScale = (Number(document.getElementById("graphLinkWidth")?.value) || 100) / 100;

  ctx.lineWidth = 1.2 * linkScale / view.k;
  ctx.strokeStyle = line;
  for (const e of edges) {
    const a = byId.get(e.a), b = byId.get(e.b);
    if (!a || !b) continue;
    ctx.globalAlpha = 0.55;
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
  }
  if (arrows) {
    ctx.globalAlpha = 0.75;
    for (const e of edges) {
      const a = byId.get(e.a), b = byId.get(e.b);
      if (!a || !b) continue;
      const dx = b.x - a.x, dy = b.y - a.y;
      const len = Math.hypot(dx, dy) || 1;
      const angle = Math.atan2(dy, dx);
      const size = 7 / view.k;
      const tipX = b.x - (dx / len) * (b.r * nodeScale + 1);
      const tipY = b.y - (dy / len) * (b.r * nodeScale + 1);
      ctx.beginPath();
      ctx.moveTo(tipX, tipY);
      ctx.lineTo(tipX - Math.cos(angle - 0.45) * size, tipY - Math.sin(angle - 0.45) * size);
      ctx.lineTo(tipX - Math.cos(angle + 0.45) * size, tipY - Math.sin(angle + 0.45) * size);
      ctx.closePath();
      ctx.fillStyle = line;
      ctx.fill();
    }
  }
  ctx.globalAlpha = 1;

  for (const n of nodes) {
    const isActive = n.id === Vault.state.active;
    const isHover = n === hovered;
    const isTag = n.type === "tag";
    ctx.beginPath();
    ctx.arc(n.x, n.y, n.r * nodeScale + (isHover ? 2 : 0), 0, Math.PI * 2);
    ctx.fillStyle = isActive ? accent : isTag ? "#e0b458" : (n.folder ? "#5d7cff" : "#6cc9a8");
    ctx.globalAlpha = isActive || isHover ? 1 : 0.85;
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.lineWidth = isActive ? 2.2 / view.k : 1 / view.k;
    ctx.strokeStyle = isActive ? accent : line;
    ctx.stroke();

    if (isTag || view.k > labelThreshold || isActive || isHover) {
      ctx.font = (11 / view.k).toFixed(1) + "px Inter, Segoe UI, sans-serif";
      ctx.fillStyle = isActive ? accent : text;
      ctx.globalAlpha = isHover || isActive ? 1 : 0.75;
      ctx.textAlign = "center";
      ctx.fillText(n.label, n.x, n.y + n.r * nodeScale + 13 / view.k);
      ctx.globalAlpha = 1;
    }
  }
  ctx.restore();
}

function loop() {
  if (needsRebuild) buildGraph();
  tick();
  draw();
  raf = requestAnimationFrame(loop);
}

function nodeAt(world) {
  let best = null, bestD = Infinity;
  const nodeScale = (Number(document.getElementById("graphNodeSize")?.value) || 100) / 100;
  for (const n of nodes) {
    const d = Math.hypot(n.x - world.x, n.y - world.y);
    if (d < n.r * nodeScale + 8 / view.k && d < bestD) { best = n; bestD = d; }
  }
  return best;
}

export function initGraph(vault) {
  Vault = vault;
  canvas = document.getElementById("graphCanvas");
  ctx = canvas.getContext("2d");

  const reb = () => { needsRebuild = true; };
  Vault.on("tree", reb);
  Vault.on("open", () => { if (!document.getElementById("graphLocal")?.checked) return; needsRebuild = true; });
  Vault.on("index", reb);
  Vault.on("view", (v) => { if (v === "graph") { resize(); needsRebuild = true; if (!raf) loop(); } });
  document.getElementById("graphLocal").onchange = () => { needsRebuild = true; };
  const gq = document.getElementById("graphQuery");
  const gt = document.getElementById("graphTag");
  const gd = document.getElementById("graphDepth");
  if (gq) gq.addEventListener("input", () => { needsRebuild = true; });
  if (gt) gt.addEventListener("input", () => { needsRebuild = true; });
  if (gd) gd.addEventListener("input", () => { needsRebuild = true; });
  const savedSettings = [
    ["graphLocal", "checkbox"],
    ["graphDepth", "number"],
    ["graphOrphans", "checkbox"],
    ["graphTags", "checkbox"],
    ["graphArrows", "checkbox"],
    ["graphTextFade", "range"],
    ["graphDistance", "range"],
    ["graphNodeSize", "range"],
    ["graphLinkWidth", "range"],
  ];
  for (const [id, type] of savedSettings) {
    const node = document.getElementById(id);
    if (!node) continue;
    const saved = localStorage.getItem("vw-" + id);
    if (saved !== null) {
      if (type === "checkbox") node.checked = saved === "1";
      else node.value = saved;
    }
    const save = () => {
      if (type === "checkbox") localStorage.setItem("vw-" + id, node.checked ? "1" : "0");
      else localStorage.setItem("vw-" + id, node.value);
      if (id === "graphOrphans" || id === "graphTags") needsRebuild = true;
    };
    node.addEventListener("input", save);
    node.addEventListener("change", save);
  }
  document.getElementById("graphRefresh").onclick = () => { needsRebuild = true; };
  document.getElementById("graphFit").onclick = () => fit();

  window.addEventListener("resize", () => { if (Vault.state.view === "graph") resize(); });

  canvas.addEventListener("wheel", (e) => {
    e.preventDefault();
    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left, my = e.clientY - rect.top;
    const factor = e.deltaY < 0 ? 1.12 : 1 / 1.12;
    const k2 = Math.max(0.12, Math.min(4, view.k * factor));
    view.x = mx - (mx - view.x) * (k2 / view.k);
    view.y = my - (my - view.y) * (k2 / view.k);
    view.k = k2;
  }, { passive: false });

  canvas.addEventListener("mousedown", (e) => {
    const w = toWorld(e.clientX, e.clientY);
    const node = nodeAt(w);
    if (node) { dragging = node; }
    else { panning = { x: e.clientX - view.x, y: e.clientY - view.y }; canvas.classList.add("dragging"); }
  });

  window.addEventListener("mousemove", (e) => {
    if (!canvas || Vault.state.view !== "graph") return;
    const w = toWorld(e.clientX, e.clientY);
    if (dragging) {
      dragging.x = w.x; dragging.y = w.y;
      dragging.vx = 0; dragging.vy = 0;
      alpha = Math.max(alpha, 0.25);
    } else if (panning) {
      view.x = e.clientX - panning.x;
      view.y = e.clientY - panning.y;
    } else {
      hovered = nodeAt(w);
      canvas.style.cursor = hovered ? "pointer" : "grab";
      const tip = document.getElementById("graphTip");
      if (tip) {
        if (hovered) {
          const degree = edges.filter((edge) => edge.a === hovered.id || edge.b === hovered.id).length;
          tip.textContent = hovered.label + " · " + degree + " звʼязків";
          tip.style.display = "block";
          tip.style.left = e.clientX + 14 + "px";
          tip.style.top = e.clientY + 14 + "px";
        } else {
          tip.style.display = "none";
        }
      }
    }
  });

  window.addEventListener("mouseup", (e) => {
    if (dragging) {
      const moved = Math.abs(e.clientX - 0) >= 0;
      if (moved && dragging) {
        const target = dragging.id;
        dragging = null;
        // open only when the pointer did not travel far
      }
    }
    if (dragging === null && panning) { panning = null; canvas.classList.remove("dragging"); }
    dragging = null;
    panning = null;
    canvas.classList.remove("dragging");
  });

  canvas.addEventListener("click", (e) => {
    const w = toWorld(e.clientX, e.clientY);
    const node = nodeAt(w);
    if (!node) return;
    if (node.type === "tag") {
      const input = document.getElementById("searchInput");
      if (input) {
        input.value = "tag:#" + node.label.replace(/^#/, "");
        Vault.showPane("search");
        input.dispatchEvent(new Event("input", { bubbles: true }));
      }
      return;
    }
    Vault.openNote(node.id);
  });

  window.__graphTest = {
    get: () => ({
      nodes: nodes.map((n) => ({ id: n.id, type: n.type || "note", label: n.label })),
      edges: edges.map((e) => ({ a: e.a, b: e.b })),
      info: document.getElementById("graphInfo").textContent,
      local: document.getElementById("graphLocal")?.checked === true,
      depth: Number(document.getElementById("graphDepth")?.value) || 1,
    }),
    setLocal(enabled, depth) {
      const cb = document.getElementById("graphLocal");
      if (cb) {
        cb.checked = !!enabled;
        localStorage.setItem("vw-graphLocal", cb.checked ? "1" : "0");
      }
      const di = document.getElementById("graphDepth");
      if (di && depth != null) {
        di.value = String(Math.max(1, Math.min(3, Number(depth) || 1)));
        localStorage.setItem("vw-graphDepth", di.value);
      }
      needsRebuild = true;
      Vault.setView("graph");
      if (!raf) loop();
    },
  };

  if (Vault.state.view === "graph") { resize(); loop(); }
}
