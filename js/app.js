import { convertMedia } from "./ffmpeg.js";
import { createGifFromVideo } from "./gif.js";
import { createBrowserVideo } from "./browser-video.js";
import { loadImageFile, exportImage } from "./image.js";
import { readHistory, addHistory, clearHistory } from "./storage.js";

const $ = id => document.getElementById(id);
const state = { video: null, audio: null, image: null, imageUrl: null, busy: false };

function setPage(name) {
  document.querySelectorAll(".page").forEach(page => page.classList.toggle("active", page.id === `page-${name}`));
  document.querySelectorAll(".nav").forEach(button => button.classList.toggle("active", button.dataset.page === name));
  const labels = {home:"Overview",video:"Video",audio:"Audio",image:"Image",history:"History"};
  $("crumb").textContent = labels[name] || "Overview";
  if (name === "history") renderHistory();
}
document.querySelectorAll("[data-page]").forEach(button => button.addEventListener("click", () => setPage(button.dataset.page)));
document.querySelectorAll("[data-open]").forEach(button => button.addEventListener("click", () => setPage(button.dataset.open)));

function sizeLabel(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes/1024).toFixed(1)} KB`;
  return `${(bytes/1024**2).toFixed(2)} MB`;
}
function outputName(file, extension) {
  const base = file.name.replace(/\.[^.]+$/, "").replace(/[\\/:*?"<>|]/g, "_");
  const outputExtension = extension === "psp" ? "mp4" : extension;
  return `${base || "media"}_converted.${outputExtension}`;
}
function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}
function saveHistory(type, filename, bytes) {
  addHistory({ type, filename, size: bytes });
}
function setProgress(kind, percent, label) {
  const wrap = `${kind}-progress`;
  $(wrap).hidden = false;
  $(`${kind}-progress-label`).textContent = label || "変換中…";
  $(`${kind}-progress-value`).textContent = `${Math.round(percent)}%`;
  $(`${kind}-progress-bar`).style.width = `${Math.max(0,Math.min(100,percent))}%`;
}
function showResult(kind, message, isError = false) {
  const node = $(`${kind}-result`);
  node.textContent = message;
  node.style.color = isError ? "#e8a2a2" : "#91d9ba";
}
function setBusy(kind, busy) {
  state.busy = busy;
  $(`${kind}-run`).disabled = busy || !state[kind];
  $(`${kind}-run`).textContent = busy ? "処理中…" : (kind === "image" ? "画像を書き出す →" : "変換を開始 →");
}

for (const kind of ["video", "audio"]) {
  const input = $(`${kind}-file`);
  input.addEventListener("change", () => {
    const file = input.files?.[0] || null;
    state[kind] = file;
    $(`${kind}-info`).textContent = file ? `${file.name} · ${sizeLabel(file.size)}` : "ファイル未選択";
    $(`${kind}-run`).disabled = !file || state.busy;
    showResult(kind, "");
  });
  $(`${kind}-run`).addEventListener("click", async () => {
    const file = state[kind];
    if (!file || state.busy) return;
    const format = $(`${kind}-format`).value;
    setBusy(kind, true);
    showResult(kind, "");
    setProgress(kind, 1, "変換エンジンを準備中…");
    const isWebmInput = kind === "video" &&
      (/\.webm$/i.test(file.name) || file.type.toLowerCase().includes("webm"));
    const useBrowserVideo = isWebmInput && ["mp4", "mov", "webm"].includes(format);

    if (kind === "video" && (format === "gif" || useBrowserVideo)) {
      $("ffmpeg-status").textContent = "Browser decoder";
    } else if (kind !== "audio") {
      $("ffmpeg-status").textContent = "Loading…";
    }
    try {
      const browserProgress = value => {
        if (value && typeof value === "object" && value.progress != null) {
          setProgress(kind, value.progress * 100, value.label || "ブラウザで処理中…");
        } else if (typeof value === "string") {
          setProgress(kind, 85, value);
        }
      };
      const blob = useBrowserVideo
        ? await createBrowserVideo(file, format, browserProgress)
        : kind === "video" && format === "gif"
          ? await createGifFromVideo(file, browserProgress)
          : await convertMedia({
        file, kind, format,
        quality: $(`${kind}-quality`).value,
        onProgress: value => {
          if (typeof value === "object" && value.progress != null) {
            setProgress(kind, value.progress * 100, "変換中…");
          } else if (typeof value === "string" && value.includes("error")) {
            console.warn("FFmpeg:", value);
          }
        }
      });
      const filename = outputName(file, format);
      downloadBlob(blob, filename);
      saveHistory(kind, filename, blob.size);
      setProgress(kind, 100, "完了");
      showResult(kind, `完了: ${filename} · ${sizeLabel(blob.size)}`);
      $("ffmpeg-status").textContent = (kind === "video" && (format === "gif" || useBrowserVideo)) ? "Browser ready" : "Loaded";
    } catch (error) {
      console.error(error);
      showResult(kind, error.message || "変換に失敗しました。", true);
      $("ffmpeg-status").textContent = "Error";
    } finally {
      setBusy(kind, false);
    }
  });
}

$("image-file").addEventListener("change", async () => {
  const file = $("image-file").files?.[0] || null;
  if (state.imageUrl) URL.revokeObjectURL(state.imageUrl);
  state.image = null;
  $("image-run").disabled = true;
  $("image-preview-wrap").hidden = true;
  if (!file) return;
  try {
    const loaded = await loadImageFile(file);
    state.image = { file, ...loaded };
    state.imageUrl = loaded.url;
    $("image-info").textContent = `${file.name} · ${loaded.width} × ${loaded.height} · ${sizeLabel(file.size)}`;
    $("image-preview").src = loaded.url;
    $("image-preview-wrap").hidden = false;
    $("image-width").value = loaded.width;
    $("image-height").value = loaded.height;
    $("image-run").disabled = false;
    showResult("image", "");
  } catch (error) {
    showResult("image", error.message, true);
  }
});
$("image-width").addEventListener("input", () => {
  const current = state.image;
  if (!current || !$("image-lock").checked) return;
  const width = Number($("image-width").value);
  if (width > 0) $("image-height").value = Math.round(width * current.height / current.width);
});
$("image-height").addEventListener("input", () => {
  const current = state.image;
  if (!current || !$("image-lock").checked) return;
  const height = Number($("image-height").value);
  if (height > 0) $("image-width").value = Math.round(height * current.width / current.height);
});
$("image-run").addEventListener("click", async () => {
  if (!state.image || state.busy) return;
  setBusy("image", true);
  try {
    const mime = $("image-format").value;
    const extension = ({ "image/png":"png", "image/jpeg":"jpg", "image/webp":"webp" })[mime];
    const blob = await exportImage({
      image: state.image.image,
      width: Number($("image-width").value),
      height: Number($("image-height").value),
      mime,
      quality: Number($("image-quality").value)
    });
    const filename = outputName(state.image.file, extension);
    downloadBlob(blob, filename);
    saveHistory("image", filename, blob.size);
    showResult("image", `完了: ${filename} · ${sizeLabel(blob.size)}`);
  } catch (error) {
    showResult("image", error.message || "画像処理に失敗しました。", true);
  } finally {
    setBusy("image", false);
  }
});

function renderHistory() {
  const items = readHistory();
  const list = $("history-list");
  if (!items.length) {
    list.innerHTML = '<p class="empty">まだ履歴はありません。</p>';
    return;
  }
  list.replaceChildren(...items.map(item => {
    const row = document.createElement("div");
    row.className = "history-item";
    const title = document.createElement("span");
    title.textContent = `${item.type.toUpperCase()} · ${item.filename}`;
    const meta = document.createElement("small");
    meta.textContent = `${sizeLabel(item.size)} · ${new Date(item.createdAt).toLocaleString()}`;
    row.append(title, meta);
    return row;
  }));
}
$("clear-history").addEventListener("click", () => {
  clearHistory();
  renderHistory();
});
