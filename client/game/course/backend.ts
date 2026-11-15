/**
 * The game's backend runs in this page: `backend.js`, built next to game.js by scripts/build.mjs from
 * server/src/browser/main.ts. It is loaded on first use, and its `fetch` answers the API client's requests
 * without any network, so this file is the game's whole "connection".
 */
interface Backend {
    fetch: typeof fetch;
    preparing(): number;
    storage: 'browser' | 'memory';
}

let loading: Promise<Backend> | undefined;
let ready: Backend | undefined;

/** Starts the backend once (it opens this browser's saved dungeons). */
export function backend(): Promise<Backend> {
    loading ??= (async () => {
        // A runtime URL beside game.js, so the game bundle does not try to include it.
        const url = new URL('./backend.js', import.meta.url).href;
        const module = await import(/* @vite-ignore */ url) as { start(): Promise<Backend> };
        return ready = await module.start();
    })();
    loading.catch(() => { loading = undefined; }); // a failed download may be retried
    return loading;
}

/** The API client's transport: the browser's `fetch` signature, answered by the in-page backend. */
export const localFetch: typeof fetch = async (input, init) => {
    let started: Backend;
    try {
        started = await backend();
    } catch (error) {
        throw new TypeError('The game could not load (backend.js). Check your connection, then reload the page. ' + (error instanceof Error ? error.message : ''));
    }
    return started.fetch(input, init);
};

/** True while an upload is being prepared: closing the page would stop it. */
export function preparingUploads(): boolean {
    return (ready?.preparing() ?? 0) > 0;
}

/** 'memory' when the browser blocked storage, so dungeons last only until the page closes. */
export function storageKind(): Backend['storage'] | undefined {
    return ready?.storage;
}
