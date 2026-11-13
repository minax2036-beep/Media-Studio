const MEDIABUNNY_URL = "https://esm.sh/mediabunny";

let mediaBunnyPromise = null;

function loadMediaBunny() {
  if (!mediaBunnyPromise) {
    mediaBunnyPromise = import(MEDIABUNNY_URL).catch(() => {
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

function waitForNextVideoFrame(video) {
  return new Promise((resolve, reject) => {
    let callbackId = null;

    const cleanup = () => {
      video.removeEventListener("ended", onEnded);
      video.removeEventListener("error", onError);
    };
    const onEnded = () => {
      if (callbackId !== null) video.cancelVideoFrameCallback(callbackId);
      cleanup();
      resolve(null);
    };
    const onError = () => {
      if (callbackId !== null) video.cancelVideoFrameCallback(callbackId);
      cleanup();
      reject(new Error("動画の再生中にデコードエラーが発生しました。"));
    };

    video.addEventListener("ended", onEnded, { once: true });
    video.addEventListener("error", onError, { once: true });
    callbackId = video.requestVideoFrameCallback((_now, metadata) => {
      cleanup();
      video.pause();
      resolve(metadata.mediaTime);
    });
  });
}

function chooseBitrate(width, height, fps) {
  const pixelsPerSecond = width * height * fps;
  // Approximately 0.08 bits per pixel per frame, with practical bounds.
  return Math.round(Math.min(24_000_000, Math.max(1_500_000, pixelsPerSecond * 0.08)));
}

/**
 * Browser-native video decode -> Canvas -> WebCodecs encode -> container.
 * Uses the source resolution and an estimated source frame rate (up to 60 FPS).
 * The complete video is processed; frames are paced by the browser decoder
 * rather than seeking independently for every frame.
 */
export async function createBrowserVideo(file, format, onProgress = () => {}) {
  if (!("VideoEncoder" in window)) {
    throw new Error("このブラウザはWebCodecs VideoEncoderに対応していません。Chromeを最新版に更新して再試行してください。");
  }
  if (!("requestVideoFrameCallback" in HTMLVideoElement.prototype)) {
    throw new Error("このブラウザはrequestVideoFrameCallbackに対応していません。Chromeを最新版に更新して再試行してください。");
  }

  const {
    Output,
    Mp4OutputFormat,
    MovOutputFormat,
    WebMOutputFormat,
    BufferTarget,
    CanvasSource,
    Input,
    ALL_FORMATS,
    BlobSource
  } = await loadMediaBunny();

  const formatConfig = {
    mp4: { OutputFormat: Mp4OutputFormat, codec: "avc", mime: "video/mp4" },
    mov: { OutputFormat: MovOutputFormat, codec: "avc", mime: "video/quicktime" },
    webm: { OutputFormat: WebMOutputFormat, codec: "vp9", mime: "video/webm" }
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
  let input = null;

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

    const duration = video.duration;
    const width = video.videoWidth;
    const height = video.videoHeight;

    onProgress({ progress: 0.01, label: "動画情報を解析中…" });
    let fps = 30;
    try {
      input = new Input({
        formats: ALL_FORMATS,
        source: new BlobSource(file, { maxCacheSize: 8 * 1024 * 1024 })
      });
      const videoTrack = await input.getPrimaryVideoTrack();
      if (videoTrack) {
        const stats = await videoTrack.computePacketStats(120);
        if (Number.isFinite(stats.averagePacketRate) && stats.averagePacketRate > 0) {
          fps = Math.min(60, Math.max(1, stats.averagePacketRate));
        }
      }
    } catch (metadataError) {
      console.warn("FPS metadata could not be read; using 30 FPS.", metadataError);
    } finally {
      input?.dispose();
      input = null;
    }

    const bitrate = chooseBitrate(width, height, fps);
    const frameDuration = 1 / fps;
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d", {
      alpha: false,
      desynchronized: true
    });
    if (!context) throw new Error("Canvasを初期化できませんでした。");

    output = new Output({
      format: new formatConfig.OutputFormat(),
      target: new BufferTarget()
    });

    videoSource = new CanvasSource(canvas, {
      codec: formatConfig.codec,
      bitrate
    });
    output.addVideoTrack(videoSource, { frameRate: fps });

    onProgress({
      progress: 0.03,
      label: `準備完了 · ${width}×${height} / 約${fps.toFixed(2)} FPS / ${Math.round(duration)}秒`
    });
    await output.start();

    await video.play();
    let frameCount = 0;
    let lastTimestamp = -1;

    while (true) {
      const timestamp = await waitForNextVideoFrame(video);
      if (timestamp === null || timestamp >= duration) break;
      if (timestamp <= lastTimestamp) {
        await video.play();
        continue;
      }

      context.drawImage(video, 0, 0, width, height);
      const actualDuration = lastTimestamp < 0
        ? frameDuration
        : Math.max(0.001, Math.min(0.25, timestamp - lastTimestamp));
      await videoSource.add(timestamp, actualDuration);

      lastTimestamp = timestamp;
      frameCount++;

      if (frameCount === 1 || frameCount % 15 === 0) {
        onProgress({
          progress: 0.05 + Math.min(1, timestamp / duration) * 0.84,
          label: `動画を変換中… ${Math.floor(timestamp)}秒 / ${Math.ceil(duration)}秒 · ${frameCount.toLocaleString()}フレーム`
        });
      }

      await video.play();
    }

    if (frameCount === 0) {
      throw new Error("動画フレームを取得できませんでした。");
    }

    videoSource.close();
    videoSource = null;

    onProgress({ progress: 0.92, label: "動画ファイルを仕上げ中…" });
    await output.finalize();

    const buffer = output.target.buffer;
    if (!buffer || buffer.byteLength === 0) {
      throw new Error(`${format.toUpperCase()}ファイルが空になりました。`);
    }

    onProgress({ progress: 1, label: `完了 · ${frameCount.toLocaleString()}フレーム` });
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
    if (/memory|allocation|out of memory/i.test(message)) {
      throw new Error(
        "変換中にメモリが不足しました。解像度または動画の長さが大きすぎる可能性があります。別の形式や短い動画で再試行してください。"
      );
    }
    throw error;
  } finally {
    input?.dispose();
    video.pause();
    video.removeAttribute("src");
    video.load();
    URL.revokeObjectURL(sourceUrl);
  }
}
