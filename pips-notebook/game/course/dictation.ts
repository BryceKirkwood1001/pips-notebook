// On-device dictation only. The browser's Web Speech API is asked to recognise speech locally
// (`processLocally = true`, which the spec says MUST be done on the device), after checking that the browser
// supports local recognition for the language (`SpeechRecognition.available`) and installing its language pack
// when needed (`SpeechRecognition.install`). There is no cloud fallback: when local recognition is unavailable,
// the button says so and the player types instead. The game itself never records or uploads audio.
// Dictation only edits the text box; it never teaches or answers by itself.
import { btn, clock } from './ui.js';

type Availability = 'unavailable' | 'downloadable' | 'downloading' | 'available';
type LocalOptions = { langs: string[]; processLocally: boolean };
type Recognition = {
  lang: string; interimResults: boolean; continuous: boolean; processLocally: boolean;
  start(): void; stop(): void; abort(): void;
  onresult: ((event: { results: ArrayLike<{ 0: { transcript: string } }> }) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
};
type Recognizer = {
  new (): Recognition;
  prototype: object;
  available?: (options: LocalOptions) => Promise<Availability>;
  install?: (options: LocalOptions) => Promise<boolean>;
};
type SpeechWindow = { SpeechRecognition?: Recognizer; webkitSpeechRecognition?: Recognizer };

const speech = clock as unknown as SpeechWindow;
/** Only a recogniser that can be told to stay on the device qualifies. */
const Local = [speech.SpeechRecognition, speech.webkitSpeechRecognition].find(
  (r): r is Recognizer => !!r && typeof r.available === 'function' && typeof r.install === 'function' && 'processLocally' in r.prototype);
export const onDeviceDictation = !!Local;

const UNSUPPORTED = 'On-device dictation is not available in this browser, so nothing was recorded. Type your explanation instead. (Recent desktop Chrome supports on-device speech recognition.)';
const PROBLEMS: Record<string, string> = {
  'not-allowed': 'Microphone access is blocked. Allow it for this page to dictate.',
  'audio-capture': 'No microphone was found.',
  'no-speech': 'No speech heard. Press Dictate and try again.',
  'language-not-supported': 'On-device recognition is not available for this language. Type instead.',
  'service-not-allowed': 'This browser would not run on-device recognition here. Type instead.',
};

let active: { cancel(): void } | null = null;
/** Navigation or another box starting: discard the microphone session (never teaches or answers). */
export function stopDictation() { active?.cancel(); }

/** The browser's language, then US English for other English variants, whichever has local recognition. */
async function localLanguage(local: Recognizer): Promise<{ lang: string; status: Availability } | null> {
  const preferred = clock.navigator.language || 'en-US';
  const langs = [...new Set([preferred, ...(preferred.toLowerCase().startsWith('en') ? ['en-US'] : [])])];
  let fallback: { lang: string; status: Availability } | null = null;
  for (const lang of langs) {
    const status = await local.available!({ langs: [lang], processLocally: true });
    if (status === 'available') return { lang, status };
    if (status !== 'unavailable' && !fallback) fallback = { lang, status };
  }
  return fallback;
}

/**
 * A microphone toggle for one text box. Speech is appended after what is already typed, live as it is heard.
 * `onText` gets the box's new value; `onStatus` gets a short message for the player.
 */
export function micButton(box: HTMLTextAreaElement, onText: (value: string) => void, onStatus: (message: string) => void) {
  const button = btn('Dictate', () => void toggle(), 'mic');
  button.setAttribute('aria-pressed', 'false');
  button.title = Local ? 'Speak instead of typing. Recognition runs on this device.' : UNSUPPORTED;
  let recognition: Recognition | null = null;
  let preparing = false;
  let session = 0;

  function idle() {
    recognition = null; preparing = false;
    button.disabled = false; button.classList.remove('listening'); button.textContent = 'Dictate'; button.setAttribute('aria-pressed', 'false');
    if (active?.cancel === cancel) active = null;
  }
  function cancel() { session++; recognition?.abort(); idle(); }

  async function toggle() {
    if (!Local) { onStatus(UNSUPPORTED); return; }
    if (recognition) { recognition.stop(); return; }
    if (preparing) return;
    stopDictation();
    const mine = ++session;
    const current = () => mine === session;
    preparing = true; active = { cancel }; button.disabled = true;
    try {
      const choice = await localLanguage(Local);
      if (!current()) return;
      if (!choice) { idle(); button.title = UNSUPPORTED; onStatus(UNSUPPORTED); return; }
      if (choice.status !== 'available') {
        // A pack can report "downloadable" even when present; install() resolves at once then. It needs the click's
        // user activation, which is still fresh here.
        onStatus(`Getting the on-device speech model for ${choice.lang} ready. The first time this downloads it to your browser…`);
        const installed = await Local.install!({ langs: [choice.lang], processLocally: true });
        if (!current()) return;
        if (!installed) { idle(); onStatus(`The on-device speech model for ${choice.lang} could not be installed, so nothing was recorded. Type instead.`); return; }
      }
      start(choice.lang, mine);
    } catch {
      if (current()) { idle(); onStatus(UNSUPPORTED); }
    }
  }

  function start(lang: string, mine: number) {
    const current = () => mine === session;
    const next = new Local!();
    next.processLocally = true;
    if (next.processLocally !== true) { idle(); onStatus(UNSUPPORTED); return; } // never start without the local guarantee
    next.lang = lang; next.continuous = true; next.interimResults = true;
    const base = box.value.trim() ? box.value.replace(/\s*$/, ' ') : '';
    let problem = false;
    next.onresult = event => {
      if (!current()) return;
      const heard = Array.from(event.results, result => result[0].transcript).join(' ').replace(/\s+/g, ' ').trim();
      box.value = (base + heard).slice(0, box.maxLength > 0 ? box.maxLength : undefined);
      onText(box.value);
    };
    next.onerror = event => {
      if (!current() || event.error === 'aborted') return;
      problem = true;
      onStatus(PROBLEMS[event.error] ?? `Dictation stopped (${event.error}). Your text is unchanged; type instead.`);
    };
    next.onend = () => {
      if (!current()) return;
      idle();
      if (!problem) onStatus('Dictation stopped. Review the text, then press Teach or Answer when you are ready.');
    };
    try { next.start(); }
    catch { idle(); onStatus('Dictation could not start. Type instead.'); return; }
    recognition = next; preparing = false;
    button.disabled = false; button.classList.add('listening'); button.textContent = 'Stop'; button.setAttribute('aria-pressed', 'true');
    onStatus('Listening on this device… press Stop when you are done.');
    box.focus();
  }

  return button;
}
