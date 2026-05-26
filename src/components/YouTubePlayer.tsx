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
  /** Use full resolution instead of scaled 320x180 (for large displays like visualizer) */
  fullRes?: boolean;
  /** Called when video fails to load (no internet, blocked, etc.) */
  onError?: () => void;
}

let apiLoading = false;
let apiReady = false;
const readyCallbacks: (() => void)[] = [];

const errorCallbacks: (() => void)[] = [];

function ensureYTApi(): Promise<void> {
  if (apiReady && window.YT?.Player) return Promise.resolve();
  return new Promise((resolve, reject) => {
    readyCallbacks.push(resolve);
    errorCallbacks.push(reject);
    if (apiLoading) return;
    apiLoading = true;
    const prev = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      prev?.();
      apiReady = true;
      for (const cb of readyCallbacks) cb();
      readyCallbacks.length = 0;
      errorCallbacks.length = 0;
    };
    const script = document.createElement("script");
    script.src = "https://www.youtube.com/iframe_api";
    script.onerror = () => {
      apiLoading = false;
      for (const cb of errorCallbacks) cb();
      errorCallbacks.length = 0;
      readyCallbacks.length = 0;
    };
    // Timeout — if API doesn't load in 5s, treat as offline
    setTimeout(() => {
      if (!apiReady) {
        apiLoading = false;
        for (const cb of errorCallbacks) cb();
        errorCallbacks.length = 0;
        readyCallbacks.length = 0;
      }
    }, 5000);
    document.head.appendChild(script);
  });
}

/** A local-position jump larger than this means the user scrubbed — seek the video. */
const USER_SEEK_THRESHOLD = 1.5;
/** Only correct YouTube drift beyond this. The video is muted background visuals, so
 *  loose sync is fine; tight correction causes a seek→buffer→drift→seek reload loop. */
const DRIFT_TOLERANCE = 3;
/** After any seek, skip drift correction this long so the buffer can settle
 *  (getCurrentTime is unreliable mid-buffer and would trigger an immediate re-seek). */
const SEEK_COOLDOWN_MS = 4000;
/** How often to check drift and sync (ms) */
const SYNC_INTERVAL = 1000;
/** Offset added to local position when syncing to YouTube (compensates for YT startup lag) */
const YT_OFFSET = 0.8;

export function YouTubePlayer({ videoId, position, isPlaying, className, fullRes, onError }: YouTubePlayerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const playerRef = useRef<YT.Player | null>(null);
  const videoIdRef = useRef(videoId);
  const positionRef = useRef(position);
  const isPlayingRef = useRef(isPlaying);
  const readyRef = useRef(false);
  const lastSeekRef = useRef(0);
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
    if (!player?.getPlayerState) return;
    // Lift the black cover as soon as the video is actually playing. Don't rely
    // solely on the onStateChange PLAYING event — the YT iframe delivers it via
    // postMessage, which a webview can drop, leaving the video playing behind a
    // stuck black cover ("works sometimes, then just black").
    try {
      if (player.getPlayerState() === YT.PlayerState.PLAYING) setVisible(true);
    } catch { /* player not ready yet */ }
    if (!player.getCurrentTime || !readyRef.current) return;
    try {
      // Keep play/pause in sync (cheap, no reload)
      if (isPlayingRef.current) {
        tryPlay(player);
      } else if (player.getPlayerState() === YT.PlayerState.PLAYING) {
        player.pauseVideo();
      }
      // Drift correction: tolerant, and never right after a seek. A seek forces a
      // buffer during which the (unpaused) local audio races ahead, so aggressive
      // correction becomes a seek→buffer→drift→seek reload loop.
      if (Date.now() - lastSeekRef.current < SEEK_COOLDOWN_MS) return;
      const target = positionRef.current + YT_OFFSET;
      const drift = Math.abs(player.getCurrentTime() - target);
      if (drift > DRIFT_TOLERANCE) {
        player.seekTo(target, true);
        lastSeekRef.current = Date.now();
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
        videoIdRef.current = videoId;
        setVisible(false);
        playerRef.current.loadVideoById({
          videoId,
          startSeconds: Math.floor(positionRef.current + YT_OFFSET),
        });
        lastSeekRef.current = Date.now();
        return;
      }

      videoIdRef.current = videoId;
      const el = document.createElement("div");
      containerRef.current.innerHTML = "";
      containerRef.current.appendChild(el);

      playerRef.current = new YT.Player(el, {
        videoId,
        width: fullRes ? "100%" : 320,
        height: fullRes ? "100%" : 180,
        playerVars: {
          autoplay: 1,
          mute: 1,
          rel: 0,
          modestbranding: 1,
          enablejsapi: 1,
          start: Math.floor(positionRef.current + YT_OFFSET),
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
            event.target.seekTo(positionRef.current + YT_OFFSET, true);
            lastSeekRef.current = Date.now();
            if (isPlayingRef.current) {
              event.target.playVideo();
            }
          },
          onStateChange: (event: YT.OnStateChangeEvent) => {
            if (event.data === YT.PlayerState.PLAYING) {
              setVisible(true);
            }
            if (
              isPlayingRef.current &&
              (event.data === YT.PlayerState.UNSTARTED ||
               event.data === YT.PlayerState.CUED ||
               event.data === YT.PlayerState.PAUSED)
            ) {
              setTimeout(() => {
                if (isPlayingRef.current && playerRef.current) {
                  tryPlay(playerRef.current);
                }
              }, 300);
            }
          },
          onError: () => {
            onError?.();
          },
        },
      });
    }).catch(() => {
      // YT API failed to load (no internet)
      onError?.();
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
    if (delta > USER_SEEK_THRESHOLD) {
      const player = playerRef.current;
      if (player?.seekTo) {
        try { player.seekTo(position + YT_OFFSET, true); lastSeekRef.current = Date.now(); } catch { /* ignore */ }
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

  // Render iframe at fixed 320x180 and CSS-scale to fill container
  // This keeps YT branding proportional at any display size
  const outerRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);

  useEffect(() => {
    const el = outerRef.current;
    if (!el) return;
    const update = () => {
      const w = el.clientWidth;
      const h = el.clientHeight;
      // Scale to cover (like object-fit: cover)
      setScale(Math.max(w / 320, h / 180));
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return (
    <div ref={outerRef} className={className} style={{ width: "100%", height: "100%", position: "relative", overflow: "hidden", background: "#000" }}>
      {/* CSS override to force YT iframe to fill container */}
      <style>{`
        .yt-full-res iframe { width: 100% !important; height: 100% !important; }
      `}</style>
      <div
        ref={containerRef}
        className={fullRes ? "yt-full-res" : undefined}
        style={fullRes ? {
          position: "absolute",
          inset: 0,
          width: "100%",
          height: "100%",
        } : {
          position: "absolute",
          top: "50%",
          left: "50%",
          width: 320,
          height: 180,
          transform: `translate(-50%, -50%) scale(${scale})`,
          transformOrigin: "center center",
        }}
      />
      {/* Black cover hides white iframe flash until video is actually playing */}
      {!visible && (
        <div style={{ position: "absolute", inset: 0, background: "#000", zIndex: 1 }} />
      )}
    </div>
  );
}
