import { defineConfig } from 'vitest/config';

// Backend/shared tests and isolated frontend controller checks; no native game test discovery.
export default defineConfig({
  test: {
    include: ['server/**/*.test.ts', 'shared/**/*.test.ts', 'scripts/**/*.test.ts'],
    exclude: ['**/node_modules/**', 'pips-notebook/**'],
    environment: 'node',
    testTimeout: 15000,
  },
});
