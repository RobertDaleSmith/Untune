import { formatTotalDuration, formatNumber, formatFileSize } from "../utils/formatters";
import { useDragRegion } from "../hooks/useDragRegion";
import { useLibraryStore } from "../stores/libraryStore";

export function StatusBar() {
  const onDrag = useDragRegion();
  const tracks = useLibraryStore((s) => s.statusBarTracks);
  const totalDuration = tracks.reduce(
    (sum, t) => sum + (t.duration ?? 0),
    0,
  );
  const totalSize = tracks.reduce(
    (sum, t) => sum + (t.size ?? 0),
    0,
  );

  return (
    <div onMouseDown={onDrag} className="flex items-center justify-center gap-3 px-3 py-2 bg-n-900/50 border-t border-n-800 text-xs text-n-500">
      <span>{formatNumber(tracks.length)} songs, {formatTotalDuration(totalDuration)}, {formatFileSize(totalSize)}</span>
    </div>
  );
}
