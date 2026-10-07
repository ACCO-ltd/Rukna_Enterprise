import { downscaleImage } from './downscale';
import { capturedAtIso, photoSource, type CaptureVia } from './photo-source';
import type { QuotePhotoSource } from '../types';

export interface PreparedPhoto {
  file: Blob;
  name: string;
  capturedAt: string;
  source: QuotePhotoSource;
}

/**
 * Turns a picked file into a queue page: provenance hint and capture time from the ORIGINAL
 * file (downscaling resets nothing we rely on, but it does strip EXIF), then the downscale.
 */
export async function preparePhoto(
  file: File,
  via: CaptureVia,
  pickedAt: number = Date.now(),
  downscale: (file: File) => Promise<File> = downscaleImage,
): Promise<PreparedPhoto> {
  const source = photoSource(via, file.lastModified, pickedAt);
  const capturedAt = capturedAtIso(file.lastModified, pickedAt);
  const out = await downscale(file);
  return { file: out, name: out.name || 'quote.jpg', capturedAt, source };
}
