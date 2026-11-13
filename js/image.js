export function loadImageFile(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => resolve({ image, url, width: image.naturalWidth, height: image.naturalHeight });
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("画像を読み込めませんでした。"));
    };
    image.src = url;
  });
}

export async function exportImage({ image, width, height, mime, quality }) {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || width > 12000 || height > 12000) {
    throw new Error("幅と高さは1〜12000pxで指定してください。");
  }
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d", { alpha: mime !== "image/jpeg" });
  if (!context) throw new Error("Canvasを初期化できませんでした。");
  if (mime === "image/jpeg") {
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, width, height);
  }
  context.drawImage(image, 0, 0, width, height);
  const blob = await new Promise(resolve => canvas.toBlob(resolve, mime, quality));
  if (!blob) throw new Error("画像を書き出せませんでした。");
  return blob;
}
