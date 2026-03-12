import { useEffect, useRef, useCallback, useState } from "react";

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

/** Only hard-seek when drift is really egregious (e.g. user seek / track change) */
const SEEK_THRESHOLD = 5;
/** How often to check play/pause state (ms) — no position correction */
const SYNC_INTERVAL = 3000;

export function YouTubePlayer({ videoId, position, isPlaying, className }: YouTubePlayerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const playerRef = useRef<YT.Player | null>(null);
  const videoIdRef = useRef(videoId);
  const positionRef = useRef(position);
  const isPlayingRef = useRef(isPlaying);
  const readyRef = useRef(false);
  const [visible, setVisible] = useState(false);

  // Keep refs in sync
  positionRef.current = position;
  isPlayingRef.current = isPlaying;

  const tryPlay = useCallback((player: YT.Player) => {
    try {
      const state = player.getPlayerState();
      // Play if unstarted, cued, or paused — covers all "stuck" states
      if (state === YT.PlayerState.UNSTARTED || state === YT.PlayerState.CUED || state === YT.PlayerState.PAUSED) {
        player.mute();
        player.playVideo();
      }
    } catch { /* player not ready */ }
  }, []);

  // Periodic check — only sync play/pause state and correct truly massive drift
  const syncState = useCallback(() => {
    const player = playerRef.current;
    if (!player?.getCurrentTime || !readyRef.current) return;
    try {
      // Only hard-seek if way off (5s+)
      const ytTime = player.getCurrentTime();
      const drift = Math.abs(ytTime - positionRef.current);
      if (drift > SEEK_THRESHOLD) {
        player.seekTo(positionRef.current, true);
      }
      // Keep play/pause in sync
      if (isPlayingRef.current) {
        tryPlay(player);
      } else {
        const state = player.getPlayerState();
        if (state === YT.PlayerState.PLAYING) {
          player.pauseVideo();
        }
      }
    } catch {
      // player may not be ready yet
    }
  }, [tryPlay]);

  // Initialize player once, then use loadVideoById for subsequent changes
  useEffect(() => {
    let destroyed = false;

    ensureYTApi().then(() => {
      if (destroyed || !containerRef.current) return;

      if (playerRef.current && readyRef.current) {
        // Reuse existing player — much more reliable than destroy/recreate
        videoIdRef.current = videoId;
        setVisible(false);
        playerRef.current.loadVideoById({
          videoId,
          startSeconds: Math.floor(positionRef.current),
        });
        return;
      }

      // First time: create the player
      videoIdRef.current = videoId;
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
          iv_load_policy: 3,
          disablekb: 1,
        },
        events: {
          onReady: (event: YT.PlayerEvent) => {
            readyRef.current = true;
            event.target.mute();
            event.target.seekTo(positionRef.current, true);
            if (isPlayingRef.current) {
              event.target.playVideo();
            }
          },
          onStateChange: (event: YT.OnStateChangeEvent) => {
            // Reveal once actually playing (hides initial title overlay)
            if (event.data === YT.PlayerState.PLAYING) {
              setVisible(true);
            }
            // Auto-recover from stuck states
            if (
              isPlayingRef.current &&
              (event.data === YT.PlayerState.UNSTARTED ||
               event.data === YT.PlayerState.CUED ||
               event.data === YT.PlayerState.PAUSED)
            ) {
              // Small delay to let YouTube finish its internal state transition
              setTimeout(() => {
                if (isPlayingRef.current && playerRef.current) {
                  tryPlay(playerRef.current);
                }
              }, 300);
            }
          },
        },
      });
    });

    return () => {
      destroyed = true;
    };
  }, [videoId, tryPlay]);

  // Cleanup only on unmount
  useEffect(() => {
    return () => {
      readyRef.current = false;
      if (playerRef.current) {
        try { playerRef.current.destroy(); } catch { /* ignore */ }
        playerRef.current = null;
      }
    };
  }, []);

  // Periodic play/pause sync + safety-net drift check
  useEffect(() => {
    const timer = setInterval(syncState, SYNC_INTERVAL);
    return () => clearInterval(timer);
  }, [syncState]);

  // Detect user seeks (large position jumps) and sync
  const prevPositionRef = useRef(position);
  useEffect(() => {
    const delta = Math.abs(position - prevPositionRef.current);
    prevPositionRef.current = position;
    if (delta > SEEK_THRESHOLD) {
      const player = playerRef.current;
      if (player?.seekTo) {
        try { player.seekTo(position, true); } catch { /* ignore */ }
      }
    }
  }, [position]);

  // Sync play/pause immediately when it changes
  useEffect(() => {
    const player = playerRef.current;
    if (!player || !readyRef.current) return;
    try {
      if (isPlaying) {
        tryPlay(player);
      } else {
        player.pauseVideo();
      }
    } catch { /* ignore */ }
  }, [isPlaying, tryPlay]);

  return (
    <div className={className} style={{ width: "100%", height: "100%", position: "relative", overflow: "hidden", background: "#000" }}>
      {/* Scale iframe wider (16:9 → square) so video fills height and sides clip */}
      <div
        ref={containerRef}
        style={{
          position: "absolute",
          top: 0,
          left: "50%",
          transform: "translateX(-50%)",
          width: "177.78%",  /* 16/9 of the square height */
          height: "100%",
        }}
      />
      {/* Black cover hides white iframe flash until video is actually playing */}
      {!visible && (
        <div style={{ position: "absolute", inset: 0, background: "#000", zIndex: 1 }} />
      )}
    </div>
  );
}
