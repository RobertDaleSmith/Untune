import { getArtworkDataUrl } from "./commands";

const MAX_CONCURRENT = 6;
let active = 0;
const queue: Array<{ hash: string; resolve: (v: string | null) => void; reject: (e: unknown) => void }> = [];

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
  return new Promise((resolve, reject) => {
    queue.push({ hash: artworkHash, resolve, reject });
    flush();
  });
}
