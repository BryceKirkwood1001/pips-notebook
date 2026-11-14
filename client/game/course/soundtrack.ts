import { state, type Screen } from './app.js';
import { clock, el, host } from './ui.js';
import { tierFor } from '../art.js';

const player = el('audio');
player.loop = true;
player.hidden = true;
host.body.append(player);
const MUSIC_VOLUME = 0.45, FADE_OUT_MS = 650, FADE_IN_MS = 900, FADE_STEP_MS = 25;
player.volume = 0;
/** One mini-boss track per danger tier (art.ts tiers): the gentlest room gets the first, the darkest the last. */
const combatTracks = ['miniboss_1', 'miniboss_2', 'miniboss_3'] as const;
let currentTrack = '';
let loadedTrack = '';
let fadeTimer: number | undefined;

function cancelFade() {
    clock.clearInterval(fadeTimer);
    fadeTimer = undefined;
}

/** One cancellable envelope: a newer scene or mute always replaces the pending transition. */
function fadeTo(volume: number, duration: number, done?: () => void) {
    cancelFade();
    const from = player.volume, started = clock.performance.now();
    fadeTimer = clock.setInterval(() => {
        const progress = Math.min(1, (clock.performance.now() - started) / duration);
        player.volume = from + (volume - from) * progress;
        if (progress === 1) { cancelFade(); done?.(); }
    }, FADE_STEP_MS);
}

function loadCurrentTrack() {
    cancelFade();
    player.pause();
    player.volume = 0;
    loadedTrack = currentTrack;
    player.src = 'media/music/' + loadedTrack + '.mp3';
}

// Wait until sound actually starts (including after buffering/autoplay unlock) before fading in.
player.addEventListener('playing', () => {
    if (enabled && !host.hidden && loadedTrack === currentTrack) fadeTo(MUSIC_VOLUME, FADE_IN_MS);
});
/** The player's music choice, remembered in this browser (it is only a preference). */
const MUSIC_KEY = 'top.music';
let enabled = true;
try { enabled = clock.localStorage.getItem(MUSIC_KEY) !== 'off'; } catch { /* Storage may be unavailable: music stays on. */ }

export function musicOn() { return enabled; }
/** Turns the soundtrack on or off and returns the new state. */
export function toggleMusic() {
    enabled = !enabled;
    try { clock.localStorage.setItem(MUSIC_KEY, enabled ? 'on' : 'off'); } catch { /* Not remembered, but still applied. */ }
    if (enabled) resumeMusic(); else { cancelFade(); player.pause(); player.volume = 0; }
    return enabled;
}

function resumeMusic() {
    if (!enabled || !currentTrack || host.hidden || !player.paused) return;
    if (loadedTrack !== currentTrack) loadCurrentTrack();
    // A browser may defer playback until a gesture, or cancel a play when the scene changes.
    void player.play().catch((error: Error) => {
        if (error.name !== 'NotAllowedError' && error.name !== 'AbortError') console.warn('Soundtrack playback failed', error);
    });
}

// The HUD receives input above the Phaser canvas. Capture gestures on both surfaces.
host.addEventListener('click', resumeMusic, true);
host.addEventListener('keydown', resumeMusic, true);
host.addEventListener('visibilitychange', () => {
    if (host.hidden) { cancelFade(); player.pause(); player.volume = 0; }
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
        currentTrack = track;
        if (!enabled || host.hidden || player.paused || player.volume === 0) {
            loadCurrentTrack();
        } else if (loadedTrack === currentTrack) {
            // Back to the outgoing scene before its fade finishes: keep its playback position.
            fadeTo(MUSIC_VOLUME, FADE_IN_MS);
        } else {
            fadeTo(0, FADE_OUT_MS, () => { loadCurrentTrack(); resumeMusic(); });
        }
    }
    resumeMusic();
}
