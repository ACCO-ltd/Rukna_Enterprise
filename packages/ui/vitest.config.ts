import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// The library's own component tests. apps/web still tests the screens that compose these; this
// suite covers behaviour that belongs to the component itself (dismiss guards, keyboard models,
// roles), so a regression shows up here rather than in whichever screen happens to notice.
export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
    css: false,
    testTimeout: 20_000,
  },
});
