"use client";

export type PreparedPage = { id: string; file: Blob; type: string; url: string; width: number | null; height: number | null; name: string };

const MAX_SIDE = 2000; // long side in pixels: plenty for handwriting, small enough for phones on slow networks

/** Shrink a phone photo before upload (respecting its rotation). PDFs are passed through as they are. */
export async function preparePage(file: File): Promise<PreparedPage> {
  const id = crypto.randomUUID();
  if (file.type === "application/pdf") return { id, file, type: file.type, url: "", width: null, height: null, name: file.name };
  const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
  const w = Math.round(bitmap.width * scale), h = Math.round(bitmap.height * scale);
  const canvas = document.createElement("canvas");
  canvas.width = w; canvas.height = h;
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0, w, h);
  bitmap.close();
  const blob = await new Promise<Blob>((res, rej) => canvas.toBlob((b) => (b ? res(b) : rej(new Error("compress"))), "image/jpeg", 0.85));
  return { id, file: blob, type: "image/jpeg", url: URL.createObjectURL(blob), width: w, height: h, name: file.name };
}

export type QrHit = { data: string; top: number; bottom: number; flipped: boolean }; // top/bottom in image pixels

/**
 * Find the sheet QR code in a photo. Tries the whole page (downscaled), then the top-right corner at higher resolution
 * (where the code is printed), then the page upside down. jsQR needs no network and runs on the device.
 * Returns where the code sits, so the printed name beside it can be blanked out before upload.
 */
export async function readQr(blob: Blob): Promise<QrHit | null> {
  const { default: jsQR } = await import("jsqr");
  const bitmap = await createImageBitmap(blob);
  const W = bitmap.width, H = bitmap.height;
  const attempts = [
    { sx: 0, sy: 0, sw: W, sh: H, flip: false },
    { sx: W * 0.5, sy: 0, sw: W * 0.5, sh: H * 0.4, flip: false },
    { sx: 0, sy: 0, sw: W, sh: H, flip: true },
    { sx: 0, sy: H * 0.6, sw: W * 0.5, sh: H * 0.4, flip: true },
  ];
  try {
    for (const a of attempts) {
      const scale = Math.min(1, 1400 / Math.max(a.sw, a.sh));
      const w = Math.max(1, Math.round(a.sw * scale)), h = Math.max(1, Math.round(a.sh * scale));
      const canvas = document.createElement("canvas");
      canvas.width = w; canvas.height = h;
      const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
      if (a.flip) { ctx.translate(w, h); ctx.rotate(Math.PI); }
      ctx.drawImage(bitmap, a.sx, a.sy, a.sw, a.sh, 0, 0, w, h);
      const code = jsQR(ctx.getImageData(0, 0, w, h).data, w, h, { inversionAttempts: "dontInvert" });
      if (!code?.data) continue;
      const ys = [code.location.topLeftCorner, code.location.topRightCorner, code.location.bottomLeftCorner, code.location.bottomRightCorner].map((pt) => pt.y);
      // back to the original photo's pixels (undo the 180° turn, the scale and the crop)
      const toImg = (y: number) => (a.flip ? a.sy + a.sh - y / scale : a.sy + y / scale);
      const mapped = ys.map(toImg);
      return { data: code.data, top: Math.max(0, Math.min(...mapped)), bottom: Math.min(H, Math.max(...mapped)), flipped: a.flip };
    }
    return null;
  } finally {
    bitmap.close();
  }
}

/**
 * Blank out the answer sheet's printed header (the student's name sits level with the QR code) before the photo leaves
 * the device, so the AI services never see the printed name. Everything from the page edge to the far side of the QR
 * code is painted white; the answers below are untouched.
 */
export async function redactHeader(page: PreparedPage, hit: QrHit): Promise<PreparedPage> {
  const bitmap = await createImageBitmap(page.file);
  const canvas = document.createElement("canvas");
  canvas.width = bitmap.width; canvas.height = bitmap.height;
  const ctx = canvas.getContext("2d")!;
  ctx.drawImage(bitmap, 0, 0);
  const pad = (hit.bottom - hit.top) * 0.08;
  ctx.fillStyle = "#ffffff";
  if (!hit.flipped) ctx.fillRect(0, 0, bitmap.width, Math.min(bitmap.height, hit.bottom + pad));
  else ctx.fillRect(0, Math.max(0, hit.top - pad), bitmap.width, bitmap.height);
  bitmap.close();
  const blob = await new Promise<Blob>((res, rej) => canvas.toBlob((b) => (b ? res(b) : rej(new Error("redact"))), "image/jpeg", 0.85));
  if (page.url) URL.revokeObjectURL(page.url);
  return { ...page, file: blob, type: "image/jpeg", url: URL.createObjectURL(blob) };
}
