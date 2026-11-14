/** Settings → MongoDB tab: choose where dungeons are saved, test a MongoDB connection, switch and copy. */
import type { ApiClient, StorageBackend, StorageSettings, UpdateStorageSettingsBody } from '../../../shared/src/api-client.js';
import { btn, el } from './ui.js';

export interface StoragePanelDeps {
  /** The API client for the server in the Backend URL field. */
  client: () => ApiClient;
  /** Runs one request with the controls disabled, reporting errors through `say`. */
  act: (say: (text: string, kind?: string) => void, action: () => Promise<void>) => Promise<void>;
  field: (name: string, input: HTMLInputElement, hint?: string) => HTMLElement;
  /** Called after the server switched to another storage: the open expedition belongs to the old one. */
  onSwitched: () => void;
  practice?: boolean;
}

const NAMES: Record<StorageSettings['active'], string> = { local: 'this computer', mongodb: 'MongoDB', memory: 'memory (test server)' };
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

export function buildStoragePanel(deps: StoragePanelDeps): { el: HTMLElement; load: () => Promise<void>; clear: () => void } {
  let current: StorageSettings | null = null;
  let selected: StorageBackend = 'local';

  const status = el('div', 'setup-status dim', 'Connecting to your server…');
  status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite');
  const say = (text: string, kind = 'dim') => { status.textContent = text; status.className = `setup-status ${kind}`; };
  const badge = el('span', 'setup-badge', 'THIS COMPUTER');

  const uri = el('input'); uri.type = 'password'; uri.id = 'storage-uri'; uri.autocomplete = 'off'; uri.spellcheck = false; uri.maxLength = 4096;
  const database = el('input'); database.id = 'storage-database'; database.autocomplete = 'off'; database.maxLength = 63;
  const vectorIndex = el('input'); vectorIndex.id = 'storage-vector-index'; vectorIndex.autocomplete = 'off'; vectorIndex.maxLength = 63;
  const removeUri = el('input'); removeUri.type = 'checkbox'; removeUri.id = 'storage-remove-uri';
  const uriState = el('span', 'dim', 'No connection string saved');
  const copy = el('input'); copy.type = 'checkbox'; copy.id = 'storage-copy'; copy.checked = true;
  const copyLabel = el('label', '', '');
  copyLabel.htmlFor = copy.id;
  const copyRow = el('div', 'copy-option', copy, copyLabel);

  const mongoFields = el('section', 'provider-fields',
    deps.field('Connection string', uri, 'Starts with mongodb+srv:// or mongodb://. It stays on your computer and is never shown again.'),
    el('div', 'key-options', uriState, el('label', '', removeUri, ' Remove saved connection string')),
    el('div', 'model-fields', deps.field('Database', database), deps.field('Vector search index', vectorIndex,
      'Used to find passages in your material. Created for you when your cluster allows it.')));
  const localNote = el('section', 'provider-fields offline-note', el('h3', '', 'Saved on this computer'),
    el('p', '', 'Dungeons, notebooks and expeditions are kept in the .local folder next to the game. No account or setup needed.'),
    el('small', 'dim', 'Choose MongoDB to keep them in a database you can reach from other computers.'));

  const cards = new Map<StorageBackend, HTMLButtonElement>();
  const choices = el('div', 'provider-choices storage-choices');
  choices.setAttribute('role', 'radiogroup'); choices.setAttribute('aria-label', 'Where dungeons are saved');
  for (const [backend, label, detail] of [
    ['local', 'This computer', 'Saved in .local · no setup'], ['mongodb', 'MongoDB', 'Atlas or your own server'],
  ] as const) {
    const choice = btn('', () => choose(backend), 'provider-choice');
    choice.append(el('b', '', label), el('small', '', detail));
    choice.setAttribute('role', 'radio'); choice.setAttribute('aria-label', label);
    cards.set(backend, choice); choices.append(choice);
  }

  const inUse = el('p', '', '');
  const problem = el('p', 'warn', '');
  problem.hidden = true;

  function choose(backend: StorageBackend) {
    selected = backend;
    for (const [id, card] of cards) { card.setAttribute('aria-checked', String(id === backend)); card.classList.toggle('selected', id === backend); }
    mongoFields.hidden = backend !== 'mongodb';
    localNote.hidden = backend !== 'local';
    badge.textContent = backend === 'mongodb' ? 'MONGODB' : 'THIS COMPUTER';
    updateCopy();
  }

  /** Offer to copy only when saving would move the game to a different storage. */
  function updateCopy() {
    if (!current) { copyRow.hidden = true; return; }
    const from = current.active === 'mongodb' ? 'in MongoDB' : 'on this computer';
    const to = selected === 'mongodb' ? 'MongoDB' : 'this computer';
    const moving = selected === 'mongodb'
      ? current.active !== 'mongodb' || !!uri.value.trim() || database.value.trim() !== current.mongodb.database
      : current.active === 'mongodb';
    copyRow.hidden = !moving || current.courses === 0;
    copyLabel.textContent = ` Copy the ${plural(current.courses, 'dungeon')} saved ${from} to ${to}`;
  }
  for (const input of [uri, database]) input.addEventListener('input', updateCopy);

  function apply(settings: StorageSettings) {
    current = settings;
    database.value = settings.mongodb.database;
    vectorIndex.value = settings.mongodb.vectorIndex;
    uri.value = ''; removeUri.checked = false;
    uri.placeholder = settings.mongodb.hasUri ? `Saved for ${settings.mongodb.host ?? 'your cluster'} — enter a replacement or leave blank` : 'mongodb+srv://user:password@cluster.example.net';
    uriState.textContent = settings.mongodb.hasUri ? `Saved: ${settings.mongodb.host ?? 'connection string'}` : 'No connection string saved';
    uriState.className = settings.mongodb.hasUri ? 'ok' : 'dim';
    inUse.textContent = `In use now: ${NAMES[settings.active]}${settings.active === 'mongodb' && settings.mongodb.host ? ` (${settings.mongodb.host}, ${settings.mongodb.database})` : ''} · ${plural(settings.courses, 'dungeon')}.`;
    problem.textContent = settings.error ? `MongoDB could not be reached when the game started, so this computer is in use. ${settings.error}` : '';
    problem.hidden = !settings.error;
    choose(settings.backend);
  }

  function body(): UpdateStorageSettingsBody {
    const update: UpdateStorageSettingsBody = { backend: selected };
    if (selected === 'mongodb' || removeUri.checked) {
      update.mongodb = {
        database: database.value.trim(), vectorIndex: vectorIndex.value.trim(),
        ...(removeUri.checked ? { uri: null } : uri.value.trim() ? { uri: uri.value.trim() } : {}),
      };
    }
    if (!copyRow.hidden && copy.checked) update.copyExisting = true;
    return update;
  }

  const test = btn('Test connection', () => void deps.act(say, async () => {
    if (!current) throw new Error('Connect to the server first.');
    const result = await deps.client().testStorageSettings(body());
    say(result.message, result.ok ? 'ok' : 'bad');
  }), 'alt');
  const save = btn('Save & switch', () => void deps.act(say, async () => {
    if (!current) throw new Error('Connect to the server first.');
    const before = current;
    const enteredUri = !!uri.value.trim();
    const result = await deps.client().updateStorageSettings(body());
    apply(result);
    const switched = before.active !== result.active || (result.active === 'mongodb' && (enteredUri
      || before.mongodb.database !== result.mongodb.database || before.mongodb.vectorIndex !== result.mongodb.vectorIndex));
    if (switched) deps.onSwitched();
    const where = result.active === 'mongodb' ? `MongoDB (${result.mongodb.host ?? 'your cluster'})` : NAMES[result.active];
    const copied = result.copied
      ? ` Copied ${plural(result.copied.courses, 'dungeon')} and ${plural(result.copied.runs, 'expedition')}${result.copied.skipped ? `; ${result.copied.skipped} already there` : ''}.`
      : '';
    say(switched ? `Dungeons are now saved in ${where}.${copied}` : 'Saved.', 'ok');
  }));

  const root = el('div', 'setup-panel',
    el('div', 'setup-heading', el('div', '', el('h2', '', 'Where your dungeons are saved'),
      el('p', 'dim', 'Keep them on this computer, or in a MongoDB database. Switching happens right away.')), badge),
    choices,
    el('div', 'setup-grid', el('div', 'provider-form', mongoFields, localNote, copyRow),
      el('aside', 'setup-aside', el('h3', '', 'Good to know'), inUse, problem,
        el('p', '', 'Switching moves the game to the other storage at once. An expedition you have open goes back to My archive.'),
        el('div', 'setup-rule'),
        el('p', 'dim', 'Copying skips dungeons that are already there and never deletes anything.'),
        deps.practice ? el('p', 'warn', 'Practice mode has no server storage. Open the game without ?mock=1 to use these settings.') : null)),
    el('div', 'setup-footer', el('div', 'actions', test, save),
      el('small', 'dim', 'Testing connects once and counts the dungeons there. Nothing is saved.')),
    status,
  );

  async function load() {
    await deps.act(say, async () => {
      apply(await deps.client().getStorageSettings());
      say('Connected.');
    });
  }
  choose('local');
  return { el: root, load, clear: () => { uri.value = ''; } };
}
