import '@testing-library/jest-dom/vitest';
import { afterEach, vi } from 'vitest';
import { cleanup } from '@testing-library/react';

// Radix Select (and any other primitive built on its popper) calls three DOM APIs that jsdom
// does not implement. They are no-ops for assertions but throw if missing, so every test that
// opens a dropdown would fail on the environment rather than on the component.
Object.assign(window.HTMLElement.prototype, {
  scrollIntoView: vi.fn(),
  hasPointerCapture: vi.fn(() => false),
  setPointerCapture: vi.fn(),
  releasePointerCapture: vi.fn(),
});

afterEach(() => {
  cleanup();
});
