import { defineConfig } from 'vite';

// The test harness always runs on 5174 (the teammate's game owns 4173; the API is on 8787).
export default defineConfig({
  server: { port: 5174, strictPort: true },
  preview: { port: 5174, strictPort: true },
});
