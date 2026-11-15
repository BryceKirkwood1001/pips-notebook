/** Settings → Saved in this browser: what is saved here, asking the browser to keep it, and a JSON backup. */
import type { ApiClient, StorageSettings } from '../../../shared/src/api-client.js';
import { btn, clock, el, host } from './ui.js';

export interface StoragePanelDeps {
  /** The API client (the in-page backend). */
  client: () => ApiClient;
  /** Runs one request with the controls disabled, reporting errors through `say`. */
  act: (say: (text: string, kind?: string) => void, action: () => Promise<void>) => Promise<void>;
  /** Called after a backup added dungeons, so open lists can refresh. */
  onSwitched: () => void;
  practice?: boolean;
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;
const size = (bytes: number) => bytes >= 1024 ** 3 ? `${(bytes / 1024 ** 3).toFixed(1)} GB` : `${Math.max(0.1, bytes / 1024 ** 2).toFixed(1)} MB`;

export function buildStoragePanel(deps: StoragePanelDeps): { el: HTMLElement; load: () => Promise<void>; clear: () => void } {
  const status = el('div', 'setup-status dim', 'Checking what is saved…');
  status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite');
  const say = (text: string, kind = 'dim') => { status.textContent = text; status.className = `setup-status ${kind}`; };
  const badge = el('span', 'setup-badge', 'THIS BROWSER');

  const counts = el('p', '', '');
  const space = el('p', 'dim', '');
  const keepNote = el('p', '', '');
  const problem = el('p', 'warn', '');
  problem.hidden = true;

  const keep = btn('Keep my dungeons', () => void deps.act(say, async () => {
    const granted = await clock.navigator.storage?.persist?.().catch(() => false);
    await load(false);
    say(granted ? 'Done: this browser will not clear your dungeons to free up space.'
      : 'This browser did not agree yet. Browsers often agree once you have played here for a while, or bookmarked the site.', granted ? 'ok' : 'dim');
  }), 'alt');

  const file = el('input'); file.type = 'file'; file.accept = '.json,application/json'; file.id = 'backup-file'; file.hidden = true;
  const download = btn('Download backup', () => void deps.act(say, async () => {
    const backup = await deps.client().exportBackup();
    const blob = new Blob([JSON.stringify(backup)], { type: 'application/json' });
    const link = el('a'); link.href = URL.createObjectURL(blob);
    link.download = `pips-notebook-backup-${backup.exportedAt.slice(0, 10)}.json`;
    host.body.append(link); link.click(); link.remove();
    clock.setTimeout(() => URL.revokeObjectURL(link.href), 60_000);
    say(`Downloaded ${plural(backup.courses.length, 'dungeon')} and ${plural(backup.runs.length, 'expedition')}. Keep the file somewhere safe.`, 'ok');
  }));
  const upload = btn('Import backup…', () => file.click(), 'alt');
  file.addEventListener('change', () => {
    const chosen = file.files?.[0];
    file.value = '';
    if (!chosen) return;
    void deps.act(say, async () => {
      let backup: unknown;
      try { backup = JSON.parse(await chosen.text()); } catch { throw new Error(`"${chosen.name}" is not a backup file (it is not JSON).`); }
      const result = await deps.client().importBackup(backup);
      await load(false);
      if (result.courses > 0) deps.onSwitched();
      say(result.courses || result.skipped
        ? `Added ${plural(result.courses, 'dungeon')} and ${plural(result.runs, 'expedition')}${result.skipped ? `; ${result.skipped} already saved here` : ''}.`
        : 'That backup has no dungeons.', 'ok');
    });
  });

  function apply(settings: StorageSettings) {
    const memory = settings.active === 'memory';
    badge.textContent = memory ? 'THIS TAB ONLY' : 'THIS BROWSER';
    counts.textContent = `${plural(settings.courses, 'dungeon')} and ${plural(settings.runs, 'expedition')} saved here.`;
    space.textContent = settings.usageBytes !== null && settings.quotaBytes
      ? `Using ${size(settings.usageBytes)} of the ${size(settings.quotaBytes)} this browser allows.` : '';
    space.hidden = !space.textContent;
    keepNote.textContent = memory ? ''
      : settings.persisted ? 'This browser has agreed to keep them: it will not clear them to free up space.'
      : 'When a device runs low on space, a browser may clear saved data. Ask it to keep your dungeons:';
    keepNote.hidden = memory;
    keep.hidden = memory || settings.persisted !== false;
    problem.textContent = settings.error ? `Saving is blocked here: ${settings.error}` : '';
    problem.hidden = !settings.error;
  }

  const root = el('div', 'setup-panel',
    el('div', 'setup-heading', el('div', '', el('h2', '', 'Saved in this browser'),
      el('p', 'dim', 'Your dungeons, notebooks and expeditions are saved on this device, in this browser, and nowhere else.')), badge),
    el('div', 'setup-grid',
      el('div', 'provider-form',
        el('section', 'provider-fields offline-note', counts, space, problem, keepNote, el('div', 'actions', keep)),
        el('section', 'provider-fields', el('h3', '', 'Backup'),
          el('p', '', 'Download every dungeon and expedition as one file, to keep it safe or move it to another browser. Import adds the dungeons of a backup; ones already here are kept as they are.'),
          el('div', 'actions', download, upload, file))),
      el('aside', 'setup-aside', el('h3', '', 'Good to know'),
        el('p', '', 'Clearing this site\'s data, or closing a private window, deletes what is saved here. Download a backup first.'),
        el('div', 'setup-rule'),
        el('p', 'dim', 'A backup holds your material and the answer keys of its questions, so it is yours to keep. It never holds your API keys.'),
        deps.practice ? el('p', 'warn', 'Practice mode saves nothing. Open the game without ?mock=1 to use these settings.') : null)),
    status,
  );

  async function load(announce = true) {
    const run = async () => { apply(await deps.client().getStorageSettings()); if (announce) say('Up to date.'); };
    if (announce) await deps.act(say, run); else await run();
  }
  return { el: root, load: () => load(), clear: () => { file.value = ''; } };
}
