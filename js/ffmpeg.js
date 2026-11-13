const CORE_BASE = "https://unpkg.com/@ffmpeg/core@0.12.10/dist/umd";
let enginePromise;
let ffmpegInstance;

export async function getFFmpeg(onProgress = () => {}) {
  if (ffmpegInstance) return ffmpegInstance;

  if (!enginePromise) {
    enginePromise = (async () => {
      const { FFmpeg } = await import("https://esm.sh/@ffmpeg/ffmpeg@0.12.10");
      const { toBlobURL } = await import("https://esm.sh/@ffmpeg/util@0.12.2");

      const ffmpeg = new FFmpeg();

      ffmpeg.on("log", ({ message }) => {
        if (message) onProgress(message);
      });

      ffmpeg.on("progress", ({ progress }) => {
        onProgress({ progress });
      });

      const coreURL = await toBlobURL(
        `${CORE_BASE}/ffmpeg-core.js`,
        "text/javascript"
      );

      const wasmURL = await toBlobURL(
        `${CORE_BASE}/ffmpeg-core.wasm`,
        "application/wasm"
      );

      // Let @ffmpeg/ffmpeg resolve its own packaged worker.js.
      // The previous custom URL pointed to a file that is not in this repository.
      await ffmpeg.load({ coreURL, wasmURL });

      ffmpegInstance = ffmpeg;
      return ffmpeg;
    })().catch(error => {
      enginePromise = null;
      throw error;
    });
  }

  return enginePromise;
}

function safeName(name) {
  return name.normalize("NFKC").replace(/[^a-zA-Z0-9._-]/g, "_").slice(-100) || "input";
}

export async function convertMedia({ file, kind, format, quality, onProgress }) {
  const ffmpeg = await getFFmpeg(onProgress);
  const inputName = `input_${safeName(file.name)}`;
  const outputName = `output.${format}`;

  await ffmpeg.writeFile(inputName, new Uint8Array(await file.arrayBuffer()));

  const args = ["-i", inputName, "-y"];

  if (kind === "audio") {
    if (format === "mp3") args.push("-vn", "-b:a", quality, "-codec:a", "libmp3lame");
    else if (format === "ogg") args.push("-vn", "-c:a", "libvorbis", "-q:a", "5");
    else if (format === "flac") args.push("-vn", "-c:a", "flac");
    else if (format === "wav") args.push("-vn", "-c:a", "pcm_s16le");
    else if (format === "m4a") args.push("-vn", "-c:a", "aac", "-b:a", quality);
  } else {
    if (format === "mp4" || format === "mov") {
      const crf = quality === "high" ? "18" : quality === "small" ? "28" : "23";
      args.push(
        "-c:v", "libx264",
        "-preset", "ultrafast",
        "-crf", crf,
        "-c:a", "aac",
        "-movflags", "+faststart"
      );
      if (format === "mov") args.push("-f", "mov");
    } else if (format === "webm") {
      args.push(
        "-c:v", "libvpx",
        "-deadline", "realtime",
        "-cpu-used", "8",
        "-crf", quality === "high" ? "20" : "32",
        "-b:v", "0",
        "-c:a", "libopus"
      );
    } else if (format === "gif") {
      args.push("-vf", "fps=12,scale=640:-1:flags=lanczos");
    }
  }

  onProgress("変換中…");

  const exitCode = await ffmpeg.exec([...args, outputName]);

  if (exitCode !== 0) {
    throw new Error("FFmpegが変換に失敗しました。入力形式と出力形式を確認してください。");
  }

  const data = await ffmpeg.readFile(outputName);

  const mime = kind === "audio"
    ? ({
        mp3: "audio/mpeg",
        wav: "audio/wav",
        ogg: "audio/ogg",
        flac: "audio/flac",
        m4a: "audio/mp4"
      }[format] || "application/octet-stream")
    : ({
        mp4: "video/mp4",
        mov: "video/quicktime",
        webm: "video/webm",
        gif: "image/gif"
      }[format] || "application/octet-stream");

  await ffmpeg.deleteFile(inputName).catch(() => {});
  await ffmpeg.deleteFile(outputName).catch(() => {});

  return new Blob([data], { type: mime });
}
