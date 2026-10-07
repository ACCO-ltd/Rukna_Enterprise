import type { QuotePhotoSource } from '../types';

/** How the photo reached the page: the capture input (camera) or the plain picker (gallery). */
export type CaptureVia = 'camera' | 'gallery';

/** A file whose timestamp is this close to the moment it was picked was taken just now. */
export const FRESH_CAPTURE_MS = 2 * 60 * 1000;

/**
 * Best-effort provenance hint (ADR-044 §9). A browser cannot prove a photo came from the camera:
 * `capture="environment"` only *requests* it. So this is shown to finance as a hint, never as
 * proof:
 *
 * - `GALLERY` — picked through the gallery control;
 * - `CAMERA` — came through the capture input and its `lastModified` is within 2 minutes of the
 *   pick (a freshly taken photo);
 * - `UNKNOWN` — anything else (the capture input handed back an older file).
 */
export function photoSource(via: CaptureVia, lastModified: number | undefined, pickedAt: number): QuotePhotoSource {
  if (via === 'gallery') return 'GALLERY';
  if (lastModified && Math.abs(pickedAt - lastModified) <= FRESH_CAPTURE_MS) return 'CAMERA';
  return 'UNKNOWN';
}

/**
 * Device-reported capture time: the file's own timestamp when it is plausible (not in the future,
 * not zero), else the moment it was picked.
 */
export function capturedAtIso(lastModified: number | undefined, pickedAt: number): string {
  const plausible = lastModified && lastModified > 0 && lastModified <= pickedAt + 60_000;
  return new Date(plausible ? lastModified : pickedAt).toISOString();
}
