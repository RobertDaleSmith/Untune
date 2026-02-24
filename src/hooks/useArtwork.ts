import { useEffect, useState } from "react";
import { fetchArtwork } from "../lib/artworkQueue";

// Module-level cache shared across all hook instances
const cache = new Map<string, string | null>();
const pending = new Map<string, Promise<string | null>>();

export function useArtwork(artworkHash: string | null): string | null {
  const [url, setUrl] = useState<string | null>(
    artworkHash ? (cache.get(artworkHash) ?? null) : null,
  );

  useEffect(() => {
    if (!artworkHash) {
      setUrl(null);
      return;
    }

    // Already cached
    if (cache.has(artworkHash)) {
      setUrl(cache.get(artworkHash) ?? null);
      return;
    }

    // Deduplicate in-flight requests
    let p = pending.get(artworkHash);
    if (!p) {
      p = fetchArtwork(artworkHash).then((result) => {
        cache.set(artworkHash, result);
        pending.delete(artworkHash);
        return result;
      }).catch(() => {
        cache.set(artworkHash, null);
        pending.delete(artworkHash);
        return null;
      });
      pending.set(artworkHash, p);
    }

    let cancelled = false;
    p.then((result) => {
      if (!cancelled) setUrl(result);
    });
    return () => { cancelled = true; };
  }, [artworkHash]);

  return url;
}
