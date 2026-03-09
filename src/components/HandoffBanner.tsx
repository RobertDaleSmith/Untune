import { usePlaybackStore } from "../stores/playbackStore";
import { getArtworkDataUrl } from "../lib/commands";
import { useState, useEffect } from "react";

export function HandoffBanner() {
  const handoffInfo = usePlaybackStore((s) => s.handoffInfo);
  const handoffDismissed = usePlaybackStore((s) => s.handoffDismissed);
  const acceptHandoff = usePlaybackStore((s) => s.acceptHandoff);
  const dismissHandoff = usePlaybackStore((s) => s.dismissHandoff);

  const [artworkUrl, setArtworkUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!handoffInfo?.artworkHash) {
      setArtworkUrl(null);
      return;
    }
    let cancelled = false;
    getArtworkDataUrl(handoffInfo.artworkHash).then((url) => {
      if (!cancelled) setArtworkUrl(url);
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [handoffInfo?.artworkHash]);

  if (!handoffInfo || handoffDismissed || handoffInfo.trackId == null) return null;

  const pos = handoffInfo.state.position;
  const mins = Math.floor(pos / 60);
  const secs = Math.floor(pos % 60);
  const timeStr = `${mins}:${secs.toString().padStart(2, "0")}`;

  return (
    <div className="absolute top-12 left-1/2 -translate-x-1/2 z-50 animate-in fade-in slide-in-from-top-2 duration-300">
      <div className="flex items-center gap-3 bg-n-800/95 backdrop-blur-xl border border-n-700 rounded-xl px-4 py-2.5 shadow-2xl max-w-md">
        {/* Artwork */}
        <div className="w-10 h-10 rounded-lg bg-n-700 flex-shrink-0 overflow-hidden">
          {artworkUrl ? (
            <img src={artworkUrl} alt="" className="w-full h-full object-cover" />
          ) : (
            <div className="w-full h-full flex items-center justify-center text-n-500">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                <path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55C7.79 13 6 14.79 6 17s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z" />
              </svg>
            </div>
          )}
        </div>

        {/* Info */}
        <div className="flex-1 min-w-0">
          <p className="text-[13px] text-n-100 truncate font-medium">
            {handoffInfo.title ?? "Unknown Track"}
            {handoffInfo.artist && (
              <span className="text-n-400 font-normal"> - {handoffInfo.artist}</span>
            )}
          </p>
          <p className="text-[11px] text-n-500">
            Paused at {timeStr} on {handoffInfo.state.deviceName}
          </p>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-1.5 flex-shrink-0">
          <button
            onClick={acceptHandoff}
            className="px-3 py-1 text-[11px] rounded-md bg-accent/20 text-accent hover:bg-accent/30 transition-colors font-medium"
          >
            Resume
          </button>
          <button
            onClick={dismissHandoff}
            className="p-1 text-n-500 hover:text-n-300 transition-colors"
            title="Dismiss"
          >
            <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M4 4l8 8M12 4l-8 8" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
}
