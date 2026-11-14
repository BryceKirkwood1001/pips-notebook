/** Shared settings view: rendered by the Phaser scene and the standalone setup preview. */
import { createApiClient, type ApiSettings, type LlmProvider, type UpdateApiSettingsBody } from './api-client.js';
import { btn, el } from './ui.js';

export interface SettingsViewOptions {
  apiOrigin: string;
  onOriginChange: (origin: string) => void;
  onBack: () => void;
  practice?: boolean;
}

export function buildSettingsView(options: SettingsViewOptions): { el: HTMLElement; stop: () => void } {
  let active = true;
  let selected: LlmProvider = 'mock';
  let loaded = false;
  const controller = new AbortController();
  const root = el('div', 'api-setup');
  const status = el('div', 'setup-status dim', 'Connecting to your server…');
  status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite');
  const keyStatus = el('span', 'setup-badge', 'OFFLINE');
  const providerCards = el('div', 'provider-choices');
  providerCards.setAttribute('role', 'radiogroup'); providerCards.setAttribute('aria-label', 'AI provider');
  const fields = el('div', 'provider-form');
  const timeout = el('input'); timeout.type = 'number'; timeout.min = '1'; timeout.max = '180'; timeout.value = '30';
  timeout.id = 'api-timeout';
  const ingestTimeout = el('input'); ingestTimeout.type = 'number'; ingestTimeout.min = '1'; ingestTimeout.max = '600'; ingestTimeout.value = '180';
  ingestTimeout.id = 'api-ingest-timeout';
  const origin = el('input'); origin.type = 'url'; origin.value = options.apiOrigin; origin.id = 'api-origin'; origin.autocomplete = 'off';
  const clientFor = (baseUrl: string) => createApiClient({ baseUrl, fetch: (url, init) => fetch(url, { ...init,
    signal: AbortSignal.any([controller.signal, AbortSignal.timeout(String(url).endsWith('/test') ? Number(timeout.value || 30) * 3000 + 5000 : 15000)]),
  }) });
  let connection = clientFor(options.apiOrigin);
  const titleFor = (p: LlmProvider) => p === 'openai' ? 'OpenAI' : p === 'gemini' ? 'Google Gemini' : 'Offline';
  const field = (name: string, input: HTMLInputElement, hint?: string) => {
    const label = el('label', '', name); label.htmlFor = input.id;
    return el('div', 'setup-field', label, input, hint ? el('small', 'dim', hint) : null);
  };
  const profiles = {} as Record<'openai' | 'gemini', { box: HTMLElement; model: HTMLInputElement; embedding: HTMLInputElement; key: HTMLInputElement; remove: HTMLInputElement; state: HTMLElement }>;
  for (const provider of ['openai', 'gemini'] as const) {
    const model = el('input'); model.id = `api-${provider}-model`; model.maxLength = 160; model.autocomplete = 'off';
    const embedding = el('input'); embedding.id = `api-${provider}-embedding`; embedding.maxLength = 160; embedding.autocomplete = 'off';
    const key = el('input'); key.type = 'password'; key.id = `api-${provider}-key`; key.autocomplete = 'new-password'; key.spellcheck = false; key.maxLength = 8192;
    const remove = el('input'); remove.type = 'checkbox';
    const state = el('span', 'dim', 'No key saved');
    const box = el('section', 'provider-fields',
      field(`${titleFor(provider)} API key`, key, 'Leave blank to keep a saved key. Keys stay on this backend.'),
      el('div', 'key-options', state, el('label', '', remove, ' Remove saved key')),
      el('div', 'model-fields', field('Generation model', model), field('Embedding model', embedding)),
    );
    profiles[provider] = { box, model, embedding, key, remove, state };
    fields.append(box);
  }
  const offline = el('section', 'provider-fields offline-note', el('h3', '', 'A lesson without a key'),
    el('p', '', 'Play the sample courses with a deterministic student. No account, network calls, or API credits required.'),
    el('small', 'dim', 'Best for checking the game flow. Choose OpenAI or Gemini to learn from new course material.'));
  fields.append(offline);
  const cards = new Map<LlmProvider, HTMLButtonElement>();
  for (const [provider, label, detail] of [
    ['openai', 'OpenAI', 'Responses + embeddings'], ['gemini', 'Google Gemini', 'Native PDF + embeddings'], ['mock', 'Offline', 'Sample courses · no key'],
  ] as const) {
    const choice = btn('', () => choose(provider), 'provider-choice');
    choice.append(el('b', '', label), el('small', '', detail));
    choice.setAttribute('role', 'radio'); choice.setAttribute('aria-label', label);
    cards.set(provider, choice); providerCards.append(choice);
  }
  function choose(provider: LlmProvider) {
    selected = provider;
    for (const [id, choice] of cards) { choice.setAttribute('aria-checked', String(id === provider)); choice.classList.toggle('selected', id === provider); }
    for (const id of ['openai', 'gemini'] as const) profiles[id].box.hidden = provider !== id;
    offline.hidden = provider !== 'mock';
    keyStatus.textContent = provider === 'mock' ? 'OFFLINE' : titleFor(provider).toUpperCase();
  }
  const showStatus = (text: string, kind = 'dim') => { if (active) { status.textContent = text; status.className = `setup-status ${kind}`; } };
  function serverOrigin() {
    const url = new URL(origin.value.trim());
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
      throw new Error('Enter a server origin such as http://localhost:8787, without a path or credentials.');
    }
    return url.origin;
  }
  function apply(settings: ApiSettings) {
    loaded = true;
    choose(settings.provider);
    timeout.value = String(settings.timeoutMs / 1000);
    ingestTimeout.value = String(settings.ingestTimeoutMs / 1000);
    for (const provider of ['openai', 'gemini'] as const) {
      const view = profiles[provider], saved = settings.providers[provider];
      view.model.value = saved.model; view.embedding.value = saved.embeddingModel;
      view.key.value = ''; view.remove.checked = false;
      view.key.placeholder = saved.hasApiKey ? 'Saved — enter a replacement or leave blank' : 'Paste your API key';
      view.state.textContent = saved.hasApiKey ? 'Key saved on backend' : 'No key saved';
      view.state.className = saved.hasApiKey ? 'ok' : 'dim';
    }
    persistence.textContent = settings.persistence === 'local'
      ? 'Saved on this machine and restored when the backend restarts.' : 'Session settings: this backend is running without local persistence.';
    dimensions.textContent = `Retrieval uses ${settings.embeddingDims} dimensions. Existing courses retain their original embedding model.`;
  }
  function body(): UpdateApiSettingsBody {
    const seconds = Number(timeout.value);
    if (!Number.isInteger(seconds) || seconds < 1 || seconds > 180) throw new Error('Choose a whole-number timeout between 1 and 180 seconds.');
    const update: UpdateApiSettingsBody = { provider: selected, timeoutMs: seconds * 1000 };
    const ingestSeconds = Number(ingestTimeout.value);
    if (!Number.isInteger(ingestSeconds) || ingestSeconds < 1 || ingestSeconds > 600) throw new Error('Choose a whole-number course preparation timeout between 1 and 600 seconds.');
    update.ingestTimeoutMs = ingestSeconds * 1000;
    for (const provider of ['openai', 'gemini'] as const) {
      const p = profiles[provider];
      update[provider] = { model: p.model.value.trim(), embeddingModel: p.embedding.value.trim(),
        ...(p.remove.checked ? { apiKey: null } : p.key.value.trim() ? { apiKey: p.key.value.trim() } : {}) };
    }
    return update;
  }
  const save = btn('Save & apply', () => void act(async () => {
    if (!loaded) throw new Error('Connect to the backend first.');
    const apiOrigin = serverOrigin();
    const settings = await clientFor(apiOrigin).updateApiSettings(body());
    if (!active) return;
    connection = clientFor(apiOrigin); apply(settings); options.onOriginChange(apiOrigin);
    showStatus(`${titleFor(settings.provider)} is ready. Your settings are saved and active.`, 'ok');
  }));
  const test = btn('Test connection', () => void act(async () => {
    if (!loaded) throw new Error('Connect to the backend first.');
    const result = await clientFor(serverOrigin()).testApiSettings(body());
    showStatus(result.message, result.ok ? 'ok' : 'bad');
  }), 'alt');
  const load = btn('Load server', () => void loadSettings(), 'alt');
  const back = btn('Back to game', options.onBack, 'alt');
  async function act(action: () => Promise<void>) {
    if (root.getAttribute('aria-busy') === 'true') return;
    root.setAttribute('aria-busy', 'true');
    for (const control of root.querySelectorAll<HTMLInputElement | HTMLButtonElement>('input,button')) if (control !== back) control.disabled = true;
    showStatus('Working…');
    try { await action(); }
    catch (error) { showStatus(error instanceof Error && ['TimeoutError', 'AbortError'].includes(error.name)
      ? 'The server took too long to respond. Check the backend URL and try again.'
      : error instanceof Error ? error.message : 'Could not update API settings.', 'bad'); }
    finally {
      if (active) {
        root.setAttribute('aria-busy', 'false');
        for (const control of root.querySelectorAll<HTMLInputElement | HTMLButtonElement>('input,button')) control.disabled = false;
        save.disabled = test.disabled = !loaded;
      }
    }
  }
  async function loadSettings() {
    await act(async () => {
      const apiOrigin = serverOrigin(); connection = clientFor(apiOrigin);
      const settings = await connection.getApiSettings();
      if (!active) return;
      apply(settings); showStatus('Connected. Choose how your student learns.');
    });
  }
  const persistence = el('p', 'dim');
  const dimensions = el('p', 'dim');
  const advanced = el('details', 'setup-advanced', el('summary', '', 'Connection details'),
    el('div', 'connection-fields', field('Backend URL', origin, 'Changing servers starts a new game session.'), load, field('Request timeout (seconds)', timeout)),
    field('Course preparation timeout (seconds)', ingestTimeout, 'Per request while preparing your course. Active OpenAI document streams extend this idle budget, with a 10-minute request cap.'));
  root.append(
    el('div', 'setup-heading', el('div', '', el('span', 'setup-eyebrow', 'SETTINGS / API SETUP'), el('h2', '', 'Choose your oracle.'),
      el('p', 'dim', 'The same dungeon. A different mind behind the notebook.')), keyStatus),
    providerCards,
    el('div', 'setup-grid', fields, el('aside', 'setup-aside', el('h3', '', 'Keep the lesson yours.'),
      el('p', '', 'Your student still knows only what you teach. The provider powers its questions, notes, and course preparation.'),
      el('div', 'setup-rule'), persistence, dimensions,
      options.practice ? el('p', 'warn', 'Practice mode uses canned responses. These settings apply when you play through the backend.') : null)),
    advanced,
    el('div', 'setup-footer', el('div', 'actions', test, save), el('small', 'dim', 'The connection test makes a small generation and embedding request.')),
    status,
    el('div', 'setup-back', back),
  );
  choose('mock');
  void loadSettings();
  return { el: root, stop: () => { active = false; controller.abort(); for (const p of Object.values(profiles)) p.key.value = ''; } };
}
