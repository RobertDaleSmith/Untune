import { useCallback, useEffect, useRef, useState } from "react";
import { getTrackAllArtworks, fetchLyrics } from "../lib/commands";
import { SyncedLyrics } from "./SyncedLyrics";

interface TrackInfo {
  title?: string | null;
  artist?: string | null;
  album?: string | null;
}

interface ArtworkLightboxProps {
  trackId: number;
  artworkUrl: string | null;
  originRect: DOMRect;
  trackInfo?: TrackInfo;
  duration: number | null;
  onClose: () => void;
}

type LyricsAvailability = "loading" | "available" | "none";

export function ArtworkLightbox({
  trackId,
  artworkUrl,
  originRect,
  trackInfo,
  duration,
  onClose,
}: ArtworkLightboxProps) {
  const [embeddedArtworks, setEmbeddedArtworks] = useState<string[]>([]);
  const [index, setIndex] = useState(0);
  const [animState, setAnimState] = useState<"entering" | "open" | "leaving">(
    "entering",
  );
  const [lyricsAvailable, setLyricsAvailable] = useState<LyricsAvailability>("loading");
  const overlayRef = useRef<HTMLDivElement>(null);

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

  // ESC to close
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [close]);

  // Click overlay to close
  const handleOverlayClick = useCallback(
    (e: React.MouseEvent) => {
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

  const vpW = window.innerWidth;
  const vpH = window.innerHeight;

  const isOpen = animState === "open";
  const isLeaving = animState === "leaving";
  const currentSrc = artworks[index] ?? null;

  if (hasLyrics) {
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
    };

    return (
      <div
        ref={overlayRef}
        onClick={handleOverlayClick}
        className="fixed inset-0 z-[100]"
        style={{
          backgroundColor:
            isOpen ? "rgba(0,0,0,0.85)" : "rgba(0,0,0,0)",
          transition: "background-color 0.3s ease",
        }}
      >
        {/* Left: artwork */}
        {currentSrc ? (
          <img
            src={currentSrc}
            alt="Artwork"
            onClick={handleImageClick}
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
            className="fixed text-center transition-opacity duration-300"
            style={{
              left: artLeft,
              top: artTop + artSize + 16,
              width: artSize,
              opacity: isOpen && !isLeaving ? 1 : 0,
            }}
          >
            {trackInfo.title && (
              <p className="text-white text-lg font-semibold truncate">
                {trackInfo.title}
              </p>
            )}
            {trackInfo.artist && (
              <p className="text-white/60 text-sm truncate mt-0.5">
                {trackInfo.artist}
              </p>
            )}
            {trackInfo.album && (
              <p className="text-white/40 text-sm truncate mt-0.5">
                {trackInfo.album}
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

        {/* Right: lyrics panel */}
        {isOpen && (
          <div
            className="fixed transition-opacity duration-500"
            style={{
              left: leftPanelWidth,
              top: 0,
              width: vpW - leftPanelWidth,
              height: vpH,
              opacity: isOpen && !isLeaving ? 1 : 0,
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

  // No lyrics: centered artwork layout (original)
  const infoHeight = hasInfo ? 80 : 0;
  const targetSize = Math.min(vpW, vpH) * 0.7;
  const targetLeft = (vpW - targetSize) / 2;
  const targetTop = (vpH - targetSize - infoHeight) / 2;

  const scaleX = originRect.width / targetSize;
  const scaleY = originRect.height / targetSize;
  const translateX = originRect.left - targetLeft;
  const translateY = originRect.top - targetTop;

  const containerStyle: React.CSSProperties = {
    width: targetSize,
    height: targetSize,
    left: targetLeft,
    top: targetTop,
    transform:
      isOpen
        ? "translate(0, 0) scale(1)"
        : `translate(${translateX}px, ${translateY}px) scale(${scaleX}, ${scaleY})`,
    transformOrigin: "top left",
    transition: "transform 0.3s cubic-bezier(0.4, 0, 0.2, 1)",
    opacity: isLeaving ? 0 : 1,
  };

  return (
    <div
      ref={overlayRef}
      onClick={handleOverlayClick}
      className="fixed inset-0 z-[100] flex items-center justify-center"
      style={{
        backgroundColor:
          isOpen ? "rgba(0,0,0,0.85)" : "rgba(0,0,0,0)",
        transition: "background-color 0.3s ease",
      }}
    >
      {currentSrc ? (
        <img
          src={currentSrc}
          alt="Artwork"
          onClick={handleImageClick}
          className={`fixed rounded-lg shadow-2xl object-cover ${artworks.length > 1 ? "cursor-pointer" : ""}`}
          style={containerStyle}
        />
      ) : (
        <div
          className="fixed rounded-lg shadow-2xl bg-n-800 flex items-center justify-center"
          style={containerStyle}
        >
          <svg
            width="96"
            height="96"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1"
            className="text-n-600"
          >
            <circle cx="12" cy="12" r="10" />
            <circle cx="12" cy="12" r="3" />
          </svg>
        </div>
      )}
      {/* Track info below artwork — Apple TV style */}
      {hasInfo && isOpen && (
        <div
          className="fixed text-center transition-opacity duration-300"
          style={{
            left: targetLeft,
            top: targetTop + targetSize + 16,
            width: targetSize,
            opacity: isOpen && !isLeaving ? 1 : 0,
          }}
        >
          {trackInfo.title && (
            <p className="text-white text-lg font-semibold truncate">
              {trackInfo.title}
            </p>
          )}
          {trackInfo.artist && (
            <p className="text-white/60 text-sm truncate mt-0.5">
              {trackInfo.artist}
            </p>
          )}
          {trackInfo.album && (
            <p className="text-white/40 text-sm truncate mt-0.5">
              {trackInfo.album}
            </p>
          )}
        </div>
      )}
      {artworks.length > 1 && isOpen && (
        <div
          className="fixed bottom-8 left-1/2 -translate-x-1/2 flex gap-1.5 transition-opacity duration-300"
          style={{ opacity: isOpen ? 1 : 0 }}
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
