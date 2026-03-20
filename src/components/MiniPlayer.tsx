import { useRef, useCallback, useState, useEffect } from "react";
import { usePlaybackStore } from "../stores/playbackStore";
import { useThemeStore } from "../stores/themeStore";
import { useDragRegion } from "../hooks/useDragRegion";
import { getUpcomingTracks } from "../lib/commands";
import { getCurrentWindow, LogicalSize } from "@tauri-apps/api/window";
import { YouTubePlayer } from "./YouTubePlayer";
import { extractYouTubeVideoId } from "../utils/youtube";
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
  const play = usePlaybackStore((s) => s.play);
  const shuffle = usePlaybackStore((s) => s.shuffle);
  const videoMode = usePlaybackStore((s) => s.videoMode);
  const toggleShuffle = usePlaybackStore((s) => s.toggleShuffle);
  const toggleMiniPlayer = useThemeStore((s) => s.toggleMiniPlayer);
  const progressRef = useRef<HTMLDivElement>(null);
  const [modHeld, setModHeld] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [queueIds, setQueueIds] = useState<number[]>([]);

  const COLLAPSED_H = 32;
  const EXPANDED_H = 280;

  const toggleExpanded = useCallback(async () => {
    const next = !expanded;
    setExpanded(next);
    const win = getCurrentWindow();
    await win.setMinSize(new LogicalSize(300, next ? EXPANDED_H : COLLAPSED_H));
    await win.setSize(new LogicalSize(300, next ? EXPANDED_H : COLLAPSED_H));
  }, [expanded]);

  // Close list when window loses focus
  useEffect(() => {
    const unlisten = getCurrentWindow().onFocusChanged(({ payload: focused }) => {
      if (!focused && expanded) {
        setExpanded(false);
        getCurrentWindow().setMinSize(new LogicalSize(300, COLLAPSED_H)).catch(() => {});
        getCurrentWindow().setSize(new LogicalSize(300, COLLAPSED_H)).catch(() => {});
      }
    });
    return () => { unlisten.then((f) => f()); };
  }, [expanded]);

  // Fetch upcoming tracks when expanded or track changes
  useEffect(() => {
    if (!expanded || currentTrackId == null) return;
    let cancelled = false;
    getUpcomingTracks(20).then(({ nextTrackIds }) => {
      if (!cancelled) setQueueIds(nextTrackIds);
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [expanded, currentTrackId]);

  useEffect(() => {
    const down = (e: KeyboardEvent) => { if (e.key === "Alt" || e.key === "Shift") setModHeld(true); };
    const up = (e: KeyboardEvent) => { if (e.key === "Alt" || e.key === "Shift") setModHeld(false); };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => { window.removeEventListener("keydown", down); window.removeEventListener("keyup", up); };
  }, []);

  const currentTrack = currentTrackId != null
    ? tracks.find((t) => t.id === currentTrackId)
    : null;
  const [videoFailed, setVideoFailed] = useState(false);
  const videoId = videoMode && !videoFailed && currentTrack?.sourceUrl ? extractYouTubeVideoId(currentTrack.sourceUrl) : null;

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
      const t = setTimeout(() => setBgBottom(null), 600);
      return () => clearTimeout(t);
    }
    setBgTopReady(false);
    setBgTop(currentArtworkUrl);
    requestAnimationFrame(() => {
      requestAnimationFrame(() => setBgTopReady(true));
    });
    const t = setTimeout(() => {
      setBgBottom(currentArtworkUrl);
      setBgTopReady(false);
      setBgTop(null);
    }, 700);
    return () => clearTimeout(t);
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
        <div className="absolute inset-0 overflow-hidden" aria-hidden="true" style={{ transform: "translateZ(0)" }}>
          {bgBottom && (
            <img
              src={bgBottom}
              alt=""
              className="absolute inset-[-24px] w-[calc(100%+48px)] h-[calc(100%+48px)] object-cover"
              style={{ filter: "var(--mini-bg-filter)" }}
            />
          )}
          {bgTop && (
            <img
              src={bgTop}
              alt=""
              className="absolute inset-[-24px] w-[calc(100%+48px)] h-[calc(100%+48px)] object-cover transition-opacity duration-500 ease-in-out"
              style={{ filter: "var(--mini-bg-filter)", opacity: bgTopReady ? 1 : 0 }}
            />
          )}
          <div className="absolute inset-0" style={{ backgroundColor: "var(--mini-bg-overlay)" }} />
        </div>
      )}

      {/* Top bar — fixed height */}
      <div className="flex items-center relative z-10" style={{ height: COLLAPSED_H, minHeight: COLLAPSED_H }}>
        {/* Transport controls */}
        <div className="flex items-center gap-1 pl-2 flex-shrink-0 relative z-30">
          {/* Play/Pause — Option: dice (play random) */}
          <button
            onClick={(e) => {
              e.stopPropagation();
              if (modHeld) {
                const allIds = tracks.map((t) => t.id);
                if (allIds.length === 0) return;
                const randomIdx = Math.floor(Math.random() * allIds.length);
                play(allIds, randomIdx, "songs");
                if (!shuffle) toggleShuffle();
              } else {
                togglePlayPause();
              }
            }}
            onMouseDown={(e) => e.stopPropagation()}
            className={`w-5 h-5 flex items-center justify-center rounded-full transition-colors ${
              modHeld
                ? "bg-accent text-n-950 hover:opacity-80"
                : currentTrack
                  ? "bg-n-200 text-n-900 hover:bg-n-100"
                  : "bg-n-800 text-n-600"
            }`}
          >
            {modHeld ? (
              <svg width="8" height="8" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <rect x="2" y="2" width="12" height="12" rx="2" />
                <circle cx="5.5" cy="5.5" r="1" fill="currentColor" stroke="none" />
                <circle cx="10.5" cy="10.5" r="1" fill="currentColor" stroke="none" />
              </svg>
            ) : isPlaying ? (
              <svg width="7" height="7" viewBox="0 0 16 16" fill="currentColor">
                <path d="M3 2h4v12H3V2zm6 0h4v12H9V2z" />
              </svg>
            ) : (
              <svg width="7" height="7" viewBox="0 0 16 16" fill="currentColor">
                <path d="M4 2l10 6-10 6V2z" />
              </svg>
            )}
          </button>

          {/* Next (shift = prev) */}
          <button
            onClick={(e) => { e.stopPropagation(); (e.altKey || e.shiftKey) ? prev() : next(); }}
            onMouseDown={(e) => e.stopPropagation()}
            className={`p-1 ${currentTrack ? "text-n-400 hover:text-n-200 transition-colors" : "text-n-700 cursor-default"}`}
          >
            <svg width="10" height="10" viewBox="0 0 16 16" fill="currentColor" className={modHeld ? "scale-x-[-1]" : ""}>
              <path d="M8 8L1 2v12zM15 8l-7-6v12z" />
            </svg>
          </button>
        </div>

        {/* Artwork / Video — double-click to exit mini mode */}
        <div
          className="h-full aspect-square flex-shrink-0 bg-n-900 flex items-center justify-center overflow-hidden ml-1.5 mb-[2px] cursor-pointer relative"
          onDoubleClick={(e) => { e.stopPropagation(); toggleMiniPlayer(); }}
          onMouseDown={(e) => e.stopPropagation()}
        >
          {videoId ? (
            <>
              <YouTubePlayer
                videoId={videoId}
                position={position}
                isPlaying={isPlaying}
                className="absolute inset-0 w-full h-full"
                onError={() => setVideoFailed(true)}
              />
              <div className="absolute inset-0 z-10" />
            </>
          ) : currentArtworkUrl ? (
            <img
              src={currentArtworkUrl}
              alt=""
              className="w-full h-full object-cover"
              draggable={false}
            />
          ) : (
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" className="text-n-600">
              <path d="M9 18V5l12-2v13" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              <circle cx="6" cy="18" r="3" stroke="currentColor" strokeWidth="2" />
              <circle cx="18" cy="16" r="3" stroke="currentColor" strokeWidth="2" />
            </svg>
          )}
        </div>

        {/* Track info — single line at this height */}
        <div className="flex-1 min-w-0 px-1.5">
          {currentTrack ? (
            <div className="text-[10px] truncate leading-normal">
              <span className="font-medium">{currentTrack.title}</span>
              <span className="text-n-300"> — {currentTrack.artist}</span>
            </div>
          ) : (
            <div className="text-[10px] text-n-500">Not Playing</div>
          )}
        </div>

        {/* Queue toggle */}
        <button
          onClick={(e) => { e.stopPropagation(); toggleExpanded(); }}
          onMouseDown={(e) => e.stopPropagation()}
          style={{ position: "relative", zIndex: 30 }}
          className={`transition-colors flex-shrink-0 px-2 py-1 ${expanded ? "text-accent" : "text-n-500 hover:text-n-200"}`}
          title={expanded ? "Hide Queue" : "Show Queue"}
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
            <path d="M4 6h16M4 12h12M4 18h8M19 14v6M16 17h6" />
          </svg>
        </button>
      </div>

      {/* Expanded queue list */}
      {expanded && (
        <div className="flex-1 overflow-y-auto min-h-0 relative z-10 pt-0.5">
          {queueIds.length === 0 ? (
            <div className="text-[10px] text-n-500 text-center py-4">No upcoming tracks</div>
          ) : (
            queueIds.map((id, i) => {
              const t = tracks.find((tr) => tr.id === id);
              if (!t) return null;
              const isCurrent = id === currentTrackId;
              return (
                <button
                  key={`${id}-${i}`}
                  className={`w-full flex items-center gap-2 px-2 py-1 text-left hover:bg-n-100/10 transition-colors ${
                    isCurrent ? "bg-accent/20" : ""
                  }`}
                  onClick={(e) => {
                    e.stopPropagation();
                    const allIds = tracks.map((tr) => tr.id);
                    const idx = allIds.indexOf(id);
                    if (idx >= 0) play(allIds, idx, "songs");
                  }}
                  onMouseDown={(e) => e.stopPropagation()}
                >
                  <span className="text-[10px] truncate flex-1">
                    <span className={isCurrent ? "text-accent font-medium" : "text-n-200"}>{t.title}</span>
                    <span className="text-n-300"> — {t.artist}</span>
                  </span>
                  <span className="text-[9px] text-n-400 flex-shrink-0">
                    {t.duration ? `${Math.floor(t.duration / 60)}:${String(Math.floor(t.duration % 60)).padStart(2, "0")}` : ""}
                  </span>
                </button>
              );
            })
          )}
        </div>
      )}

      {/* Progress bar — anchored under the top bar */}
      <div
        ref={progressRef}
        onClick={handleProgressClick}
        onMouseDown={(e) => e.stopPropagation()}
        className="absolute left-0 right-0 z-20 cursor-pointer group flex flex-col justify-center"
        style={{ top: COLLAPSED_H - 6, height: 14 }}
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
