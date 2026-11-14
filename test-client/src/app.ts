// Shared app state, the API instance, the one error-handling wrapper and scene navigation.
import type Phaser from 'phaser';
import {
  ApiError,
  createApiClient,
  type ApiClient,
  type PublicRun,
  type Results,
  type RunPhase,
} from '@top/shared/api-client';
import { createMockApi } from './mockApi';

export const params = new URLSearchParams(location.search);
export const isMock = params.get('mock') === '1';
let apiOrigin = params.get('api') || 'http://localhost:8787';
try { apiOrigin = params.get('api') || localStorage.getItem('top.apiOrigin') || apiOrigin; } catch { /* Optional non-secret preference. */ }
export const api: ApiClient = isMock
  ? createMockApi()
  : createApiClient({ baseUrl: apiOrigin });

export const state: { run: PublicRun | null; results: Results | null; game: Phaser.Game | null } = {
  run: null,
  results: null,
  game: null,
};

// ── Error banner ────────────────────────────────────────────────────────────

export function showError(text: string) {
  const b = document.getElementById('banner');
  if (!b) return;
  b.replaceChildren();
  const close = document.createElement('button');
  close.textContent = 'x';
  close.onclick = clearBanner;
  const msg = document.createElement('span');
  msg.textContent = text;
  b.append(close, msg);
  b.style.display = 'block';
}

export function clearBanner() {
  const b = document.getElementById('banner');
  if (b) b.style.display = 'none';
}

export function describeError(err: unknown): string {
  if (err instanceof ApiError) {
    const pre = err.status === 425 ? 'Not ready yet. ' : '';
    return `${pre}${err.message} [${err.code}, HTTP ${err.status}]`;
  }
  return err instanceof Error ? err.message : String(err);
}

// ── The call wrapper: every API call goes through here ──────────────────────

let inflight = false;

/** Runs one API call. Ignores a second call while one is in flight (no double submits). Returns undefined on error. */
export async function call<T>(fn: () => Promise<T>): Promise<T | undefined> {
  if (inflight) return undefined;
  inflight = true;
  document.body.classList.add('busy');
  clearBanner();
  try {
    return await fn();
  } catch (err) {
    showError(describeError(err));
    // 409 = wrong phase: our copy of the run is stale. Reload it and jump to the right scene.
    if (err instanceof ApiError && err.status === 409 && state.run) {
      try {
        const run = await api.getRun(state.run.id);
        setRun(run);
        goTo(sceneForPhase(run.phase));
      } catch (e2) {
        showError(describeError(e2));
      }
    }
    return undefined;
  } finally {
    inflight = false;
    document.body.classList.remove('busy');
  }
}

// ── Run and navigation ──────────────────────────────────────────────────────

export function sceneForPhase(p: RunPhase): string {
  switch (p) {
    case 'learning':
      return 'Learning';
    case 'room':
    case 'room_result':
      return 'Fight';
    case 'boss':
      return 'Boss';
    default:
      return 'Results';
  }
}

/** Remember the run in state and in the URL (?run=<id>) so a reload resumes it. */
export function setRun(run: PublicRun | null) {
  state.run = run;
  const u = new URL(location.href);
  if (run) u.searchParams.set('run', run.id);
  else u.searchParams.delete('run');
  history.replaceState(null, '', u);
}

// Phaser scene status values (Phaser.Scenes.START .. SLEEPING): a scene that has been started and not shut down.
const SCENE_STARTED = 2;
const SCENE_SLEEPING = 7;

/**
 * Show exactly one scene: stop every other started scene, then start (or restart) the target.
 * Stopping "whichever scene is active" is not enough: Boot starts the first scene while it is still
 * being created, so it would stay alive and the wrong scene would be the one stopped later.
 */
export function goTo(key: string) {
  const game = state.game;
  if (!game) return;
  for (const scene of game.scene.getScenes(false)) {
    const status = scene.sys.settings.status;
    if (scene.scene.key !== key && status >= SCENE_STARTED && status <= SCENE_SLEEPING) {
      game.scene.stop(scene.scene.key);
    }
  }
  game.scene.start(key);
}
