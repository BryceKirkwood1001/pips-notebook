import { defineConfig } from 'vitest/config';

// One Vitest run for the whole backend. The teammate's game (teach-or-perish/) is never touched.
export default defineConfig({
  test: {
    include: ['server/**/*.test.ts', 'shared/**/*.test.ts', 'scripts/**/*.test.ts'],
    exclude: ['**/node_modules/**', 'teach-or-perish/**', 'test-client/**'],
    environment: 'node',
    testTimeout: 15000,
  },
});
