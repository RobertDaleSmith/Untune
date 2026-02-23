import { useEffect, useState, useRef, useCallback } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { getAlbums } from "../lib/commands";
import { formatDuration } from "../utils/formatters";
import { useNavigationStore } from "../stores/navigationStore";
import type { AlbumSummary } from "../lib/types";

const ROW_HEIGHT = 32;

export function AlbumsView() {
  const [albums, setAlbums] = useState<AlbumSummary[]>([]);
  const parentRef = useRef<HTMLDivElement>(null);
  const navigateToAlbum = useNavigationStore((s) => s.navigateToAlbum);

  useEffect(() => {
    getAlbums().then(setAlbums).catch(console.error);
  }, []);

  const virtualizer = useVirtualizer({
    count: albums.length,
    getScrollElement: () => parentRef.current,
    estimateSize: useCallback(() => ROW_HEIGHT, []),
    overscan: 20,
  });

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
        <thead className="sticky top-0 z-10 bg-neutral-900">
          <tr>
            <th className="px-2 py-1 text-left font-medium text-neutral-400 border-b border-neutral-800 w-[300px]">Album</th>
            <th className="px-2 py-1 text-left font-medium text-neutral-400 border-b border-neutral-800 w-[200px]">Artist</th>
            <th className="px-2 py-1 text-left font-medium text-neutral-400 border-b border-neutral-800 w-[60px]">Tracks</th>
            <th className="px-2 py-1 text-left font-medium text-neutral-400 border-b border-neutral-800 w-[80px]">Duration</th>
            <th className="px-2 py-1 text-left font-medium text-neutral-400 border-b border-neutral-800 w-[50px]">Year</th>
          </tr>
        </thead>
        <tbody>
          {paddingTop > 0 && (
            <tr><td style={{ height: `${paddingTop}px` }} /></tr>
          )}
          {virtualRows.map((vRow) => {
            const album = albums[vRow.index];
            return (
              <tr
                key={vRow.index}
                onClick={() => navigateToAlbum(album.album, album.artist)}
                className="border-b border-neutral-900 cursor-pointer hover:bg-neutral-800/50"
                style={{ height: `${ROW_HEIGHT}px` }}
              >
                <td className="px-2 py-0 truncate text-neutral-200" style={{ maxWidth: 300 }}>{album.album}</td>
                <td className="px-2 py-0 truncate text-neutral-400" style={{ maxWidth: 200 }}>{album.artist}</td>
                <td className="px-2 py-0 text-neutral-400">{album.trackCount}</td>
                <td className="px-2 py-0 text-neutral-400">{formatDuration(album.totalDuration)}</td>
                <td className="px-2 py-0 text-neutral-400">{album.year ?? ""}</td>
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
