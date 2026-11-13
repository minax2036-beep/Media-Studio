/*
 * FFmpeg.wasm 0.12.10 worker.
 * This is the browser-worker implementation corresponding to the
 * upstream @ffmpeg/ffmpeg 0.12.10 worker protocol, hosted same-origin
 * so GitHub Pages can construct it without a cross-origin Worker error.
 */

const FFMessageType = {
  LOAD: "LOAD",
  EXEC: "EXEC",
  FFPROBE: "FFPROBE",
  WRITE_FILE: "WRITE_FILE",
  READ_FILE: "READ_FILE",
  DELETE_FILE: "DELETE_FILE",
  RENAME: "RENAME",
  CREATE_DIR: "CREATE_DIR",
  LIST_DIR: "LIST_DIR",
  DELETE_DIR: "DELETE_DIR",
  ERROR: "ERROR",
  DOWNLOAD: "DOWNLOAD",
  PROGRESS: "PROGRESS",
  LOG: "LOG",
  MOUNT: "MOUNT",
  UNMOUNT: "UNMOUNT"
};

const CORE_VERSION = "0.12.10";
const CORE_URL = `https://cdn.jsdelivr.net/npm/@ffmpeg/core@${CORE_VERSION}/dist/umd/ffmpeg-core.js`;

const ERROR_UNKNOWN_MESSAGE_TYPE = new Error("unknown message type");
const ERROR_NOT_LOADED = new Error("ffmpeg is not loaded, call `await ffmpeg.load()` first");
const ERROR_IMPORT_FAILURE = new Error("failed to import ffmpeg-core.js");

let ffmpeg = null;

async function load({
  coreURL: requestedCoreURL,
  wasmURL: requestedWasmURL,
  workerURL: requestedWorkerURL
}) {
  let coreURL = requestedCoreURL || CORE_URL;

  try {
    importScripts(coreURL);
  } catch {
    if (!requestedCoreURL || requestedCoreURL === CORE_URL) {
      coreURL = CORE_URL.replace("/umd/", "/esm/");
    }

    const importedCore = await import(coreURL);
    self.createFFmpegCore = importedCore.default;

    if (!self.createFFmpegCore) {
      throw ERROR_IMPORT_FAILURE;
    }
  }

  const wasmURL = requestedWasmURL || coreURL.replace(/.js$/g, ".wasm");
  const workerURL = requestedWorkerURL || coreURL.replace(/.js$/g, ".worker.js");

  ffmpeg = await self.createFFmpegCore({
    mainScriptUrlOrBlob: `${coreURL}#${btoa(JSON.stringify({ wasmURL, workerURL }))}`
  });

  ffmpeg.setLogger(data => {
    self.postMessage({ type: FFMessageType.LOG, data });
  });

  ffmpeg.setProgress(data => {
    self.postMessage({ type: FFMessageType.PROGRESS, data });
  });

  return true;
}

function exec({ args, timeout = -1 }) {
  ffmpeg.setTimeout(timeout);
  ffmpeg.exec(...args);
  const result = ffmpeg.ret;
  ffmpeg.reset();
  return result;
}

function ffprobe({ args, timeout = -1 }) {
  ffmpeg.setTimeout(timeout);
  ffmpeg.ffprobe(...args);
  const result = ffmpeg.ret;
  ffmpeg.reset();
  return result;
}

const writeFile = ({ path, data }) => {
  ffmpeg.FS.writeFile(path, data);
  return true;
};

const readFile = ({ path, encoding }) =>
  ffmpeg.FS.readFile(path, { encoding });

const deleteFile = ({ path }) => {
  ffmpeg.FS.unlink(path);
  return true;
};

const rename = ({ oldPath, newPath }) => {
  ffmpeg.FS.rename(oldPath, newPath);
  return true;
};

const createDir = ({ path }) => {
  ffmpeg.FS.mkdir(path);
  return true;
};

function listDir({ path }) {
  return ffmpeg.FS.readdir(path).map(name => {
    const stat = ffmpeg.FS.stat(`${path}/${name}`);
    return {
      name,
      isDir: ffmpeg.FS.isDir(stat.mode)
    };
  });
}

const deleteDir = ({ path }) => {
  ffmpeg.FS.rmdir(path);
  return true;
};

function mount({ fsType, options, mountPoint }) {
  const key = fsType;
  const filesystem = ffmpeg.FS.filesystems[key];
  if (!filesystem) return false;
  ffmpeg.FS.mount(filesystem, options, mountPoint);
  return true;
}

const unmount = ({ mountPoint }) => {
  ffmpeg.FS.unmount(mountPoint);
  return true;
};

self.onmessage = async event => {
  const { id, type, data } = event.data;
  const transfers = [];

  try {
    if (type !== FFMessageType.LOAD && !ffmpeg) {
      throw ERROR_NOT_LOADED;
    }

    let result;

    switch (type) {
      case FFMessageType.LOAD:
        result = await load(data);
        break;
      case FFMessageType.EXEC:
        result = exec(data);
        break;
      case FFMessageType.FFPROBE:
        result = ffprobe(data);
        break;
      case FFMessageType.WRITE_FILE:
        result = writeFile(data);
        break;
      case FFMessageType.READ_FILE:
        result = readFile(data);
        break;
      case FFMessageType.DELETE_FILE:
        result = deleteFile(data);
        break;
      case FFMessageType.RENAME:
        result = rename(data);
        break;
      case FFMessageType.CREATE_DIR:
        result = createDir(data);
        break;
      case FFMessageType.LIST_DIR:
        result = listDir(data);
        break;
      case FFMessageType.DELETE_DIR:
        result = deleteDir(data);
        break;
      case FFMessageType.MOUNT:
        result = mount(data);
        break;
      case FFMessageType.UNMOUNT:
        result = unmount(data);
        break;
      default:
        throw ERROR_UNKNOWN_MESSAGE_TYPE;
    }

    if (result instanceof Uint8Array) {
      transfers.push(result.buffer);
    }

    self.postMessage({ id, type, data: result }, transfers);
  } catch (error) {
    self.postMessage({
      id,
      type: FFMessageType.ERROR,
      data: error instanceof Error ? error.toString() : String(error)
    });
  }
};
