import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { MediaUpload, type MediaUploadLabels } from './media-upload';

const labels: MediaUploadLabels = {
  dropHint: 'Drag files here, or',
  browse: 'browse',
  tooLargeImage: 'Photos must be under 15 MB.',
  tooLargeVideo: 'Videos must be under 150 MB.',
  wrongType: 'Only photos and videos can be attached.',
  uploading: 'Uploading…',
  failed: 'Upload failed',
  retry: 'Retry',
  remove: 'Remove',
};

beforeEach(() => {
  // jsdom has no object-URL support; the component needs it for previews.
  URL.createObjectURL = vi.fn(() => 'blob:mock');
  URL.revokeObjectURL = vi.fn();
});

/** A File with a forced size (jsdom ignores the byte content length). */
function fileOfSize(name: string, type: string, sizeBytes: number): File {
  const f = new File(['x'], name, { type });
  Object.defineProperty(f, 'size', { value: sizeBytes });
  return f;
}

/** Drive the hidden input directly, bypassing user-event's `accept` filtering so the component's
 *  OWN type/size validation is what's under test. */
function selectFiles(container: HTMLElement, files: File[]): void {
  const input = container.querySelector('input[type="file"]') as HTMLInputElement;
  Object.defineProperty(input, 'files', { value: files, configurable: true });
  fireEvent.change(input);
}

describe('MediaUpload', () => {
  it('uploads an accepted image', () => {
    const onUpload = vi.fn().mockResolvedValue(undefined);
    const { container } = render(<MediaUpload onUpload={onUpload} labels={labels} />);

    selectFiles(container, [fileOfSize('site.jpg', 'image/jpeg', 2 * 1024 * 1024)]);

    expect(onUpload).toHaveBeenCalledTimes(1);
    expect(onUpload.mock.calls[0]![0]).toBeInstanceOf(File);
  });

  it('rejects a non-media file without uploading', () => {
    const onUpload = vi.fn().mockResolvedValue(undefined);
    const { container } = render(<MediaUpload onUpload={onUpload} labels={labels} />);

    selectFiles(container, [fileOfSize('notes.pdf', 'application/pdf', 1024)]);

    expect(onUpload).not.toHaveBeenCalled();
    expect(screen.getByText('Only photos and videos can be attached.')).toBeInTheDocument();
  });

  it('rejects an over-size image without uploading', () => {
    const onUpload = vi.fn().mockResolvedValue(undefined);
    const { container } = render(<MediaUpload onUpload={onUpload} labels={labels} />);

    selectFiles(container, [fileOfSize('huge.jpg', 'image/jpeg', 20 * 1024 * 1024)]);

    expect(onUpload).not.toHaveBeenCalled();
    expect(screen.getByText('Photos must be under 15 MB.')).toBeInTheDocument();
  });
});
