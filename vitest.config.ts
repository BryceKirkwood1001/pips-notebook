import { defineConfig } from 'vitest/config';

// Server and shared tests, plus the game's isolated controller tests in client/tests (no native game test discovery).
export default defineConfig({
  // client/game/tsconfig.json extends the Phaser AE toolkit (client/phaser), which a fresh clone does not have, and
  // the tests need none of its settings: transform TypeScript without looking for a tsconfig.
  oxc: { tsconfig: false },
  test: {
    include: ['server/**/*.test.ts', 'shared/**/*.test.ts', 'client/tests/**/*.test.ts'],
    exclude: ['**/node_modules/**', 'client/phaser/**'],
    environment: 'node',
    testTimeout: 15000,
  },
});
