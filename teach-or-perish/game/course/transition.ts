// A curtain over the whole window for moving between rooms: fade to black, a title card while the next room
// loads, then fade back in. It lives outside the HUD stage, so a scene change underneath does not remove it.
import { clock, el, host } from './ui.js';
import { walkOff, type Exit } from '../art.js';

/** Fade in and out, and the shortest time the title card stays up so it can be read. */
const FADE_MS = 450, MIN_CARD_MS = 1400;
/** Pip's walk off screen is cut short after this long (the game clock stops while the tab is hidden). */
const WALK_OFF_MAX_MS = 2600;

const curtain = el('div', 'curtain');
curtain.setAttribute('role', 'status');
curtain.setAttribute('aria-live', 'polite');
let mounted = false;

const sleep = (ms: number) => new Promise<void>(resolve => clock.setTimeout(resolve, ms));

/** True while a title card covers the screen: scene changes then happen at once, out of sight. */
export function curtainUp() { return curtain.classList.contains('show'); }

export type Card = { kicker: string; title: string; detail?: string };
let travelling = false;

/**
 * Runs `work` (the API call and scene change) behind a title card. Returns what `work` returned; on a failure the
 * curtain lifts at once so the error banner is visible.
 */
export async function travel(card: Card, work: () => Promise<boolean>, exit: Exit | 'none' = 'right'): Promise<boolean> {
  if (travelling) return false; // a second click while Pip is already leaving
  travelling = true;
  try { return await go(card, work, exit); }
  finally { travelling = false; }
}

/** Pip gets up and walks off (HUD hidden and inert meanwhile), then the title card covers the scene change. */
async function go(card: Card, work: () => Promise<boolean>, exit: Exit | 'none'): Promise<boolean> {
  if (!mounted) { host.body.append(curtain); mounted = true; }
  const stage = host.querySelector<HTMLElement>('.course-stage');
  if (exit !== 'none') {
    if (stage) { stage.inert = true; stage.classList.add('travelling'); }
    await Promise.race([walkOff(exit), sleep(WALK_OFF_MAX_MS)]);
  }
  curtain.replaceChildren(el('div', 'curtain-card',
    el('small', '', card.kicker), el('strong', '', card.title), card.detail ? el('p', '', card.detail) : null,
    el('div', 'curtain-dots', el('i'), el('i'), el('i'))));
  curtain.classList.add('show');
  await sleep(FADE_MS);
  const started = clock.performance.now();
  let ok = false;
  try { ok = await work(); }
  finally {
    if (stage) { stage.inert = false; stage.classList.remove('travelling'); }
    if (ok) await sleep(Math.max(0, MIN_CARD_MS - (clock.performance.now() - started)));
    curtain.classList.remove('show');
  }
  return ok;
}
