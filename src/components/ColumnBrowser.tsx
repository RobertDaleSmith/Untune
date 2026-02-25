import { useMemo, useCallback, useRef } from "react";
import { useColumnBrowserStore } from "../stores/columnBrowserStore";
import type { Track } from "../lib/types";

interface ColumnBrowserProps {
  tracks: Track[];
}

interface ColumnListProps {
  label: string;
  items: { name: string; count: number }[];
  selected: string | null;
  onSelect: (value: string | null) => void;
}

function ColumnList({ label, items, selected, onSelect }: ColumnListProps) {
  return (
    <div className="flex-1 min-w-0 flex flex-col border-r border-n-800 last:border-r-0">
      <div className="px-2 py-1 text-[10px] font-semibold text-n-500 uppercase tracking-wider border-b border-n-800 bg-n-900/70 shrink-0">
        {label}
      </div>
      <div className="flex-1 overflow-y-auto min-h-0">
        <button
          onClick={() => onSelect(null)}
          className={`w-full text-left px-2 py-0.5 text-xs transition-colors ${
            selected == null
              ? "bg-blue-600/30 text-blue-200"
              : "text-n-300 hover:bg-n-800/50"
          }`}
        >
          All ({items.reduce((s, i) => s + i.count, 0)})
        </button>
        {items.map((item) => (
          <button
            key={item.name}
            onClick={() =>
              onSelect(item.name === selected ? null : item.name)
            }
            className={`w-full text-left px-2 py-0.5 text-xs truncate transition-colors ${
              selected === item.name
                ? "bg-blue-600/30 text-blue-200"
                : "text-n-300 hover:bg-n-800/50"
            }`}
          >
            {item.name}{" "}
            <span className="text-n-600">({item.count})</span>
          </button>
        ))}
      </div>
    </div>
  );
}

export function ColumnBrowser({ tracks }: ColumnBrowserProps) {
  const {
    visible,
    columns,
    height,
    useAlbumArtist,
    selectedGenre,
    selectedArtist,
    selectedAlbum,
    setHeight,
    setSelectedGenre,
    setSelectedArtist,
    setSelectedAlbum,
  } = useColumnBrowserStore();

  const dragging = useRef(false);
  const startY = useRef(0);
  const startH = useRef(0);

  const onResizeStart = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      dragging.current = true;
      startY.current = e.clientY;
      startH.current = height;

      const onMove = (ev: MouseEvent) => {
        if (!dragging.current) return;
        const delta = ev.clientY - startY.current;
        setHeight(startH.current + delta);
      };
      const onUp = () => {
        dragging.current = false;
        document.removeEventListener("mousemove", onMove);
        document.removeEventListener("mouseup", onUp);
      };
      document.addEventListener("mousemove", onMove);
      document.addEventListener("mouseup", onUp);
    },
    [height, setHeight],
  );

  // Build genre list from all tracks
  const genres = useMemo(() => {
    const map = new Map<string, number>();
    for (const t of tracks) {
      const g = t.genre || "(Unknown Genre)";
      map.set(g, (map.get(g) || 0) + 1);
    }
    return Array.from(map, ([name, count]) => ({ name, count })).sort(
      (a, b) => a.name.localeCompare(b.name),
    );
  }, [tracks]);

  // Filter by genre, then build artist list
  const genreFiltered = useMemo(() => {
    if (!selectedGenre) return tracks;
    return tracks.filter((t) => (t.genre || "(Unknown Genre)") === selectedGenre);
  }, [tracks, selectedGenre]);

  const artists = useMemo(() => {
    const map = new Map<string, number>();
    for (const t of genreFiltered) {
      const a = useAlbumArtist
        ? t.albumArtist || t.artist || "(Unknown Artist)"
        : t.artist || "(Unknown Artist)";
      map.set(a, (map.get(a) || 0) + 1);
    }
    return Array.from(map, ([name, count]) => ({ name, count })).sort(
      (a, b) => a.name.localeCompare(b.name),
    );
  }, [genreFiltered, useAlbumArtist]);

  // Filter by artist, then build album list
  const artistFiltered = useMemo(() => {
    if (!selectedArtist) return genreFiltered;
    return genreFiltered.filter((t) => {
      const a = useAlbumArtist
        ? t.albumArtist || t.artist || "(Unknown Artist)"
        : t.artist || "(Unknown Artist)";
      return a === selectedArtist;
    });
  }, [genreFiltered, selectedArtist, useAlbumArtist]);

  const albums = useMemo(() => {
    const map = new Map<string, number>();
    for (const t of artistFiltered) {
      const a = t.album || "(Unknown Album)";
      map.set(a, (map.get(a) || 0) + 1);
    }
    return Array.from(map, ([name, count]) => ({ name, count })).sort(
      (a, b) => a.name.localeCompare(b.name),
    );
  }, [artistFiltered]);

  return (
    <div
      className="shrink-0 relative overflow-hidden transition-[height] duration-200 ease-in-out"
      style={{ height: visible ? `${height}px` : "0px" }}
    >
      <div className="flex border-b border-n-800 bg-n-900/30 absolute inset-0">
        {columns.includes("genres") && (
          <ColumnList
            label="Genres"
            items={genres}
            selected={selectedGenre}
            onSelect={setSelectedGenre}
          />
        )}
        {columns.includes("artists") && (
          <ColumnList
            label={useAlbumArtist ? "Album Artists" : "Artists"}
            items={artists}
            selected={selectedArtist}
            onSelect={setSelectedArtist}
          />
        )}
        {columns.includes("albums") && (
          <ColumnList
            label="Albums"
            items={albums}
            selected={selectedAlbum}
            onSelect={setSelectedAlbum}
          />
        )}
      </div>
      {/* Resize handle */}
      {visible && (
        <div
          onMouseDown={onResizeStart}
          className="absolute bottom-0 left-0 right-0 h-1 cursor-row-resize z-10 hover:bg-blue-500/40 active:bg-blue-500/60 transition-colors"
        />
      )}
    </div>
  );
}
