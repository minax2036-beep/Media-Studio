const MEDIABUNNY_URL = "https://esm.sh/mediabunny";

let mediaBunnyPromise = null;

function loadMediaBunny() {
  if (!mediaBunnyPromise) {
    mediaBunnyPromise = import(MEDIABUNNY_URL).catch(error => {
      mediaBunnyPromise = null;
      throw new Error(
        "ブラウザ動画エンジン（Mediabunny）を読み込めませんでした。ネットワーク接続を確認してください。"
      );
    });
  }
  return mediaBunnyPromise;
}

function waitForMediaEvent(element, successEvent, errorMessage) {
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      element.removeEventListener(successEvent, onSuccess);
      element.removeEventListener("error", onError);
    };
    const onSuccess = () => {
      cleanup();
      resolve();
    };
    const onError = () => {
      cleanup();
      reject(new Error(errorMessage));
    };
    element.addEventListener(successEvent, onSuccess, { once: true });
    element.addEventListener("error", onError, { once: true });
  });
}

/**
 * Browser-native video decode -> Canvas -> WebCodecs encode -> container.
 * Diagnostic mode intentionally exports only 5 seconds, 320px wide,
 * 5 fps, and without audio to isolate decoder/encoder compatibility.
 */
export async function createBrowserVideo(file, format, onProgress = () => {}) {
  if (!("VideoEncoder" in window)) {
    throw new Error("このブラウザはWebCodecs VideoEncoderに対応していません。Chromeを最新版に更新して再試行してください。");
  }

  const {
    Output,
    Mp4OutputFormat,
    MovOutputFormat,
    WebMOutputFormat,
    BufferTarget,
    CanvasSource
  } = await loadMediaBunny();

  const formatConfig = {
    mp4: { OutputFormat: Mp4OutputFormat, codec: "avc", mime: "video/mp4", bitrate: 500_000 },
    mov: { OutputFormat: MovOutputFormat, codec: "avc", mime: "video/quicktime", bitrate: 500_000 },
    webm: { OutputFormat: WebMOutputFormat, codec: "vp9", mime: "video/webm", bitrate: 500_000 }
  }[format];

  if (!formatConfig?.OutputFormat) {
    throw new Error(`ブラウザ変換では未対応の出力形式です: ${format}`);
  }

  const video = document.createElement("video");
  const sourceUrl = URL.createObjectURL(file);
  video.muted = true;
  video.playsInline = true;
  video.preload = "auto";
  video.src = sourceUrl;

  let output = null;
  let videoSource = null;

  try {
    const metadataReady = waitForMediaEvent(
      video,
      "loadedmetadata",
      "ブラウザが動画情報を読み込めませんでした。"
    );
    const firstFrameReady = waitForMediaEvent(
      video,
      "loadeddata",
      "ブラウザが動画フレームをデコードできませんでした。AV1動画の再生に対応しているか確認してください。"
    );
    video.load();
    await metadataReady;
    await firstFrameReady;

    if (!Number.isFinite(video.duration) || video.duration <= 0) {
      throw new Error("動画の長さを取得できませんでした。");
    }
    if (video.videoWidth < 1 || video.videoHeight < 1) {
      throw new Error("動画の解像度を取得できませんでした。");
    }

    const duration = Math.min(video.duration, 5);
    const fps = 5;
    const width = Math.max(2, Math.floor(Math.min(320, video.videoWidth) / 2) * 2);
    const height = Math.max(
      2,
      Math.round((video.videoHeight * width / video.videoWidth) / 2) * 2
    );
    const frameCount = Math.max(1, Math.ceil(duration * fps));

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d", { alpha: false });
    if (!context) throw new Error("Canvasを初期化できませんでした。");

    output = new Output({
      format: new formatConfig.OutputFormat(),
      target: new BufferTarget()
    });

    videoSource = new CanvasSource(canvas, {
      codec: formatConfig.codec,
      bitrate: formatConfig.bitrate
    });
    output.addVideoTrack(videoSource);

    onProgress({ progress: 0.02, label: "動画エンコーダーを準備中…" });
    await output.start();

    for (let index = 0; index < frameCount; index++) {
      const timestamp = index / fps;

      if (index > 0) {
        const seeked = waitForMediaEvent(
          video,
          "seeked",
          "動画のフレーム移動に失敗しました。"
        );
        video.currentTime = Math.min(timestamp, Math.max(0, duration - 0.04));
        await seeked;
      }

      context.drawImage(video, 0, 0, width, height);
      await videoSource.add(timestamp, 1 / fps);
      onProgress({
        progress: ((index + 1) / frameCount) * 0.9,
        label: `ブラウザで${format.toUpperCase()}を生成中…`
      });
    }

    videoSource.close();
    videoSource = null;

    onProgress({ progress: 0.94, label: `${format.toUpperCase()}ファイルを仕上げ中…` });
    await output.finalize();

    const buffer = output.target.buffer;
    if (!buffer || buffer.byteLength === 0) {
      throw new Error(`${format.toUpperCase()}ファイルが空になりました。`);
    }

    onProgress({ progress: 1, label: "完了" });
    return new Blob([buffer], { type: formatConfig.mime });
  } catch (error) {
    try { videoSource?.close(); } catch {}
    if (output && output.state !== "finalized" && output.state !== "canceled") {
      try { await output.cancel(); } catch {}
    }
    const message = String(error?.message || error);
    if (/not supported|unsupported|encoder|codec/i.test(message)) {
      throw new Error(
        `このブラウザでは${format.toUpperCase()}用の動画エンコードを利用できません。WebCodecsの対応状況を確認してください。\n\n` +
        message
      );
    }
    throw error;
  } finally {
    video.pause();
    video.removeAttribute("src");
    video.load();
    URL.revokeObjectURL(sourceUrl);
  }
}
