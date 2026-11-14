// Placeholder until the test-client harness is built (SPEC section 8 of the build brief).
import { createApiClient } from '@top/shared/api-client';

const api = createApiClient({ baseUrl: 'http://localhost:8787' });
const root = document.getElementById('game');
if (root) {
  root.textContent = 'Teach or Perish test client: checking the API...';
  api
    .health()
    .then((h) => {
      root.textContent = `API ok (llm=${h.llmProvider}, storage=${h.storage})`;
    })
    .catch((err: unknown) => {
      root.textContent = `API not reachable: ${err instanceof Error ? err.message : String(err)}`;
    });
}
