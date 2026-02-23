import { formatTotalDuration, formatNumber } from "../utils/formatters";
import type { Track } from "../lib/types";

interface StatusBarProps {
  tracks: Track[];
}

export function StatusBar({ tracks }: StatusBarProps) {
  const totalDuration = tracks.reduce(
    (sum, t) => sum + (t.duration ?? 0),
    0,
  );

  return (
    <div className="flex items-center justify-between px-3 py-1 bg-neutral-900 border-t border-neutral-800 text-xs text-neutral-500">
      <span>
        {formatNumber(tracks.length)} tracks
      </span>
      <span>{formatTotalDuration(totalDuration)}</span>
    </div>
  );
}
