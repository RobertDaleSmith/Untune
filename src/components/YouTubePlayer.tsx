import { useEffect, useRef, useCallback } from "react";

declare global {
  interface Window {
    onYouTubeIframeAPIReady?: () => void;
  }
}

interface YouTubePlayerProps {
  videoId: string;
  /** Current playback position in seconds (from local audio engine) */
  position: number;
  /** Whether local audio is currently playing */
  isPlaying: boolean;
  className?: string;
}

let apiLoading = false;
let apiReady = false;
const readyCallbacks: (() => void)[] = [];

function ensureYTApi(): Promise<void> {
  if (apiReady && window.YT?.Player) return Promise.resolve();
  return new Promise((resolve) => {
    readyCallbacks.push(resolve);
    if (apiLoading) return;
    apiLoading = true;
    const prev = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      prev?.();
      apiReady = true;
      for (const cb of readyCallbacks) cb();
      readyCallbacks.length = 0;
    };
    const script = document.createElement("script");
    script.src = "https://www.youtube.com/iframe_api";
    document.head.appendChild(script);
  });
}

/** Max allowed drift in seconds before re-syncing */
const DRIFT_THRESHOLD = 2;
/** How often to check drift (ms) */
const SYNC_INTERVAL = 3000;

export function YouTubePlayer({ videoId, position, isPlaying, className }: YouTubePlayerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const playerRef = useRef<YT.Player | null>(null);
  const videoIdRef = useRef(videoId);
  const positionRef = useRef(position);
  const isPlayingRef = useRef(isPlaying);

  // Keep refs in sync
  positionRef.current = position;
  isPlayingRef.current = isPlaying;

  const syncPosition = useCallback(() => {
    const player = playerRef.current;
    if (!player?.getCurrentTime) return;
    try {
      const ytTime = player.getCurrentTime();
      const drift = Math.abs(ytTime - positionRef.current);
      if (drift > DRIFT_THRESHOLD) {
        player.seekTo(positionRef.current, true);
      }
      // Sync play/pause state
      const state = player.getPlayerState();
      if (isPlayingRef.current && state === YT.PlayerState.PAUSED) {
        player.playVideo();
      } else if (!isPlayingRef.current && state === YT.PlayerState.PLAYING) {
        player.pauseVideo();
      }
    } catch {
      // player may not be ready yet
    }
  }, []);

  // Initialize player
  useEffect(() => {
    let destroyed = false;
    videoIdRef.current = videoId;

    ensureYTApi().then(() => {
      if (destroyed || !containerRef.current) return;

      // Clean up previous player
      if (playerRef.current) {
        try { playerRef.current.destroy(); } catch { /* ignore */ }
        playerRef.current = null;
      }

      // Create a div for the player inside the container
      const el = document.createElement("div");
      containerRef.current.innerHTML = "";
      containerRef.current.appendChild(el);

      playerRef.current = new YT.Player(el, {
        videoId,
        width: "100%",
        height: "100%",
        playerVars: {
          autoplay: 1,
          mute: 1,
          rel: 0,
          modestbranding: 1,
          enablejsapi: 1,
          start: Math.floor(positionRef.current),
          controls: 0,
          showinfo: 0,
          fs: 0,
        },
        events: {
          onReady: (event: YT.PlayerEvent) => {
            event.target.mute();
            event.target.seekTo(positionRef.current, true);
            if (isPlayingRef.current) {
              event.target.playVideo();
            }
          },
        },
      });
    });

    return () => {
      destroyed = true;
      if (playerRef.current) {
        try { playerRef.current.destroy(); } catch { /* ignore */ }
        playerRef.current = null;
      }
    };
  }, [videoId]);

  // Periodic sync
  useEffect(() => {
    const timer = setInterval(syncPosition, SYNC_INTERVAL);
    return () => clearInterval(timer);
  }, [syncPosition]);

  // Detect seeks (large position jumps) and sync immediately
  const prevPositionRef = useRef(position);
  useEffect(() => {
    const delta = Math.abs(position - prevPositionRef.current);
    prevPositionRef.current = position;
    if (delta > DRIFT_THRESHOLD) {
      const player = playerRef.current;
      if (player?.seekTo) {
        try { player.seekTo(position, true); } catch { /* ignore */ }
      }
    }
  }, [position]);

  // Sync play/pause immediately when it changes
  useEffect(() => {
    const player = playerRef.current;
    if (!player?.getPlayerState) return;
    try {
      if (isPlaying) {
        player.playVideo();
      } else {
        player.pauseVideo();
      }
    } catch { /* ignore */ }
  }, [isPlaying]);

  return (
    <div ref={containerRef} className={className} style={{ width: "100%", height: "100%" }} />
  );
}
