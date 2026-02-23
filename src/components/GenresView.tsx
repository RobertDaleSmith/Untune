import { useEffect, useState, useRef, useCallback } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { getGenres } from "../lib/commands";
import { useNavigationStore } from "../stores/navigationStore";
import type { GenreSummary } from "../lib/types";

const ROW_HEIGHT = 32;

export function GenresView() {
  const [genres, setGenres] = useState<GenreSummary[]>([]);
  const parentRef = useRef<HTMLDivElement>(null);
  const navigateToGenre = useNavigationStore((s) => s.navigateToGenre);

  useEffect(() => {
    getGenres().then(setGenres).catch(console.error);
  }, []);

  const virtualizer = useVirtualizer({
    count: genres.length,
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
            <th className="px-2 py-1 text-left font-medium text-neutral-400 border-b border-neutral-800 w-[300px]">Genre</th>
            <th className="px-2 py-1 text-left font-medium text-neutral-400 border-b border-neutral-800 w-[80px]">Tracks</th>
          </tr>
        </thead>
        <tbody>
          {paddingTop > 0 && (
            <tr><td style={{ height: `${paddingTop}px` }} /></tr>
          )}
          {virtualRows.map((vRow) => {
            const genre = genres[vRow.index];
            return (
              <tr
                key={vRow.index}
                onClick={() => navigateToGenre(genre.name)}
                className="border-b border-neutral-900 cursor-pointer hover:bg-neutral-800/50"
                style={{ height: `${ROW_HEIGHT}px` }}
              >
                <td className="px-2 py-0 truncate text-neutral-200" style={{ maxWidth: 300 }}>{genre.name}</td>
                <td className="px-2 py-0 text-neutral-400">{genre.trackCount}</td>
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
