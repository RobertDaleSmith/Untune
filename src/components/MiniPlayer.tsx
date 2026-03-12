import { useRef, useCallback, useState, useEffect } from "react";
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
  const [shiftHeld, setShiftHeld] = useState(false);

  useEffect(() => {
    const down = (e: KeyboardEvent) => { if (e.key === "Shift") setShiftHeld(true); };
    const up = (e: KeyboardEvent) => { if (e.key === "Shift") setShiftHeld(false); };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => { window.removeEventListener("keydown", down); window.removeEventListener("keyup", up); };
  }, []);

  const currentTrack = currentTrackId != null
    ? tracks.find((t) => t.id === currentTrackId)
    : null;

  // Two-layer crossfade for blurred background
  const [bgBottom, setBgBottom] = useState<string | null>(currentArtworkUrl);
  const [bgTop, setBgTop] = useState<string | null>(null);
  const [bgTopReady, setBgTopReady] = useState(false);
  const prevBgRef = useRef<string | null>(currentArtworkUrl);

  useEffect(() => {
    if (currentArtworkUrl === prevBgRef.current) return;
    prevBgRef.current = currentArtworkUrl;
    if (!currentArtworkUrl) {
      setBgTopReady(false);
      setBgTop(null);
      const t = setTimeout(() => setBgBottom(null), 800);
      return () => clearTimeout(t);
    }
    setBgTopReady(false);
    const img = new Image();
    img.onload = () => {
      setBgTop(currentArtworkUrl);
      requestAnimationFrame(() => {
        requestAnimationFrame(() => setBgTopReady(true));
      });
      setTimeout(() => {
        setBgBottom(currentArtworkUrl);
        setBgTopReady(false);
        setBgTop(null);
      }, 900);
    };
    img.src = currentArtworkUrl;
  }, [currentArtworkUrl]);

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
      onContextMenu={(e) => e.preventDefault()}
    >
      {/* Blurred artwork background */}
      {(bgBottom || bgTop) && (
        <div className="absolute inset-0 overflow-hidden" aria-hidden="true">
          <div
            className="absolute inset-[-24px]"
            style={{ filter: "blur(20px) saturate(2) brightness(0.5)" }}
          >
            {bgBottom && (
              <img src={bgBottom} alt="" className="absolute inset-0 w-full h-full object-cover" />
            )}
            {bgTop && (
              <img
                src={bgTop}
                alt=""
                className="absolute inset-0 w-full h-full object-cover transition-opacity duration-800 ease-in-out"
                style={{ opacity: bgTopReady ? 1 : 0 }}
              />
            )}
          </div>
          <div className="absolute inset-0" style={{ backgroundColor: "rgba(10,10,10,0.35)" }} />
        </div>
      )}

      {/* Main content row — pb-1 accounts for the progress bar overlaid at bottom */}
      <div className="flex-1 flex items-center min-h-0 relative z-10 pb-[2px]">
        {/* Transport controls */}
        <div className="flex items-center gap-1.5 pl-3 flex-shrink-0">
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

          {/* Next (shift = prev) */}
          <button
            onClick={(e) => { e.stopPropagation(); e.shiftKey ? prev() : next(); }}
            onMouseDown={(e) => e.stopPropagation()}
            className={`p-2 ${currentTrack ? "text-n-400 hover:text-n-200 transition-colors" : "text-n-700 cursor-default"}`}
          >
            <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" className={shiftHeld ? "scale-x-[-1]" : ""}>
              <path d="M8 8L1 2v12zM15 8l-7-6v12z" />
            </svg>
          </button>
        </div>

        {/* Artwork */}
        <div className="h-full aspect-square flex-shrink-0 bg-n-900 flex items-center justify-center overflow-hidden ml-2">
          {currentArtworkUrl ? (
            <img
              src={currentArtworkUrl}
              alt=""
              className="w-full h-full object-cover"
              draggable={false}
            />
          ) : (
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" className="text-n-600">
              <path d="M9 18V5l12-2v13" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              <circle cx="6" cy="18" r="3" stroke="currentColor" strokeWidth="2" />
              <circle cx="18" cy="16" r="3" stroke="currentColor" strokeWidth="2" />
            </svg>
          )}
        </div>

        {/* Track info */}
        <div className="flex-1 min-w-0 px-2">
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

        {/* Expand (exit mini player) */}
        <button
          onClick={(e) => { e.stopPropagation(); toggleMiniPlayer(); }}
          onMouseDown={(e) => e.stopPropagation()}
          className="text-n-500 hover:text-n-200 transition-colors flex-shrink-0 px-2"
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

      {/* Progress bar — fixed to bottom, overlays content */}
      <div
        ref={progressRef}
        onClick={handleProgressClick}
        onMouseDown={(e) => e.stopPropagation()}
        className="absolute bottom-0 left-0 right-0 z-20 cursor-pointer group pt-2"
      >
        <div className="h-0.5 group-hover:h-1 transition-all duration-150 bg-n-800 relative overflow-visible">
          <div
            className="absolute inset-y-0 left-0 bg-accent shadow-[0_0_8px_var(--color-accent)]"
            style={{ width: `${Math.min(100, progressPct)}%` }}
          />
        </div>
      </div>
    </div>
  );
}
