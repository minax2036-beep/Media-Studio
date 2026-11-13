const GIF_LIBRARY_URL = "https://cdn.jsdelivr.net/npm/gif.js.optimized@1.0.1/dist/gif.js";
const GIF_WORKER_URL = "https://cdn.jsdelivr.net/npm/gif.js.optimized@1.0.1/dist/gif.worker.js";

let gifLibraryPromise = null;

function loadGifLibrary() {
  if (window.GIF) return Promise.resolve(window.GIF);
  if (!gifLibraryPromise) {
    gifLibraryPromise = new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = GIF_LIBRARY_URL;
      script.async = true;
      script.onload = () => {
        if (window.GIF) resolve(window.GIF);
        else reject(new Error("GIFエンジンを読み込めませんでした。"));
      };
      script.onerror = () => {
        gifLibraryPromise = null;
        reject(new Error("GIF.jsの読み込みに失敗しました。ネットワーク接続を確認してください。"));
      };
      document.head.append(script);
    });
  }
  return gifLibraryPromise;
}

function waitFor(target, eventName, errorName = "error") {
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      target.removeEventListener(eventName, onSuccess);
      target.removeEventListener(errorName, onError);
    };
    const onSuccess = () => {
      cleanup();
      resolve();
    };
    const onError = () => {
      cleanup();
      reject(new Error("ブラウザが動画をデコードできませんでした。AV1動画の再生に対応しているか確認してください。"));
    };
    target.addEventListener(eventName, onSuccess, { once: true });
    target.addEventListener(errorName, onError, { once: true });
  });
}

export async function createGifFromVideo(file, onProgress = () => {}) {
  const GIF = await loadGifLibrary();
  const video = document.createElement("video");
  const sourceUrl = URL.createObjectURL(file);
  video.muted = true;
  video.playsInline = true;
  video.preload = "auto";
  video.src = sourceUrl;

  let gif;
  try {
    const metadataReady = waitFor(video, "loadedmetadata");
    const firstFrameReady = waitFor(video, "loadeddata");
    video.load();
    await metadataReady;
    await firstFrameReady;

    if (!Number.isFinite(video.duration) || video.duration <= 0) {
      throw new Error("動画の長さを取得できませんでした。");
    }
    if (video.videoWidth < 1 || video.videoHeight < 1) {
      throw new Error("動画の解像度を取得できませんでした。");
    }

    // Conservative browser-decoder test: first 5 seconds, 320px wide, 5 fps.
    const duration = Math.min(video.duration, 5);
    const width = Math.min(320, video.videoWidth);
    const height = Math.max(2, Math.round((video.videoHeight * width / video.videoWidth) / 2) * 2);
    const fps = 5;
    const frameCount = Math.max(1, Math.ceil(duration * fps));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) throw new Error("Canvasを初期化できませんでした。");

    gif = new GIF({
      workers: 2,
      quality: 15,
      width,
      height,
      workerScript: GIF_WORKER_URL,
      repeat: 0
    });

    for (let index = 0; index < frameCount; index++) {
      const timestamp = Math.min(index / fps, Math.max(0, duration - 0.04));
      if (index > 0) {
        const seeked = waitFor(video, "seeked");
        video.currentTime = timestamp;
        await seeked;
      }
      context.drawImage(video, 0, 0, width, height);
      gif.addFrame(context, { copy: true, delay: 1000 / fps });
      onProgress({ progress: ((index + 1) / frameCount) * 0.85 });
    }

    onProgress("GIFをエンコード中…");
    const result = await new Promise((resolve, reject) => {
      gif.on("finished", resolve);
      gif.on("abort", () => reject(new Error("GIF生成が中断されました。")));
      gif.on("progress", value => onProgress({ progress: 0.85 + value * 0.15 }));
      gif.render();
    });
    return result;
  } catch (error) {
    try { gif?.abort(); } catch {}
    throw error;
  } finally {
    video.pause();
    video.removeAttribute("src");
    video.load();
    URL.revokeObjectURL(sourceUrl);
  }
}
