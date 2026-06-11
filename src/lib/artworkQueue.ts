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

export function fetchArtwork(
  artworkHash: string,
  opts?: { priority?: boolean },
): Promise<string | null> {
  // Return from cache immediately
  if (cache.has(artworkHash)) {
    return Promise.resolve(cache.get(artworkHash) ?? null);
  }

  // Deduplicate in-flight requests — a priority caller still piggybacks on an
  // already-running fetch instead of starting a second one.
  const existing = inflight.get(artworkHash);
  if (existing) return existing;

  // Priority requests (now-playing artwork) bypass the queue entirely so they
  // can't get stuck behind a wave of TrackTable/AlbumsView tile fetches. The
  // backend handles the extra concurrent request fine, and tile fetches keep
  // their MAX_CONCURRENT cap.
  if (opts?.priority) {
    const p = getArtworkDataUrl(artworkHash)
      .then((url) => {
        cache.set(artworkHash, url ?? null);
        inflight.delete(artworkHash);
        return url ?? null;
      })
      .catch(() => {
        cache.set(artworkHash, null);
        inflight.delete(artworkHash);
        return null;
      });
    inflight.set(artworkHash, p);
    return p;
  }

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
