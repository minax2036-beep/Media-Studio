const FFMPEG_VERSION = "0.12.10";
// @ffmpeg/ffmpeg 0.12.10 is paired with @ffmpeg/core 0.12.6.
const CORE_VERSION = "0.12.6";
const CORE_BASE = `https://cdn.jsdelivr.net/npm/@ffmpeg/core@${CORE_VERSION}/dist/esm`;

let enginePromise = null;
let ffmpegInstance = null;
let recentLogs = [];

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
      // Diagnostic pass-through test: do not decode or re-encode streams.
      // This isolates FFmpeg's demuxer/muxer and file-system path from encoders.
      args.push("-c", "copy", "-movflags", "+faststart");
    } else if (format === "mov") {
      const crf = quality === "high" ? "18" : quality === "small" ? "28" : "23";
      args.push("-c:v", "libx264", "-preset", "ultrafast", "-crf", crf, "-c:a", "aac", "-f", "mov");
    } else if (format === "webm") {
      args.push("-c:v", "libvpx", "-deadline", "realtime", "-cpu-used", "8", "-crf", quality === "high" ? "20" : "32", "-b:v", "0", "-c:a", "libopus");
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
      : ({ mp4: "video/mp4", mov: "video/quicktime", webm: "video/webm", gif: "image/gif" }[format] || "application/octet-stream");

    return new Blob([data], { type: mime });
  } finally {
    await ffmpeg.deleteFile(inputName).catch(() => {});
    await ffmpeg.deleteFile(outputName).catch(() => {});
  }
}
