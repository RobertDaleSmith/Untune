import { useRef, useCallback, useState, useEffect } from "react";
import { usePlaybackStore } from "../stores/playbackStore";
import { useThemeStore } from "../stores/themeStore";
import { useDragRegion } from "../hooks/useDragRegion";
import { getUpcomingTracks, setNotchMode, getFrequencyData } from "../lib/commands";
import { getCurrentWindow, LogicalSize } from "@tauri-apps/api/window";
import { listen } from "@tauri-apps/api/event";
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
  const miniPlayerMode = useThemeStore((s) => s.miniPlayerMode);
  const isNotch = miniPlayerMode === "notch";
  const notchHeight = useThemeStore((s) => s._notchHeight);
  const notchWidth = useThemeStore((s) => s._notchWidth);
  const progressRef = useRef<HTMLDivElement>(null);
  const [modHeld, setModHeld] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [notchHover, setNotchHover] = useState(false); // fully expanded (clicked)
  const notchHoverRef = useRef(false);
  const [notchPeek, setNotchPeek] = useState(false); // hover preview
  const [queueIds, setQueueIds] = useState<number[]>([]);
  const collapseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [energy, setEnergy] = useState(0);
  const notchPillRef = useRef<HTMLDivElement>(null);

  // Poll audio energy for reactive pulse in notch mode
  useEffect(() => {
    if (!isNotch || !isPlaying) { setEnergy(0); return; }
    let running = true;
    const poll = () => {
      if (!running) return;
      getFrequencyData().then((d) => {
        if (running) setEnergy(d.energy);
        if (running) requestAnimationFrame(poll);
      }).catch(() => {
        if (running) setTimeout(poll, 100);
      });
    };
    requestAnimationFrame(poll);
    return () => { running = false; };
  }, [isNotch, isPlaying]);

  const COLLAPSED_H = 32;
  const EXPANDED_H = 280;
  const NOTCH_PEEK_H = 56; // hover preview height
  const NOTCH_EXPANDED_W = 340;
  const NOTCH_EXPANDED_H = 340;

  // Notch mode hover expand/collapse — reposition via absolute coords
  const notchResize = useCallback(async (w: number, h: number) => {
    try {
      const win = getCurrentWindow();
      await win.setMinSize(new LogicalSize(w, h));
      await setNotchMode(true, w, h);
    } catch { /* ignore */ }
  }, []);

  const cancelCollapseTimer = useCallback(() => {
    if (collapseTimerRef.current) { clearTimeout(collapseTimerRef.current); collapseTimerRef.current = null; }
  }, []);

  const notchPeekEnter = useCallback(async () => {
    if (notchHoverRef.current) return;
    cancelCollapseTimer();
    setNotchPeek(true);
    await notchResize(notchWidth + notchHeight, NOTCH_PEEK_H);
  }, [notchResize, notchWidth, notchHeight, cancelCollapseTimer]);

  const notchPeekLeave = useCallback(async () => {
    if (notchHoverRef.current) return;
    setNotchPeek(false);
    collapseTimerRef.current = setTimeout(() => notchResize(notchWidth + notchHeight, notchHeight), 250);
  }, [notchResize, notchWidth, notchHeight]);

  const notchOpen = useCallback(async () => {
    if (notchHoverRef.current) return;
    cancelCollapseTimer();
    setNotchPeek(false);
    notchHoverRef.current = true;
    setNotchHover(true);
    getCurrentWindow().setFocus().catch(() => {});
    await notchResize(NOTCH_EXPANDED_W + 40, NOTCH_EXPANDED_H);
  }, [notchResize, cancelCollapseTimer]);

  const notchClose = useCallback(() => {
    notchHoverRef.current = false;
    setNotchHover(false);
    setNotchPeek(false);
    setExpanded(false);
    collapseTimerRef.current = setTimeout(async () => {
      await notchResize(notchWidth + notchHeight, notchHeight);
      // After shrink, check if mouse is still over the pill and re-trigger peek
      const el = notchPillRef.current;
      if (el) {
        const rect = el.getBoundingClientRect();
        const handler = (e: MouseEvent) => {
          if (e.clientX >= rect.left && e.clientX <= rect.right && e.clientY >= rect.top && e.clientY <= rect.bottom) {
            notchPeekEnter();
          }
        };
        document.addEventListener("mousemove", handler, { once: true });
        // Clean up if no mouse move within 100ms
        setTimeout(() => document.removeEventListener("mousemove", handler), 100);
      }
    }, 400);
  }, [notchResize, notchWidth, notchHeight, notchPeekEnter]);

  // Close notch island on mouse leave, Escape, or focus loss
  useEffect(() => {
    if (!isNotch || !notchHover) return;
    // Mouse leave with delay
    let closeTimer: ReturnType<typeof setTimeout> | null = null;
    const onLeave = () => { closeTimer = setTimeout(notchClose, 500); };
    const onEnter = () => { if (closeTimer) { clearTimeout(closeTimer); closeTimer = null; } };
    const el = notchPillRef.current;
    if (el) {
      el.addEventListener("mouseleave", onLeave);
      el.addEventListener("mouseenter", onEnter);
    }
    // Escape key
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") notchClose(); };
    window.addEventListener("keydown", onKey);
    // Click outside window (from Rust global monitor)
    const unlisten = listen("notch-click-outside", () => notchClose());
    return () => {
      if (closeTimer) clearTimeout(closeTimer);
      if (el) {
        el.removeEventListener("mouseleave", onLeave);
        el.removeEventListener("mouseenter", onEnter);
      }
      window.removeEventListener("keydown", onKey);
      unlisten.then((f) => f());
    };
  }, [isNotch, notchHover, notchClose]);

  // Native hover monitor (macOS): the notch is a non-activating panel, so DOM
  // hover events don't fire until it's focused. The Rust side watches the cursor
  // and emits enter/leave; drive the peek preview from those.
  useEffect(() => {
    if (!isNotch) return;
    const enter = listen("notch-hover-enter", () => { notchPeekEnter(); });
    const leave = listen("notch-hover-leave", () => { notchPeekLeave(); });
    return () => { enter.then((f) => f()); leave.then((f) => f()); };
  }, [isNotch, notchPeekEnter, notchPeekLeave]);

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
  const isExpanded = expanded || notchHover;
  useEffect(() => {
    if (!isExpanded || currentTrackId == null) return;
    let cancelled = false;
    getUpcomingTracks(20).then(({ nextTrackIds }) => {
      if (!cancelled) setQueueIds(nextTrackIds);
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [isExpanded, currentTrackId]);

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
    let started = false;
    const startCrossfade = () => {
      if (started) return;
      started = true;
      requestAnimationFrame(() => {
        requestAnimationFrame(() => setBgTopReady(true));
      });
    };
    // Gate the fade on a fully decoded bitmap so it can't stutter mid-flight,
    // but never block longer than 150ms.
    const img = new Image();
    img.decoding = "async";
    img.src = currentArtworkUrl;
    img.decode().then(startCrossfade, startCrossfade);
    setTimeout(startCrossfade, 150);
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

  // ── Notch mode ──────────────────────────────────────────────
  if (isNotch) {
    return (
      <div
        className="h-screen w-screen flex flex-col select-none"
        style={{ background: "transparent", overflow: "visible", pointerEvents: "none" }}
        onContextMenu={(e) => e.preventDefault()}
      >
        <div ref={notchPillRef} className="mx-auto relative" style={{ width: notchHover ? NOTCH_EXPANDED_W : notchWidth, transition: "width 0.35s ease-out", pointerEvents: "auto" }} onMouseEnter={notchPeekEnter} onMouseLeave={notchPeekLeave} onMouseDown={() => getCurrentWindow().setFocus().catch(() => {})}>
          {/* Inverted/concave corners — smooth curve from bezel into pill top */}
          {(() => {
            const r = notchHover ? 14 : 8;
            return (
              <>
                {/* Left concave corner */}
                <svg
                  width={r} height={r} viewBox={`0 0 ${r} ${r}`}
                  className="absolute pointer-events-none"
                  style={{ left: -r, top: 0, transform: "scaleY(-1)" }}
                >
                  <path d={`M${r} 0 L${r} ${r} L0 ${r} A${r} ${r} 0 0 0 ${r} 0Z`} fill="rgba(0,0,0,0.95)" />
                </svg>
                {/* Right concave corner */}
                <svg
                  width={r} height={r} viewBox={`0 0 ${r} ${r}`}
                  className="absolute pointer-events-none"
                  style={{ right: -r, top: 0, transform: "scaleY(-1)" }}
                >
                  <path d={`M0 0 L0 ${r} L${r} ${r} A${r} ${r} 0 0 1 0 0Z`} fill="rgba(0,0,0,0.95)" />
                </svg>
              </>
            );
          })()}
          <div
            className="flex flex-col overflow-hidden"
            style={{
              width: "100%",
              borderRadius: notchHover ? `0 0 14px 14px` : notchPeek ? `0 0 10px 10px` : `0 0 8px 8px`,
              background: "rgba(0,0,0,0.95)",
              backdropFilter: "blur(20px)",
              WebkitBackdropFilter: "blur(20px)",
              transition: "border-radius 0.35s ease-out, max-height 0.35s ease-out",
              maxHeight: notchHover ? NOTCH_EXPANDED_H : notchPeek ? NOTCH_PEEK_H : notchHeight,
            }}
          >
          {/* Collapsed pill: click blank space to expand */}
          <div
            className="flex items-center justify-between px-2 cursor-pointer"
            style={{ height: notchHeight, minHeight: notchHeight }}
            onMouseDown={() => { getCurrentWindow().setFocus(); notchOpen(); }}
            onDoubleClick={(e) => { e.stopPropagation(); toggleMiniPlayer(); }}
          >
            {/* Artwork — play/pause button */}
            <button
              className="rounded-sm overflow-hidden flex-shrink-0 bg-n-800 relative cursor-pointer group/art"
              style={{
                width: 20,
                height: 20,
                transform: notchHover ? "scale(3.5)" : "scale(1)",
                transformOrigin: "left top",
                transition: "transform 0.35s ease-out",
              }}
              onMouseDown={(e) => e.stopPropagation()}
              onClick={(e) => { e.stopPropagation(); togglePlayPause(); }}
            >
              {currentArtworkUrl ? (
                <img src={currentArtworkUrl} alt=""
                  className="w-full h-full object-cover transition-opacity duration-150 group-hover/art:opacity-40"
                  style={{ opacity: isPlaying ? 1 : 0.5 }}
                  draggable={false} />
              ) : (
                <div className="w-full h-full bg-n-700" />
              )}
              {/* Playing: no icon, hover shows pause. Paused: pause icon, hover shows play */}
              {isPlaying ? (
                <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover/art:opacity-100 transition-opacity duration-150">
                  <svg width="8" height="8" viewBox="0 0 16 16" fill="white">
                    <path d="M3 2h4v12H3zm6 0h4v12H9z" />
                  </svg>
                </div>
              ) : (
                <>
                  <div className="absolute inset-0 flex items-center justify-center group-hover/art:opacity-0 transition-opacity duration-150">
                    <svg width="8" height="8" viewBox="0 0 16 16" fill="white" opacity="0.9">
                      <path d="M3 2h4v12H3zm6 0h4v12H9z" />
                    </svg>
                  </div>
                  <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover/art:opacity-100 transition-opacity duration-150">
                    <svg width="8" height="8" viewBox="0 0 16 16" fill="white" opacity="0.9">
                      <path d="M4 2l10 6-10 6z" />
                    </svg>
                  </div>
                </>
              )}
            </button>

            {/* Progress ring — doubles as the Next button. Shows the live progress
                arc with a pulsing energy dot when collapsed; once the notch is
                peeked/expanded the center becomes a skip icon. Clicking always skips
                (the album art handles play/pause). */}
            <button
              className="flex-shrink-0 relative w-5 h-5 group/next cursor-pointer"
              onMouseDown={(e) => e.stopPropagation()}
              onClick={(e) => { e.stopPropagation(); next(); }}
              title="Next"
            >
              <svg width="20" height="20" viewBox="0 0 20 20" className="-rotate-90">
                <circle cx="10" cy="10" r="8" fill="none" stroke="rgba(255,255,255,0.15)" strokeWidth="1.5" />
                <circle cx="10" cy="10" r="8" fill="none" stroke="var(--color-accent, #fff)" strokeWidth="1.5"
                  strokeDasharray={`${2 * Math.PI * 8}`}
                  strokeDashoffset={`${2 * Math.PI * 8 * (1 - progressPct / 100)}`}
                  strokeLinecap="round"
                />
              </svg>
              {/* Collapsed: energy dot */}
              {!(notchPeek || notchHover) && (
                <div className="absolute inset-0 flex items-center justify-center">
                  <div
                    className="w-1.5 h-1.5 rounded-full bg-accent"
                    style={{
                      transform: `scale(${1 + energy * 2.5})`,
                      opacity: isPlaying ? 0.6 + energy * 0.4 : 1,
                      transition: "transform 0.05s ease-out, opacity 0.05s ease-out",
                    }}
                  />
                </div>
              )}
              {/* Peeked/expanded: skip-next icon */}
              {(notchPeek || notchHover) && (
                <div className="absolute inset-0 flex items-center justify-center text-white/90 group-hover/next:text-white transition-colors">
                  <svg width="9" height="9" viewBox="0 0 16 16" fill="currentColor">
                    <path d="M1 2l9 6-9 6V2zM13 2v12h2V2h-2z" />
                  </svg>
                </div>
              )}
            </button>
          </div>

          {/* Peek row — visible on hover, below the notch bar */}
          <div
            className="flex items-center justify-between px-2 overflow-hidden"
            style={{
              maxHeight: (notchPeek || notchHover) ? 24 : 0,
              opacity: (notchPeek || notchHover) ? 1 : 0,
              transition: "max-height 0.25s ease-out, opacity 0.2s ease-out",
            }}
          >
            {/* Track info — centered in the peek row, nudged up 3px; hidden when
                fully expanded (the expanded panel shows the title beside the art). */}
            <div className="flex-1 min-w-0 text-center" style={{ transform: "translateY(-3px)" }}>
              {!notchHover && (currentTrack ? (
                <>
                  <div className="text-[9px] text-white/90 truncate leading-tight font-medium">{currentTrack.title}</div>
                  <div className="text-[8px] text-white/50 truncate leading-tight">{currentTrack.artist}</div>
                </>
              ) : (
                <div className="text-[8px] text-white/40">Not Playing</div>
              ))}
            </div>
            {/* Transport lives on the pill itself: album art = play/pause,
                progress ring = next. */}
          </div>

          {/* Expanded content — below the notch. Positioned above the scaled-up
              artwork (which is a transformed element and would otherwise paint on
              top) so the title and controls are never hidden behind it. */}
          <div
            className="relative z-10 flex flex-col px-2 gap-2 overflow-hidden"
            style={{
              opacity: notchHover ? 1 : 0,
              maxHeight: notchHover ? 400 : 0,
              paddingBottom: notchHover ? 4 : 0,
              transition: "opacity 0.25s ease-out, max-height 0.35s ease-out, padding-bottom 0.35s ease-out",
              pointerEvents: notchHover ? "auto" : "none",
            }}
          >
              {/* Track info — offset to avoid scaled artwork */}
              <div className="text-left" style={{ marginLeft: 78, marginRight: 4, marginTop: -4 }}>
                {currentTrack ? (
                  <>
                    <div className="text-[11px] text-white font-medium truncate">{currentTrack.title}</div>
                    <div className="text-[10px] text-white/50 truncate">{currentTrack.artist}</div>
                  </>
                ) : (
                  <div className="text-[10px] text-white/40">Not Playing</div>
                )}
              </div>
              {/* Progress bar — aligned with track info */}
              <div
                ref={progressRef}
                onClick={handleProgressClick}
                className="cursor-pointer group"
                style={{ marginLeft: 78, marginRight: 4 }}
              >
                <div className="h-1 rounded-full bg-white/15 relative overflow-hidden">
                  <div
                    className="absolute inset-y-0 left-0 bg-accent rounded-full"
                    style={{ width: `${Math.min(100, progressPct)}%` }}
                  />
                </div>
              </div>

              {/* Queue list */}
              <div className="overflow-y-auto max-h-48">
                {queueIds.length === 0 ? (
                  <div className="text-[10px] text-white/30 text-center py-2">No upcoming tracks</div>
                ) : (
                  queueIds.map((id, i) => {
                    const t = tracks.find((tr) => tr.id === id);
                    if (!t) return null;
                    return (
                      <button
                        key={`${id}-${i}`}
                        className="w-full flex items-center gap-2 px-1 py-0.5 text-left hover:bg-white/10 rounded transition-colors"
                        onDoubleClick={() => {
                          const allIds = tracks.map((tr) => tr.id);
                          const idx = allIds.indexOf(id);
                          if (idx >= 0) play(allIds, idx, "songs");
                        }}
                      >
                        <span className="text-[10px] truncate flex-1">
                          <span className="text-white/80">{t.title}</span>
                          <span className="text-white/40"> — {t.artist}</span>
                        </span>
                      </button>
                    );
                  })
                )}
              </div>
          </div>
          </div>
        </div>
      </div>
    );
  }

  // ── Floating mode ──────────────────────────────────────────
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
              style={{ filter: "var(--mini-bg-filter)", transform: "translateZ(0)", backfaceVisibility: "hidden" }}
            />
          )}
          {bgTop && (
            <img
              src={bgTop}
              alt=""
              className="absolute inset-[-24px] w-[calc(100%+48px)] h-[calc(100%+48px)] object-cover transition-opacity duration-500 ease-in-out"
              style={{ filter: "var(--mini-bg-filter)", opacity: bgTopReady ? 1 : 0, transform: "translateZ(0)", backfaceVisibility: "hidden", willChange: "opacity" }}
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
              <path d="M1 2l9 6-9 6V2zM13 2v12h2V2h-2z" />
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
