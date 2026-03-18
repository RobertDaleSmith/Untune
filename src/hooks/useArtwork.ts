import { useEffect, useState } from "react";
import { fetchArtwork, getCachedArtwork } from "../lib/artworkQueue";

export function useArtwork(artworkHash: string | null): string | null {
  const [url, setUrl] = useState<string | null>(
    artworkHash ? (getCachedArtwork(artworkHash) ?? null) : null,
  );

  useEffect(() => {
    if (!artworkHash) {
      setUrl(null);
      return;
    }

    // Already cached
    const cached = getCachedArtwork(artworkHash);
    if (cached !== undefined) {
      setUrl(cached);
      return;
    }

    let cancelled = false;
    fetchArtwork(artworkHash).then((result) => {
      if (!cancelled) setUrl(result);
    });
    return () => { cancelled = true; };
  }, [artworkHash]);

  return url;
}
