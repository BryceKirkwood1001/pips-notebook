// Dictation with three engines, tried in this order:
// 1. The browser's on-device speech recognition (Web Speech API with `processLocally = true`, which the spec says MUST
//    run on the device), when the browser has a local model for the language. Audio stays on the computer.
// 2. Otherwise the browser's own speech service (the same API without `processLocally`). Chrome sends the audio to
//    Google, Edge to Microsoft and Safari to Apple to turn it into text; the game says so on the button and while
//    listening. Text appears live as it is heard.
// 3. Otherwise (Firefox, or when that service fails) an open speech model that runs inside this page: Moonshine base
//    (MIT licence) through transformers.js, on the CPU via WebAssembly. The clip is recorded, decoded and transcribed
//    in the page. The library and model files (about 63 MB) download once from jsDelivr and Hugging Face and are cached;
//    the recording itself is never uploaded.
// Dictation only edits the text box; it never teaches or answers by itself. Navigation cancels it.
import { btn, clock } from './ui.js';

/**
 * The pinned in-page speech engine: the library's self-contained CDN build (the `.web` builds expect a bundler to resolve
 * onnxruntime-web), the model and its 8-bit weights (encoder 20.5 MB + decoder 42.4 MB).
 */
const LIBRARY_URL = 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@4.3.2/dist/transformers.min.js';
const MODEL_ID = 'onnx-community/moonshine-base-ONNX';
const MODEL_DTYPE = 'q8';
const MODEL_SIZE = '63 MB';
/** Moonshine expects 16 kHz mono; clips longer than this stop recording automatically. */
const SAMPLE_RATE = 16000;
const MAX_RECORD_SECONDS = 30;

// ── Engine 1: the browser's on-device recognition ──────────────────────────
type Availability = 'unavailable' | 'downloadable' | 'downloading' | 'available';
type LocalOptions = { langs: string[]; processLocally: boolean };
type Recognition = {
  lang: string; interimResults: boolean; continuous: boolean; processLocally: boolean;
  start(): void; stop(): void; abort(): void;
  onresult: ((event: { results: ArrayLike<{ 0: { transcript: string } }> }) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
  onspeechstart?: (() => void) | null;
};
type Recognizer = {
  new (): Recognition;
  prototype: object;
  available?: (options: LocalOptions) => Promise<Availability>;
  install?: (options: LocalOptions) => Promise<boolean>;
};
// ── Engine 2: recording and the in-page model ──────────────────────────────
type AsrOutput = { text: string } | { text: string }[];
type Transcriber = (audio: Float32Array) => Promise<AsrOutput>;
type LoadProgress = { status: string; progress?: number };
type Transformers = {
  env: { allowLocalModels: boolean; useBrowserCache: boolean };
  pipeline: (task: 'automatic-speech-recognition', model: string,
    options: { device: string; dtype: string; progress_callback: (info: LoadProgress) => void }) => Promise<Transcriber>;
};
type RecorderLike = { state: string; mimeType: string; start(): void; stop(): void;
  ondataavailable: ((event: { data: Blob }) => void) | null; onstop: (() => void) | null; onerror: (() => void) | null };
type AudioWindow = {
  SpeechRecognition?: Recognizer; webkitSpeechRecognition?: Recognizer;
  MediaRecorder?: new (stream: MediaStream) => RecorderLike;
  AudioContext?: typeof AudioContext; OfflineAudioContext?: typeof OfflineAudioContext;
};

const host = clock as unknown as AudioWindow;
/** Engine 1: only a recogniser that can be told to stay on the device qualifies. */
const Local = [host.SpeechRecognition, host.webkitSpeechRecognition].find(
  (r): r is Recognizer => !!r && typeof r.available === 'function' && typeof r.install === 'function' && 'processLocally' in r.prototype);
/** Engine 2: the browser's own speech service, which runs on its maker's servers. */
const Service = host.SpeechRecognition ?? host.webkitSpeechRecognition;
const canRecord = !!host.MediaRecorder && !!host.AudioContext && !!host.OfflineAudioContext && !!clock.navigator.mediaDevices?.getUserMedia;
export const canDictate = !!Local || !!Service || canRecord;

/** Who runs the browser's speech service, for the disclosure. */
export function speechServiceOwner(): string {
  const agent = clock.navigator.userAgent;
  if (/Edg\//.test(agent)) return 'Microsoft';
  if (/Chrome|Chromium|CriOS/.test(agent)) return 'Google';
  if (/Safari/.test(agent)) return 'Apple';
  return "your browser's maker";
}
/** Errors that mean the browser's speech service cannot work here; later dictation uses the in-page model instead. */
const SERVICE_FAILURES = new Set(['network', 'service-not-allowed', 'language-not-supported']);
/**
 * Engines that listened but returned no words this page visit. Some browsers expose the API without a working
 * recogniser behind it (Brave, some other Chromium browsers), and an on-device language pack can report ready when it
 * is not. The next press of Dictate then moves on to the next engine.
 */
let deviceUnusable = false;
let serviceUnusable = false;
/** A session this long without words, or one where speech was detected, counts as the engine not working. */
const SILENT_FAILURE_MS = 4000;
const log = (...parts: unknown[]) => console.info('[dictation]', ...parts);

const UNSUPPORTED = 'This browser cannot record audio for dictation, so nothing was recorded. Type instead.';
const PROBLEMS: Record<string, string> = {
  'not-allowed': 'Microphone access is blocked. Allow it for this page to dictate.',
  'audio-capture': 'No microphone was found.',
  'no-speech': 'No speech heard. Press Dictate and try again.',
};

let active: { cancel(): void } | null = null;
/** Navigation or another box starting: discard the microphone session (never teaches or answers). */
export function stopDictation() { active?.cancel(); }

/** The browser's language (then US English for English variants) when the browser can recognise it locally. */
let browserChoice: Promise<{ lang: string; status: Availability } | null> | null = null;
function browserLanguage(): Promise<{ lang: string; status: Availability } | null> {
  if (!Local) return Promise.resolve(null);
  browserChoice ??= (async () => {
    const preferred = clock.navigator.language || 'en-US';
    const langs = [...new Set([preferred, ...(preferred.toLowerCase().startsWith('en') ? ['en-US'] : [])])];
    let fallback: { lang: string; status: Availability } | null = null;
    for (const lang of langs) {
      const status = await Local.available!({ langs: [lang], processLocally: true });
      if (status === 'available') return { lang, status };
      if (status !== 'unavailable' && !fallback) fallback = { lang, status };
    }
    return fallback;
  })().catch(() => null);
  return browserChoice;
}

/** Loads the in-page model once per page; progress goes to whoever is waiting. A failed load can be retried. */
let model: Promise<Transcriber> | null = null;
const loadListeners = new Set<(percent: number) => void>();
function loadModel(): Promise<Transcriber> {
  model ??= (async () => {
    const lib = (await import(LIBRARY_URL)) as unknown as Transformers;
    lib.env.allowLocalModels = false; // the game serves no model files of its own
    lib.env.useBrowserCache = true;   // keep the download for next time
    return lib.pipeline('automatic-speech-recognition', MODEL_ID, {
      device: 'wasm', dtype: MODEL_DTYPE,
      progress_callback: info => {
        if (info.status === 'progress_total' && typeof info.progress === 'number') loadListeners.forEach(f => f(info.progress!));
      },
    });
  })().catch(error => { model = null; throw error; });
  return model;
}

/** Decodes a recording and resamples it to 16 kHz mono in the page. */
async function toSamples(recording: Blob): Promise<Float32Array> {
  const context = new host.AudioContext!();
  try {
    const decoded = await context.decodeAudioData(await recording.arrayBuffer());
    const offline = new host.OfflineAudioContext!(1, Math.max(1, Math.ceil(decoded.duration * SAMPLE_RATE)), SAMPLE_RATE);
    const source = offline.createBufferSource();
    source.buffer = decoded; source.connect(offline.destination); source.start();
    return (await offline.startRendering()).getChannelData(0);
  } finally { void context.close(); }
}

/**
 * A microphone toggle for one text box. With the browser's on-device recogniser, speech is appended live as it is heard;
 * with the in-page model, the clip is transcribed after Stop and appended. `onText` gets the box's new value; `onStatus`
 * gets a short message for the player.
 */
export function micButton(box: HTMLTextAreaElement, onText: (value: string) => void, onStatus: (message: string) => void) {
  const button = btn('Dictate', () => void toggle(), 'mic');
  button.setAttribute('aria-pressed', 'false');
  button.title = !canDictate ? UNSUPPORTED : Service
    ? `Speak instead of typing. Uses your browser's speech recognition, which may send your voice to ${speechServiceOwner()} to turn it into text.`
    : 'Speak instead of typing. Speech is recognised on this computer; audio is never uploaded.';
  let recognition: Recognition | null = null;
  let recorder: RecorderLike | null = null;
  let stream: MediaStream | null = null;
  let busy = false;
  let session = 0;
  let timer = 0;

  function idle() {
    clock.clearInterval(timer);
    stream?.getTracks().forEach(track => track.stop());
    recognition = null; recorder = null; stream = null; busy = false;
    button.disabled = false; button.classList.remove('listening'); button.textContent = 'Dictate'; button.setAttribute('aria-pressed', 'false');
    if (active?.cancel === cancel) active = null;
  }
  function cancel() {
    session++;
    recognition?.abort();
    if (recorder?.state === 'recording') recorder.stop();
    idle();
  }
  function listening(label: string) {
    button.disabled = false; button.classList.add('listening'); button.textContent = label; button.setAttribute('aria-pressed', 'true');
  }
  function append(text: string) {
    const clean = text.replace(/\s+/g, ' ').trim();
    if (!clean) { onStatus('No speech was recognised. Press Dictate and try again.'); return; }
    const base = box.value.trim() ? box.value.replace(/\s*$/, ' ') : '';
    box.value = (base + clean).slice(0, box.maxLength > 0 ? box.maxLength : undefined);
    onText(box.value);
    onStatus('Added to your text. Review it, then press Teach or Answer when you are ready.');
  }

  async function toggle() {
    if (recognition) { recognition.stop(); return; }
    if (recorder?.state === 'recording') { recorder.stop(); return; }
    if (busy) return;
    if (!canDictate) { onStatus(UNSUPPORTED); return; }
    stopDictation();
    const mine = ++session;
    const current = () => mine === session;
    busy = true; active = { cancel }; button.disabled = true;
    try {
      const choice = await browserLanguage();
      if (!current()) return;
      if (choice && !deviceUnusable) {
        // A pack can report "downloadable" even when present; install() resolves at once then. It needs the click's
        // user activation, which is still fresh here.
        const ready = choice.status === 'available' || await Local!.install!({ langs: [choice.lang], processLocally: true }).catch(() => false);
        if (!current()) return;
        if (ready && startLive(Local!, choice.lang, mine, 'device')) return;
      }
      if (Service && !serviceUnusable && startLive(Service, clock.navigator.language || 'en-US', mine, 'service')) return;
      if (canRecord) await record(mine);
      else { idle(); onStatus(UNSUPPORTED); }
    } catch {
      if (current()) { idle(); onStatus('Dictation could not start. Type instead.'); }
    }
  }

  /**
   * Engines 1 and 2: live text from the browser's recogniser, on the device or through its speech service.
   * False when it cannot start.
   */
  function startLive(Recognition: Recognizer, lang: string, mine: number, where: 'device' | 'service'): boolean {
    const current = () => mine === session;
    const next = new Recognition();
    if (where === 'device') {
      next.processLocally = true;
      if (next.processLocally !== true) return false; // never claim on-device without the local guarantee
    } else if ('processLocally' in next) next.processLocally = false;
    next.lang = lang; next.continuous = true; next.interimResults = true;
    const base = box.value.trim() ? box.value.replace(/\s*$/, ' ') : '';
    const started = clock.performance.now();
    let problem = false;
    let words = false;
    let speech = false;
    next.onspeechstart = () => { speech = true; };
    next.onresult = event => {
      if (!current()) return;
      const heard = Array.from(event.results, result => result[0].transcript).join(' ').replace(/\s+/g, ' ').trim();
      if (heard) words = true;
      box.value = (base + heard).slice(0, box.maxLength > 0 ? box.maxLength : undefined);
      onText(box.value);
    };
    next.onerror = event => {
      if (!current() || event.error === 'aborted') return;
      problem = true;
      log(where, 'error', event.error);
      if (where === 'service' && SERVICE_FAILURES.has(event.error) && canRecord) {
        serviceUnusable = true;
        onStatus(`Your browser's speech service is not available here (${event.error}). Press Dictate again to use a speech model that runs on this computer instead.`);
        return;
      }
      onStatus(PROBLEMS[event.error] ?? `Dictation stopped (${event.error}). Your text is unchanged; type instead.`);
    };
    next.onend = () => {
      if (!current()) return;
      const elapsed = clock.performance.now() - started;
      log(where, 'ended', { words, speech, seconds: Math.round(elapsed / 1000) });
      idle();
      if (problem) return;
      if (!words && (speech || elapsed >= SILENT_FAILURE_MS)) {
        // It listened but never returned words: try the next engine on the next press.
        if (where === 'device') deviceUnusable = true;
        else if (canRecord) serviceUnusable = true;
        const fallback = where === 'device' && Service && !serviceUnusable
          ? `your browser's speech service (it sends your voice to ${speechServiceOwner()})`
          : canRecord && (where === 'device' || serviceUnusable) ? 'a speech model that runs on this computer' : null;
        onStatus(fallback
          ? `Your browser's speech recognition listened but returned no words. Press Dictate again to use ${fallback} instead.`
          : "Your browser's speech recognition listened but returned no words. Type instead.");
        return;
      }
      onStatus('Dictation stopped. Review the text, then press Teach or Answer when you are ready.');
    };
    try { next.start(); } catch { return false; }
    log('listening with', where === 'device' ? 'the on-device recogniser' : `the browser speech service (${speechServiceOwner()})`, lang);
    recognition = next; busy = false;
    listening('Stop');
    onStatus(where === 'device'
      ? 'Listening on this computer… press Stop when you are done.'
      : `Listening… Your browser sends your voice to ${speechServiceOwner()} to turn it into text. Press Stop when you are done.`);
    box.focus();
    return true;
  }

  /** Engine 2: record a clip, then transcribe it with the in-page model. The model starts loading as you speak. */
  async function record(mine: number) {
    const current = () => mine === session;
    let mic: MediaStream;
    try { mic = await clock.navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true } }); }
    catch (error) {
      if (!current()) return;
      idle();
      onStatus((error as Error).name === 'NotAllowedError' ? PROBLEMS['not-allowed']! : PROBLEMS['audio-capture']!);
      return;
    }
    if (!current()) { mic.getTracks().forEach(track => track.stop()); return; }
    stream = mic;
    const firstUse = !model;
    const loading = loadModel();
    loading.catch(() => { /* reported after Stop */ });
    let percent = 0;
    const onProgress = (p: number) => { percent = Math.round(p); };
    loadListeners.add(onProgress);
    const next = new host.MediaRecorder!(mic);
    const chunks: Blob[] = [];
    next.ondataavailable = event => { if (event.data.size) chunks.push(event.data); };
    next.onerror = () => { if (current()) { idle(); onStatus('Recording failed. Your text is unchanged.'); } };
    next.onstop = () => void (async () => {
      clock.clearInterval(timer);
      stream?.getTracks().forEach(track => track.stop());
      if (!current()) { loadListeners.delete(onProgress); return; }
      busy = true; button.disabled = true; button.classList.remove('listening'); button.textContent = 'Transcribing…';
      try {
        const samples = await toSamples(new Blob(chunks, { type: next.mimeType }));
        const wait = clock.setInterval(() => { if (percent < 100) onStatus(`Getting the speech model ready (one-time download): ${percent}%…`); }, 300);
        let transcriber: Transcriber;
        try { transcriber = await loading; } finally { clock.clearInterval(wait); }
        if (!current()) return;
        onStatus('Transcribing on this device…');
        const result = await transcriber(samples);
        if (!current()) return;
        append(Array.isArray(result) ? result.map(r => r.text).join(' ') : result.text);
      } catch {
        if (current()) onStatus('The on-device speech model could not load or transcribe this clip, so your text is unchanged. Check your connection for the one-time download, or type instead.');
      } finally {
        loadListeners.delete(onProgress);
        if (current()) idle();
      }
    })();
    try { next.start(); }
    catch { idle(); loadListeners.delete(onProgress); onStatus('Recording could not start. Type instead.'); return; }
    recorder = next; busy = false;
    listening('Stop');
    const started = clock.performance.now();
    const tick = () => {
      if (!current() || recorder?.state !== 'recording') return;
      const seconds = Math.floor((clock.performance.now() - started) / 1000);
      if (seconds >= MAX_RECORD_SECONDS) { recorder.stop(); return; }
      onStatus(`Recording on this device: ${seconds}s of ${MAX_RECORD_SECONDS}s. Press Stop when you are done.` +
        (firstUse ? ` The first time, a ${MODEL_SIZE} speech model downloads once; your audio is never uploaded.` : ''));
    };
    tick();
    timer = clock.setInterval(tick, 500);
    box.focus();
  }

  return button;
}
