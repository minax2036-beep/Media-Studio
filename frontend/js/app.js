const pageNames = {
  overview: "Overview",
  video: "Video",
  audio: "Audio",
  image: "Image",
  downloader: "Downloader",
  queue: "Queue",
  settings: "Settings"
};

const pageDescriptions = {
  video: "動画の変換・トリミング・情報確認",
  audio: "音声の変換・形式変更・基本処理",
  image: "画像のリサイズ・形式変換",
  downloader: "yt-dlpを使ったメディアページの解析",
  queue: "処理待ちタスクの管理",
  settings: "Media Studioとローカル環境の設定"
};

function setPage(page) {
  if (!pageNames[page]) return;

  document.querySelectorAll(".nav-item").forEach((button) => {
    button.classList.toggle("active", button.dataset.page === page);
  });

  const overview = document.getElementById("page-overview");
  const placeholder = document.getElementById("page-placeholder");
  const isOverview = page === "overview";

  overview.classList.toggle("active", isOverview);
  placeholder.classList.toggle("active", !isOverview);
  document.getElementById("current-section").textContent = pageNames[page];

  if (!isOverview) {
    document.getElementById("placeholder-title").textContent = pageNames[page];
    document.getElementById("placeholder-description").textContent =
      pageDescriptions[page] || "This module is being prepared.";
  }
}

function setToolStatus(id, available, pathId, path) {
  const value = document.getElementById(id);
  value.textContent = available ? "Available" : "Not installed";
  value.classList.toggle("good", available);
  value.classList.toggle("missing", !available);
  if (pathId) {
    document.getElementById(pathId).textContent = path || "Not found in PATH";
  }
}

async function refreshStatus() {
  document.getElementById("app-status").textContent = "Connecting…";

  try {
    const response = await fetch("/api/status", { cache: "no-store" });
    if (!response.ok) throw new Error("Status request failed");
    const data = await response.json();

    document.getElementById("app-status").textContent = "Running";
    document.getElementById("app-status").classList.add("good");
    document.getElementById("python-version").textContent = "Python " + data.python;

    setToolStatus("ffmpeg-status", data.tools.ffmpeg.available, "ffmpeg-path", data.tools.ffmpeg.path);
    setToolStatus("ffprobe-status", data.tools.ffprobe.available, "ffprobe-path", data.tools.ffprobe.path);

    const modules = [];
    if (data.tools.yt_dlp) modules.push("yt-dlp");
    if (data.tools.pillow) modules.push("Pillow");
    const moduleValue = document.getElementById("modules-status");
    moduleValue.textContent = modules.length + " / 2 ready";
    moduleValue.classList.toggle("good", modules.length === 2);
    moduleValue.classList.toggle("missing", modules.length !== 2);
    document.getElementById("modules-detail").textContent =
      modules.length ? modules.join(" · ") : "No optional modules installed";
  } catch (error) {
    document.getElementById("app-status").textContent = "Offline";
    document.getElementById("app-status").classList.add("missing");
    document.getElementById("python-version").textContent = "Could not reach local server";
    console.error("Media Studio status error:", error);
  }
}

document.querySelectorAll("[data-page]").forEach((button) => {
  button.addEventListener("click", () => setPage(button.dataset.page));
});

document.querySelectorAll("[data-open]").forEach((button) => {
  button.addEventListener("click", () => setPage(button.dataset.open));
});

document.getElementById("refresh-status").addEventListener("click", refreshStatus);

refreshStatus();
