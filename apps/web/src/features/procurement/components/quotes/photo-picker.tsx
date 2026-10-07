'use client';

import { useCallback, useEffect, useRef } from 'react';

import type { CaptureVia } from '../../quotations/capture/photo-source';

/**
 * Two hidden file inputs — the camera (`capture="environment"`) and the gallery — opened by real
 * buttons, so the controls are keyboard-reachable and the camera opens inside the user's tap
 * (browsers only allow a file picker from a user gesture).
 *
 * `onCancel` fires when the camera is dismissed without a photo, where the browser reports it.
 */
export function usePhotoPicker(
  onPicked: (files: File[], via: CaptureVia) => void,
  options?: { onCancel?: () => void; galleryMultiple?: boolean },
) {
  const cameraRef = useRef<HTMLInputElement>(null);
  const galleryRef = useRef<HTMLInputElement>(null);

  // `cancel` (current Chrome/Safari) fires when the picker closes with nothing; React has no prop.
  const onCancel = options?.onCancel;
  useEffect(() => {
    const input = cameraRef.current;
    if (!input || !onCancel) return;
    input.addEventListener('cancel', onCancel);
    return () => input.removeEventListener('cancel', onCancel);
  }, [onCancel]);

  const openCamera = useCallback(() => cameraRef.current?.click(), []);
  const openGallery = useCallback(() => galleryRef.current?.click(), []);

  const handle = (via: CaptureVia) => (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? []);
    // Reset so picking the same file again still fires `change`.
    event.target.value = '';
    if (files.length > 0) onPicked(files, via);
    else options?.onCancel?.();
  };

  const inputs = (
    <>
      <input
        ref={cameraRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="sr-only"
        tabIndex={-1}
        aria-hidden="true"
        data-testid="quote-camera-input"
        onChange={handle('camera')}
      />
      <input
        ref={galleryRef}
        type="file"
        accept="image/*"
        multiple={options?.galleryMultiple ?? true}
        className="sr-only"
        tabIndex={-1}
        aria-hidden="true"
        data-testid="quote-gallery-input"
        onChange={handle('gallery')}
      />
    </>
  );

  return { openCamera, openGallery, inputs };
}
