import { useRef, useCallback, useState, useEffect } from "react";
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
    cell: (info) => {
      const val = info.getValue();
      if (!val) return "";
      return "★".repeat(Math.round(val / 20));
    },
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
  const [selectedRowIndex, setSelectedRowIndex] = useState<number | null>(null);
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    sortedIndex: number;
  } | null>(null);
  const { currentTrackId, play, togglePlayPause } = usePlaybackStore();

  const table = useReactTable({
    data: tracks,
    columns,
    state: { sorting, columnSizing },
    onSortingChange: (updater) => {
      setSorting(updater);
      setSelectedRowIndex(null);
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

  const handleRowClick = useCallback((sortedIndex: number) => {
    setSelectedRowIndex(sortedIndex);
    setContextMenu(null);
  }, []);

  const handleContextMenu = useCallback(
    (e: React.MouseEvent, sortedIndex: number) => {
      e.preventDefault();
      setSelectedRowIndex(sortedIndex);
      setContextMenu({ x: e.clientX, y: e.clientY, sortedIndex });
    },
    [],
  );

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
    overscan: 20,
  });

  // Auto-scroll to the playing track when it changes — scroll just enough to
  // bring the row into view. Double-rAF so layout has settled after the
  // PlaybackBar appears/disappears and clientHeight is accurate.
  useEffect(() => {
    if (currentTrackId == null) return;
    const idx = rows.findIndex((r) => r.original.id === currentTrackId);
    if (idx < 0) return;

    // Double rAF: first frame triggers layout, second reads correct dimensions
    const frame = requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        const el = parentRef.current;
        if (!el) return;

        // The sticky thead overlaps the top of the scroll area, so the
        // visible content region is offset by the header height.
        const thead = el.querySelector("thead");
        const headerH = thead ? thead.getBoundingClientRect().height : 0;

        // Row positions in the scrollable content (tbody starts after thead in flow)
        const contentTop = headerH + idx * ROW_HEIGHT;
        const contentBottom = contentTop + ROW_HEIGHT;

        // Visible region within the scroll container
        const visibleTop = el.scrollTop + headerH;
        const visibleBottom = el.scrollTop + el.clientHeight;

        if (contentTop < visibleTop) {
          // Row is above — place it right below the sticky header
          el.scrollTop = contentTop - headerH;
        } else if (contentBottom > visibleBottom) {
          // Row is below — place it flush with the bottom
          el.scrollTop = contentBottom - el.clientHeight;
        }
      });
    });
    return () => cancelAnimationFrame(frame);
  }, [currentTrackId, rows]);

  // Reset selection when tracks change
  useEffect(() => {
    setSelectedRowIndex(null);
  }, [tracks]);

  // Keyboard handler
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (rows.length === 0) return;

      switch (e.key) {
        case " ": {
          e.preventDefault();
          togglePlayPause();
          break;
        }
        case "ArrowDown": {
          e.preventDefault();
          setSelectedRowIndex((prev) => {
            const next = prev == null ? 0 : Math.min(prev + 1, rows.length - 1);
            virtualizer.scrollToIndex(next, { align: "auto" });
            return next;
          });
          break;
        }
        case "ArrowUp": {
          e.preventDefault();
          setSelectedRowIndex((prev) => {
            const next = prev == null ? 0 : Math.max(prev - 1, 0);
            virtualizer.scrollToIndex(next, { align: "auto" });
            return next;
          });
          break;
        }
        case "Enter": {
          if (selectedRowIndex != null) {
            e.preventDefault();
            handleDoubleClick(selectedRowIndex);
          }
          break;
        }
      }
    },
    [rows.length, togglePlayPause, selectedRowIndex, handleDoubleClick, virtualizer],
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
        <thead className="sticky top-0 z-10 bg-neutral-900">
          {table.getHeaderGroups().map((headerGroup) => (
            <tr key={headerGroup.id}>
              {headerGroup.headers.map((header) => (
                <th
                  key={header.id}
                  className="relative px-2 py-1 text-left font-medium text-neutral-400 border-b border-neutral-800 cursor-pointer select-none hover:text-neutral-200"
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
                      className={`absolute right-0 top-0 h-full w-1 cursor-col-resize select-none touch-none hover:bg-blue-500 ${
                        header.column.getIsResizing() ? "bg-blue-500" : ""
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
            const isSelected = virtualRow.index === selectedRowIndex;
            return (
              <tr
                key={row.id}
                onClick={() => handleRowClick(virtualRow.index)}
                onDoubleClick={() => handleDoubleClick(virtualRow.index)}
                onContextMenu={(e) => handleContextMenu(e, virtualRow.index)}
                className={`border-b border-neutral-900 cursor-default ${
                  isCurrentTrack
                    ? "bg-blue-950/60 hover:bg-blue-900/50"
                    : isSelected
                      ? "bg-neutral-800/70"
                      : "hover:bg-neutral-800/50"
                }${isSelected ? " ring-1 ring-neutral-600" : ""}`}
                style={{ height: `${ROW_HEIGHT}px` }}
              >
                {row.getVisibleCells().map((cell) => (
                  <td
                    key={cell.id}
                    className="px-2 py-0 truncate text-neutral-300"
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
            className="fixed z-50 min-w-[160px] py-1 bg-neutral-800 border border-neutral-700 rounded-lg shadow-xl text-xs"
            style={{ left: contextMenu.x, top: contextMenu.y }}
          >
            <button
              className="w-full text-left px-3 py-1.5 text-neutral-200 hover:bg-neutral-700"
              onClick={() => {
                handleDoubleClick(contextMenu.sortedIndex);
                setContextMenu(null);
              }}
            >
              {isPlaying ? "Restart" : "Play"}
            </button>
            <button
              className="w-full text-left px-3 py-1.5 text-neutral-200 hover:bg-neutral-700"
              onClick={() => {
                const trackIds = rows.map((r) => r.original.id);
                play(trackIds, contextMenu.sortedIndex, source);
                setContextMenu(null);
              }}
            >
              Play from Here
            </button>
            <div className="my-1 border-t border-neutral-700" />
            <div className="px-3 py-1.5 text-neutral-500">
              {track.artist && <div>{track.artist}</div>}
              {track.album && <div>{track.album}</div>}
              {track.duration != null && <div>{formatDuration(track.duration)}</div>}
            </div>
          </div>
        );
      })()}
    </div>
  );
}
