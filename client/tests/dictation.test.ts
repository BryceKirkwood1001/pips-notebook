/**
 * Dictation picks the browser's on-device recogniser first, then the browser's speech service (and says who receives
 * the audio), then the in-page model. The browser APIs are faked here; vitest loads the game module with these mocks.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

type Fake = {
  lang: string; continuous: boolean; interimResults: boolean; processLocally: boolean;
  started: boolean; start(): void; stop(): void; abort(): void;
  onresult: ((event: unknown) => void) | null; onerror: ((event: { error: string }) => void) | null; onend: (() => void) | null;
};
const env = vi.hoisted(() => ({
  window: {} as Record<string, unknown>,
  made: [] as Fake[],
  buttons: [] as { onClick: () => void; textContent: string; title: string }[],
}));
vi.mock('../game/course/ui.js', () => ({
  btn: (label: string, onClick: () => void) => {
    const button = {
      onClick, textContent: label, title: '', disabled: false,
      classList: { add() {}, remove() {} }, setAttribute() {},
    };
    env.buttons.push(button);
    return button;
  },
  get clock() { return env.window; },
}));

const CHROME = 'Mozilla/5.0 (Macintosh) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/156.0 Safari/537.36';
const EDGE = `${CHROME} Edg/156.0`;
const SAFARI = 'Mozilla/5.0 (Macintosh) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/19.0 Safari/605.1.15';

function recognizer(options: { onDevice?: 'available' | 'unavailable' } = {}) {
  class Recognition implements Fake {
    lang = ''; continuous = false; interimResults = false; started = false;
    declare processLocally: boolean;
    onresult = null; onerror = null; onend = null;
    constructor() { env.made.push(this); }
    start() { this.started = true; }
    stop() {}
    abort() {}
  }
  // Like a real browser (Chrome 139+), `processLocally` is an accessor on the prototype.
  const local = new WeakMap<object, boolean>();
  Object.defineProperty(Recognition.prototype, 'processLocally', {
    get() { return local.get(this) ?? false; },
    set(value: boolean) { local.set(this, value); },
  });
  if (options.onDevice) {
    Object.assign(Recognition, {
      available: async () => options.onDevice,
      install: async () => true,
    });
  }
  return Recognition;
}

async function setup(userAgent: string, Recognition?: unknown, canRecord = true) {
  vi.resetModules();
  env.made.length = 0;
  env.buttons.length = 0;
  const getUserMedia = vi.fn(async () => { throw Object.assign(new Error('blocked'), { name: 'NotAllowedError' }); });
  env.window = {
    navigator: { userAgent, language: 'en-US', mediaDevices: canRecord ? { getUserMedia } : undefined },
    SpeechRecognition: Recognition,
    MediaRecorder: canRecord ? function MediaRecorder() {} : undefined,
    AudioContext: canRecord ? function AudioContext() {} : undefined,
    OfflineAudioContext: canRecord ? function OfflineAudioContext() {} : undefined,
    setInterval, clearInterval, performance,
  };
  const dictation = await import('../game/course/dictation.js');
  const box = { value: '', maxLength: 0, focus() {} } as unknown as HTMLTextAreaElement;
  const messages: string[] = [];
  const button = dictation.micButton(box, () => {}, (message) => messages.push(message)) as unknown as { title: string };
  const click = async () => { env.buttons[0]!.onClick(); await new Promise((r) => setTimeout(r, 0)); };
  return { button, click, messages, getUserMedia };
}

describe('dictation', () => {
  beforeEach(() => { vi.restoreAllMocks(); });

  it('uses the browser speech service when there is no on-device model, and says Google gets the audio in Chrome', async () => {
    const { button, click, messages } = await setup(CHROME, recognizer());
    expect(button.title).toContain('may send your voice to Google');
    await click();
    const used = env.made[0]!;
    expect(used.started).toBe(true);
    expect(used.processLocally).toBe(false);
    expect(used).toMatchObject({ lang: 'en-US', continuous: true, interimResults: true });
    expect(messages.at(-1)).toBe('Listening… Your browser sends your voice to Google to turn it into text. Press Stop when you are done.');
  });

  it.each([[EDGE, 'Microsoft'], [SAFARI, 'Apple']])('names who receives the audio: %s', async (agent, owner) => {
    const { click, messages } = await setup(agent, recognizer());
    await click();
    expect(messages.at(-1)).toContain(`sends your voice to ${owner}`);
  });

  it('prefers the on-device recogniser and says the audio stays on the computer', async () => {
    const { click, messages } = await setup(CHROME, recognizer({ onDevice: 'available' }));
    await click();
    expect(env.made[0]!.processLocally).toBe(true);
    expect(messages.at(-1)).toBe('Listening on this computer… press Stop when you are done.');
  });

  it('falls back to the speech service when the on-device model is unavailable', async () => {
    const { click, messages } = await setup(CHROME, recognizer({ onDevice: 'unavailable' }));
    await click();
    expect(env.made[0]!.processLocally).toBe(false);
    expect(messages.at(-1)).toContain('sends your voice to Google');
  });

  it('switches to the in-page model after the speech service fails', async () => {
    const { click, messages, getUserMedia } = await setup(CHROME, recognizer());
    await click();
    env.made[0]!.onerror!({ error: 'network' });
    env.made[0]!.onend!();
    expect(messages.at(-1)).toContain("speech service is not available here (network)");
    await click();
    expect(env.made).toHaveLength(1);
    expect(getUserMedia).toHaveBeenCalled();
  });

  it('moves on when the speech service hears speech but returns no words (Brave and similar)', async () => {
    const { click, messages, getUserMedia } = await setup(CHROME, recognizer());
    await click();
    env.made[0]!.onspeechstart!();
    env.made[0]!.onend!();
    expect(messages.at(-1)).toBe("Your browser's speech recognition listened but returned no words. Press Dictate again to use a speech model that runs on this computer instead.");
    await click();
    expect(env.made).toHaveLength(1);
    expect(getUserMedia).toHaveBeenCalled();
  });

  it('moves from a silent on-device recogniser to the speech service, naming who gets the audio', async () => {
    const { click, messages } = await setup(CHROME, recognizer({ onDevice: 'available' }));
    await click();
    env.made[0]!.onspeechstart!();
    env.made[0]!.onend!();
    expect(messages.at(-1)).toContain("Press Dictate again to use your browser's speech service (it sends your voice to Google) instead.");
    await click();
    expect(env.made).toHaveLength(2);
    expect(env.made[1]!.processLocally).toBe(false);
  });

  it('treats a quick stop with no speech as an ordinary stop', async () => {
    const { click, messages } = await setup(CHROME, recognizer());
    await click();
    env.made[0]!.onend!();
    expect(messages.at(-1)).toBe('Dictation stopped. Review the text, then press Teach or Answer when you are ready.');
    await click();
    expect(env.made).toHaveLength(2);
  });

  it('uses the in-page model when the browser has no speech recognition (Firefox)', async () => {
    const { button, click, getUserMedia } = await setup('Mozilla/5.0 (Macintosh) Gecko/20100101 Firefox/150.0');
    expect(button.title).toBe('Speak instead of typing. Speech is recognised on this computer; audio is never uploaded.');
    await click();
    expect(env.made).toHaveLength(0);
    expect(getUserMedia).toHaveBeenCalled();
  });
});
