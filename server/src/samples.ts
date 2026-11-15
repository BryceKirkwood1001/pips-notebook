/**
 * Where the bundled sample lessons come from. The browser fetches them next to the page (`samples/`, written by
 * scripts/build.mjs); tests and scripts read the repo's `samples/cache/` folder (node/samples.ts).
 */
export interface SampleSource {
  /** Every sample's id and title, in any order. */
  list(): Promise<{ id: string; title: string }[]>;
  /** The parsed `<id>.json` fixture, or null when there is none. */
  read(id: string): Promise<unknown | null>;
}

/** No samples at all. */
export const noSamples: SampleSource = { list: async () => [], read: async () => null };

/**
 * Samples served as static files: `<base>index.json` lists them, `<base><id>.json` is each fixture.
 * `base` is a URL relative to the page, so the game works at a domain's root or under a path.
 */
export function createFetchSampleSource(base: string | URL, doFetch: typeof fetch = (input, init) => globalThis.fetch(input, init)): SampleSource {
  const root = new URL(base, globalThis.location?.href);
  const json = async (name: string): Promise<unknown | null> => {
    const res = await doFetch(new URL(name, root));
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`Could not load ${name} (HTTP ${res.status})`);
    return res.json();
  };
  return {
    async list() {
      const index = (await json('index.json').catch(() => null)) as { samples?: { id?: unknown; title?: unknown }[] } | null;
      return (index?.samples ?? [])
        .filter((s): s is { id: string; title?: unknown } => typeof s.id === 'string')
        .map((s) => ({ id: s.id, title: typeof s.title === 'string' && s.title ? s.title : s.id }));
    },
    read: (id) => json(`${encodeURIComponent(id)}.json`),
  };
}
