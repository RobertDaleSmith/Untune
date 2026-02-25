import { useCallback, useEffect, useRef, useState } from "react";
import { getTrackAllArtworks } from "../lib/commands";

interface ArtworkLightboxProps {
  trackId: number;
  initialUrl: string;
  originRect: DOMRect;
  onClose: () => void;
}

export function ArtworkLightbox({
  trackId,
  initialUrl,
  originRect,
  onClose,
}: ArtworkLightboxProps) {
  const [artworks, setArtworks] = useState<string[]>([initialUrl]);
  const [index, setIndex] = useState(0);
  const [animState, setAnimState] = useState<"entering" | "open" | "leaving">(
    "entering",
  );
  const overlayRef = useRef<HTMLDivElement>(null);

  // Load all embedded artworks
  useEffect(() => {
    getTrackAllArtworks(trackId)
      .then((urls) => {
        if (urls.length > 0) {
          setArtworks(urls);
        }
      })
      .catch(() => {});
  }, [trackId]);

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

  // Compute origin transform for animation
  const vpW = window.innerWidth;
  const vpH = window.innerHeight;
  const targetSize = Math.min(vpW, vpH) * 0.7;
  const targetLeft = (vpW - targetSize) / 2;
  const targetTop = (vpH - targetSize) / 2;

  const scaleX = originRect.width / targetSize;
  const scaleY = originRect.height / targetSize;
  const translateX = originRect.left - targetLeft;
  const translateY = originRect.top - targetTop;

  const isOpen = animState === "open";
  const isLeaving = animState === "leaving";

  const imgStyle: React.CSSProperties = {
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
      <img
        src={artworks[index]}
        alt="Artwork"
        onClick={handleImageClick}
        className={`fixed rounded-lg shadow-2xl object-cover ${artworks.length > 1 ? "cursor-pointer" : ""}`}
        style={imgStyle}
      />
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
