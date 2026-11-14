import type { Screen } from './app.js';
import { el, host } from './ui.js';

const player = el('audio');
player.loop = true;
player.volume = 0.45;
const combatTracks = ['miniboss_1', 'miniboss_2', 'miniboss_3'] as const;
let currentTrack = '';

function resumeMusic() {
    if (!currentTrack || host.hidden || !player.paused) return;
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
        case 'Fight':
            track = combatTracks[crypto.getRandomValues(new Uint32Array(1))[0]! % combatTracks.length]!;
            break;
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
