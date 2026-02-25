import { useRef, useCallback } from "react";
import { usePlaybackStore } from "../stores/playbackStore";
import { useThemeStore } from "../stores/themeStore";
import { useDragRegion } from "../hooks/useDragRegion";
import type { Track } from "../lib/types";

interface MiniPlayerProps {
  tracks: Track[];
}

export function MiniPlayer({ tracks }: MiniPlayerProps) {
  const onDrag = useDragRegion();
  const currentTrackId = usePlaybackStore((s) => s.currentTrackId);
  const isPlaying = usePlaybackStore((s) => s.isPlaying);
  const position = usePlaybackStore((s) => s.position);
  const duration = usePlaybackStore((s) => s.duration);
  const currentArtworkUrl = usePlaybackStore((s) => s.currentArtworkUrl);
  const togglePlayPause = usePlaybackStore((s) => s.togglePlayPause);
  const seek = usePlaybackStore((s) => s.seek);
  const next = usePlaybackStore((s) => s.next);
  const prev = usePlaybackStore((s) => s.prev);
  const toggleMiniPlayer = useThemeStore((s) => s.toggleMiniPlayer);
  const progressRef = useRef<HTMLDivElement>(null);

  const currentTrack = currentTrackId != null
    ? tracks.find((t) => t.id === currentTrackId)
    : null;

  const progressPct = duration && duration > 0 ? (position / duration) * 100 : 0;

  const handleProgressClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (!progressRef.current || !duration) return;
      e.stopPropagation();
      const rect = progressRef.current.getBoundingClientRect();
      const fraction = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
      seek(fraction * duration);
    },
    [duration, seek],
  );

  return (
    <div
      className="h-screen w-screen bg-n-950 text-n-100 flex flex-col select-none overflow-hidden"
      data-tauri-drag-region
      onMouseDown={onDrag}
    >
      {/* Main content row */}
      <div className="flex-1 flex items-center min-h-0">
        {/* Left padding for macOS traffic light buttons */}
        <div className="w-[72px] flex-shrink-0" />

        {/* Artwork */}
        <div className="w-14 h-14 flex-shrink-0 rounded bg-n-900 flex items-center justify-center overflow-hidden">
          {currentArtworkUrl ? (
            <img
              src={currentArtworkUrl}
              alt=""
              className="w-full h-full object-cover"
              draggable={false}
            />
          ) : (
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" className="text-n-600">
              <path d="M9 18V5l12-2v13" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              <circle cx="6" cy="18" r="3" stroke="currentColor" strokeWidth="2" />
              <circle cx="18" cy="16" r="3" stroke="currentColor" strokeWidth="2" />
            </svg>
          )}
        </div>

        {/* Track info */}
        <div className="flex-1 min-w-0 px-3">
          {currentTrack ? (
            <>
              <div className="text-xs font-medium truncate leading-tight">
                {currentTrack.title}
              </div>
              <div className="text-[10px] text-n-400 truncate leading-tight mt-0.5">
                {currentTrack.artist}
              </div>
            </>
          ) : (
            <div className="text-xs text-n-500">Not Playing</div>
          )}
        </div>

        {/* Transport controls */}
        <div className="flex items-center gap-2 pr-3 flex-shrink-0">
          {/* Previous */}
          <button
            onClick={(e) => { e.stopPropagation(); prev(); }}
            onMouseDown={(e) => e.stopPropagation()}
            className={currentTrack ? "text-n-400 hover:text-n-200 transition-colors" : "text-n-700 cursor-default"}
          >
            <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
              <path d="M3 2h2v12H3V2zm3 6l8-6v12L6 8z" />
            </svg>
          </button>

          {/* Play/Pause */}
          <button
            onClick={(e) => { e.stopPropagation(); togglePlayPause(); }}
            onMouseDown={(e) => e.stopPropagation()}
            className={`w-7 h-7 flex items-center justify-center rounded-full transition-colors ${
              currentTrack
                ? "bg-n-200 text-n-900 hover:bg-n-100"
                : "bg-n-800 text-n-600"
            }`}
          >
            {isPlaying ? (
              <svg width="10" height="10" viewBox="0 0 16 16" fill="currentColor">
                <path d="M3 2h4v12H3V2zm6 0h4v12H9V2z" />
              </svg>
            ) : (
              <svg width="10" height="10" viewBox="0 0 16 16" fill="currentColor">
                <path d="M4 2l10 6-10 6V2z" />
              </svg>
            )}
          </button>

          {/* Next */}
          <button
            onClick={(e) => { e.stopPropagation(); next(); }}
            onMouseDown={(e) => e.stopPropagation()}
            className={currentTrack ? "text-n-400 hover:text-n-200 transition-colors" : "text-n-700 cursor-default"}
          >
            <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
              <path d="M11 2h2v12h-2V2zM2 2l8 6-8 6V2z" />
            </svg>
          </button>

          {/* Expand (exit mini player) */}
          <button
            onClick={(e) => { e.stopPropagation(); toggleMiniPlayer(); }}
            onMouseDown={(e) => e.stopPropagation()}
            className="text-n-500 hover:text-n-200 transition-colors ml-1"
            title="Exit Mini Player"
          >
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
              <polyline points="5 1 1 1 1 5" />
              <polyline points="11 15 15 15 15 11" />
              <line x1="1" y1="1" x2="6" y2="6" />
              <line x1="15" y1="15" x2="10" y2="10" />
            </svg>
          </button>
        </div>
      </div>

      {/* Progress bar */}
      <div
        ref={progressRef}
        onClick={handleProgressClick}
        onMouseDown={(e) => e.stopPropagation()}
        className="h-1 flex-shrink-0 bg-n-800 cursor-pointer group"
      >
        <div
          className="h-full bg-n-500 group-hover:bg-n-300 transition-colors"
          style={{ width: `${Math.min(100, progressPct)}%` }}
        />
      </div>
    </div>
  );
}
