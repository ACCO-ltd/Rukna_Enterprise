/**
 * Client-side downscale of a quote photo before upload (ADR-044 §9, spec Q10).
 *
 * A phone photo is 3–12 MB; on a market's weak signal that is minutes. A paper quote stays
 * readable at a 1600 px long edge, which as a JPEG at quality 0.8 is ~250–500 KB. The upload
 * hashes the bytes it sends (files-api `uploadFile`), so the stored SHA-256 is of this output.
 *
 * Downscaling strips EXIF, which ADR-044 §9 records as accepted: capture time is device-reported.
 */

export const MAX_EDGE_PX = 1600;
export const JPEG_QUALITY = 0.8;

/** A decoded image that can draw itself onto a 2D context. */
export interface DecodedImage {
  width: number;
  height: number;
  draw: (ctx: CanvasRenderingContext2D, width: number, height: number) => void;
  close?: () => void;
}

export interface DownscaleDeps {
  decode: (file: Blob) => Promise<DecodedImage>;
  encode: (image: DecodedImage, width: number, height: number, quality: number) => Promise<Blob>;
}

export interface DownscaleOptions {
  maxEdge?: number;
  quality?: number;
}

/** `createImageBitmap` honours EXIF orientation, so a portrait quote is not stored sideways. */
async function browserDecode(file: Blob): Promise<DecodedImage> {
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  return {
    width: bitmap.width,
    height: bitmap.height,
    draw: (ctx, width, height) => ctx.drawImage(bitmap, 0, 0, width, height),
    close: () => bitmap.close(),
  };
}

async function browserEncode(
  image: DecodedImage,
  width: number,
  height: number,
  quality: number,
): Promise<Blob> {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D is unavailable');
  // Paper is mostly white; a white fill keeps a transparent PNG from turning black as JPEG.
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, width, height);
  image.draw(ctx, width, height);
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('Image encoding failed'))),
      'image/jpeg',
      quality,
    );
  });
}

const BROWSER_DEPS: DownscaleDeps = { decode: browserDecode, encode: browserEncode };

/** The scaled size for a long edge cap; never upscales. */
export function scaledSize(width: number, height: number, maxEdge: number): { width: number; height: number } {
  const longest = Math.max(width, height);
  if (longest <= maxEdge || longest === 0) return { width, height };
  const scale = maxEdge / longest;
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

function jpegName(name: string): string {
  const base = name.replace(/\.[^.]+$/, '') || 'quote';
  return `${base}.jpg`;
}

/**
 * Returns a JPEG no larger than `maxEdge` on its long side.
 *
 * - Keeps the original when it is already a JPEG within the limit (re-encoding would only lose
 *   quality and change the hash for nothing).
 * - Keeps the original when it cannot be decoded (HEIC on browsers without HEIC support) — the
 *   server accepts `image/heic`, and a slower upload beats a lost quote.
 * - Keeps the original when the re-encoded file would be bigger.
 */
export async function downscaleImage(
  file: File,
  options: DownscaleOptions = {},
  deps: DownscaleDeps = BROWSER_DEPS,
): Promise<File> {
  const maxEdge = options.maxEdge ?? MAX_EDGE_PX;
  const quality = options.quality ?? JPEG_QUALITY;
  if (!file.type.startsWith('image/')) return file;

  let image: DecodedImage;
  try {
    image = await deps.decode(file);
  } catch {
    return file;
  }

  try {
    const target = scaledSize(image.width, image.height, maxEdge);
    const unchanged = target.width === image.width && target.height === image.height;
    if (unchanged && file.type === 'image/jpeg') return file;

    const blob = await deps.encode(image, target.width, target.height, quality);
    if (unchanged && blob.size >= file.size) return file;
    return new File([blob], jpegName(file.name), {
      type: 'image/jpeg',
      lastModified: file.lastModified,
    });
  } catch {
    return file;
  } finally {
    image.close?.();
  }
}
