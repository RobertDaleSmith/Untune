import { getArtworkDataUrl } from "./commands";

const MAX_CONCURRENT = 6;
let active = 0;
const queue: Array<{ hash: string; resolve: (v: string | null) => void; reject: (e: unknown) => void }> = [];

// Shared cache — populated by pre-warming, read by playback store + useArtwork hook
const cache = new Map<string, string | null>();
const inflight = new Map<string, Promise<string | null>>();

function flush() {
  while (active < MAX_CONCURRENT && queue.length > 0) {
    const item = queue.shift()!;
    active++;
    getArtworkDataUrl(item.hash)
      .then(item.resolve, item.reject)
      .finally(() => {
        active--;
        flush();
      });
  }
}

export function fetchArtwork(artworkHash: string): Promise<string | null> {
  // Return from cache immediately
  if (cache.has(artworkHash)) {
    return Promise.resolve(cache.get(artworkHash) ?? null);
  }

  // Deduplicate in-flight requests
  const existing = inflight.get(artworkHash);
  if (existing) return existing;

  const p = new Promise<string | null>((resolve, reject) => {
    queue.push({ hash: artworkHash, resolve, reject });
    flush();
  }).then((result) => {
    cache.set(artworkHash, result);
    inflight.delete(artworkHash);
    return result;
  }).catch(() => {
    cache.set(artworkHash, null);
    inflight.delete(artworkHash);
    return null;
  });

  inflight.set(artworkHash, p);
  return p;
}

export function getCachedArtwork(artworkHash: string): string | null | undefined {
  return cache.get(artworkHash);
}
