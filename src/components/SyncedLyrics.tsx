import { useCallback, useEffect, useRef, useState } from "react";
import { fetchLyrics, type LyricsResult } from "../lib/commands";
import { parseLRC, findCurrentLineIndex, type LyricLine } from "../lib/lrcParser";
import { usePlaybackStore } from "../stores/playbackStore";

interface SyncedLyricsProps {
  trackName: string;
  artistName: string;
  albumName: string;
  duration: number | null;
}

type LyricsState =
  | { status: "loading" }
  | { status: "synced"; lines: LyricLine[] }
  | { status: "plain"; text: string }
  | { status: "instrumental" }
  | { status: "not-found" };

export function SyncedLyrics({ trackName, artistName, albumName, duration }: SyncedLyricsProps) {
  const [state, setState] = useState<LyricsState>({ status: "loading" });
  const [currentLine, setCurrentLine] = useState(-1);
  const containerRef = useRef<HTMLDivElement>(null);
  const lineRefs = useRef<(HTMLParagraphElement | null)[]>([]);
  const position = usePlaybackStore((s) => s.position);

  // Fetch lyrics on track identity change
  useEffect(() => {
    setState({ status: "loading" });
    setCurrentLine(-1);

    let cancelled = false;
    fetchLyrics(trackName, artistName, albumName, duration)
      .then((result: LyricsResult) => {
        if (cancelled) return;
        if (result.instrumental) {
          setState({ status: "instrumental" });
        } else if (result.syncedLyrics) {
          const lines = parseLRC(result.syncedLyrics);
          if (lines.length > 0) {
            setState({ status: "synced", lines });
          } else if (result.plainLyrics) {
            setState({ status: "plain", text: result.plainLyrics });
          } else {
            setState({ status: "not-found" });
          }
        } else if (result.plainLyrics) {
          setState({ status: "plain", text: result.plainLyrics });
        } else {
          setState({ status: "not-found" });
        }
      })
      .catch(() => {
        if (!cancelled) setState({ status: "not-found" });
      });

    return () => { cancelled = true; };
  }, [trackName, artistName, albumName, duration]);

  // Update current line from position
  useEffect(() => {
    if (state.status !== "synced") return;
    const idx = findCurrentLineIndex(state.lines, position);
    setCurrentLine(idx);
  }, [position, state]);

  // Auto-scroll to current line
  useEffect(() => {
    if (state.status !== "synced" || currentLine < 0) return;
    const el = lineRefs.current[currentLine];
    const container = containerRef.current;
    if (!el || !container) return;

    const containerRect = container.getBoundingClientRect();
    const elRect = el.getBoundingClientRect();
    const offset = elRect.top - containerRect.top - containerRect.height / 2 + elRect.height / 2;

    container.scrollTo({
      top: container.scrollTop + offset,
      behavior: "smooth",
    });
  }, [currentLine, state.status]);

  const setLineRef = useCallback((idx: number) => (el: HTMLParagraphElement | null) => {
    lineRefs.current[idx] = el;
  }, []);

  if (state.status === "loading") {
    return (
      <div data-tauri-drag-region className="flex items-center justify-center h-full text-white/30 text-sm">
        Loading lyrics...
      </div>
    );
  }

  if (state.status === "instrumental") {
    return (
      <div data-tauri-drag-region className="flex items-center justify-center h-full">
        <div data-tauri-drag-region className="text-center">
          <p data-tauri-drag-region className="text-white/40 text-lg">Instrumental</p>
        </div>
      </div>
    );
  }

  if (state.status === "not-found") {
    return null;
  }

  if (state.status === "plain") {
    return (
      <div
        ref={containerRef}
        data-tauri-drag-region
        className="h-full overflow-y-auto px-6 py-8 scrollbar-hide"
      >
        <div data-tauri-drag-region className="whitespace-pre-wrap text-white/50 text-lg leading-relaxed">
          {state.text}
        </div>
      </div>
    );
  }

  // Synced lyrics
  const { lines } = state;

  return (
    <div
      ref={containerRef}
      data-tauri-drag-region
      className="h-full overflow-y-auto px-6 scrollbar-hide"
    >
      {/* Top spacer so first line can center */}
      <div data-tauri-drag-region style={{ height: "50%" }} />
      {lines.map((line, i) => {
        const isCurrent = i === currentLine;
        return (
          <p
            key={i}
            ref={setLineRef(i)}
            data-tauri-drag-region
            className={`py-1.5 transition-all duration-300 ${
              isCurrent
                ? "text-white text-2xl font-semibold opacity-100"
                : "text-white/30 text-lg font-normal"
            }`}
          >
            {line.text}
          </p>
        );
      })}
      {/* Bottom spacer so last line can center */}
      <div data-tauri-drag-region style={{ height: "50%" }} />
    </div>
  );
}
