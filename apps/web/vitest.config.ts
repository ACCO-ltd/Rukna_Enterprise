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
    //
    // Raised from 10s when DatePicker replaced the native date input: every file importing
    // `@erp/ui` now pulls react-day-picker and date-fns through jsdom, and the first test in
    // a file pays that cost. Individually those tests still finish in well under a second —
    // this is collection overhead under contention, not a slow assertion.
    testTimeout: 20_000,
    css: false,
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
});
