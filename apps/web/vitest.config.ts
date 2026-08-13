import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'node:path';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
    // The complete UI suite runs many jsdom workers concurrently. Interactive
    // user-event tests remain fast in isolation but can exceed Vitest's 5s default
    // under full-suite CPU contention on CI and Windows development machines.
    testTimeout: 10_000,
    css: false,
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
});
