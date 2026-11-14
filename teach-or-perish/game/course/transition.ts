// A curtain over the whole window for moving between rooms: fade to black, a title card while the next room
// loads, then fade back in. It lives outside the HUD stage, so a scene change underneath does not remove it.
import { clock, el, host } from './ui.js';

/** Fade in and out, and the shortest time the title card stays up so it can be read. */
const FADE_MS = 450, MIN_CARD_MS = 1400;

const curtain = el('div', 'curtain');
curtain.setAttribute('role', 'status');
curtain.setAttribute('aria-live', 'polite');
let mounted = false;

const sleep = (ms: number) => new Promise<void>(resolve => clock.setTimeout(resolve, ms));

/** True while a title card covers the screen: scene changes then happen at once, out of sight. */
export function curtainUp() { return curtain.classList.contains('show'); }

export type Card = { kicker: string; title: string; detail?: string };

/**
 * Runs `work` (the API call and scene change) behind a title card. Returns what `work` returned; on a failure the
 * curtain lifts at once so the error banner is visible.
 */
export async function travel(card: Card, work: () => Promise<boolean>): Promise<boolean> {
  if (!mounted) { host.body.append(curtain); mounted = true; }
  curtain.replaceChildren(el('div', 'curtain-card',
    el('small', '', card.kicker), el('strong', '', card.title), card.detail ? el('p', '', card.detail) : null,
    el('div', 'curtain-dots', el('i'), el('i'), el('i'))));
  curtain.classList.add('show');
  await sleep(FADE_MS);
  const started = clock.performance.now();
  let ok = false;
  try { ok = await work(); }
  finally {
    if (ok) await sleep(Math.max(0, MIN_CARD_MS - (clock.performance.now() - started)));
    curtain.classList.remove('show');
  }
  return ok;
}
