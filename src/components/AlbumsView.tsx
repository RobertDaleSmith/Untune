import { useEffect, useRef, useState, useCallback } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { getAlbums } from "../lib/commands";
import { useNavigationStore } from "../stores/navigationStore";
import { useArtwork } from "../hooks/useArtwork";
import type { AlbumSummary } from "../lib/types";

const MIN_TILE_WIDTH = 140;
const GAP = 16;
const PADDING = 20;
const TEXT_HEIGHT = 44;

// Module-level cache so data survives unmount/remount
let cachedAlbums: AlbumSummary[] | null = null;

function AlbumTile({ album, width }: { album: AlbumSummary; width: number }) {
  const navigateToAlbum = useNavigationStore((s) => s.navigateToAlbum);
  const artworkUrl = useArtwork(album.artworkHash);

  return (
    <button
      onClick={() => navigateToAlbum(album.album, album.artist)}
      className="flex flex-col items-start text-left group"
      style={{ width }}
    >
      <div
        className="w-full rounded-md overflow-hidden bg-n-800 shadow-md group-hover:shadow-lg transition-shadow"
        style={{ height: width }}
      >
        {artworkUrl ? (
          <img
            src={artworkUrl}
            alt={album.album}
            className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-200"
            loading="lazy"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-n-600">
            <svg
              width="40"
              height="40"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1"
            >
              <circle cx="12" cy="12" r="10" />
              <circle cx="12" cy="12" r="3" />
            </svg>
          </div>
        )}
      </div>
      <p className="mt-1.5 text-xs font-medium text-n-200 truncate w-full group-hover:text-n-50 transition-colors">
        {album.album}
      </p>
      <p className="text-[11px] text-n-500 truncate w-full">
        {album.artist}
      </p>
    </button>
  );
}

function useContainerLayout(containerRef: React.RefObject<HTMLDivElement | null>) {
  const [layout, setLayout] = useState({ cols: 1, tileWidth: MIN_TILE_WIDTH });

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const measure = () => {
      const availableWidth = el.clientWidth - PADDING * 2 + GAP;
      const cols = Math.max(1, Math.floor(availableWidth / (MIN_TILE_WIDTH + GAP)));
      const tileWidth = Math.floor((availableWidth - GAP * cols) / cols);
      setLayout({ cols, tileWidth });
    };

    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [containerRef]);

  return layout;
}

export function AlbumsView() {
  const [albums, setAlbums] = useState<AlbumSummary[]>(cachedAlbums ?? []);
  const parentRef = useRef<HTMLDivElement>(null);
  const { cols, tileWidth } = useContainerLayout(parentRef);

  const rowCount = Math.ceil(albums.length / cols);
  const rowHeight = tileWidth + TEXT_HEIGHT + GAP;

  useEffect(() => {
    getAlbums().then((data) => {
      cachedAlbums = data;
      setAlbums(data);
    }).catch(console.error);
  }, []);

  const virtualizer = useVirtualizer({
    count: rowCount,
    getScrollElement: () => parentRef.current,
    estimateSize: useCallback(() => rowHeight, [rowHeight]),
    overscan: 3,
  });

  // Restore scroll position after albums render
  useEffect(() => {
    if (albums.length === 0) return;
    const pos = useNavigationStore.getState().getScrollPosition("albums");
    if (pos > 0 && parentRef.current) {
      parentRef.current.scrollTop = pos;
    }
  }, [albums]);

  // Save scroll position on unmount
  useEffect(() => {
    const el = parentRef.current;
    return () => {
      if (el) {
        useNavigationStore.getState().saveScrollPosition("albums", el.scrollTop);
      }
    };
  }, []);

  const virtualRows = virtualizer.getVirtualItems();

  return (
    <div ref={parentRef} className="flex-1 overflow-auto">
      <div
        style={{
          height: virtualizer.getTotalSize() + PADDING * 2,
          position: "relative",
        }}
      >
        {virtualRows.map((vRow) => {
          const startIdx = vRow.index * cols;
          const rowAlbums = albums.slice(startIdx, startIdx + cols);

          return (
            <div
              key={vRow.index}
              style={{
                position: "absolute",
                top: vRow.start + PADDING,
                left: PADDING,
                right: PADDING,
                height: rowHeight,
                display: "flex",
                gap: GAP,
              }}
            >
              {rowAlbums.map((album, i) => (
                <AlbumTile key={startIdx + i} album={album} width={tileWidth} />
              ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}
