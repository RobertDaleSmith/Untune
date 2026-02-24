import { useCallback, useEffect, useRef, useState } from "react";
import { usePlaybackStore } from "../stores/playbackStore";
import { useNavigationStore } from "../stores/navigationStore";
import { formatDuration } from "../utils/formatters";
import { SearchBar } from "./SearchBar";
import type { Track } from "../lib/types";

function MarqueeText({ children, className }: { children: React.ReactNode; className?: string }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const textRef = useRef<HTMLSpanElement>(null);
  const [overflow, setOverflow] = useState(0);

  useEffect(() => {
    if (!containerRef.current || !textRef.current) return;
    const check = () => {
      const cw = containerRef.current!.offsetWidth;
      const tw = textRef.current!.scrollWidth;
      setOverflow(Math.max(0, tw - cw));
    };
    check();
    const ro = new ResizeObserver(check);
    ro.observe(containerRef.current);
    return () => ro.disconnect();
  }, [children]);

  return (
    <div ref={containerRef} data-tauri-drag-region className={`overflow-hidden max-w-full ${className ?? ""}`}>
      <span
        ref={textRef}
        data-tauri-drag-region
        className={`inline-flex items-center gap-1 whitespace-nowrap ${overflow > 0 ? "animate-marquee" : ""}`}
        style={overflow > 0 ? { "--marquee-distance": `-${overflow}px` } as React.CSSProperties : undefined}
      >
        {children}
      </span>
    </div>
  );
}

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
    queueSource,
    playError,
    requestScrollToNowPlaying,
  } = usePlaybackStore();

  const { navigateTo, navigateToPlaylist, navigateToAlbum, navigateToArtist, navigateToGenre } =
    useNavigationStore();

  const jumpToSource = useCallback(() => {
    if (!queueSource) {
      navigateTo("songs");
      return;
    }
    if (queueSource === "songs") {
      navigateTo("songs");
    } else if (queueSource.startsWith("playlist:")) {
      const id = parseInt(queueSource.split(":")[1], 10);
      const name = queueSource.split(":").slice(2).join(":") || "Playlist";
      navigateToPlaylist(id, name);
    } else if (queueSource.startsWith("album:")) {
      const parts = queueSource.split(":");
      const album = parts[1] ?? "";
      const artist = parts.slice(2).join(":") || null;
      navigateToAlbum(album, artist);
    } else if (queueSource.startsWith("artist:")) {
      navigateToArtist(queueSource.slice(7));
    } else if (queueSource.startsWith("genre:")) {
      navigateToGenre(queueSource.slice(6));
    } else {
      navigateTo("songs");
    }
    // After navigating, request scroll (use rAF so the view mounts first)
    requestAnimationFrame(() => requestScrollToNowPlaying());
  }, [queueSource, navigateTo, navigateToPlaylist, navigateToAlbum, navigateToArtist, navigateToGenre, requestScrollToNowPlaying]);

  const progressRef = useRef<HTMLDivElement>(null);
  const isDraggingRef = useRef(false);
  const lastSeekRef = useRef(0);
  const preMuteVolumeRef = useRef(1.0);
  const [dragPosition, setDragPosition] = useState<number | null>(null);
  const [showRemaining, setShowRemaining] = useState(false);

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

  const volumeRef = useRef<HTMLDivElement>(null);
  const isDraggingVolumeRef = useRef(false);

  const computeVolume = useCallback((clientX: number): number => {
    if (!volumeRef.current) return volume;
    const rect = volumeRef.current.getBoundingClientRect();
    return Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
  }, [volume]);

  const handleVolumeMouseDown = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      e.preventDefault();
      isDraggingVolumeRef.current = true;
      setVolume(computeVolume(e.clientX));
    },
    [computeVolume, setVolume],
  );

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!isDraggingVolumeRef.current) return;
      setVolume(computeVolume(e.clientX));
    };
    const onUp = () => {
      isDraggingVolumeRef.current = false;
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
    return () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
    };
  }, [computeVolume, setVolume]);

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

  const hasTrack = !!currentTrack;
  const disabledBtn = "text-n-700 cursor-default";

  return (
    <div className="relative h-[56px] shrink-0 bg-n-900/50 border-b border-n-800">
      {/* Drag region — sits behind everything, receives clicks on dead space */}
      <div data-tauri-drag-region className="absolute inset-0" />

      {/* Controls — pointer-events-none container, auto on each group */}
      <div
        className="absolute inset-0 grid items-center pointer-events-none"
        style={{ paddingLeft: "78px", paddingRight: "16px", gridTemplateColumns: "1fr auto 1fr" }}
      >
        {/* Col 1: Transport controls — centered in cell */}
        <div className="flex justify-center min-w-0 overflow-hidden">
          <div className={`flex items-center gap-3 shrink-0 ${hasTrack ? "pointer-events-auto" : ""}`}>
            <button
              onClick={hasTrack ? toggleShuffle : undefined}
              className={`transition-colors hidden sm:block ${!hasTrack ? disabledBtn : shuffle ? "text-blue-400" : "text-n-500 hover:text-n-200"}`}
              title={shuffle ? "Shuffle on" : "Shuffle off"}
            >
              <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M2 4h3l3 4-3 4H2M14 4h-3l-3 4 3 4h3M12 3l2 1-2 1M12 11l2 1-2 1" />
              </svg>
            </button>
            <button
              onClick={hasTrack ? prev : undefined}
              className={hasTrack ? "text-n-400 hover:text-n-200 transition-colors" : disabledBtn}
              title="Previous"
            >
              <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
                <path d="M3 2h2v12H3V2zm3 6l8-6v12L6 8z" />
              </svg>
            </button>
            <button
              onClick={hasTrack ? togglePlayPause : undefined}
              className={`w-6 h-6 flex items-center justify-center rounded-full transition-colors ${hasTrack ? "bg-n-200 text-n-900 hover:bg-n-100" : "bg-n-800 text-n-600"}`}
              title={isPlaying ? "Pause" : "Play"}
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
            <button
              onClick={hasTrack ? next : undefined}
              className={hasTrack ? "text-n-400 hover:text-n-200 transition-colors" : disabledBtn}
              title="Next"
            >
              <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
                <path d="M11 2h2v12h-2V2zM2 2l8 6-8 6V2z" />
              </svg>
            </button>
            <button
              onClick={hasTrack ? cycleRepeat : undefined}
              className={`transition-colors relative hidden sm:block ${!hasTrack ? disabledBtn : repeatMode !== "off" ? "text-blue-400" : "text-n-500 hover:text-n-200"}`}
              title={repeatMode === "one" ? "Repeat one" : repeatMode === "all" ? "Repeat all" : "Repeat off"}
            >
              <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M2 6a5 5 0 0 1 9-2h2M14 10a5 5 0 0 1-9 2H3" />
                <path d="M13 2v2h-2M3 14v-2h2" />
              </svg>
              {repeatMode === "one" && (
                <span className="absolute -top-1.5 -right-1.5 text-[8px] font-bold leading-none">1</span>
              )}
            </button>
          </div>
        </div>

        {/* Col 2: Progress bar + track info — always centered */}
        <div className="pointer-events-auto w-[300px] shrink-0 flex flex-col">
          {/* Row 1: Track name */}
          <div data-tauri-drag-region className="h-[14px] flex justify-center items-center px-8">
            {playError ? (
              <span className="text-[11px] text-red-400 truncate block leading-none" title={playError}>
                {playError}
              </span>
            ) : hasTrack ? (
              <>
                <MarqueeText>
                  <span data-tauri-drag-region className="text-[11px] font-medium text-n-200 leading-none">
                    {currentTrack!.title}
                  </span>
                </MarqueeText>
                <button
                  onClick={jumpToSource}
                  className="pointer-events-auto shrink-0 text-n-600 hover:text-n-300 transition-colors ml-1"
                  title="Go to playing source"
                >
                  <svg width="9" height="9" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M2 8h12M10 4l4 4-4 4" />
                  </svg>
                </button>
              </>
            ) : null}
          </div>

          {/* Row 2: Progress bar */}
          <div className="flex items-center gap-2">
            <span data-tauri-drag-region className="text-[10px] text-n-500 w-8 text-right tabular-nums shrink-0">
              {formatDuration(displayPosition) || "0:00"}
            </span>
            <div
              ref={progressRef}
              onMouseDown={handleProgressMouseDown}
              className="flex-1 py-1.5 cursor-pointer group relative"
            >
              <div className="h-1 bg-n-700 rounded-full relative">
                <div
                  className="h-full bg-n-400 group-hover:bg-n-200 rounded-full transition-colors"
                  style={{ width: `${Math.min(100, progressPct)}%` }}
                />
              </div>
            </div>
            <span
              onClick={() => setShowRemaining((v) => !v)}
              className="text-[10px] text-n-500 w-8 tabular-nums shrink-0 cursor-pointer hover:text-n-300 transition-colors"
            >
              {showRemaining && duration
                ? `-${formatDuration(Math.max(0, duration - displayPosition)) || "0:00"}`
                : formatDuration(duration) || "0:00"}
            </span>
          </div>

          {/* Row 3: Artist / Album */}
          <div data-tauri-drag-region className="h-[13px] flex justify-center items-center px-8">
            {hasTrack && (currentTrack!.artist || currentTrack!.album) && (
              <MarqueeText>
                {currentTrack!.artist && (
                  <span data-tauri-drag-region className="text-[10px] text-n-400 leading-none">
                    {currentTrack!.artist}
                  </span>
                )}
                {currentTrack!.artist && currentTrack!.album && (
                  <span data-tauri-drag-region className="text-[10px] text-n-600 shrink-0">&mdash;</span>
                )}
                {currentTrack!.album && (
                  <span data-tauri-drag-region className="text-[10px] text-n-500 leading-none">
                    {currentTrack!.album}
                  </span>
                )}
              </MarqueeText>
            )}
          </div>
        </div>

        {/* Col 3: Volume (centered) + Search (far right) */}
        <div className="flex items-center min-w-0 overflow-hidden">
          <div className="flex-1 flex justify-center min-w-0">
            <div className="pointer-events-auto flex items-center gap-2 shrink-0">
              <button
                onClick={toggleMute}
                className="text-n-500 hover:text-n-300 transition-colors shrink-0"
                title={volume === 0 ? "Unmute" : "Mute"}
              >
                <svg width="13" height="13" viewBox="0 0 16 16" fill="currentColor">
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
              <div
                ref={volumeRef}
                onMouseDown={handleVolumeMouseDown}
                className="hidden sm:block w-[72px] py-2 cursor-pointer group relative"
              >
                <div className="h-1 bg-n-700 rounded-full relative">
                  <div
                    className="h-full bg-n-400 group-hover:bg-n-200 rounded-full transition-colors"
                    style={{ width: `${Math.min(100, volume * 100)}%` }}
                  />
                </div>
              </div>
            </div>
          </div>
          <div className="pointer-events-auto shrink-0 ml-4">
            <SearchBar />
          </div>
        </div>
      </div>
    </div>
  );
}
