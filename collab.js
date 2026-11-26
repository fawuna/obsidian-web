// Real-time collaboration: Yjs CRDT over WebRTC (y-webrtc). No server of our own.
let Vault = null;
let Y = null;
let WebrtcProvider = null;
let doc = null;
let provider = null;
let ytext = null;
let boundPath = null;
let applyingRemote = false;
let saveTimer = null;
let active = false;

const COLORS = ["#a882ff", "#52c98a", "#e0b458", "#e5686c", "#5d9cff", "#ff9ad5"];
const myColor = COLORS[Math.floor(Math.random() * COLORS.length)];
const myName = () => localStorage.getItem("vw-myName") || "me";

function status(text) {
  const el = document.getElementById("stCollab");
  if (el) el.textContent = text || "";
}
function modalState(text) {
  const el = document.getElementById("collabState");
  if (el) el.textContent = text || "";
}

function renderPresence() {
  const host = document.getElementById("presence");
  host.innerHTML = "";
  if (!provider) return;
  const states = provider.awareness ? provider.awareness.getStates() : new Map();
  let i = 0;
  states.forEach((state) => {
    const user = state && state.user;
    if (!user) return;
    const dot = document.createElement("span");
    dot.className = "peer";
    dot.style.background = user.color || "#888";
    dot.title = user.name || "?";
    dot.textContent = (user.name || "?").slice(0, 1).toUpperCase();
    host.appendChild(dot);
    i++;
  });
  status(active ? "collab: " + i + " онлайн" : "");
}

function applyDiff(oldText, newText) {
  if (!ytext || applyingRemote) return;
  let start = 0;
  while (start < oldText.length && start < newText.length && oldText[start] === newText[start]) start++;
  let endOld = oldText.length, endNew = newText.length;
  while (endOld > start && endNew > start && oldText[endOld - 1] === newText[endNew - 1]) { endOld--; endNew--; }
  if (endOld === start && endNew === start) return;
  ytext.delete(start, endOld - start);
  if (endNew > start) ytext.insert(start, newText.slice(start, endNew));
}

function log(...args) {
  if (window.__DBG_ON) (window.__dbg = window.__dbg || []).push(args.join(" | "));
}

function seedWhenSafe(path, file, attempt = 0) {
  setTimeout(() => {
    if (!active || boundPath !== path || !ytext || ytext.length > 0) return;
    const peers = provider && provider.awareness ? provider.awareness.getStates().size : 1;
    if (peers > 1 && attempt < 2) { seedWhenSafe(path, file, attempt + 1); return; }
    if (file.text) ytext.insert(0, file.text);
  }, 1500);
}

function bindNote(path) {
  if (!active || !doc) return;
  if (boundPath === path) return;
  boundPath = path;
  ytext = doc.getText("note:" + path);
  const file = Vault.state.open.find((f) => f.path === path);
  if (!file) return;
  log("bind " + path + " ytext=" + ytext.length + " file=" + file.text.length);
  if (ytext.length === 0) {
    seedWhenSafe(path, file);
  } else if (ytext.toString() !== file.text) {
    const remote = ytext.toString();
    if (!remote) return;
    applyingRemote = true;
    file.text = remote;
    const ed = document.getElementById("editor");
    if (ed) ed.value = file.text;
    applyingRemote = false;
  }
  ytext.observe(() => {
    if (!active || applyingRemote) return;
    const file2 = Vault.state.open.find((f) => f.path === boundPath);
    if (!file2) return;
    const text = ytext.toString();
    log("observe text=" + text.length + " file=" + file2.text.length);
    if (text === file2.text) return;
    if (!text && file2.text) return;
    applyingRemote = true;
    const ed = document.getElementById("editor");
    const pos = ed.selectionStart;
    file2.text = text;
    ed.value = text;
    try { ed.selectionStart = ed.selectionEnd = Math.min(pos, text.length); } catch { /* noop */ }
    file2.dirty = false;
    applyingRemote = false;
    Vault.paint();
  });
}

export async function initCollab(vault) {
  Vault = vault;

  Vault.on("edit", ({ path, text, prev }) => {
    log("edit " + path + " active=" + active + " ytext=" + (ytext ? ytext.length : "none") + " bound=" + boundPath + " from=" + (prev || "").length + " to=" + text.length);
    if (!active || !ytext || path !== boundPath) return;
    applyDiff(prev ?? "", text);
  });

  Vault.on("open", (path) => {
    if (active) bindNote(path);
  });

  Vault.on("paint", () => {
    if (active && Vault.state.active && Vault.state.active !== boundPath) bindNote(Vault.state.active);
  });

  document.getElementById("shareBtn").onclick = () => openModal();
  Vault.on("collab:open", () => openModal());

  function openModal() {
    document.getElementById("collabRoom").value = localStorage.getItem("vw-room") || (Vault.repo + "@" + Vault.branch);
    document.getElementById("collabName").value = myName();
    document.getElementById("collabToggle").textContent = active ? "Вимкнути" : "Увімкнути";
    modalState(active ? "сесія активна" : "сесія вимкнена");
    Vault.openModal("collabModal");
  }

  document.getElementById("collabClose").onclick = () => Vault.closeModals();

  document.getElementById("collabToggle").onclick = async () => {
    if (active) { stop(); return; }
    const room = document.getElementById("collabRoom").value.trim();
    const name = document.getElementById("collabName").value.trim() || "me";
    if (!room) { modalState("введи назву кімнати"); return; }
    localStorage.setItem("vw-room", room);
    localStorage.setItem("vw-myName", name);
    modalState("підключаюсь…");
    try {
      await start(room, name);
      modalState("працює. кімната: " + room);
      document.getElementById("collabToggle").textContent = "Вимкнути";
      Vault.closeModals();
      Vault.toast("спільна сесія увімкнена");
    } catch (error) {
      modalState("не вийшло: " + error.message + " (перевір інтернет)");
    }
  };

  async function start(room, name) {
    if (!Y) {
      const yjs = await import("https://esm.sh/yjs@13.6.33");
      Y = yjs;
    }
    doc = new Y.Doc();
    let connected = false;
    // 1) public Yjs relay (reliable, works across networks)
    try {
      const mod = await import("https://esm.sh/y-websocket@2.0.4?external=yjs");
      provider = new mod.WebsocketProvider("wss://demos.yjs.dev/ws", room, doc, { connect: true });
      connected = true;
    } catch (error) {
      console.warn("y-websocket failed, falling back to webrtc", error);
    }
    // 2) fallback: peer-to-peer WebRTC with a public signalling server
    if (!connected) {
      const webrtc = await import("https://esm.sh/y-webrtc@10.3.0?bundle");
      provider = new webrtc.WebrtcProvider(room, doc, { signaling: ["wss://y-webrtc.fly.dev"], maxConns: 20 });
    }
    provider.awareness.setLocalStateField("user", { name, color: myColor });
    provider.awareness.on("change", renderPresence);
    active = true;
    boundPath = null;
    status("collab: підключення…");
    renderPresence();
    if (Vault.state.active) bindNote(Vault.state.active);
  }

  function stop() {
    active = false;
    try { provider?.destroy(); } catch { /* noop */ }
    try { doc?.destroy(); } catch { /* noop */ }
    provider = null; doc = null; ytext = null; boundPath = null;
    document.getElementById("presence").innerHTML = "";
    status("");
    document.getElementById("collabToggle").textContent = "Увімкнути";
    modalState("сесія вимкнена");
  }

  if (localStorage.getItem("vw-autocollab") === "1") {
    status("");
  }
}
