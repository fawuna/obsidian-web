// Audio recorder core plugin: records the microphone and saves a .webm file into the vault.
let Vault = null;
let config = { folder: "" };
let media = null;

const cleanFolder = (value) => String(value || "").replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
const pad2 = (value) => String(value).padStart(2, "0");

function stamp(date) {
  return date.getFullYear() + "-" + pad2(date.getMonth() + 1) + "-" + pad2(date.getDate()) +
    " " + pad2(date.getHours()) + "." + pad2(date.getMinutes()) + "." + pad2(date.getSeconds());
}

function recordingPath(date) {
  const folder = cleanFolder(config.folder);
  return (folder ? folder + "/" : "") + "Recording " + stamp(date) + ".webm";
}

async function loadConfig() {
  try {
    const raw = JSON.parse((await Vault.ghGet(".obsidian/audio-recorder.json")).text);
    if (raw && typeof raw === "object") config = { ...config, ...raw };
  } catch { /* defaults */ }
}

function supportedMime() {
  if (typeof MediaRecorder === "undefined") return "";
  for (const mime of ["audio/webm;codecs=opus", "audio/webm", "audio/ogg;codecs=opus", "audio/mp4"]) {
    if (MediaRecorder.isTypeSupported(mime)) return mime;
  }
  return "";
}

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || "").split(",")[1] || "");
    reader.onerror = () => reject(reader.error || new Error("read failed"));
    reader.readAsDataURL(blob);
  });
}

function tick() {
  if (!media) return;
  const seconds = Math.floor((Date.now() - media.startedAt) / 1000);
  Vault.setState("● запис " + Math.floor(seconds / 60) + ":" + pad2(seconds % 60), "warn");
}

async function start() {
  if (media) { Vault.toast("Запис уже йде"); return false; }
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    Vault.toast("Мікрофон недоступний у цьому браузері");
    return false;
  }
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const mime = supportedMime();
    const recorder = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream);
    const chunks = [];
    recorder.ondataavailable = (event) => { if (event.data && event.data.size) chunks.push(event.data); };
    const session = { recorder, stream, chunks, startedAt: Date.now(), timer: null, stopped: null };
    media = session;
    session.stopped = new Promise((resolve) => {
      recorder.onstop = async () => {
        const blob = new Blob(chunks, { type: recorder.mimeType || "audio/webm" });
        clearInterval(session.timer);
        stream.getTracks().forEach((track) => track.stop());
        media = null;
        Vault.setState("зберігаю запис…");
        try {
          const b64 = await blobToBase64(blob);
          const path = recordingPath(new Date());
          await Vault.ghPutRaw(path, b64, null, "recording: " + path);
          Vault.state.pending.add(path);
          await Vault.loadTree();
          if (Vault.currentFile()) {
            Vault.insertAtCursor("\n![[" + path + "]]\n");
          }
          Vault.toast("запис збережено: " + path);
          Vault.setState("запис збережено", "ok");
          resolve(path);
        } catch (error) {
          Vault.toast("Запис не зберігся: " + error.message);
          Vault.setState("запис: помилка", "warn");
          resolve("");
        }
      };
    });
    recorder.start(250);
    session.timer = setInterval(tick, 500);
    tick();
    Vault.toast("запис почато");
    return true;
  } catch (error) {
    Vault.toast("Мікрофон: " + (error.message || error.name || error));
    return false;
  }
}

async function stop() {
  if (!media) { Vault.toast("Запис не йде"); return ""; }
  const stopped = media.stopped;
  media.recorder.stop();
  return stopped;
}

async function toggle() {
  if (media) return stop();
  return start();
}

export async function initRecorder(vault) {
  Vault = vault;
  await loadConfig();
  Vault.registerCommand({ id: "audio-record", label: "Почати/зупинити аудіозапис", hint: "REC", plugin: "audiorecorder", run: toggle });
  Vault.addRibbonButton({ id: "audio-record", icon: "🎙", title: "Аудіозапис", run: toggle });
  return {
    start,
    stop,
    toggle,
    loadConfig,
    get recording() { return !!media; },
    get config() { return { ...config }; },
  };
}
