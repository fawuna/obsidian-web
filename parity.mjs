// Parity harness: Obsidian (CDP 9222) vs the web app (headless Chrome CDP).
// Usage: node parity.mjs
// Requires Obsidian running with --remote-debugging-port=9222, the web app served at WEB_URL,
// and the note PARITY_NOTE present in both (vault + GitHub main).
import { spawn, spawnSync } from "node:child_process";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const OBSIDIAN_CDP = process.env.OBSIDIAN_CDP || "http://127.0.0.1:9222";
const WEB_URL = process.env.WEB_URL || "http://127.0.0.1:8899/test.html";
const CHROME = process.env.CHROME_PATH || "C:/Program Files/Google/Chrome/Application/chrome.exe";
const NOTE = process.env.PARITY_NOTE || "_parity.md";
const WEB_CDP_PORT = Number(process.env.WEB_CDP_PORT || 9333);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function getJson(url) {
  const res = await fetch(url);
  return res.json();
}

function evaluate(wsUrl, expression, timeoutMs = 30000) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    const timer = setTimeout(() => { try { ws.close(); } catch { /* ignore */ } reject(new Error("CDP timeout")); }, timeoutMs);
    ws.onopen = () => ws.send(JSON.stringify({
      id: 1,
      method: "Runtime.evaluate",
      params: { expression, returnByValue: true, awaitPromise: true },
    }));
    ws.onmessage = (event) => {
      const msg = JSON.parse(event.data);
      if (msg.id !== 1) return;
      clearTimeout(timer);
      ws.close();
      if (msg.result?.exceptionDetails) resolve({ __error: msg.result.exceptionDetails.exception?.description ?? msg.result.exceptionDetails.text });
      else resolve(msg.result?.result?.value);
    };
    ws.onerror = () => { clearTimeout(timer); reject(new Error("CDP websocket error")); };
  });
}

// Injected into both pages. Keep it self-contained (no external references).
function parityFeatures(root) {
  const visible = (el) => {
    const style = el.ownerDocument.defaultView.getComputedStyle(el);
    return style.display !== "none" && style.visibility !== "hidden" && el.getClientRects().length > 0;
  };
  const texts = (selector) => [...root.querySelectorAll(selector)].filter(visible).map((el) => el.textContent.trim()).filter(Boolean);
  const sorted = (value) => String(value || "").split(/\s+/).filter(Boolean).sort().join(" ");
  const props = [...root.querySelectorAll(".metadata-property, .props .row")].filter(visible).map((p) => {
    if (p.classList.contains("row")) {
      return {
        key: p.querySelector(".k")?.textContent.trim() || "",
        value: p.querySelector(".v")?.textContent.trim() || "",
      };
    }
    const key = p.getAttribute("data-property-key") || p.querySelector("input.metadata-property-key-input")?.value || "";
    const value = p.querySelector(".metadata-property-value")?.textContent.trim() || "";
    return { key, value };
  });
  return {
    headings: texts("h1, h2, h3, h4, h5, h6"),
    strong: texts("strong"),
    em: texts("em"),
    mark: texts("mark"),
    del: texts("del, s"),
    tables: [...root.querySelectorAll("table")].filter(visible).length,
    callouts: [...root.querySelectorAll(".callout")].filter(visible).map((c) => ({
      kind: c.dataset.callout || "",
      title: c.querySelector(".callout-title-inner")?.textContent.trim() || c.querySelector(".callout-title")?.textContent.trim() || "",
      content: c.querySelector(".callout-content")?.textContent.replace(/\s+/g, " ").trim() || "",
      hasInner: !!c.querySelector(".callout-title-inner"),
      hasContent: !!c.querySelector(".callout-content"),
      tag: c.tagName.toLowerCase(),
    })),
    tasks: [...root.querySelectorAll('input[type="checkbox"]')].filter(visible).map((box) => ({
      cls: sorted(box.className),
      li: sorted(box.closest("li")?.className),
      checked: box.checked,
    })),
    links: [...root.querySelectorAll(".internal-link")].filter(visible).map((a) => ({
      text: a.textContent.trim(),
      cls: sorted(a.className),
      href: a.getAttribute("href") || "",
    })),
    tags: [...root.querySelectorAll(".tag")].filter(visible).map((a) => ({
      text: a.textContent.trim(),
      cls: sorted(a.className),
      href: a.getAttribute("href") || "",
      tag: a.tagName.toLowerCase(),
    })),
    props,
    markHtml: root.querySelector("mark")?.outerHTML || "",
  };
}

function obsidianExpression() {
  return `(async () => {
    const leaf = app.workspace.activeLeaf;
    await leaf.setViewState({ type: "markdown", state: { file: ${JSON.stringify(NOTE)}, mode: "preview" } });
    for (let i = 0; i < 20; i++) {
      await new Promise((r) => setTimeout(r, 200));
      const sizer = leaf.view.previewMode?.containerEl?.querySelector(".markdown-preview-sizer");
      if (sizer && sizer.children.length > 2) break;
    }
    const root = leaf.view.previewMode.containerEl.querySelector(".markdown-preview-sizer");
    const oldFont = app.vault.getConfig("baseFontSize");
    app.vault.setConfig("baseFontSize", 17);
    await new Promise((r) => setTimeout(r, 450));
    const settings = { fontSize: getComputedStyle(root.querySelector("p")).fontSize };
    app.vault.setConfig("baseFontSize", oldFont);
    await new Promise((r) => setTimeout(r, 250));
    return { ...(${parityFeatures.toString()})(root), settings };
  })()`;
}

function webExpression() {
  return `(async () => {
    for (let i = 0; i < 120; i++) {
      if (window.__vaultReady) break;
      await new Promise((r) => setTimeout(r, 300));
    }
    await window.Vault.loadTree();
    await window.Vault.openNote(${JSON.stringify(NOTE)});
    await new Promise((r) => setTimeout(r, 700));
    document.getElementById("modeRead").click();
    await new Promise((r) => setTimeout(r, 700));
    const root = document.getElementById("preview");
    const fontSelect = document.getElementById("setFont");
    fontSelect.value = "17";
    fontSelect.dispatchEvent(new Event("change", { bubbles: true }));
    await new Promise((r) => setTimeout(r, 300));
    const features = (${parityFeatures.toString()})(root);
    features.settings = { fontSize: getComputedStyle(root.querySelector("p")).fontSize };
    return features;
  })()`;
}

async function extractObsidian() {
  const list = await getJson(OBSIDIAN_CDP + "/json/list");
  const page = list.find((target) => target.type === "page" && target.url.startsWith("app://obsidian"));
  if (!page) throw new Error("Obsidian page target not found on " + OBSIDIAN_CDP);
  const data = await evaluate(page.webSocketDebuggerUrl, obsidianExpression(), 40000);
  if (data && data.__error) throw new Error("Obsidian evaluate: " + data.__error);
  return data;
}

async function extractWeb() {
  const profile = await mkdtemp(join(tmpdir(), "parity-chrome-"));
  const chrome = spawn(CHROME, [
    "--headless=new",
    "--remote-debugging-port=" + WEB_CDP_PORT,
    "--user-data-dir=" + profile,
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-gpu",
    "--disable-extensions",
    "--disable-background-networking",
    "about:blank",
  ], { stdio: "ignore" });
  try {
    let list = null;
    for (let i = 0; i < 60; i++) {
      try { list = await getJson("http://127.0.0.1:" + WEB_CDP_PORT + "/json/list"); break; } catch { await sleep(250); }
    }
    if (!list) throw new Error("headless Chrome CDP did not start");
    let page = list.find((target) => target.type === "page");
    if (!page) throw new Error("headless Chrome page target not found");
    await evaluate(page.webSocketDebuggerUrl, "location.href = " + JSON.stringify(WEB_URL) + "; 'navigating'", 5000);
    await sleep(1500);
    list = await getJson("http://127.0.0.1:" + WEB_CDP_PORT + "/json/list");
    page = list.find((target) => target.type === "page" && target.url.includes("test.html")) || list.find((target) => target.type === "page");
    const data = await evaluate(page.webSocketDebuggerUrl, webExpression(), 60000);
    if (data && data.__error) throw new Error("web evaluate: " + data.__error);
    return data;
  } finally {
    spawnSync("taskkill", ["/PID", String(chrome.pid), "/T", "/F"], { stdio: "ignore" });
  }
}

function normalizeProps(props) {
  return props
    .filter((prop) => prop.key && prop.key !== "tags")
    .map((prop) => ({ key: prop.key, value: prop.value }))
    .sort((a, b) => a.key.localeCompare(b.key));
}

function main() {
  return (async () => {
    const obsidian = await extractObsidian();
    const web = await extractWeb();
    const fields = ["headings", "strong", "em", "mark", "del", "tables", "callouts", "tasks", "links", "tags", "settings"];
    const rows = [];
    const diffs = [];
    for (const field of fields) {
      const same = JSON.stringify(obsidian[field]) === JSON.stringify(web[field]);
      rows.push({ field, obsidian: obsidian[field], web: web[field], same });
      if (!same) diffs.push(field);
    }
    const obsProps = normalizeProps(obsidian.props);
    const webProps = normalizeProps(web.props);
    const propsSame = JSON.stringify(obsProps) === JSON.stringify(webProps)
      && obsidian.props.some((p) => p.key === "tags")
      && web.props.some((p) => p.key === "tags");
    rows.push({ field: "props", obsidian: obsProps, web: webProps, same: propsSame });
    if (!propsSame) diffs.push("props");

    const width = 12;
    console.log("field".padEnd(width) + "obsidian".padEnd(42) + "web".padEnd(42) + "status");
    for (const row of rows) {
      const o = JSON.stringify(row.obsidian);
      const w = JSON.stringify(row.web);
      console.log(row.field.padEnd(width) + o.slice(0, 40).padEnd(42) + w.slice(0, 40).padEnd(42) + (row.same ? "ok" : "DIFF"));
    }
    if (diffs.length) {
      console.log("\nFIRST DIVERGENCE: " + diffs[0]);
      console.log("DIVERGENCES: " + diffs.join(", "));
      process.exitCode = 1;
    } else {
      console.log("\nPARITY OK for " + rows.length + " measured features");
    }
  })();
}

main().catch((error) => {
  console.error("PARITY ERROR:", error.message);
  process.exitCode = 2;
});
