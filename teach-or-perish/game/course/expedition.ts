// Ending and removing expeditions, from My archive and the Rooms/Pause menu. Ending keeps the run as a read-only
// record in My archive; removing deletes it for good (its course and questions stay). Both ask first.
import { api, call, setRun, state } from './app.js';
import type { ArchiveResponse } from './api-client.js';
import { stage } from './page.js';
import { btn, el } from './ui.js';

type Summary = ArchiveResponse['runs'][number];

/** An in-game yes/no question over the whole stage. Escape and Cancel say no; Cancel has the focus. */
export function confirmChoice(opts: { title: string; message: string; confirm: string }): Promise<boolean> {
  return new Promise(resolve => {
    const done = (yes: boolean) => { veil.remove(); content.inert = false; header.inert = false; resolve(yes); };
    const cancel = btn('Cancel', () => done(false), 'alt');
    const ok = btn(opts.confirm, () => done(true), 'alt remove');
    const box = el('section', 'folio confirm-folio', el('h2', '', opts.title), el('p', '', opts.message), el('div', 'menu-actions', cancel, ok));
    const veil = el('div', 'veil confirm-veil', box);
    veil.setAttribute('role', 'alertdialog'); veil.setAttribute('aria-modal', 'true'); veil.setAttribute('aria-label', opts.title);
    veil.addEventListener('keydown', event => { if (event.key === 'Escape') { event.stopPropagation(); done(false); } });
    const content = stage.querySelector<HTMLElement>('section')!, header = stage.querySelector<HTMLElement>('header')!;
    content.inert = true; header.inert = true;
    stage.append(veil);
    cancel.focus();
  });
}

/** Ends the expedition after asking. Returns true when it ended. */
export async function endExpedition(runId: string): Promise<boolean> {
  const yes = await confirmChoice({ title: 'End this expedition?',
    message: 'Pip stops here. The expedition stays in My archive as a record (rooms cleared, notebook, report), but it can’t be resumed. Start a new one any time.',
    confirm: 'End expedition' });
  if (!yes) return false;
  const run = await call(() => api.endRun(runId));
  if (!run) return false;
  if (state.run?.id === runId) setRun(run);
  return true;
}

/** Removes the expedition for good after asking. Returns true when it was removed. */
export async function removeExpedition(runId: string): Promise<boolean> {
  const yes = await confirmChoice({ title: 'Remove this expedition?',
    message: 'This permanently deletes the expedition: its progress, notebook and report. The course and its lessons stay in My archive. This can’t be undone.',
    confirm: 'Remove for good' });
  if (!yes) return false;
  const removed = await call(() => api.deleteRun(runId));
  if (!removed) return false;
  if (state.run?.id === runId) { setRun(null); state.results = null; }
  return true;
}

/** One line for an expedition in My archive: where it stands and when it was last played. */
export function describeRun(r: Summary): string {
  const when = new Date(r.updatedAt).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  const where = r.phase === 'results' ? 'Finished · results ready'
    : r.endedAt ? `Ended after ${Math.min(r.roomIndex, r.rooms)} of ${r.rooms} rooms`
    : r.phase === 'boss' ? 'Final exam in progress'
    : `Room ${Math.min(r.roomIndex + 1, r.rooms)} of ${r.rooms}${r.pausedAt ? ' · paused' : ''}`;
  return `${where} · ${when}`;
}

/** True while the expedition can still be played: not ended early and not finished. */
export function canPlay(r: { phase: string; endedAt?: string }) { return !r.endedAt && r.phase !== 'results'; }
