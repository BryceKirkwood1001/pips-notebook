import { state, type Screen } from './app.js';
import { clock, el, host } from './ui.js';
import { tierFor } from '../art.js';

const player = el('audio');
player.loop = true;
player.volume = 0.45;
/** One mini-boss track per danger tier (art.ts tiers): the gentlest room gets the first, the darkest the last. */
const combatTracks = ['miniboss_1', 'miniboss_2', 'miniboss_3'] as const;
let currentTrack = '';
/** The player's music choice, remembered in this browser (it is only a preference). */
const MUSIC_KEY = 'top.music';
let enabled = true;
try { enabled = clock.localStorage.getItem(MUSIC_KEY) !== 'off'; } catch { /* Storage may be unavailable: music stays on. */ }

export function musicOn() { return enabled; }
/** Turns the soundtrack on or off and returns the new state. */
export function toggleMusic() {
    enabled = !enabled;
    try { clock.localStorage.setItem(MUSIC_KEY, enabled ? 'on' : 'off'); } catch { /* Not remembered, but still applied. */ }
    if (enabled) resumeMusic(); else player.pause();
    return enabled;
}

function resumeMusic() {
    if (!enabled || !currentTrack || host.hidden || !player.paused) return;
    // A browser may defer playback until a gesture, or cancel a play when the scene changes.
    void player.play().catch((error: Error) => {
        if (error.name !== 'NotAllowedError' && error.name !== 'AbortError') console.warn('Soundtrack playback failed', error);
    });
}

// The HUD receives input above the Phaser canvas. Capture gestures on both surfaces.
host.addEventListener('click', resumeMusic, true);
host.addEventListener('keydown', resumeMusic, true);
host.addEventListener('visibilitychange', () => {
    if (host.hidden) player.pause();
    else resumeMusic();
});

export function playSceneMusic(scene: Screen) {
    let track: string;
    switch (scene) {
        case 'Fight': {
            const run = state.run;
            track = combatTracks[run ? Math.min(tierFor(run.roomIndex, run.rooms.length), combatTracks.length - 1) : 0]!;
            break;
        }
        case 'Boss': track = 'finalboss'; break;
        case 'Learning': track = 'learning'; break;
        default: track = 'menu';
    }
    if (track !== currentTrack) {
        player.pause();
        currentTrack = track;
        player.src = 'media/music/' + track + '.mp3';
    }
    resumeMusic();
}
