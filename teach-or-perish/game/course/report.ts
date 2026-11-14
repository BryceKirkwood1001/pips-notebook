// The expedition report between rooms: rooms cleared, battle accuracy and weak points. Everything here restates
// what the player has already seen (battle turns, Pip's questions, the notebook); Pip's hidden beliefs stay hidden.
import type { PublicRoomReport, PublicRun } from './api-client.js';
import { btn, el, inline } from './ui.js';

/** How many weak points the compact card lists before "Full report". */
const CARD_WEAK_POINTS = 3;
/** A topic with fewer notes than this is "thin". */
const THIN_NOTES = 2;

export type WeakPoint = { kind: 'missed' | 'skipped' | 'thin'; title: string; detail: string };

/** Notebook bullets by section title ("## Title" then "- note" lines). */
export function notesByTitle(md: string): Map<string, string[]> {
  const out = new Map<string, string[]>();
  let current: string[] | null = null;
  for (const raw of md.split('\n')) {
    const line = raw.trim();
    const heading = /^##\s+(.*)$/.exec(line);
    if (heading) { current = []; out.set(heading[1]!.trim(), current); continue; }
    if (line.startsWith('- ') && current) current.push(line.slice(2).trim());
  }
  return out;
}

/** Only the latest attempt of each room counts for hearts; every attempt counts for accuracy. */
export function summary(run: PublicRun) {
  const history = run.history ?? [];
  const correct = history.reduce((n, h) => n + h.correct, 0);
  const total = history.reduce((n, h) => n + h.total, 0);
  const cleared = run.rooms.filter(r => r.state === 'passed').length + (run.phase === 'room_result' && run.room?.passed ? 1 : 0);
  return { history, correct, total, accuracy: total ? Math.round((correct / total) * 100) : null, cleared };
}

export function weakPoints(run: PublicRun): WeakPoint[] {
  const points: WeakPoint[] = [];
  const missed = new Map<string, { title: string; student: number; help: number }>();
  for (const h of run.history ?? []) for (const m of h.missed) for (const c of m.concepts) {
    const entry = missed.get(c.id) ?? { title: c.title, student: 0, help: 0 };
    entry[m.by] += 1;
    missed.set(c.id, entry);
  }
  for (const m of [...missed.values()].sort((a, b) => b.student + b.help - a.student - a.help)) {
    const parts = [m.student ? `Pip missed ${m.student} battle question${m.student === 1 ? '' : 's'}` : '',
      m.help ? `${m.help} missed while you helped` : ''].filter(Boolean);
    points.push({ kind: 'missed', title: m.title, detail: parts.join(' · ') });
  }
  const skipped = (run.history ?? []).reduce((n, h) => n + h.questionsSkipped, 0);
  if (skipped) points.push({ kind: 'skipped', title: `${skipped} skipped question${skipped === 1 ? '' : 's'}`,
    detail: 'Pip kept whatever idea it asked about. Reteach those topics.' });
  const notes = notesByTitle(run.notebookMd);
  for (const c of run.currentRoom?.concepts ?? []) {
    const count = notes.get(c.title)?.length ?? 0;
    if (count < THIN_NOTES) points.push({ kind: 'thin', title: c.title, detail: count ? 'Only 1 note so far' : 'No notes yet in this room' });
  }
  return points;
}

const icon = { missed: '!', skipped: '?', thin: '✎' } as const;

function weakList(points: WeakPoint[]) {
  if (!points.length) return el('p', 'report-empty', 'No weak points spotted yet.');
  return el('ul', 'weak-points', ...points.map(p => {
    const item = el('li', `weak-${p.kind}`, el('b', 'weak-icon', icon[p.kind]), el('span', '', el('strong', '', p.title), el('small', '', p.detail)));
    item.title = `${p.title}: ${p.detail}`;
    return item;
  }));
}

function hearts(have: number, max: number) {
  return el('span', 'heart-row', ...Array.from({ length: max }, (_, i) => el('i', i < have ? 'heart full' : 'heart')));
}

/** The compact card shown in the library between rooms. */
export function reportCard(run: PublicRun, openFull?: () => void): HTMLElement {
  const s = summary(run);
  const meter = el('progress'); meter.max = run.rooms.length; meter.value = s.cleared;
  meter.setAttribute('aria-label', 'Rooms cleared');
  const points = weakPoints(run);
  const card = el('aside', 'report-card',
    el('div', 'report-head', el('small', '', 'Expedition log'), el('small', '', `Room ${Math.min(run.roomIndex + 1, run.rooms.length)} of ${run.rooms.length}`)),
    meter,
    el('div', 'report-stats',
      el('span', '', el('strong', '', String(s.cleared)), ' cleared'),
      el('span', '', el('strong', '', s.accuracy === null ? '—' : `${s.accuracy}%`), ' battle accuracy')),
    el('h3', '', 'Weak points'), weakList(points.slice(0, CARD_WEAK_POINTS)));
  if (openFull) card.append(btn(points.length > CARD_WEAK_POINTS ? `Full report (+${points.length - CARD_WEAK_POINTS})` : 'Full report', openFull, 'report-more'));
  card.setAttribute('aria-label', 'Expedition log');
  return card;
}

function roomEntry(h: PublicRoomReport) {
  const entry = el('article', 'report-room',
    el('h4', '', `${h.title}${h.attempt > 1 ? ` · attempt ${h.attempt}` : ''}`),
    el('p', h.passed ? 'ok' : 'bad', h.passed ? 'Cleared' : 'Failed', ' · ', hearts(h.hearts, h.maxHearts)),
    el('p', '', `${h.correct}/${h.total} correct${h.helped ? ` · you helped ${h.helped} time${h.helped === 1 ? '' : 's'}` : ''}`),
    el('p', 'dim', `Lesson: taught ${h.teachCount} time${h.teachCount === 1 ? '' : 's'} · Pip asked ${h.questionsAsked}` +
      (h.questionsAsked ? ` (answered ${h.questionsAnswered}, skipped ${h.questionsSkipped})` : '')));
  if (h.missed.length) entry.append(el('ul', 'report-missed', ...h.missed.map(m => el('li', '',
    el('span', '', inline(m.prompt)), el('small', 'dim', [m.by === 'help' ? 'Your help' : 'Pip', ...m.concepts.map(c => c.title)].join(' · '))))));
  return entry;
}

/** The full report: every finished room attempt and every weak point. */
export function reportBook(run: PublicRun): HTMLElement {
  const s = summary(run);
  const root = el('div', 'report-book',
    el('p', '', `${s.cleared} of ${run.rooms.length} rooms cleared · ${s.accuracy === null ? 'no battles yet' : `${s.correct}/${s.total} battle answers correct (${s.accuracy}%)`}`),
    el('h3', '', 'Weak points'), weakList(weakPoints(run)), el('h3', '', 'Rooms so far'));
  if (!s.history.length) root.append(el('p', 'dim', 'Finished battles appear here.'));
  for (const h of [...s.history].reverse()) root.append(roomEntry(h));
  return root;
}

/** One room attempt's numbers, for the victory and defeat screens. */
export function attemptStats(h: PublicRoomReport | undefined, fallback: { hearts: number; maxHearts: number; correct: number; total: number }) {
  const v = h ?? { ...fallback, helped: 0 };
  return el('div', 'attempt-stats',
    el('span', '', el('small', '', 'Hearts'), hearts(v.hearts, v.maxHearts)),
    el('span', '', el('small', '', 'Correct'), el('strong', '', `${v.correct}/${v.total}`)),
    el('span', '', el('small', '', 'Your help'), el('strong', '', String(v.helped))));
}
