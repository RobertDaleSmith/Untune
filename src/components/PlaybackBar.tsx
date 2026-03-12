import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { usePlaybackStore } from "../stores/playbackStore";
import { useNavigationStore } from "../stores/navigationStore";
import { formatDuration } from "../utils/formatters";
import { SearchBar } from "./SearchBar";
import { AssistantButton } from "./AssistantButton";
import { ActivityIndicator } from "./ActivityIndicator";
import { toggleRadioMode, getRadioState } from "../lib/commands";
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

function RollingNumber({ value }: { value: number }) {
  const H = 14;
  return (
    <span className="relative inline-block overflow-hidden" style={{ height: H, minWidth: 7 }}>
      <span
        className="flex flex-col transition-transform duration-150 ease-out"
        style={{ transform: `translateY(${-(11 - value) * H}px)` }}
      >
        {Array.from({ length: 12 }, (_, i) => (
          <span key={i} className="flex items-center justify-center" style={{ height: H, fontSize: 9, lineHeight: `${H}px` }}>
            {11 - i}
          </span>
        ))}
      </span>
    </span>
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
    audioRoute,
    audioDevices,
    refreshDevices,
    switchDevice,
    sleepTimerRemaining,
    setSleepTimer,
    cancelSleepTimer,
    queuePanelOpen,
    toggleQueuePanel,
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
  const preMuteVolumeRef = useRef(1.0);
  const [dragPosition, setDragPosition] = useState<number | null>(null);
  const [showRemaining, setShowRemaining] = useState(false);
  const [showDevicePicker, setShowDevicePicker] = useState(false);
  const devicePickerRef = useRef<HTMLDivElement>(null);
  const deviceBtnRef = useRef<HTMLButtonElement>(null);
  const [pickerPos, setPickerPos] = useState<{ top: number; left: number }>({ top: 0, left: 0 });
  const [showSleepMenu, setShowSleepMenu] = useState(false);
  const sleepMenuRef = useRef<HTMLDivElement>(null);
  const sleepBtnRef = useRef<HTMLButtonElement>(null);
  const [sleepMenuPos, setSleepMenuPos] = useState<{ top: number; left: number }>({ top: 0, left: 0 });
  const [radioEnabled, setRadioEnabled] = useState(false);

  // Load initial radio state
  useEffect(() => {
    getRadioState().then((s) => setRadioEnabled(s.enabled)).catch(() => {});
  }, []);

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
    },
    [computePosition],
  );

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isDraggingRef.current) return;
      const pos = computePosition(e.clientX);
      if (pos == null) return;
      setDragPosition(pos);
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
  const [volumeDragging, setVolumeDragging] = useState(false);
  const [volumeBubbleX, setVolumeBubbleX] = useState(0);
  const [volumeBubbleY, setVolumeBubbleY] = useState(0);
  const [showVolumePopup, setShowVolumePopup] = useState(false);
  const muteBtnRef = useRef<HTMLButtonElement>(null);
  const volumePopupRef = useRef<HTMLDivElement>(null);
  const [volumePopupPos, setVolumePopupPos] = useState<{ top: number; left: number }>({ top: 0, left: 0 });
  const volumePopupBarRef = useRef<HTMLDivElement>(null);
  const isDraggingPopupVolumeRef = useRef(false);

  // Volume scale: 0–10 maps to 0.0–0.8 (80%), 11 = 1.0 (100%).
  // Bar covers 0–10. Dragging 8px+ past the right edge snaps to 11.
  const computeVolume = useCallback((clientX: number): number => {
    if (!volumeRef.current) return volume;
    const rect = volumeRef.current.getBoundingClientRect();
    const raw = (clientX - rect.left) / rect.width; // 0–1 within bar, >1 past edge
    if (raw > 1.0 && (clientX - rect.right) > 8) {
      return 1.0; // snap to 11 = 100%
    }
    // 0–10 maps to 0–0.8
    return Math.max(0, Math.min(0.8, raw * 0.8));
  }, [volume]);

  const updateVolumeBubble = useCallback((clientX: number) => {
    if (!volumeRef.current) return;
    const rect = volumeRef.current.getBoundingClientRect();
    const x = Math.min(rect.right, Math.max(rect.left, clientX));
    setVolumeBubbleX(x);
    setVolumeBubbleY(rect.top - 13);
  }, []);

  const handleVolumeMouseDown = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      e.preventDefault();
      isDraggingVolumeRef.current = true;
      setVolumeDragging(true);
      updateVolumeBubble(e.clientX);
      setVolume(computeVolume(e.clientX));
    },
    [computeVolume, setVolume, updateVolumeBubble],
  );

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!isDraggingVolumeRef.current) return;
      updateVolumeBubble(e.clientX);
      setVolume(computeVolume(e.clientX));
    };
    const onUp = () => {
      if (isDraggingVolumeRef.current) {
        isDraggingVolumeRef.current = false;
        setVolumeDragging(false);
      }
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
    return () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
    };
  }, [computeVolume, setVolume, updateVolumeBubble]);

  const toggleMute = useCallback(() => {
    if (volume > 0) {
      preMuteVolumeRef.current = volume;
      setVolume(0);
    } else {
      setVolume(preMuteVolumeRef.current || 0.8);
    }
  }, [volume, setVolume]);

  // Popup volume slider (collapsed mode) — vertical slider
  const computePopupVolume = useCallback((clientY: number): number => {
    if (!volumePopupBarRef.current) return volume;
    const rect = volumePopupBarRef.current.getBoundingClientRect();
    // Bottom = 0, top = max. Past top by 8px snaps to 11.
    const raw = 1 - (clientY - rect.top) / rect.height;
    if (raw > 1.0 && (rect.top - clientY) > 8) {
      return 1.0; // snap to 11
    }
    return Math.max(0, Math.min(0.8, raw * 0.8));
  }, [volume]);

  const handlePopupVolumeMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    isDraggingPopupVolumeRef.current = true;
    setVolumeDragging(true);
    setVolume(computePopupVolume(e.clientY));
  }, [computePopupVolume, setVolume]);

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!isDraggingPopupVolumeRef.current) return;
      setVolume(computePopupVolume(e.clientY));
    };
    const onUp = () => {
      if (isDraggingPopupVolumeRef.current) {
        isDraggingPopupVolumeRef.current = false;
        setVolumeDragging(false);
      }
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
    return () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
    };
  }, [computePopupVolume, setVolume]);

  // Close volume popup on click outside
  useEffect(() => {
    if (!showVolumePopup) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (
        volumePopupRef.current && !volumePopupRef.current.contains(e.target as Node) &&
        muteBtnRef.current && !muteBtnRef.current.contains(e.target as Node)
      ) {
        setShowVolumePopup(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [showVolumePopup]);

  // Close device picker on click outside
  useEffect(() => {
    if (!showDevicePicker) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (devicePickerRef.current && !devicePickerRef.current.contains(e.target as Node)) {
        setShowDevicePicker(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [showDevicePicker]);

  // Close sleep timer menu on click outside
  useEffect(() => {
    if (!showSleepMenu) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (sleepMenuRef.current && !sleepMenuRef.current.contains(e.target as Node)) {
        setShowSleepMenu(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [showSleepMenu]);

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
          <div className={`flex items-center gap-2 shrink-0 ${hasTrack ? "pointer-events-auto" : ""}`}>
            <button
              onClick={() => {
                const allIds = tracks.map((t) => t.id);
                if (allIds.length === 0) return;
                const randomIdx = Math.floor(Math.random() * allIds.length);
                usePlaybackStore.getState().play(allIds, randomIdx, "songs");
                if (!shuffle) toggleShuffle();
              }}
              className={`p-1.5 transition-colors hidden min-[900px]:block pointer-events-auto ${tracks.length === 0 ? disabledBtn : "text-n-500 hover:text-n-200"}`}
              title="Play random"
            >
              <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <rect x="2" y="2" width="12" height="12" rx="2" />
                <circle cx="5.5" cy="5.5" r="1" fill="currentColor" stroke="none" />
                <circle cx="10.5" cy="5.5" r="1" fill="currentColor" stroke="none" />
                <circle cx="5.5" cy="10.5" r="1" fill="currentColor" stroke="none" />
                <circle cx="10.5" cy="10.5" r="1" fill="currentColor" stroke="none" />
                <circle cx="8" cy="8" r="1" fill="currentColor" stroke="none" />
              </svg>
            </button>
            <button
              onClick={hasTrack ? toggleShuffle : undefined}
              className={`p-1.5 transition-colors hidden min-[900px]:block ${!hasTrack ? disabledBtn : shuffle ? "text-accent drop-shadow-[0_0_6px_var(--color-accent)]" : "text-n-500 hover:text-n-200"}`}
              title={shuffle ? "Shuffle on" : "Shuffle off"}
            >
              <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M2 4h3l3 4-3 4H2M14 4h-3l-3 4 3 4h3M12 3l2 1-2 1M12 11l2 1-2 1" />
              </svg>
            </button>
            <button
              onClick={hasTrack ? prev : undefined}
              className={`p-1.5 hidden min-[600px]:block ${hasTrack ? "text-n-400 hover:text-n-200 transition-colors" : disabledBtn}`}
              title="Previous"
            >
              <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
                <path d="M8 8L15 2v12zM1 8l7-6v12z" />
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
              className={`p-1.5 ${hasTrack ? "text-n-400 hover:text-n-200 transition-colors" : disabledBtn}`}
              title="Next"
            >
              <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
                <path d="M8 8L1 2v12zM15 8l-7-6v12z" />
              </svg>
            </button>
            <button
              onClick={hasTrack ? cycleRepeat : undefined}
              className={`p-1.5 transition-colors relative hidden min-[900px]:block ${!hasTrack ? disabledBtn : repeatMode !== "off" ? "text-accent drop-shadow-[0_0_6px_var(--color-accent)]" : "text-n-500 hover:text-n-200"}`}
              title={repeatMode === "one" ? "Repeat one" : repeatMode === "all" ? "Repeat all" : "Repeat off"}
            >
              <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M2 6a5 5 0 0 1 9-2h2M14 10a5 5 0 0 1-9 2H3" />
                <path d="M13 2v2h-2M3 14v-2h2" />
              </svg>
              {repeatMode === "one" && (
                <span className="absolute top-0 right-0 text-[7px] font-bold leading-none">1</span>
              )}
            </button>
            <button
              onClick={() => {
                toggleRadioMode()
                  .then((s) => setRadioEnabled(s.enabled))
                  .catch(console.error);
              }}
              className={`p-1.5 transition-colors hidden min-[900px]:block ${radioEnabled ? "text-accent drop-shadow-[0_0_6px_var(--color-accent)]" : "text-n-500 hover:text-n-200"}`}
              title={radioEnabled ? "Radio on" : "Radio off"}
            >
              <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M3 8a5 5 0 0 1 10 0" />
                <path d="M5 8a3 3 0 0 1 6 0" />
                <circle cx="8" cy="8" r="1" fill="currentColor" />
                <path d="M8 9v4" />
              </svg>
            </button>
          </div>
        </div>

        {/* Col 2: Activity indicator + Progress bar + track info — always centered */}
        <div className="pointer-events-auto w-[300px] shrink-0 flex items-center">
          <div className="hidden sm:block pointer-events-auto shrink-0 mr-1">
            <ActivityIndicator />
          </div>
          <div className="flex flex-col flex-1 min-w-0">
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
              className="flex-1 py-1.5 cursor-pointer group relative z-10"
            >
              <div className="h-1 bg-n-700 rounded-full relative">
                <div
                  className="h-full bg-accent group-hover:bg-accent rounded-full transition-colors shadow-[0_0_8px_var(--color-accent)]"
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
        </div>

        {/* Col 3: Volume (centered) + Search (far right) */}
        <div className="flex items-center min-w-0 overflow-hidden">
          <div className="flex-1 flex justify-center min-w-0">
            <div className="pointer-events-auto flex items-center gap-2 shrink-0">
              {/* Wide: normal mute button */}
              <button
                onClick={toggleMute}
                className="hidden min-[900px]:block text-n-500 hover:text-n-300 transition-colors shrink-0"
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
                className="hidden min-[900px]:block w-[72px] py-2 cursor-pointer group relative"
              >
                <div className="h-1 bg-n-700 rounded-full relative overflow-visible">
                  <div
                    className={`h-full bg-accent group-hover:bg-accent rounded-full transition-colors ${volume > 0.8 ? "shadow-[0_0_8px_var(--color-accent)]" : ""}`}
                    style={{ width: `${Math.min(108, (volume / 0.8) * 100)}%` }}
                  />
                </div>
                {/* Rolling number bubble — portaled to escape overflow:hidden */}
                {volumeDragging && !showVolumePopup && createPortal(
                  <div
                    className="fixed pointer-events-none z-[9999]"
                    style={{ top: volumeBubbleY, left: volumeBubbleX, transform: "translateX(-50%)" }}
                  >
                    <div className="text-n-400 font-bold tabular-nums" style={{ height: 14 }}>
                      <RollingNumber value={volume > 0.8 ? 11 : Math.round(volume / 0.08)} />
                    </div>
                  </div>,
                  document.body
                )}
              </div>
              <div className="relative hidden min-[900px]:block">
                <button
                  ref={deviceBtnRef}
                  onClick={() => {
                    if (!showDevicePicker) {
                      refreshDevices();
                      if (deviceBtnRef.current) {
                        const rect = deviceBtnRef.current.getBoundingClientRect();
                        setPickerPos({ top: rect.top, left: rect.right });
                      }
                    }
                    setShowDevicePicker((v) => !v);
                  }}
                  className={`p-1.5 transition-colors ${audioRoute?.isAirplay ? "text-accent drop-shadow-[0_0_6px_var(--color-accent)]" : "text-n-500 hover:text-n-300"}`}
                  title={audioRoute ? `Output: ${audioRoute.name}` : "Audio output"}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M5 17H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2h-1" />
                    <polygon points="12,15 17,21 7,21" fill="currentColor" stroke="none" />
                  </svg>
                </button>
              </div>
            </div>
          </div>
          <div className="pointer-events-auto shrink-0 ml-4 flex items-center gap-1">
            {/* Collapsed volume button — only visible below 900px */}
            <button
              ref={muteBtnRef}
              onClick={() => {
                if (!showVolumePopup && muteBtnRef.current) {
                  const rect = muteBtnRef.current.getBoundingClientRect();
                  setVolumePopupPos({ top: rect.top, left: rect.left + rect.width / 2 });
                }
                setShowVolumePopup((v) => !v);
              }}
              className="max-[899px]:block hidden p-1.5 text-n-500 hover:text-n-300 transition-colors shrink-0"
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
            <div className="relative hidden sm:block">
              <button
                ref={sleepBtnRef}
                onClick={() => {
                  if (!showSleepMenu && sleepBtnRef.current) {
                    const rect = sleepBtnRef.current.getBoundingClientRect();
                    setSleepMenuPos({ top: rect.top, left: rect.right });
                  }
                  setShowSleepMenu((v) => !v);
                }}
                className={`p-1.5 transition-colors ${sleepTimerRemaining != null ? "text-accent drop-shadow-[0_0_6px_var(--color-accent)]" : "text-n-500 hover:text-n-300"}`}
                title={sleepTimerRemaining != null ? `Sleep in ${Math.ceil(sleepTimerRemaining / 60)}m` : "Sleep timer"}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
                </svg>
              </button>
            </div>
            <div className="relative hidden sm:block">
              <button
                onClick={toggleQueuePanel}
                className={`p-1.5 transition-colors ${queuePanelOpen ? "text-accent drop-shadow-[0_0_6px_var(--color-accent)]" : "text-n-500 hover:text-n-300"}`}
                title="Play queue"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
                  <path d="M4 6h16M4 12h12M4 18h8M19 14v6M16 17h6" />
                </svg>
              </button>
            </div>
            <div className="relative hidden sm:block">
              <AssistantButton />
            </div>
            <SearchBar />
          </div>
        </div>
      </div>

      {/* Device picker dropdown — rendered via portal to escape overflow:hidden */}
      {/* Sleep timer dropdown — rendered via portal */}
      {showSleepMenu && createPortal(
        <div
          ref={sleepMenuRef}
          className="fixed w-44 bg-n-800 border border-n-700 rounded-lg shadow-xl overflow-hidden z-[9999]"
          style={{ top: sleepMenuPos.top + 28, left: sleepMenuPos.left - 176 }}
        >
          <div className="px-3 py-2 text-[10px] text-n-500 uppercase tracking-wider font-medium border-b border-n-700">
            Sleep Timer
          </div>
          <div className="py-1">
            {[15, 30, 45, 60].map((mins) => (
              <button
                key={mins}
                onClick={() => {
                  setSleepTimer(mins);
                  setShowSleepMenu(false);
                }}
                className="w-full text-left px-3 py-1.5 text-[11px] text-n-300 hover:bg-n-700 transition-colors"
              >
                {mins} minutes
              </button>
            ))}
            {sleepTimerRemaining != null && (
              <>
                <div className="my-1 border-t border-n-700" />
                <div className="px-3 py-1 text-[10px] text-n-500">
                  {Math.ceil(sleepTimerRemaining / 60)}m remaining
                </div>
                <button
                  onClick={() => {
                    cancelSleepTimer();
                    setShowSleepMenu(false);
                  }}
                  className="w-full text-left px-3 py-1.5 text-[11px] text-red-400 hover:bg-n-700 transition-colors"
                >
                  Cancel Timer
                </button>
              </>
            )}
          </div>
        </div>,
        document.body
      )}

      {showDevicePicker && createPortal(
        <div
          ref={devicePickerRef}
          className="fixed w-56 bg-n-800 border border-n-700 rounded-lg shadow-xl overflow-hidden z-[9999]"
          style={{ top: pickerPos.top + 28, left: pickerPos.left - 224 }}
        >
          <div className="px-3 py-2 text-[10px] text-n-500 uppercase tracking-wider font-medium border-b border-n-700">
            Audio Output
          </div>
          <div className="max-h-48 overflow-y-auto py-1">
            {audioDevices.map((device) => (
              <button
                key={device.id}
                onClick={() => {
                  switchDevice(device.id);
                  setShowDevicePicker(false);
                }}
                className={`w-full text-left px-3 py-1.5 text-[11px] flex items-center gap-2 transition-colors ${
                  device.isDefault
                    ? "text-accent bg-accent/10"
                    : "text-n-300 hover:bg-n-700"
                }`}
              >
                {device.isAirplay ? (
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0">
                    <path d="M5 17H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2h-1" />
                    <polygon points="12,15 17,21 7,21" fill="currentColor" stroke="none" />
                  </svg>
                ) : (
                  <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor" className="shrink-0">
                    <path d="M8 1l-5 4H1v6h2l5 4V1z" />
                    <path d="M11 5.5a3 3 0 010 5M13 3.5a6 6 0 010 9" stroke="currentColor" strokeWidth="1.2" fill="none" />
                  </svg>
                )}
                <span className="truncate">{device.name}</span>
                {device.isDefault && (
                  <svg width="10" height="10" viewBox="0 0 16 16" fill="currentColor" className="shrink-0 ml-auto">
                    <path d="M6 10.8L3.2 8l-1 1L6 12.8l8-8-1-1L6 10.8z" />
                  </svg>
                )}
              </button>
            ))}
            {audioDevices.length === 0 && (
              <div className="px-3 py-2 text-[11px] text-n-500">No devices found</div>
            )}
          </div>
        </div>,
        document.body
      )}

      {/* Vertical volume popup for collapsed mode */}
      {showVolumePopup && createPortal(
        <div
          ref={volumePopupRef}
          className="fixed z-[9999] flex flex-col items-center"
          style={{ top: volumePopupPos.top + 28, left: volumePopupPos.left, transform: "translateX(-50%)" }}
        >
          <div className="bg-n-800 border border-n-700 rounded-lg shadow-xl px-2 py-3 flex flex-col items-center gap-1.5">
            <span className="text-[9px] text-n-400 font-bold tabular-nums -mt-1 mb-2">
              {volume > 0.8 ? 11 : Math.round(volume / 0.08)}
            </span>
            <div
              ref={volumePopupBarRef}
              onMouseDown={handlePopupVolumeMouseDown}
              className="w-1.5 h-[80px] bg-n-700 rounded-full relative cursor-pointer"
            >
              <div
                className="absolute bottom-0 w-full bg-accent rounded-full"
                style={{ height: `${Math.min(108, (volume / 0.8) * 100)}%` }}
              />
            </div>
            <button
              onClick={toggleMute}
              className="text-n-500 hover:text-n-300 transition-colors"
              title={volume === 0 ? "Unmute" : "Mute"}
            >
              <svg width="11" height="11" viewBox="0 0 16 16" fill="currentColor">
                {volume === 0 ? (
                  <>
                    <path d="M8 1l-5 4H1v6h2l5 4V1z" />
                    <path d="M11 5l4 6M15 5l-4 6" stroke="currentColor" strokeWidth="1.2" fill="none" />
                  </>
                ) : (
                  <>
                    <path d="M8 1l-5 4H1v6h2l5 4V1z" />
                    <path d="M11 5.5a3 3 0 010 5" stroke="currentColor" strokeWidth="1.2" fill="none" />
                  </>
                )}
              </svg>
            </button>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}
