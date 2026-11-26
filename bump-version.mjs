// Bumps the asset version everywhere: index.html ?v=, module imports in app.js, BUILD constant.
// Usage: node bump-version.mjs [newVersion]
import { readFile, writeFile } from "node:fs/promises";

const dir = new URL(".", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
const appPath = dir + "app.js";
const htmlPath = dir + "index.html";

let app = await readFile(appPath, "utf8");
const current = Number((app.match(/BUILD = "v(\d+)"/) || [null, "0"])[1]) || 0;
const next = process.argv[2] ? String(process.argv[2]).replace(/^v/, "") : String(current + 1);

app = app.replace(/BUILD = "v\d+"/, 'BUILD = "v' + next + '"');
app = app.replace(/(from "\.\/[a-z-]+\.js)(\?v=\d+)?"/g, '$1?v=' + next + '"');
await writeFile(appPath, app, "utf8");

let html = await readFile(htmlPath, "utf8");
html = html.replace(/\?v=\d+/g, "?v=" + next);
await writeFile(htmlPath, html, "utf8");

console.log("version -> v" + next);
console.log("imports:", (app.match(/\.js\?v=\d+/g) || []).join(", "));
