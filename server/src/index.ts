/** Server entry point. `npm start` (scripts/start.mjs) runs it; `npm run dev` runs it in watch mode. */
import { buildApp } from './app';
import { createContainer } from './container';

const container = await createContainer();
const app = await buildApp(container);
const { config } = container;

try {
  await app.listen({ port: config.port, host: '0.0.0.0' });
} catch (err) {
  console.error('[server] failed to start:', err);
  process.exit(1);
}

const health = container.services.health();
console.log(`[server] Pip's Notebook on http://localhost:${config.port} (API under /api)`);
console.log(
  `[server] llm=${health.llmProvider} storage=${health.storage} debug=${health.debug}` +
    (config.demoMode ? ' demo=true' : ''),
);

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    void app.close().then(() => process.exit(0));
  });
}
