import { useEffect, useState, useRef, useCallback } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { getArtists } from "../lib/commands";
import { useNavigationStore } from "../stores/navigationStore";
import type { ArtistSummary } from "../lib/types";

const ROW_HEIGHT = 32;

let cachedArtists: ArtistSummary[] | null = null;

export function ArtistsView() {
  const [artists, setArtists] = useState<ArtistSummary[]>(cachedArtists ?? []);
  const parentRef = useRef<HTMLDivElement>(null);
  const navigateToArtist = useNavigationStore((s) => s.navigateToArtist);

  useEffect(() => {
    getArtists().then((data) => {
      cachedArtists = data;
      setArtists(data);
    }).catch(console.error);
  }, []);

  const virtualizer = useVirtualizer({
    count: artists.length,
    getScrollElement: () => parentRef.current,
    estimateSize: useCallback(() => ROW_HEIGHT, []),
    overscan: 20,
  });

  // Restore scroll position after data loads
  useEffect(() => {
    if (artists.length === 0) return;
    const pos = useNavigationStore.getState().getScrollPosition("artists");
    if (pos > 0 && parentRef.current) {
      parentRef.current.scrollTop = pos;
    }
  }, [artists]);

  // Save scroll position on unmount
  useEffect(() => {
    const el = parentRef.current;
    return () => {
      if (el) {
        useNavigationStore.getState().saveScrollPosition("artists", el.scrollTop);
      }
    };
  }, []);

  const virtualRows = virtualizer.getVirtualItems();
  const totalSize = virtualizer.getTotalSize();
  const paddingTop = virtualRows.length > 0 ? virtualRows[0].start : 0;
  const paddingBottom =
    virtualRows.length > 0
      ? totalSize - virtualRows[virtualRows.length - 1].end
      : 0;

  return (
    <div ref={parentRef} className="flex-1 overflow-auto">
      <table className="w-full border-collapse text-xs">
        <thead className="sticky top-0 z-10 bg-n-900/70 backdrop-blur-xl">
          <tr>
            <th className="px-2 py-1 text-left font-medium text-n-400 border-b border-n-800 w-[300px]">Artist</th>
            <th className="px-2 py-1 text-left font-medium text-n-400 border-b border-n-800 w-[80px]">Albums</th>
            <th className="px-2 py-1 text-left font-medium text-n-400 border-b border-n-800 w-[80px]">Tracks</th>
          </tr>
        </thead>
        <tbody>
          {paddingTop > 0 && (
            <tr><td style={{ height: `${paddingTop}px` }} /></tr>
          )}
          {virtualRows.map((vRow) => {
            const artist = artists[vRow.index];
            return (
              <tr
                key={vRow.index}
                onClick={() => navigateToArtist(artist.name)}
                className="border-b border-n-900 cursor-pointer hover:bg-n-800/50"
                style={{ height: `${ROW_HEIGHT}px` }}
              >
                <td className="px-2 py-0 truncate text-n-200" style={{ maxWidth: 300 }}>{artist.name}</td>
                <td className="px-2 py-0 text-n-400">{artist.albumCount}</td>
                <td className="px-2 py-0 text-n-400">{artist.trackCount}</td>
              </tr>
            );
          })}
          {paddingBottom > 0 && (
            <tr><td style={{ height: `${paddingBottom}px` }} /></tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
