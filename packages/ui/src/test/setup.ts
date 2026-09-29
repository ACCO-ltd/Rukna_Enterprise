import '@testing-library/jest-dom/vitest';
import { afterEach, vi } from 'vitest';
import { cleanup } from '@testing-library/react';

// Radix primitives call DOM APIs jsdom does not implement. No-ops for assertions, but they
// throw if missing — the same shim apps/web's setup carries.
Object.assign(window.HTMLElement.prototype, {
  scrollIntoView: vi.fn(),
  hasPointerCapture: vi.fn(() => false),
  setPointerCapture: vi.fn(),
  releasePointerCapture: vi.fn(),
});

afterEach(() => {
  cleanup();
});
