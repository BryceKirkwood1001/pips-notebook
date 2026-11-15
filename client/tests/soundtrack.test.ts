import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const env = vi.hoisted(() => {
    const audio = {
        src: '', volume: 0, paused: true, loop: false, hidden: false,
        addEventListener: vi.fn(), pause: vi.fn(), play: vi.fn(),
    };
    return { audio, hidden: false, append: vi.fn(), listen: vi.fn() };
});
vi.mock('../game/course/ui.js', () => ({
    el: () => env.audio,
    host: { get hidden() { return env.hidden; }, body: { append: env.append }, addEventListener: env.listen },
    clock: {
        setInterval: (...args: Parameters<typeof setInterval>) => setInterval(...args),
        clearInterval: (id: ReturnType<typeof setInterval>) => clearInterval(id),
        performance: { now: () => performance.now() },
        localStorage: { getItem: () => null, setItem: vi.fn() },
    },
}));
vi.mock('../game/course/app.js', () => ({ state: { run: null } }));
vi.mock('../game/art.js', () => ({ tierFor: () => 0 }));

// Keep the DOM-dependent game outside the backend TypeScript project; Vitest loads it with the mocks above.
const soundtrackModule = '../game/course/soundtrack.js';
let music: { playSceneMusic(scene: string): void; toggleMusic(): boolean };
function playing() { env.audio.addEventListener.mock.calls.find(([event]) => event === 'playing')![1](); }
function visibility() { env.listen.mock.calls.find(([event]) => event === 'visibilitychange')![1](); }
function start() {
    music.playSceneMusic('Title');
    playing();
    vi.advanceTimersByTime(900);
}

beforeEach(async () => {
    vi.resetModules();
    vi.clearAllMocks();
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'performance'] });
    env.hidden = false;
    Object.assign(env.audio, { src: '', volume: 0, paused: true });
    env.audio.pause.mockImplementation(() => { env.audio.paused = true; });
    env.audio.play.mockImplementation(() => { env.audio.paused = false; return Promise.resolve(); });
    music = await import(soundtrackModule);
});
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); });

describe('scene soundtrack transitions', () => {
    it('fades out before replacing the track, then waits for playback before fading in', () => {
        start();
        expect(env.audio.volume).toBeCloseTo(0.45);
        music.playSceneMusic('Learning');
        vi.advanceTimersByTime(325);
        expect(env.audio.src).toContain('menu.m4a');
        expect(env.audio.volume).toBeCloseTo(0.225);
        vi.advanceTimersByTime(325);
        expect(env.audio.src).toContain('learning.m4a');
        expect(env.audio.volume).toBe(0);
        vi.advanceTimersByTime(1000); // Buffering must not consume the fade-in.
        expect(env.audio.volume).toBe(0);
        playing();
        vi.advanceTimersByTime(450);
        expect(env.audio.volume).toBeCloseTo(0.225);
        vi.advanceTimersByTime(450);
        expect(env.audio.volume).toBeCloseTo(0.45);
    });

    it('keeps shared tracks playing across scenes without another fade or play call', () => {
        start();
        music.playSceneMusic('Upload');
        music.playSceneMusic('Settings');
        expect(env.audio.play).toHaveBeenCalledTimes(1);
        expect(env.audio.pause).toHaveBeenCalledTimes(1);
        expect(env.audio.volume).toBeCloseTo(0.45);
        expect(vi.getTimerCount()).toBe(0);
    });

    it('cancels an obsolete switch when quickly returning to the outgoing soundtrack', () => {
        start();
        music.playSceneMusic('Learning');
        vi.advanceTimersByTime(250);
        music.playSceneMusic('Title');
        vi.advanceTimersByTime(1500);
        expect(env.audio.src).toContain('menu.m4a');
        expect(env.audio.volume).toBeCloseTo(0.45);
        expect(env.audio.play).toHaveBeenCalledTimes(1);
    });

    it('mutes immediately during a transition and fades into the latest requested track on unmute', () => {
        start();
        music.playSceneMusic('Learning');
        vi.advanceTimersByTime(250);
        expect(music.toggleMusic()).toBe(false);
        vi.advanceTimersByTime(1500);
        expect(env.audio.paused).toBe(true);
        expect(env.audio.volume).toBe(0);
        expect(env.audio.src).toContain('menu.m4a');
        expect(music.toggleMusic()).toBe(true);
        expect(env.audio.src).toContain('learning.m4a');
        playing();
        vi.advanceTimersByTime(900);
        expect(env.audio.volume).toBeCloseTo(0.45);
    });

    it('cancels fades while hidden and resumes the latest scene quietly before fading in', () => {
        start();
        music.playSceneMusic('Learning');
        env.hidden = true;
        visibility();
        vi.advanceTimersByTime(1500);
        expect(env.audio.paused).toBe(true);
        expect(env.audio.volume).toBe(0);
        music.playSceneMusic('Boss');
        expect(env.audio.src).toContain('finalboss.m4a');
        env.hidden = false;
        visibility();
        playing();
        vi.advanceTimersByTime(900);
        expect(env.audio.volume).toBeCloseTo(0.45);
        expect(env.audio.paused).toBe(false);
    });
});
