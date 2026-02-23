import { useRef, useCallback, useState } from "react";
import {
  createColumnHelper,
  flexRender,
  getCoreRowModel,
  getSortedRowModel,
  useReactTable,
  type SortingState,
} from "@tanstack/react-table";
import { useVirtualizer } from "@tanstack/react-virtual";
import type { Track } from "../lib/types";
import { formatDuration, formatDate } from "../utils/formatters";

const columnHelper = createColumnHelper<Track>();

const columns = [
  columnHelper.accessor("title", {
    header: "Title",
    size: 300,
    cell: (info) => info.getValue(),
  }),
  columnHelper.accessor("artist", {
    header: "Artist",
    size: 200,
    cell: (info) => info.getValue() ?? "",
  }),
  columnHelper.accessor("album", {
    header: "Album",
    size: 200,
    cell: (info) => info.getValue() ?? "",
  }),
  columnHelper.accessor("duration", {
    header: "Time",
    size: 60,
    cell: (info) => formatDuration(info.getValue()),
  }),
  columnHelper.accessor("playCount", {
    header: "Plays",
    size: 60,
    cell: (info) => info.getValue() ?? 0,
  }),
  columnHelper.accessor("dateAdded", {
    header: "Date Added",
    size: 120,
    cell: (info) => formatDate(info.getValue()),
  }),
  columnHelper.accessor("genre", {
    header: "Genre",
    size: 120,
    cell: (info) => info.getValue() ?? "",
  }),
  columnHelper.accessor("year", {
    header: "Year",
    size: 50,
    cell: (info) => info.getValue() ?? "",
  }),
  columnHelper.accessor("rating", {
    header: "Rating",
    size: 50,
    cell: (info) => {
      const val = info.getValue();
      if (!val) return "";
      return "★".repeat(Math.round(val / 20));
    },
  }),
];

interface TrackTableProps {
  tracks: Track[];
}

const ROW_HEIGHT = 28;

export function TrackTable({ tracks }: TrackTableProps) {
  const parentRef = useRef<HTMLDivElement>(null);
  const [sorting, setSorting] = useState<SortingState>([]);

  const table = useReactTable({
    data: tracks,
    columns,
    state: { sorting },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
  });

  const { rows } = table.getRowModel();

  const virtualizer = useVirtualizer({
    count: rows.length,
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
          {table.getHeaderGroups().map((headerGroup) => (
            <tr key={headerGroup.id}>
              {headerGroup.headers.map((header) => (
                <th
                  key={header.id}
                  className="px-2 py-1 text-left font-medium text-neutral-400 border-b border-neutral-800 cursor-pointer select-none hover:text-neutral-200"
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
            return (
              <tr
                key={row.id}
                className="hover:bg-neutral-800/50 border-b border-neutral-900"
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
    </div>
  );
}
