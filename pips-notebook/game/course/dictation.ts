// Dictation that never sends audio anywhere. Two on-device engines, tried in this order:
// 1. The browser's own on-device speech recognition (Web Speech API with `processLocally = true`, which the spec says
//    MUST run on the device), when the browser has a local model for the language. Text appears live as it is heard.
// 2. Otherwise an open speech model that runs inside this page: Moonshine base (MIT licence) through transformers.js,
//    on the CPU via WebAssembly. Pip's Notebook records the clip, decodes it in the page and transcribes it locally.
//    The library and model files (about 63 MB) are downloaded once, from jsDelivr and Hugging Face, and then cached by
//    the browser; the recording itself is never uploaded.
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
/** Only a recogniser that can be told to stay on the device qualifies. */
const Local = [host.SpeechRecognition, host.webkitSpeechRecognition].find(
  (r): r is Recognizer => !!r && typeof r.available === 'function' && typeof r.install === 'function' && 'processLocally' in r.prototype);
const canRecord = !!host.MediaRecorder && !!host.AudioContext && !!host.OfflineAudioContext && !!clock.navigator.mediaDevices?.getUserMedia;
export const onDeviceDictation = !!Local || canRecord;

const UNSUPPORTED = 'This browser cannot record audio for on-device dictation, so nothing was recorded. Type instead.';
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
  button.title = onDeviceDictation ? 'Speak instead of typing. Speech is recognised on this device; audio is never uploaded.' : UNSUPPORTED;
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
    if (!onDeviceDictation) { onStatus(UNSUPPORTED); return; }
    stopDictation();
    const mine = ++session;
    const current = () => mine === session;
    busy = true; active = { cancel }; button.disabled = true;
    try {
      const choice = await browserLanguage();
      if (!current()) return;
      if (choice) {
        // A pack can report "downloadable" even when present; install() resolves at once then. It needs the click's
        // user activation, which is still fresh here.
        const ready = choice.status === 'available' || await Local!.install!({ langs: [choice.lang], processLocally: true }).catch(() => false);
        if (!current()) return;
        if (ready && startLive(choice.lang, mine)) return;
      }
      if (canRecord) await record(mine);
      else { idle(); onStatus(UNSUPPORTED); }
    } catch {
      if (current()) { idle(); onStatus('Dictation could not start. Type instead.'); }
    }
  }

  /** Engine 1: live text from the browser's on-device recogniser. False when it cannot start. */
  function startLive(lang: string, mine: number): boolean {
    const current = () => mine === session;
    const next = new Local!();
    next.processLocally = true;
    if (next.processLocally !== true) return false; // never start without the local guarantee
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
    try { next.start(); } catch { return false; }
    recognition = next; busy = false;
    listening('Stop');
    onStatus('Listening on this device… press Stop when you are done.');
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
