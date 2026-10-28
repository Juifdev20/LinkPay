/**
 * Shrinks a picture chosen on the phone BEFORE it is sent (a camera photo is 3-8 Mo; on a weak 2G connection that is a
 * failed upload). The picture is drawn on a small square canvas and saved as WebP (JPEG where the browser cannot write
 * WebP), at the best quality that stays under the size limit. The canvas also drops every piece of metadata (place,
 * date, camera) and applies the rotation the phone recorded. The API shrinks it once more: what is kept never depends
 * on this function.
 */

export interface ShrunkPicture {
  blob: Blob;
  /** An address the screen can show at once (revoke it with URL.revokeObjectURL when done). */
  previewUrl: string;
  width: number;
  height: number;
}

export type PictureShape = 'face' | 'logo';

const QUALITIES = [0.82, 0.72, 0.62, 0.52, 0.42];

async function decode(file: Blob): Promise<{ source: CanvasImageSource; width: number; height: number; close: () => void }> {
  if (typeof createImageBitmap === 'function') {
    try {
      const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' } as ImageBitmapOptions);
      return { source: bmp, width: bmp.width, height: bmp.height, close: () => bmp.close() };
    } catch { /* an older browser: the <img> path below */ }
  }
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.decoding = 'async';
    img.src = url;
    await img.decode();
    return { source: img, width: img.naturalWidth, height: img.naturalHeight, close: () => undefined };
  } finally {
    URL.revokeObjectURL(url);
  }
}

const toBlob = (canvas: HTMLCanvasElement, type: string, quality: number) =>
  new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, quality));

/** `face`: cropped to a square from the middle. `logo`: kept whole, centered on a transparent square. */
export async function shrinkPicture(file: Blob, shape: PictureShape, options: { size?: number; maxBytes?: number } = {}): Promise<ShrunkPicture> {
  if (!file.type.startsWith('image/')) throw new Error("Ce fichier n'est pas une image.");
  const size = options.size ?? (shape === 'face' ? 256 : 512);
  const maxBytes = options.maxBytes ?? 60_000; // the API accepts far more; this keeps the upload tiny
  const { source, width, height, close } = await decode(file).catch(() => { throw new Error("Cette image n'a pas pu être lue. Choisissez-en une autre."); });
  try {
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error("Cet appareil ne permet pas de préparer l'image.");
    ctx.imageSmoothingQuality = 'high';
    if (shape === 'face') {
      const side = Math.min(width, height);
      ctx.drawImage(source, (width - side) / 2, (height - side) / 2, side, side, 0, 0, size, size);
    } else {
      const scale = Math.min(size / width, size / height);
      const w = Math.round(width * scale);
      const h = Math.round(height * scale);
      ctx.drawImage(source, 0, 0, width, height, Math.round((size - w) / 2), Math.round((size - h) / 2), w, h);
    }
    let best: Blob | null = null;
    for (const type of ['image/webp', 'image/jpeg']) {
      for (const q of QUALITIES) {
        const blob = await toBlob(canvas, type, q);
        if (!blob || blob.type !== type) break; // this browser cannot write that format
        best = blob;
        if (blob.size <= maxBytes) return { blob, previewUrl: URL.createObjectURL(blob), width: size, height: size };
      }
      if (best && best.type === type) return { blob: best, previewUrl: URL.createObjectURL(best), width: size, height: size };
    }
    throw new Error("L'image n'a pas pu être préparée. Choisissez-en une autre.");
  } finally {
    close();
  }
}
