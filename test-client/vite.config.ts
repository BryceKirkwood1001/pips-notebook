import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

// The test harness always runs on 5174 (the teammate's game owns 4173; the API is on 8787).
export default defineConfig({
  // The standalone setup preview imports the game's DOM view, without its separate engine config.
  tsconfig: fileURLToPath(new URL('tsconfig.json', import.meta.url)),
  server: { port: 5174, strictPort: true },
  preview: { port: 5174, strictPort: true },
  build: { rollupOptions: { input: {
    main: fileURLToPath(new URL('index.html', import.meta.url)),
    settings: fileURLToPath(new URL('api-settings.html', import.meta.url)),
  } } },
});
