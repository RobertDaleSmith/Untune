import { useRef, useCallback, useState, useEffect, useLayoutEffect } from "react";
import {
  createColumnHelper,
  flexRender,
  getCoreRowModel,
  getSortedRowModel,
  useReactTable,
  type SortingState,
  type ColumnSizingState,
} from "@tanstack/react-table";
import { useVirtualizer } from "@tanstack/react-virtual";
import type { Track } from "../lib/types";
import { formatDuration, formatDate } from "../utils/formatters";
import { usePlaybackStore } from "../stores/playbackStore";
import { useLibraryStore } from "../stores/libraryStore";
import { StarRating } from "./StarRating";
import { useNavigationStore } from "../stores/navigationStore";
import { TrackInfoModal } from "./TrackInfoModal";
import { ArtworkSearchModal } from "./ArtworkSearchModal";
import { revealInFinder } from "../lib/commands";

const columnHelper = createColumnHelper<Track>();

const columns = [
  columnHelper.accessor("title", {
    header: "Title",
    size: 300,
    minSize: 60,
    cell: (info) => info.getValue(),
  }),
  columnHelper.accessor("artist", {
    header: "Artist",
    size: 200,
    minSize: 60,
    cell: (info) => info.getValue() ?? "",
  }),
  columnHelper.accessor("album", {
    header: "Album",
    size: 200,
    minSize: 60,
    cell: (info) => info.getValue() ?? "",
  }),
  columnHelper.accessor("trackNumber", {
    header: "#",
    size: 40,
    minSize: 30,
    cell: (info) => info.getValue() ?? "",
  }),
  columnHelper.accessor("trackCount", {
    header: "Of",
    size: 40,
    minSize: 30,
    cell: (info) => info.getValue() ?? "",
  }),
  columnHelper.accessor("duration", {
    header: "Time",
    size: 60,
    minSize: 40,
    cell: (info) => formatDuration(info.getValue()),
  }),
  columnHelper.accessor("playCount", {
    header: "Plays",
    size: 60,
    minSize: 40,
    cell: (info) => info.getValue() ?? 0,
  }),
  columnHelper.accessor("dateAdded", {
    header: "Date Added",
    size: 120,
    minSize: 60,
    cell: (info) => formatDate(info.getValue()),
  }),
  columnHelper.accessor("genre", {
    header: "Genre",
    size: 120,
    minSize: 40,
    cell: (info) => info.getValue() ?? "",
  }),
  columnHelper.accessor("year", {
    header: "Year",
    size: 50,
    minSize: 40,
    cell: (info) => info.getValue() ?? "",
  }),
  columnHelper.accessor("rating", {
    header: "Rating",
    size: 80,
    minSize: 60,
    cell: (info) => (
      <StarRating
        trackId={info.row.original.id}
        rating={info.getValue()}
      />
    ),
  }),
];

interface TrackTableProps {
  tracks: Track[];
  source?: string;
}

const ROW_HEIGHT = 28;

export function TrackTable({ tracks, source }: TrackTableProps) {
  const parentRef = useRef<HTMLDivElement>(null);
  const [sorting, setSorting] = useState<SortingState>([]);
  const [columnSizing, setColumnSizing] = useState<ColumnSizingState>({});
  const [selectedIndices, setSelectedIndices] = useState<Set<number>>(new Set());
  const anchorIndexRef = useRef<number | null>(null);
  const focusIndexRef = useRef<number | null>(null);
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    sortedIndex: number;
  } | null>(null);
  const contextMenuRef = useRef<HTMLDivElement>(null);
  const [infoTrackIndex, setInfoTrackIndex] = useState<number | null>(null);
  const [artworkSearchTrack, setArtworkSearchTrack] = useState<{ artist: string; album: string } | null>(null);
  const { currentTrackId, play, togglePlayPause, scrollToNowPlaying } = usePlaybackStore();
  const setSelectedTrackIds = useLibraryStore((s) => s.setSelectedTrackIds);
  const setDraggedTrackIds = useLibraryStore((s) => s.setDraggedTrackIds);
  const { navigateToAlbum, navigateToArtist } = useNavigationStore();
  const [flashTrackId, setFlashTrackId] = useState<number | null>(null);
  const typeAheadRef = useRef("");
  const typeAheadTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const table = useReactTable({
    data: tracks,
    columns,
    state: { sorting, columnSizing },
    onSortingChange: (updater) => {
      setSorting(updater);
      setSelectedIndices(new Set());
      anchorIndexRef.current = null;
      focusIndexRef.current = null;
      setSelectedTrackIds([]);
    },
    onColumnSizingChange: setColumnSizing,
    enableColumnResizing: true,
    columnResizeMode: "onChange",
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
  });

  const { rows } = table.getRowModel();

  const handleDoubleClick = useCallback(
    (sortedIndex: number) => {
      const trackIds = rows.map((r) => r.original.id);
      play(trackIds, sortedIndex, source);
    },
    [rows, play, source],
  );

  // Helper to build a range of indices (inclusive)
  const rangeSet = useCallback((a: number, b: number): Set<number> => {
    const start = Math.min(a, b);
    const end = Math.max(a, b);
    const s = new Set<number>();
    for (let i = start; i <= end; i++) s.add(i);
    return s;
  }, []);

  // Sync selection to libraryStore
  const syncSelection = useCallback(
    (indices: Set<number>) => {
      setSelectedTrackIds(
        Array.from(indices)
          .sort((a, b) => a - b)
          .map((i) => rows[i]?.original.id)
          .filter((id): id is number => id != null),
      );
    },
    [rows, setSelectedTrackIds],
  );

  const handleRowClick = useCallback(
    (sortedIndex: number, e: React.MouseEvent) => {
      setContextMenu(null);
      let next: Set<number>;

      if (e.shiftKey && anchorIndexRef.current != null) {
        // Shift+click: range select from anchor
        next = rangeSet(anchorIndexRef.current, sortedIndex);
      } else if (e.metaKey || e.ctrlKey) {
        // Cmd/Ctrl+click: toggle individual row
        next = new Set(selectedIndices);
        if (next.has(sortedIndex)) {
          next.delete(sortedIndex);
        } else {
          next.add(sortedIndex);
        }
        anchorIndexRef.current = sortedIndex;
      } else {
        // Plain click: select single
        next = new Set([sortedIndex]);
        anchorIndexRef.current = sortedIndex;
      }

      focusIndexRef.current = sortedIndex;
      setSelectedIndices(next);
      syncSelection(next);
    },
    [selectedIndices, rangeSet, syncSelection],
  );

  const handleContextMenu = useCallback(
    (e: React.MouseEvent, sortedIndex: number) => {
      e.preventDefault();
      // If right-clicking an already-selected row, keep the selection
      if (!selectedIndices.has(sortedIndex)) {
        const next = new Set([sortedIndex]);
        anchorIndexRef.current = sortedIndex;
        focusIndexRef.current = sortedIndex;
        setSelectedIndices(next);
        syncSelection(next);
      }
      setContextMenu({ x: e.clientX, y: e.clientY, sortedIndex });
    },
    [selectedIndices, syncSelection],
  );

  const handleDragStart = useCallback(
    (e: React.DragEvent, sortedIndex: number) => {
      // If dragging an unselected row, select just that row
      let ids: number[];
      if (!selectedIndices.has(sortedIndex)) {
        const next = new Set([sortedIndex]);
        setSelectedIndices(next);
        syncSelection(next);
        ids = [rows[sortedIndex]?.original.id].filter((id): id is number => id != null);
      } else {
        ids = Array.from(selectedIndices)
          .sort((a, b) => a - b)
          .map((i) => rows[i]?.original.id)
          .filter((id): id is number => id != null);
      }
      setDraggedTrackIds(ids);
      e.dataTransfer.setData("text/plain", `tracks:${ids.length}`);
      e.dataTransfer.effectAllowed = "copy";

      // Create a custom drag image showing the count
      const ghost = document.createElement("div");
      ghost.textContent = `${ids.length} track${ids.length > 1 ? "s" : ""}`;
      ghost.style.cssText = "position:fixed;top:-100px;left:-100px;padding:4px 12px;background:#333;color:#fff;border-radius:6px;font-size:12px;white-space:nowrap;";
      document.body.appendChild(ghost);
      e.dataTransfer.setDragImage(ghost, 0, 0);
      setTimeout(() => document.body.removeChild(ghost), 0);
    },
    [selectedIndices, rows, syncSelection, setDraggedTrackIds],
  );

  const handleDragEnd = useCallback(() => {
    setDraggedTrackIds([]);
  }, [setDraggedTrackIds]);

  // Reposition context menu if it overflows the viewport
  useLayoutEffect(() => {
    if (!contextMenu || !contextMenuRef.current) return;
    const el = contextMenuRef.current;
    const rect = el.getBoundingClientRect();
    let { x, y } = contextMenu;
    if (rect.bottom > window.innerHeight) {
      y = window.innerHeight - rect.height - 4;
    }
    if (rect.right > window.innerWidth) {
      x = window.innerWidth - rect.width - 4;
    }
    if (x !== contextMenu.x || y !== contextMenu.y) {
      el.style.left = `${x}px`;
      el.style.top = `${y}px`;
    }
  }, [contextMenu]);

  // Close context menu on any click or scroll
  useEffect(() => {
    if (!contextMenu) return;
    const close = () => setContextMenu(null);
    document.addEventListener("click", close);
    document.addEventListener("scroll", close, true);
    return () => {
      document.removeEventListener("click", close);
      document.removeEventListener("scroll", close, true);
    };
  }, [contextMenu]);

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: useCallback(() => ROW_HEIGHT, []),
    overscan: 100,
    scrollPaddingStart: ROW_HEIGHT,
    scrollPaddingEnd: ROW_HEIGHT,
  });

  // Auto-scroll to the playing track when it changes.
  // Use virtualizer.scrollToIndex for instant, flicker-free scrolling.
  // A single rAF fallback handles the edge case where the PlaybackBar
  // appears/disappears and changes the container height.
  useEffect(() => {
    if (currentTrackId == null) return;
    const idx = rows.findIndex((r) => r.original.id === currentTrackId);
    if (idx < 0) return;

    // Immediate scroll — virtualizer pre-computes visible rows synchronously
    virtualizer.scrollToIndex(idx, { align: "auto" });

    // Follow-up rAF to correct for any layout shift (e.g. PlaybackBar appearing)
    const frame = requestAnimationFrame(() => {
      virtualizer.scrollToIndex(idx, { align: "auto" });
    });
    return () => cancelAnimationFrame(frame);
  }, [currentTrackId, rows, scrollToNowPlaying, virtualizer]);

  // Flash the playing row when jump-to-now-playing is triggered
  const prevScrollSignal = useRef(scrollToNowPlaying);
  useEffect(() => {
    if (scrollToNowPlaying === prevScrollSignal.current) return;
    prevScrollSignal.current = scrollToNowPlaying;
    if (currentTrackId == null) return;
    setFlashTrackId(currentTrackId);
    const timer = setTimeout(() => setFlashTrackId(null), 900);
    return () => clearTimeout(timer);
  }, [scrollToNowPlaying, currentTrackId]);

  // Reset selection when tracks change
  useEffect(() => {
    setSelectedIndices(new Set());
    anchorIndexRef.current = null;
    focusIndexRef.current = null;
    setSelectedTrackIds([]);
  }, [tracks, setSelectedTrackIds]);

  // Determine which text field to use for type-ahead based on sort column
  const TEXT_COLUMNS = new Set(["title", "artist", "album", "genre"]);
  const typeAheadField = (
    sorting.length > 0 && TEXT_COLUMNS.has(sorting[0].id)
      ? sorting[0].id
      : "title"
  ) as keyof Track;

  // Helper to select a single index (used by keyboard and type-ahead)
  const selectSingle = useCallback(
    (idx: number) => {
      const next = new Set([idx]);
      anchorIndexRef.current = idx;
      focusIndexRef.current = idx;
      setSelectedIndices(next);
      syncSelection(next);
    },
    [syncSelection],
  );

  // Keyboard handler
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (rows.length === 0) return;

      switch (e.key) {
        case " ": {
          if (typeAheadRef.current) {
            // Mid-type-ahead: treat space as part of the query
            e.preventDefault();
            if (typeAheadTimerRef.current) clearTimeout(typeAheadTimerRef.current);
            typeAheadRef.current += " ";
            const query = typeAheadRef.current.toLowerCase();
            const idx = rows.findIndex((r) => {
              const val = r.original[typeAheadField];
              return val != null && String(val).toLowerCase().startsWith(query);
            });
            if (idx >= 0) {
              selectSingle(idx);
              virtualizer.scrollToOffset(idx * ROW_HEIGHT, { align: "start" });
            }
            typeAheadTimerRef.current = setTimeout(() => {
              typeAheadRef.current = "";
            }, 800);
          } else {
            e.preventDefault();
            togglePlayPause();
          }
          break;
        }
        case "ArrowDown": {
          e.preventDefault();
          const curFocus = focusIndexRef.current;
          const nextIdx = curFocus == null ? 0 : Math.min(curFocus + 1, rows.length - 1);
          if (e.shiftKey && anchorIndexRef.current != null) {
            const next = rangeSet(anchorIndexRef.current, nextIdx);
            focusIndexRef.current = nextIdx;
            setSelectedIndices(next);
            syncSelection(next);
          } else {
            selectSingle(nextIdx);
          }
          virtualizer.scrollToIndex(nextIdx, { align: "auto" });
          break;
        }
        case "ArrowUp": {
          e.preventDefault();
          const curFocus = focusIndexRef.current;
          const nextIdx = curFocus == null ? 0 : Math.max(curFocus - 1, 0);
          if (e.shiftKey && anchorIndexRef.current != null) {
            const next = rangeSet(anchorIndexRef.current, nextIdx);
            focusIndexRef.current = nextIdx;
            setSelectedIndices(next);
            syncSelection(next);
          } else {
            selectSingle(nextIdx);
          }
          virtualizer.scrollToIndex(nextIdx, { align: "auto" });
          break;
        }
        case "Enter": {
          const fi = focusIndexRef.current;
          if (fi != null) {
            e.preventDefault();
            handleDoubleClick(fi);
          }
          break;
        }
        case "Escape":
        case "Tab":
        case "Shift":
        case "Control":
        case "Alt":
        case "Meta":
          break;
        default: {
          // Cmd+A: Select all
          if ((e.metaKey || e.ctrlKey) && e.key === "a") {
            e.preventDefault();
            const all = new Set(rows.map((_: unknown, i: number) => i));
            anchorIndexRef.current = 0;
            focusIndexRef.current = rows.length - 1;
            setSelectedIndices(all);
            syncSelection(all);
            break;
          }
          // Cmd+I: Get Info for focused track
          if (e.metaKey && e.key === "i" && focusIndexRef.current != null) {
            e.preventDefault();
            setInfoTrackIndex(focusIndexRef.current);
            break;
          }
          // Type-ahead: skip if modifier keys held (except shift for capitals)
          if (e.ctrlKey || e.metaKey || e.altKey) break;
          if (e.key.length !== 1) break;

          e.preventDefault();
          if (typeAheadTimerRef.current) clearTimeout(typeAheadTimerRef.current);
          typeAheadRef.current += e.key;
          const query = typeAheadRef.current.toLowerCase();

          const idx = rows.findIndex((r) => {
            const val = r.original[typeAheadField];
            return val != null && String(val).toLowerCase().startsWith(query);
          });

          if (idx >= 0) {
            selectSingle(idx);
            virtualizer.scrollToOffset(idx * ROW_HEIGHT, { align: "start" });
          }

          typeAheadTimerRef.current = setTimeout(() => {
            typeAheadRef.current = "";
          }, 800);
          break;
        }
      }
    },
    [rows, togglePlayPause, handleDoubleClick, virtualizer, typeAheadField, selectSingle, rangeSet, syncSelection],
  );

  const virtualRows = virtualizer.getVirtualItems();
  const totalSize = virtualizer.getTotalSize();

  const paddingTop = virtualRows.length > 0 ? virtualRows[0].start : 0;
  const paddingBottom =
    virtualRows.length > 0
      ? totalSize - virtualRows[virtualRows.length - 1].end
      : 0;

  return (
    <div
      ref={parentRef}
      className="flex-1 overflow-auto outline-none"
      tabIndex={0}
      onKeyDown={handleKeyDown}
    >
      <table className="w-full border-collapse text-xs">
        <thead className="sticky top-0 z-10 bg-n-900/70 backdrop-blur-xl">
          {table.getHeaderGroups().map((headerGroup) => (
            <tr key={headerGroup.id}>
              {headerGroup.headers.map((header) => (
                <th
                  key={header.id}
                  className="relative px-2 py-1 text-left font-medium text-n-400 border-b border-n-800 cursor-pointer select-none hover:text-n-200"
                  style={{ width: header.getSize() }}
                  onClick={header.column.getToggleSortingHandler()}
                >
                  <div className="flex items-center gap-1">
                    {flexRender(
                      header.column.columnDef.header,
                      header.getContext(),
                    )}
                    {{
                      asc: " ↑",
                      desc: " ↓",
                    }[header.column.getIsSorted() as string] ?? ""}
                  </div>
                  {header.column.getCanResize() && (
                    <div
                      onMouseDown={header.getResizeHandler()}
                      onTouchStart={header.getResizeHandler()}
                      onClick={(e) => e.stopPropagation()}
                      className={`absolute right-0 top-0 h-full w-1 cursor-col-resize select-none touch-none hover:bg-accent ${
                        header.column.getIsResizing() ? "bg-accent" : ""
                      }`}
                    />
                  )}
                </th>
              ))}
            </tr>
          ))}
        </thead>
        <tbody>
          {paddingTop > 0 && (
            <tr>
              <td style={{ height: `${paddingTop}px` }} />
            </tr>
          )}
          {virtualRows.map((virtualRow) => {
            const row = rows[virtualRow.index];
            const isCurrentTrack = row.original.id === currentTrackId;
            const isFlashing = row.original.id === flashTrackId;
            const isSelected = selectedIndices.has(virtualRow.index);
            const noFile = !row.original.filePath;
            return (
              <tr
                key={row.id}
                draggable
                onDragStart={(e) => handleDragStart(e, virtualRow.index)}
                onDragEnd={handleDragEnd}
                onClick={(e) => handleRowClick(virtualRow.index, e)}
                onDoubleClick={() => handleDoubleClick(virtualRow.index)}
                onContextMenu={(e) => handleContextMenu(e, virtualRow.index)}
                className={`border-b border-n-800/30 cursor-default ${
                  isCurrentTrack
                    ? `bg-accent-row hover:bg-accent-row-hover${isFlashing ? " animate-row-flash" : ""}`
                    : isSelected
                      ? "bg-accent/15"
                      : "hover:bg-n-800/50"
                }${isSelected ? " ring-1 ring-accent/30" : ""}`}
                style={{ height: `${ROW_HEIGHT}px` }}
              >
                {row.getVisibleCells().map((cell) => (
                  <td
                    key={cell.id}
                    className={`px-2 py-0 truncate ${noFile ? "text-n-400" : "text-n-300"}`}
                    style={{
                      width: cell.column.getSize(),
                      maxWidth: cell.column.getSize(),
                    }}
                  >
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </td>
                ))}
              </tr>
            );
          })}
          {paddingBottom > 0 && (
            <tr>
              <td style={{ height: `${paddingBottom}px` }} />
            </tr>
          )}
        </tbody>
      </table>

      {/* Context menu */}
      {contextMenu && (() => {
        const track = rows[contextMenu.sortedIndex]?.original;
        if (!track) return null;
        const isPlaying = track.id === currentTrackId;
        return (
          <div
            ref={contextMenuRef}
            className="fixed z-50 min-w-[160px] py-1 bg-n-800 border border-n-700 rounded-lg shadow-xl text-xs"
            style={{ left: contextMenu.x, top: contextMenu.y }}
          >
            <button
              className="w-full text-left px-3 py-1.5 text-n-200 hover:bg-n-700"
              onClick={() => {
                handleDoubleClick(contextMenu.sortedIndex);
                setContextMenu(null);
              }}
            >
              {isPlaying ? "Restart" : "Play"}
            </button>
            <button
              className="w-full text-left px-3 py-1.5 text-n-200 hover:bg-n-700"
              onClick={() => {
                const trackIds = rows.map((r) => r.original.id);
                play(trackIds, contextMenu.sortedIndex, source);
                setContextMenu(null);
              }}
            >
              Play from Here
            </button>
            <div className="my-1 border-t border-n-700" />
            <button
              className="w-full text-left px-3 py-1.5 text-n-200 hover:bg-n-700"
              onClick={() => {
                setInfoTrackIndex(contextMenu.sortedIndex);
                setContextMenu(null);
              }}
            >
              Get Info
            </button>
            {track.filePath && (
              <button
                className="w-full text-left px-3 py-1.5 text-n-200 hover:bg-n-700"
                onClick={() => {
                  revealInFinder(track.filePath!);
                  setContextMenu(null);
                }}
              >
                {navigator.platform.startsWith("Win") ? "Show in Explorer" : "Show in Finder"}
              </button>
            )}
            {(track.album || track.artist) && (
              <button
                className="w-full text-left px-3 py-1.5 text-n-200 hover:bg-n-700"
                onClick={() => {
                  setArtworkSearchTrack({
                    artist: track.albumArtist ?? track.artist ?? "",
                    album: track.album ?? "",
                  });
                  setContextMenu(null);
                }}
              >
                Find Album Artwork...
              </button>
            )}
            {(track.album || track.artist) && (
              <>
                <div className="my-1 border-t border-n-700" />
                {track.album && (
                  <button
                    className="w-full text-left px-3 py-1.5 text-n-200 hover:bg-n-700"
                    onClick={() => {
                      navigateToAlbum(track.album!, track.artist ?? null);
                      setContextMenu(null);
                    }}
                  >
                    Go to Album
                  </button>
                )}
                {track.artist && (
                  <button
                    className="w-full text-left px-3 py-1.5 text-n-200 hover:bg-n-700"
                    onClick={() => {
                      navigateToArtist(track.artist!);
                      setContextMenu(null);
                    }}
                  >
                    Go to Artist
                  </button>
                )}
              </>
            )}
          </div>
        );
      })()}

      {/* Get Info modal */}
      {infoTrackIndex != null && rows[infoTrackIndex] && (
        <TrackInfoModal
          track={rows[infoTrackIndex].original}
          onClose={() => setInfoTrackIndex(null)}
          onPrev={
            infoTrackIndex > 0
              ? () => setInfoTrackIndex(infoTrackIndex - 1)
              : undefined
          }
          onNext={
            infoTrackIndex < rows.length - 1
              ? () => setInfoTrackIndex(infoTrackIndex + 1)
              : undefined
          }
        />
      )}

      {/* Artwork search modal */}
      {artworkSearchTrack && (
        <ArtworkSearchModal
          artist={artworkSearchTrack.artist}
          album={artworkSearchTrack.album}
          onClose={() => setArtworkSearchTrack(null)}
          onApply={(result) => {
            const store = useLibraryStore.getState();
            const idSet = new Set(result.updatedTrackIds);
            store.setTracks(
              store.tracks.map((t) =>
                idSet.has(t.id)
                  ? { ...t, artworkHash: result.artworkHash }
                  : t,
              ),
            );
            setArtworkSearchTrack(null);
          }}
        />
      )}
    </div>
  );
}
