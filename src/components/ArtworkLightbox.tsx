import { useCallback, useEffect, useRef, useState } from "react";
import { getTrackAllArtworks, fetchLyrics } from "../lib/commands";
import { extractAccentColor } from "../lib/extractAccentColor";
import { usePlaybackStore } from "../stores/playbackStore";
import { SyncedLyrics } from "./SyncedLyrics";
import { AppIcon } from "./AppIcon";
import { Visualizer, ALL_MODES } from "./Visualizer";
import type { VisualizerMode } from "./Visualizer";
import { extractYouTubeVideoId } from "../utils/youtube";
import { YouTubePlayer } from "./YouTubePlayer";

interface TrackInfo {
  title?: string | null;
  artist?: string | null;
  album?: string | null;
  year?: number | null;
}

interface ArtworkLightboxProps {
  trackId: number;
  artworkUrl: string | null;
  originRect: DOMRect;
  trackInfo?: TrackInfo;
  duration: number | null;
  sourceUrl?: string | null;
  onClose: () => void;
}

type LyricsAvailability = "loading" | "available" | "none";

export function ArtworkLightbox({
  trackId,
  artworkUrl,
  originRect,
  trackInfo,
  duration,
  sourceUrl,
  onClose,
}: ArtworkLightboxProps) {
  const [embeddedArtworks, setEmbeddedArtworks] = useState<string[]>([]);
  const [index, setIndex] = useState(0);
  const [animState, setAnimState] = useState<"entering" | "open" | "leaving">(
    "entering",
  );
  const [lyricsAvailable, setLyricsAvailable] = useState<LyricsAvailability>("loading");
  const [activeModes, setActiveModes] = useState<Set<VisualizerMode>>(() => {
    try {
      const saved = localStorage.getItem("lightbox-viz-modes");
      if (saved) {
        const arr = JSON.parse(saved) as string[];
        const valid = arr.filter((m) => ALL_MODES.includes(m as VisualizerMode)) as VisualizerMode[];
        return new Set(valid);
      }
    } catch { /* ignore */ }
    return new Set<VisualizerMode>();
  });
  const [vizDropdownOpen, setVizDropdownOpen] = useState(false);
  const [controlsVisible, setControlsVisible] = useState(true);
  const controlsTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [lyricsVisible, setLyricsVisible] = useState(
    () => localStorage.getItem("lightbox-lyrics") !== "false",
  );
  const [artColor, setArtColor] = useState<[number, number, number]>([255, 255, 255]);
  const [videoVisible, setVideoVisible] = useState(false);
  const videoId = sourceUrl ? extractYouTubeVideoId(sourceUrl) : null;
  const overlayRef = useRef<HTMLDivElement>(null);

  // Progress bar seek state
  const { position: playbackPosition, duration: playbackDuration, seek, isPlaying: playbackIsPlaying } = usePlaybackStore();
  const progressBarRef = useRef<HTMLDivElement>(null);
  const isDraggingBarRef = useRef(false);
  const lastBarSeekRef = useRef(0);
  const [dragBarPosition, setDragBarPosition] = useState<number | null>(null);

  const computeBarPosition = useCallback(
    (clientX: number): number | null => {
      if (!progressBarRef.current || !playbackDuration) return null;
      const rect = progressBarRef.current.getBoundingClientRect();
      const fraction = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
      return fraction * playbackDuration;
    },
    [playbackDuration],
  );

  const handleBarMouseDown = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      const pos = computeBarPosition(e.clientX);
      if (pos == null) return;
      e.preventDefault();
      e.stopPropagation();
      isDraggingBarRef.current = true;
      setDragBarPosition(pos);
      seek(pos);
      lastBarSeekRef.current = Date.now();
    },
    [computeBarPosition, seek],
  );

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isDraggingBarRef.current) return;
      const pos = computeBarPosition(e.clientX);
      if (pos == null) return;
      setDragBarPosition(pos);
      const now = Date.now();
      if (now - lastBarSeekRef.current > 150) {
        seek(pos);
        lastBarSeekRef.current = now;
      }
    };
    const handleMouseUp = (e: MouseEvent) => {
      if (!isDraggingBarRef.current) return;
      isDraggingBarRef.current = false;
      const pos = computeBarPosition(e.clientX);
      if (pos != null) seek(pos);
      setDragBarPosition(null);
    };
    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);
    return () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
    };
  }, [computeBarPosition, seek]);

  const displayBarPosition = dragBarPosition ?? playbackPosition;
  const progressPct = playbackDuration && playbackDuration > 0
    ? (displayBarPosition / playbackDuration) * 100
    : 0;

  const visualizerActive = activeModes.size > 0;

  // Persist lightbox preferences
  useEffect(() => {
    localStorage.setItem("lightbox-viz-modes", JSON.stringify([...activeModes]));
  }, [activeModes]);
  useEffect(() => {
    localStorage.setItem("lightbox-lyrics", String(lyricsVisible));
  }, [lyricsVisible]);

  // Load all embedded artworks when track changes
  useEffect(() => {
    setEmbeddedArtworks([]);
    setIndex(0);
    getTrackAllArtworks(trackId)
      .then((urls) => {
        if (urls.length > 0) {
          setEmbeddedArtworks(urls);
        }
      })
      .catch(() => {});
  }, [trackId]);

  // Probe whether lyrics exist for this track
  useEffect(() => {
    if (!trackInfo?.title || !trackInfo?.artist) {
      setLyricsAvailable("none");
      return;
    }
    setLyricsAvailable("loading");
    let cancelled = false;
    fetchLyrics(
      trackInfo.title ?? "",
      trackInfo.artist ?? "",
      trackInfo.album ?? "",
      duration,
    )
      .then((result) => {
        if (cancelled) return;
        if (result.syncedLyrics || result.plainLyrics || result.instrumental) {
          setLyricsAvailable("available");
        } else {
          setLyricsAvailable("none");
        }
      })
      .catch(() => {
        if (!cancelled) setLyricsAvailable("none");
      });
    return () => { cancelled = true; };
  }, [trackInfo?.title, trackInfo?.artist, trackInfo?.album, duration]);

  // Extract dominant color from current artwork for visualizer
  const currentArtSrc = embeddedArtworks.length > 0
    ? embeddedArtworks[index]
    : artworkUrl;
  useEffect(() => {
    if (!currentArtSrc) {
      setArtColor([255, 255, 255]);
      return;
    }
    let cancelled = false;
    extractAccentColor(currentArtSrc).then((color) => {
      if (!cancelled) setArtColor(color ?? [255, 255, 255]);
    });
    return () => { cancelled = true; };
  }, [currentArtSrc]);

  // Use embedded artworks if available, fall back to the reactive artworkUrl prop
  const artworks = embeddedArtworks.length > 0
    ? embeddedArtworks
    : artworkUrl
      ? [artworkUrl]
      : [];

  // Trigger enter animation
  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      requestAnimationFrame(() => setAnimState("open"));
    });
    return () => cancelAnimationFrame(frame);
  }, []);

  const close = useCallback(() => {
    setAnimState("leaving");
    setTimeout(onClose, 250);
  }, [onClose]);

  // ESC to close, V to toggle visualizer
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
      if (e.key === "v" || e.key === "V") {
        setActiveModes((prev) => prev.size > 0 ? new Set() : new Set(ALL_MODES));
      }
      if (e.key === "l" || e.key === "L") {
        setLyricsVisible((prev) => !prev);
      }
      if ((e.key === "y" || e.key === "Y") && videoId) {
        setVideoVisible((prev) => !prev);
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [close, videoId]);

  // Auto-hide controls after mouse idle
  useEffect(() => {
    if (animState !== "open") return;
    const show = () => {
      setControlsVisible(true);
      if (controlsTimerRef.current) clearTimeout(controlsTimerRef.current);
      controlsTimerRef.current = setTimeout(() => {
        if (!vizDropdownOpen) setControlsVisible(false);
      }, 2500);
    };
    show();
    document.addEventListener("mousemove", show);
    return () => {
      document.removeEventListener("mousemove", show);
      if (controlsTimerRef.current) clearTimeout(controlsTimerRef.current);
    };
  }, [animState, vizDropdownOpen]);

  // Click overlay to close
  const handleOverlayClick = useCallback(
    (e: React.MouseEvent) => {
      setVizDropdownOpen(false);
      if (e.target === overlayRef.current) close();
    },
    [close],
  );

  // Cycle artwork on image click
  const handleImageClick = useCallback(() => {
    if (artworks.length > 1) {
      setIndex((i) => (i + 1) % artworks.length);
    }
  }, [artworks.length]);

  const hasLyrics = lyricsAvailable === "available";
  const hasInfo = trackInfo && (trackInfo.title || trackInfo.artist || trackInfo.album);

  const [vpSize, setVpSize] = useState({ w: window.innerWidth, h: window.innerHeight });
  useEffect(() => {
    const onResize = () => setVpSize({ w: window.innerWidth, h: window.innerHeight });
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);
  const vpW = vpSize.w;
  const vpH = vpSize.h;

  const isOpen = animState === "open";
  const isLeaving = animState === "leaving";
  const currentSrc = artworks[index] ?? null;

  // Toggle buttons (shared between layouts)
  const toggleButtons = isOpen && (
    <div
      className="fixed top-4 right-4 z-10 flex gap-2 transition-opacity duration-500"
      style={{ opacity: controlsVisible ? 1 : 0, pointerEvents: controlsVisible ? "auto" : "none" }}
    >
      <button
          onClick={(e) => {
            e.stopPropagation();
            setLyricsVisible((prev) => !prev);
          }}
          className={`p-2 rounded-full transition-colors ${
            lyricsVisible
              ? "bg-white/20 text-white"
              : "bg-white/10 text-white/50 hover:text-white/80"
          }`}
          title="Toggle lyrics (L)"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M4 6h16" />
            <path d="M4 10h12" />
            <path d="M4 14h16" />
            <path d="M4 18h8" />
          </svg>
        </button>
      <div className="relative">
        <button
          onClick={(e) => {
            e.stopPropagation();
            setVizDropdownOpen((prev) => !prev);
          }}
          className={`p-2 rounded-full transition-colors ${
            visualizerActive
              ? "bg-white/20 text-white"
              : "bg-white/10 text-white/50 hover:text-white/80"
          }`}
          title="Visualizer modes"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <path d="M2 12h2" />
            <path d="M6 8v8" />
            <path d="M10 4v16" />
            <path d="M14 6v12" />
            <path d="M18 9v6" />
            <path d="M22 12h-2" />
          </svg>
        </button>
        {vizDropdownOpen && (
          <div
            onClick={(e) => e.stopPropagation()}
            className="absolute right-0 top-full mt-1 w-40 py-1 bg-neutral-900/95 backdrop-blur-xl border border-white/10 rounded-lg shadow-xl"
          >
            <button
              onClick={() => {
                if (activeModes.size === ALL_MODES.length) {
                  setActiveModes(new Set());
                } else {
                  setActiveModes(new Set(ALL_MODES));
                }
              }}
              className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-white/90 hover:bg-white/10 transition-colors"
            >
              <span className={`w-3.5 h-3.5 rounded border flex items-center justify-center ${
                activeModes.size === ALL_MODES.length ? "bg-white/80 border-white/80" : "border-white/30"
              }`}>
                {activeModes.size === ALL_MODES.length && (
                  <svg width="10" height="10" viewBox="0 0 16 16" fill="none" stroke="black" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M3 8l4 4 6-7" />
                  </svg>
                )}
              </span>
              All
            </button>
            <div className="my-1 border-t border-white/10" />
            {ALL_MODES.map((m) => (
              <button
                key={m}
                onClick={() => {
                  setActiveModes((prev) => {
                    const next = new Set(prev);
                    if (next.has(m)) next.delete(m);
                    else next.add(m);
                    return next;
                  });
                }}
                className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-white/90 hover:bg-white/10 transition-colors"
              >
                <span className={`w-3.5 h-3.5 rounded border flex items-center justify-center ${
                  activeModes.has(m) ? "bg-white/80 border-white/80" : "border-white/30"
                }`}>
                  {activeModes.has(m) && (
                    <svg width="10" height="10" viewBox="0 0 16 16" fill="none" stroke="black" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M3 8l4 4 6-7" />
                    </svg>
                  )}
                </span>
                {m.charAt(0).toUpperCase() + m.slice(1)}
              </button>
            ))}
          </div>
        )}
      </div>
      {videoId && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            setVideoVisible((prev) => !prev);
          }}
          className={`p-2 rounded-full transition-colors ${
            videoVisible
              ? "bg-white/20 text-white"
              : "bg-white/10 text-white/50 hover:text-white/80"
          }`}
          title="Toggle video (Y)"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polygon points="23 7 16 12 23 17 23 7" />
            <rect x="1" y="5" width="15" height="14" rx="2" ry="2" />
          </svg>
        </button>
      )}
      <button
        onClick={(e) => {
          e.stopPropagation();
          onClose();
        }}
        className="p-2 rounded-full bg-white/10 text-white/50 hover:text-white/80 transition-colors"
        title="Close (Esc)"
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <path d="M18 6L6 18" />
          <path d="M6 6l12 12" />
        </svg>
      </button>
    </div>
  );

  if (lyricsVisible) {
    // Two-panel layout: artwork left, lyrics right
    const infoHeight = hasInfo ? 80 : 0;
    const artSize = Math.min(vpW, vpH) * 0.45;
    const leftPanelWidth = vpW * 0.45;
    const artLeft = (leftPanelWidth - artSize) / 2;
    const artTop = (vpH - artSize - infoHeight) / 2;

    const scaleX = originRect.width / artSize;
    const scaleY = originRect.height / artSize;
    const translateX = originRect.left - artLeft;
    const translateY = originRect.top - artTop;

    const containerStyle: React.CSSProperties = {
      width: artSize,
      height: artSize,
      left: artLeft,
      top: artTop,
      transform:
        isOpen
          ? "translate(0, 0) scale(1)"
          : `translate(${translateX}px, ${translateY}px) scale(${scaleX}, ${scaleY})`,
      transformOrigin: "top left",
      transition: "transform 0.3s cubic-bezier(0.4, 0, 0.2, 1)",
      opacity: isLeaving ? 0 : 1,
      zIndex: 2,
    };

    return (
      <div
        ref={overlayRef}
        data-tauri-drag-region
        onClick={handleOverlayClick}
        className="fixed inset-0 z-[100]"
        style={{
          backgroundColor:
            isOpen ? "rgba(0,0,0,0.85)" : "rgba(0,0,0,0)",
          transition: "background-color 0.3s ease",
        }}
      >
        {/* Visualizer canvas background */}
        {visualizerActive && isOpen && (
          <div data-tauri-drag-region className="absolute inset-0 z-0">
            <Visualizer modes={[...activeModes]} color={artColor} />
            <div
              data-tauri-drag-region
              className="absolute inset-0"
              style={{
                background: "radial-gradient(ellipse at center, transparent 40%, rgba(0,0,0,0.6) 100%)",
              }}
            />
          </div>
        )}

        {/* Progress bar */}
        {isOpen && (
          <div
            ref={progressBarRef}
            onMouseDown={handleBarMouseDown}
            className="fixed bottom-0 left-0 right-0 z-[5] cursor-pointer"
            style={{
              height: controlsVisible ? 12 : 6,
              transition: "height 0.3s ease",
            }}
          >
            <div
              className="absolute bottom-0 left-0 right-0 bg-white/10 overflow-hidden"
              style={{
                height: controlsVisible ? 6 : 2,
                transition: "height 0.3s ease, opacity 0.3s ease",
                opacity: controlsVisible ? 1 : 0.3,
              }}
            >
              <div
                className="h-full"
                style={{
                  width: `${progressPct}%`,
                  backgroundColor: `rgba(${artColor[0]}, ${artColor[1]}, ${artColor[2]}, 0.8)`,
                }}
              />
            </div>
          </div>
        )}

        {toggleButtons}

        {/* Left: artwork or video */}
        {videoVisible && videoId ? (
          <div
            className="fixed rounded-lg shadow-2xl overflow-hidden"
            style={containerStyle}
          >
            <YouTubePlayer
              videoId={videoId}
              position={playbackPosition}
              isPlaying={playbackIsPlaying}
            />
          </div>
        ) : currentSrc ? (
          <img
            src={currentSrc}
            alt="Artwork"
            onClick={handleImageClick}
            data-tauri-drag-region
            draggable={false}
            className={`fixed rounded-lg shadow-2xl object-cover ${artworks.length > 1 ? "cursor-pointer" : ""}`}
            style={containerStyle}
          />
        ) : (
          <div
            data-tauri-drag-region
            className="fixed rounded-lg shadow-2xl bg-neutral-800 flex items-center justify-center"
            style={containerStyle}
          >
            <svg
              width="96"
              height="96"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1"
              className="text-neutral-600"
            >
              <circle cx="12" cy="12" r="10" />
              <circle cx="12" cy="12" r="3" />
            </svg>
          </div>
        )}

        {/* Track info below artwork */}
        {hasInfo && isOpen && (
          <div
            data-tauri-drag-region
          className="fixed text-center transition-opacity duration-300"
            style={{
              left: artLeft,
              top: artTop + artSize + 16,
              width: artSize,
              opacity: isOpen && !isLeaving ? 1 : 0,
              zIndex: 2,
            }}
          >
            {trackInfo.title && (
              <p data-tauri-drag-region className="text-white text-lg font-semibold truncate">
                {trackInfo.title}
              </p>
            )}
            {trackInfo.artist && (
              <p data-tauri-drag-region className="text-white/60 text-sm truncate mt-0.5">
                {trackInfo.artist}
              </p>
            )}
            {trackInfo.album && (
              <p data-tauri-drag-region className="text-white/40 text-sm truncate mt-0.5">
                {trackInfo.album}{trackInfo.year ? ` (${trackInfo.year})` : ""}
              </p>
            )}
          </div>
        )}

        {/* Artwork dots */}
        {artworks.length > 1 && isOpen && (
          <div
            className="fixed flex gap-1.5 transition-opacity duration-300"
            style={{
              left: artLeft + artSize / 2,
              transform: "translateX(-50%)",
              top: artTop + artSize + (hasInfo ? 80 : 16),
              opacity: isOpen ? 1 : 0,
              zIndex: 2,
            }}
          >
            {artworks.map((_, i) => (
              <button
                key={i}
                onClick={(e) => {
                  e.stopPropagation();
                  setIndex(i);
                }}
                className={`w-2 h-2 rounded-full transition-colors ${
                  i === index ? "bg-white" : "bg-white/40"
                }`}
              />
            ))}
          </div>
        )}

        {/* App icon watermark */}
        {isOpen && (
          <AppIcon
            color="white"
            className="fixed bottom-4 right-4 h-6 w-auto opacity-20 pointer-events-none z-10"
          />
        )}

        {/* Right: lyrics panel */}
        {hasLyrics && isOpen && (
          <div
            data-tauri-drag-region
            className="fixed transition-opacity duration-500"
            style={{
              left: leftPanelWidth,
              top: 0,
              width: vpW - leftPanelWidth,
              height: vpH,
              opacity: isOpen && !isLeaving ? 1 : 0,
              zIndex: 2,
              backgroundColor: visualizerActive ? "rgba(0,0,0,0.4)" : "transparent",
            }}
          >
            <SyncedLyrics
              trackName={trackInfo?.title ?? ""}
              artistName={trackInfo?.artist ?? ""}
              albumName={trackInfo?.album ?? ""}
              duration={duration}
            />
          </div>
        )}
      </div>
    );
  }

  // No lyrics / lyrics hidden: centered artwork layout
  const infoHeight = hasInfo ? 80 : 0;
  const artSize = Math.min(vpW, vpH) * 0.7;
  const artLeft = (vpW - artSize) / 2;
  const artTop = (vpH - artSize - infoHeight) / 2;

  const scaleX = originRect.width / artSize;
  const scaleY = originRect.height / artSize;
  const translateX = originRect.left - artLeft;
  const translateY = originRect.top - artTop;

  const containerStyle: React.CSSProperties = {
    width: artSize,
    height: artSize,
    left: artLeft,
    top: artTop,
    transform:
      isOpen
        ? "translate(0, 0) scale(1)"
        : `translate(${translateX}px, ${translateY}px) scale(${scaleX}, ${scaleY})`,
    transformOrigin: "top left",
    transition: "transform 0.3s cubic-bezier(0.4, 0, 0.2, 1)",
    opacity: isLeaving ? 0 : 1,
    zIndex: 2,
  };

  return (
    <div
      ref={overlayRef}
      data-tauri-drag-region
      onClick={handleOverlayClick}
      className="fixed inset-0 z-[100]"
      style={{
        backgroundColor:
          isOpen ? "rgba(0,0,0,0.85)" : "rgba(0,0,0,0)",
        transition: "background-color 0.3s ease",
      }}
    >
      {/* Visualizer canvas background */}
      {visualizerActive && isOpen && (
        <div data-tauri-drag-region className="absolute inset-0 z-0">
          <Visualizer modes={[...activeModes]} color={artColor} />
          <div
            data-tauri-drag-region
            className="absolute inset-0"
            style={{
              background: "radial-gradient(ellipse at center, transparent 40%, rgba(0,0,0,0.6) 100%)",
            }}
          />
        </div>
      )}

      {/* Progress bar */}
      {isOpen && (
        <div
          ref={progressBarRef}
          onMouseDown={handleBarMouseDown}
          className="fixed bottom-0 left-0 right-0 z-[5] cursor-pointer"
          style={{
            height: controlsVisible ? 12 : 6,
            transition: "height 0.3s ease",
          }}
        >
          <div
            className="absolute bottom-0 left-0 right-0 bg-white/10 overflow-hidden"
            style={{
              height: controlsVisible ? 6 : 2,
              transition: "height 0.3s ease, opacity 0.3s ease",
              opacity: controlsVisible ? 1 : 0.3,
            }}
          >
            <div
              className="h-full"
              style={{
                width: `${progressPct}%`,
                backgroundColor: `rgba(${artColor[0]}, ${artColor[1]}, ${artColor[2]}, 0.8)`,
              }}
            />
          </div>
        </div>
      )}

      {toggleButtons}

      {videoVisible && videoId ? (
        <div
          className="fixed rounded-lg shadow-2xl overflow-hidden"
          style={containerStyle}
        >
          <YouTubePlayer
            videoId={videoId}
            position={playbackPosition}
            isPlaying={playbackIsPlaying}
          />
        </div>
      ) : currentSrc ? (
        <img
          src={currentSrc}
          alt="Artwork"
          onClick={handleImageClick}
          data-tauri-drag-region
          draggable={false}
          className={`fixed rounded-lg shadow-2xl object-cover ${artworks.length > 1 ? "cursor-pointer" : ""}`}
          style={containerStyle}
        />
      ) : (
        <div
          className="fixed rounded-lg shadow-2xl bg-neutral-800 flex items-center justify-center"
          style={containerStyle}
        >
          <svg
            width="96"
            height="96"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1"
            className="text-neutral-600"
          >
            <circle cx="12" cy="12" r="10" />
            <circle cx="12" cy="12" r="3" />
          </svg>
        </div>
      )}

      {/* Track info below artwork */}
      {hasInfo && isOpen && (
        <div
          data-tauri-drag-region
          className="fixed text-center transition-opacity duration-300"
          style={{
            left: artLeft,
            top: artTop + artSize + 16,
            width: artSize,
            opacity: isOpen && !isLeaving ? 1 : 0,
            zIndex: 2,
          }}
        >
          {trackInfo.title && (
            <p data-tauri-drag-region className="text-white text-lg font-semibold truncate">
              {trackInfo.title}
            </p>
          )}
          {trackInfo.artist && (
            <p data-tauri-drag-region className="text-white/60 text-sm truncate mt-0.5">
              {trackInfo.artist}
            </p>
          )}
          {trackInfo.album && (
            <p data-tauri-drag-region className="text-white/40 text-sm truncate mt-0.5">
              {trackInfo.album}{trackInfo.year ? ` (${trackInfo.year})` : ""}
            </p>
          )}
        </div>
      )}

      {/* App icon watermark */}
      {isOpen && (
        <AppIcon
          color="white"
          className="fixed bottom-4 right-4 h-6 w-auto opacity-20 pointer-events-none z-10"
        />
      )}

      {/* Artwork dots */}
      {artworks.length > 1 && isOpen && (
        <div
          className="fixed flex gap-1.5 transition-opacity duration-300"
          style={{
            left: artLeft + artSize / 2,
            transform: "translateX(-50%)",
            top: artTop + artSize + (hasInfo ? 80 : 16),
            opacity: isOpen ? 1 : 0,
            zIndex: 2,
          }}
        >
          {artworks.map((_, i) => (
            <button
              key={i}
              onClick={(e) => {
                e.stopPropagation();
                setIndex(i);
              }}
              className={`w-2 h-2 rounded-full transition-colors ${
                i === index ? "bg-white" : "bg-white/40"
              }`}
            />
          ))}
        </div>
      )}
    </div>
  );
}
