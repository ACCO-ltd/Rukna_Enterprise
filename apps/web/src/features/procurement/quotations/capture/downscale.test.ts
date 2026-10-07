import { describe, expect, it, vi } from 'vitest';

import { downscaleImage, scaledSize, type DownscaleDeps } from './downscale';
import { capturedAtIso, photoSource } from './photo-source';

function deps(width: number, height: number, outBytes = 100): DownscaleDeps & {
  encode: ReturnType<typeof vi.fn>;
} {
  return {
    decode: vi.fn(async () => ({ width, height, draw: () => undefined })),
    encode: vi.fn(async () => new Blob([new Uint8Array(outBytes)], { type: 'image/jpeg' })),
  };
}

const file = (type: string, bytes = 5_000, name = 'IMG_0001.HEIC') =>
  new File([new Uint8Array(bytes)], name, { type, lastModified: 1_000 });

describe('downscaleImage', () => {
  it('caps the long edge at 1600 px and encodes JPEG at quality 0.8', async () => {
    const d = deps(4032, 3024);
    const out = await downscaleImage(file('image/png'), {}, d);
    expect(d.encode).toHaveBeenCalledWith(expect.anything(), 1600, 1200, 0.8);
    expect(out.type).toBe('image/jpeg');
    expect(out.name).toBe('IMG_0001.jpg');
    expect(out.lastModified).toBe(1_000);
  });

  it('handles portrait photos on the height', () => {
    expect(scaledSize(3024, 4032, 1600)).toEqual({ width: 1200, height: 1600 });
    expect(scaledSize(800, 600, 1600)).toEqual({ width: 800, height: 600 });
  });

  it('keeps a JPEG that is already small enough (no needless re-encode)', async () => {
    const d = deps(1200, 900);
    const original = file('image/jpeg', 5_000, 'q.jpg');
    expect(await downscaleImage(original, {}, d)).toBe(original);
    expect(d.encode).not.toHaveBeenCalled();
  });

  it('uploads the original when the browser cannot decode it (HEIC)', async () => {
    const original = file('image/heic');
    const out = await downscaleImage(original, {}, {
      decode: async () => {
        throw new Error('unsupported');
      },
      encode: vi.fn(),
    });
    expect(out).toBe(original);
  });

  it('keeps a small non-JPEG original when re-encoding would make it bigger', async () => {
    const original = file('image/png', 50, 'q.png');
    expect(await downscaleImage(original, {}, deps(400, 300, 5_000))).toBe(original);
  });
});

describe('photo source heuristic (ADR-044 §9)', () => {
  const now = 10_000_000;
  it('marks a fresh capture-input file as CAMERA', () => {
    expect(photoSource('camera', now - 30_000, now)).toBe('CAMERA');
  });
  it('marks an old file from the capture input as UNKNOWN', () => {
    expect(photoSource('camera', now - 3 * 60_000, now)).toBe('UNKNOWN');
    expect(photoSource('camera', undefined, now)).toBe('UNKNOWN');
  });
  it('marks the gallery picker as GALLERY', () => {
    expect(photoSource('gallery', now, now)).toBe('GALLERY');
  });
  it('uses the file time for capturedAt unless it is implausible', () => {
    expect(capturedAtIso(now - 1_000, now)).toBe(new Date(now - 1_000).toISOString());
    expect(capturedAtIso(now + 10 * 60_000, now)).toBe(new Date(now).toISOString());
    expect(capturedAtIso(0, now)).toBe(new Date(now).toISOString());
  });
});
