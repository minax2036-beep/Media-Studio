const FFMPEG_VERSION = "0.12.10";
// @ffmpeg/ffmpeg 0.12.10 is paired with @ffmpeg/core 0.12.6.
const CORE_VERSION = "0.12.6";
const CORE_BASE = `https://cdn.jsdelivr.net/npm/@ffmpeg/core@${CORE_VERSION}/dist/esm`;

let enginePromise = null;
let ffmpegInstance = null;
let recentLogs = [];

function resetFFmpegInstance(instance) {
  try {
    instance?.terminate();
  } catch (error) {
    console.warn("Failed to terminate the broken FFmpeg instance:", error);
  }

  if (!instance || ffmpegInstance === instance) {
    ffmpegInstance = null;
    enginePromise = null;
  }
}

export async function getFFmpeg(onProgress = () => {}) {
  if (ffmpegInstance?.loaded) return ffmpegInstance;

  if (!enginePromise) {
    enginePromise = (async () => {
      const { FFmpeg } = await import(
        `https://esm.sh/@ffmpeg/ffmpeg@${FFMPEG_VERSION}`
      );

      const ffmpeg = new FFmpeg();
      ffmpeg.on("log", ({ message, type }) => {
        if (message) {
          recentLogs.push(message);
          if (recentLogs.length > 100) recentLogs.shift();
          onProgress({ log: message, type });
        }
      });
      ffmpeg.on("progress", ({ progress, time }) => {
        onProgress({ progress, time });
      });

      const coreURL = `${CORE_BASE}/ffmpeg-core.js`;
      const wasmURL = `${CORE_BASE}/ffmpeg-core.wasm`;
      const classWorkerURL = new URL("./ffmpeg-worker.js", import.meta.url).href;

      await ffmpeg.load({ coreURL, wasmURL, classWorkerURL });
      ffmpegInstance = ffmpeg;
      return ffmpeg;
    })().catch(error => {
      enginePromise = null;
      ffmpegInstance = null;
      throw error;
    });
  }

  return enginePromise;
}

function safeName(name) {
  return name.normalize("NFKC").replace(/[^a-zA-Z0-9._-]/g, "_").slice(-100) || "input";
}

function videoQualityArgs(quality) {
  const q = quality === "high" ? "3" : quality === "small" ? "8" : "5";
  return ["-q:v", q];
}

export async function convertMedia({ file, kind, format, quality, onProgress }) {
  recentLogs = [];
  const ffmpeg = await getFFmpeg(value => {
    if (value && typeof value === "object" && value.log) {
      if (recentLogs.length === 0 || recentLogs[recentLogs.length - 1] !== value.log) {
        recentLogs.push(value.log);
        if (recentLogs.length > 100) recentLogs.shift();
      }
    }
    onProgress?.(value);
  });

  const inputName = `input_${safeName(file.name)}`;
  const outputName = `output.${format}`;

  try {
    await ffmpeg.writeFile(inputName, new Uint8Array(await file.arrayBuffer()));
    const args = ["-i", inputName];

    if (kind === "audio") {
      args.push("-vn");
      if (format === "mp3") args.push("-b:a", quality, "-codec:a", "libmp3lame");
      else if (format === "ogg") args.push("-c:a", "libvorbis", "-q:a", "5");
      else if (format === "flac") args.push("-c:a", "flac");
      else if (format === "wav") args.push("-c:a", "pcm_s16le");
      else if (format === "m4a") args.push("-c:a", "aac", "-b:a", quality);
    } else if (format === "mp4") {
      // Kept as the conservative FFmpeg fallback. WebM inputs use the
      // browser-native WebCodecs route in app.js.
      args.push(
        "-t", "5",
        "-vf", "scale=320:-2",
        "-an",
        "-c:v", "mpeg4",
        "-q:v", "8",
        "-f", "mp4",
        "-movflags", "+faststart"
      );
    } else if (format === "mov") {
      const crf = quality === "high" ? "18" : quality === "small" ? "28" : "23";
      args.push("-c:v", "libx264", "-preset", "ultrafast", "-crf", crf, "-c:a", "aac", "-f", "mov");
    } else if (format === "webm") {
      args.push("-c:v", "libvpx", "-deadline", "realtime", "-cpu-used", "8", "-crf", quality === "high" ? "20" : "32", "-b:v", "0", "-c:a", "libopus");
    } else if (format === "mkv") {
      args.push(
        "-c:v", "mpeg4",
        ...videoQualityArgs(quality),
        "-c:a", "aac", "-b:a", "160k",
        "-f", "matroska"
      );
    } else if (format === "avi") {
      args.push(
        "-c:v", "mpeg4",
        ...videoQualityArgs(quality),
        "-c:a", "pcm_s16le",
        "-f", "avi"
      );
    } else if (format === "ts") {
      args.push(
        "-c:v", "mpeg2video",
        ...videoQualityArgs(quality),
        "-c:a", "mp2", "-b:a", "192k",
        "-f", "mpegts"
      );
    } else if (format === "3gp") {
      args.push(
        "-c:v", "mpeg4",
        ...videoQualityArgs(quality),
        "-c:a", "aac", "-b:a", "96k",
        "-f", "3gp"
      );
    } else if (format === "psp") {
      // PSP-compatible MP4: H.264 Baseline, QVGA-class widescreen,
      // AAC-LC audio at 24 kHz. The PSP muxer writes the PSP MP4 variant.
      args.push(
        "-vf", "scale=480:272:force_original_aspect_ratio=decrease,pad=480:272:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=30000/1001,format=yuv420p",
        "-c:v", "libx264", "-preset", "ultrafast",
        "-profile:v", "baseline", "-level:v", "3.0",
        "-b:v", "600k", "-maxrate", "768k", "-bufsize", "1536k",
        "-c:a", "aac", "-profile:a", "aac_low",
        "-ar", "24000", "-ac", "2", "-b:a", "128k",
        "-f", "psp"
      );
    } else if (format === "amv") {
      // AMV is a strict AVI-derived format with paired AMV video and
      // IMA-ADPCM-AMV audio streams. Keep the classic low-res/15 fps profile.
      args.push(
        "-vf", "scale=160:120:flags=lanczos,format=yuvj420p",
        "-r", "15",
        "-strict", "-1",
        "-c:v", "amv",
        "-c:a", "adpcm_ima_amv",
        "-ar", "22050", "-ac", "1",
        "-f", "amv"
      );
    } else if (format === "gif") {
      args.push("-vf", "fps=12,scale=640:-1:flags=lanczos", "-an");
    }

    args.push("-y", outputName);
    onProgress?.("変換中…");

    const exitCode = await ffmpeg.exec(args);
    if (exitCode !== 0) {
      const details = recentLogs.slice(-24).join("\n");
      throw new Error(
        `FFmpegの変換処理が終了コード ${exitCode} で失敗しました。` +
        (details ? `\n\nFFmpegログ:\n${details}` : "\nFFmpegログが取得できませんでした。")
      );
    }

    const data = await ffmpeg.readFile(outputName);
    const mime = kind === "audio"
      ? ({ mp3: "audio/mpeg", wav: "audio/wav", ogg: "audio/ogg", flac: "audio/flac", m4a: "audio/mp4" }[format] || "application/octet-stream")
      : ({
          mp4: "video/mp4",
          mov: "video/quicktime",
          webm: "video/webm",
          mkv: "video/x-matroska",
          avi: "video/x-msvideo",
          ts: "video/mp2t",
          "3gp": "video/3gpp",
          psp: "video/mp4",
          amv: "video/amv",
          gif: "image/gif"
        }[format] || "application/octet-stream");

    return new Blob([data], { type: mime });
  } catch (error) {
    const message = String(error?.message || error);
    if (/RuntimeError|memory access out of bounds|WebAssembly|out of memory|abort\(/i.test(message)) {
      resetFFmpegInstance(ffmpeg);
      throw new Error(
        `FFmpeg.wasm内部エラーが発生したため、変換エンジンを再起動対象にしました。次の変換では新しいエンジンを起動します。\n\n元のエラー: ${message}`
      );
    }
    throw error;
  } finally {
    await ffmpeg.deleteFile(inputName).catch(() => {});
    await ffmpeg.deleteFile(outputName).catch(() => {});
  }
}
