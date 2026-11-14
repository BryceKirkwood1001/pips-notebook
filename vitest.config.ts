import { defineConfig } from 'vitest/config';

// Backend and shared tests, plus the game's isolated controller tests in client/tests (no native game test discovery).
export default defineConfig({
  test: {
    include: ['server/**/*.test.ts', 'shared/**/*.test.ts', 'client/tests/**/*.test.ts'],
    exclude: ['**/node_modules/**', 'client/phaser/**'],
    environment: 'node',
    testTimeout: 15000,
  },
});
