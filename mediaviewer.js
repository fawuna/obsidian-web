// Media viewer: opens images, audio and video from the file explorer.
let Vault = null;
let path = null;
let kind = "";
let zoom = 1;

const IMAGE_RE = /\.(svg|png|jpe?g|gif|webp|bmp|avif)$/i;
const AUDIO_RE = /\.(mp3|wav|ogg|m4a|flac|aac|opus)$/i;
const VIDEO_RE = /\.(mp4|webm|ogv|mov|mkv|m4v)$/i;
const MEDIA_RE = /\.(svg|png|jpe?g|gif|webp|bmp|avif|mp3|wav|ogg|m4a|flac|aac|opus|mp4|webm|ogv|mov|mkv|m4v)$/i;

export function isMediaPath(target) {
  return MEDIA_RE.test(String(target || ""));
}

function rawUrl(target) {
  return "https://raw.githubusercontent.com/" + Vault.repo + "/" + Vault.branch + "/" + target.split("/").map(encodeURIComponent).join("/");
}

function setZoom(next) {
  const img = document.querySelector("#mediaCanvas img");
  if (!img) return;
  zoom = Math.max(0.1, Math.min(8, next));
  if (img.naturalWidth) img.style.width = Math.round(img.naturalWidth * zoom) + "px";
  const label = document.getElementById("mediaZoom");
  if (label) label.textContent = Math.round(zoom * 100) + "%";
}

function fit() {
  const img = document.querySelector("#mediaCanvas img");
  const host = document.getElementById("mediaCanvas");
  if (!img || !host) return;
  const available = Math.max(120, host.clientWidth - 40);
  if (!img.naturalWidth) { img.onload = fit; return; }
  setZoom(Math.min(1, available / img.naturalWidth));
}

async function open(target) {
  if (!Vault) return;
  Vault.setView("media");
  path = target;
  kind = IMAGE_RE.test(target) ? "image" : AUDIO_RE.test(target) ? "audio" : "video";
  zoom = 1;
  const host = document.getElementById("mediaCanvas");
  if (!host) return;
  host.innerHTML = '<div class="media-loading">Завантажую…</div>';
  const title = document.getElementById("mediaTitle");
  if (title) title.textContent = target;
  const zoomWrap = document.getElementById("mediaZoomWrap");
  if (zoomWrap) zoomWrap.style.display = kind === "image" ? "" : "none";
  const label = document.getElementById("mediaZoom");
  if (label) label.textContent = "100%";
  const status = document.getElementById("stPath");
  if (status) status.textContent = target;
  document.title = target.split("/").pop() + " · Vault";
  try {
    const src = await Vault.loadAttachment(target);
    host.innerHTML = "";
    if (kind === "image") {
      const img = document.createElement("img");
      img.alt = target;
      img.onload = () => fit();
      img.src = src;
      host.appendChild(img);
    } else if (kind === "audio") {
      const audio = document.createElement("audio");
      audio.controls = true;
      audio.preload = "metadata";
      audio.src = src;
      host.appendChild(audio);
    } else {
      const video = document.createElement("video");
      video.controls = true;
      video.preload = "metadata";
      video.src = src;
      host.appendChild(video);
    }
  } catch (error) {
    host.innerHTML = "";
    const box = document.createElement("div");
    box.className = "media-loading";
    box.textContent = "Файл не відкрився: " + error.message;
    host.appendChild(box);
    Vault.toast("Файл: " + error.message);
  }
}

function close() {
  const host = document.getElementById("mediaCanvas");
  if (host) host.innerHTML = "";
  path = null;
  kind = "";
  Vault.setView("note");
  Vault.paint();
}

export function initMediaViewer(vault) {
  Vault = vault;
  const host = document.getElementById("mediaHost");
  if (!host) return null;
  document.getElementById("mediaZoomOut").onclick = () => setZoom(zoom / 1.2);
  document.getElementById("mediaZoomIn").onclick = () => setZoom(zoom * 1.2);
  document.getElementById("mediaFit").onclick = fit;
  document.getElementById("mediaClose").onclick = close;
  document.getElementById("mediaExternal").onclick = () => {
    if (!path) return;
    Vault.loadAttachment(path).then((url) => window.open(url, "_blank", "noopener")).catch((error) => Vault.toast("Файл: " + error.message));
  };
  return {
    open,
    close,
    fit,
    setZoom,
    get path() { return path; },
    get kind() { return kind; },
    state: () => ({ path, kind, zoom }),
  };
}
