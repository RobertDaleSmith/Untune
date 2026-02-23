import { useCallback, useEffect, useRef, useState } from "react";
import { usePlaybackStore } from "../stores/playbackStore";
import { formatDuration } from "../utils/formatters";
import type { Track } from "../lib/types";

interface PlaybackBarProps {
  tracks: Track[];
}

export function PlaybackBar({ tracks }: PlaybackBarProps) {
  const {
    currentTrackId,
    isPlaying,
    position,
    duration,
    volume,
    togglePlayPause,
    next,
    prev,
    seek,
    setVolume,
    shuffle,
    toggleShuffle,
    repeatMode,
    cycleRepeat,
  } = usePlaybackStore();

  const progressRef = useRef<HTMLDivElement>(null);
  const isDraggingRef = useRef(false);
  const lastSeekRef = useRef(0);
  const preMuteVolumeRef = useRef(1.0);
  const [dragPosition, setDragPosition] = useState<number | null>(null);

  const currentTrack = currentTrackId
    ? tracks.find((t) => t.id === currentTrackId)
    : null;

  const computePosition = useCallback(
    (clientX: number): number | null => {
      if (!progressRef.current || !duration) return null;
      const rect = progressRef.current.getBoundingClientRect();
      const fraction = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
      return fraction * duration;
    },
    [duration],
  );

  const handleProgressMouseDown = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      const pos = computePosition(e.clientX);
      if (pos == null) return;
      e.preventDefault();
      isDraggingRef.current = true;
      setDragPosition(pos);
      seek(pos);
      lastSeekRef.current = Date.now();
    },
    [computePosition, seek],
  );

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isDraggingRef.current) return;
      const pos = computePosition(e.clientX);
      if (pos == null) return;
      setDragPosition(pos);
      const now = Date.now();
      if (now - lastSeekRef.current > 150) {
        seek(pos);
        lastSeekRef.current = now;
      }
    };

    const handleMouseUp = (e: MouseEvent) => {
      if (!isDraggingRef.current) return;
      isDraggingRef.current = false;
      const pos = computePosition(e.clientX);
      if (pos != null) {
        seek(pos);
      }
      setDragPosition(null);
    };

    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);
    return () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
    };
  }, [computePosition, seek]);

  const handleVolumeChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      setVolume(parseFloat(e.target.value));
    },
    [setVolume],
  );

  const toggleMute = useCallback(() => {
    if (volume > 0) {
      preMuteVolumeRef.current = volume;
      setVolume(0);
    } else {
      setVolume(preMuteVolumeRef.current || 1.0);
    }
  }, [volume, setVolume]);

  const displayPosition = dragPosition ?? position;
  const progressPct = duration && duration > 0 ? (displayPosition / duration) * 100 : 0;

  if (!currentTrack) return null;

  return (
    <div
      className="grid items-center gap-4 px-3 py-2 bg-neutral-900 border-t border-neutral-800"
      style={{ gridTemplateColumns: "minmax(0, 192px) 1fr minmax(0, 112px)" }}
    >
      {/* Track info */}
      <div className="min-w-0">
        <div className="text-xs font-medium text-neutral-200 truncate">
          {currentTrack.title}
        </div>
        <div className="text-[11px] text-neutral-500 truncate">
          {currentTrack.artist ?? ""}
        </div>
      </div>

      {/* Transport controls + progress */}
      <div className="min-w-0 flex flex-col items-center gap-1">
        <div className="flex items-center gap-3">
          <button
            onClick={toggleShuffle}
            className={`transition-colors ${shuffle ? "text-blue-400" : "text-neutral-400 hover:text-neutral-200"}`}
            title={shuffle ? "Shuffle on" : "Shuffle off"}
          >
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M2 4h3l3 4-3 4H2M14 4h-3l-3 4 3 4h3M12 3l2 1-2 1M12 11l2 1-2 1" />
            </svg>
          </button>
          <button
            onClick={prev}
            className="text-neutral-400 hover:text-neutral-200 transition-colors"
            title="Previous"
          >
            <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
              <path d="M3 2h2v12H3V2zm3 6l8-6v12L6 8z" />
            </svg>
          </button>
          <button
            onClick={togglePlayPause}
            className="w-7 h-7 flex items-center justify-center rounded-full bg-neutral-200 text-neutral-900 hover:bg-white transition-colors"
            title={isPlaying ? "Pause" : "Play"}
          >
            {isPlaying ? (
              <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor">
                <path d="M3 2h4v12H3V2zm6 0h4v12H9V2z" />
              </svg>
            ) : (
              <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor">
                <path d="M4 2l10 6-10 6V2z" />
              </svg>
            )}
          </button>
          <button
            onClick={next}
            className="text-neutral-400 hover:text-neutral-200 transition-colors"
            title="Next"
          >
            <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
              <path d="M11 2h2v12h-2V2zM2 2l8 6-8 6V2z" />
            </svg>
          </button>
          <button
            onClick={cycleRepeat}
            className={`transition-colors relative ${repeatMode !== "off" ? "text-blue-400" : "text-neutral-400 hover:text-neutral-200"}`}
            title={repeatMode === "one" ? "Repeat one" : repeatMode === "all" ? "Repeat all" : "Repeat off"}
          >
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M2 6a5 5 0 0 1 9-2h2M14 10a5 5 0 0 1-9 2H3" />
              <path d="M13 2v2h-2M3 14v-2h2" />
            </svg>
            {repeatMode === "one" && (
              <span className="absolute -top-1 -right-1 text-[8px] font-bold leading-none">1</span>
            )}
          </button>
        </div>

        {/* Progress bar */}
        <div className="flex items-center gap-2 w-full max-w-xl">
          <span className="text-[10px] text-neutral-500 w-8 text-right tabular-nums">
            {formatDuration(displayPosition)}
          </span>
          <div
            ref={progressRef}
            onMouseDown={handleProgressMouseDown}
            className="flex-1 h-1 bg-neutral-700 rounded-full cursor-pointer group relative"
          >
            <div
              className="h-full bg-neutral-400 group-hover:bg-neutral-200 rounded-full transition-colors"
              style={{ width: `${Math.min(100, progressPct)}%` }}
            />
          </div>
          <span className="text-[10px] text-neutral-500 w-8 tabular-nums">
            {formatDuration(duration)}
          </span>
        </div>
      </div>

      {/* Volume */}
      <div className="flex items-center gap-2 min-w-0">
        <button
          onClick={toggleMute}
          className="text-neutral-500 hover:text-neutral-300 transition-colors shrink-0"
          title={volume === 0 ? "Unmute" : "Mute"}
        >
          <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
            {volume === 0 ? (
              <>
                <path d="M8 1l-5 4H1v6h2l5 4V1z" />
                <path d="M11 5l4 6M15 5l-4 6" stroke="currentColor" strokeWidth="1.2" fill="none" />
              </>
            ) : (
              <>
                <path d="M8 1l-5 4H1v6h2l5 4V1z" />
                <path d="M11 5.5a3 3 0 010 5M13 3.5a6 6 0 010 9" stroke="currentColor" strokeWidth="1.2" fill="none" />
              </>
            )}
          </svg>
        </button>
        <input
          type="range"
          min="0"
          max="1"
          step="0.01"
          value={volume}
          onChange={handleVolumeChange}
          className="flex-1 h-1 accent-neutral-400 min-w-0"
        />
      </div>
    </div>
  );
}
