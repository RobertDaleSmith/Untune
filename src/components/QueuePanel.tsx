import { useCallback, useEffect, useRef, useState } from "react";
import { usePlaybackStore } from "../stores/playbackStore";
import { useLibraryStore } from "../stores/libraryStore";
import { getQueueSnapshot, removeFromQueue, jumpToQueueIndex } from "../lib/commands";
import type { QueueEntry as RawQueueEntry } from "../lib/commands";
import { formatDuration } from "../utils/formatters";
import type { Track } from "../lib/types";

interface QueueDisplayEntry {
  trackId: number;
  queueIndex: number;
  track: Track | null;
  section: "history" | "current" | "upcoming";
}

export function QueuePanel() {
  const queuePanelOpen = usePlaybackStore((s) => s.queuePanelOpen);
  const toggleQueuePanel = usePlaybackStore((s) => s.toggleQueuePanel);
  const currentTrackId = usePlaybackStore((s) => s.currentTrackId);
  const isPlaying = usePlaybackStore((s) => s.isPlaying);
  const tracks = useLibraryStore((s) => s.tracks);

  const [entries, setEntries] = useState<QueueDisplayEntry[]>([]);

  // Build a lookup map for tracks
  const trackMap = useRef<Map<number, Track>>(new Map());
  useEffect(() => {
    const map = new Map<number, Track>();
    for (const t of tracks) {
      map.set(t.id, t);
    }
    trackMap.current = map;
  }, [tracks]);

  const toDisplay = useCallback((entry: RawQueueEntry, section: "history" | "current" | "upcoming"): QueueDisplayEntry => ({
    trackId: entry.trackId,
    queueIndex: entry.queueIndex,
    track: trackMap.current.get(entry.trackId) ?? null,
    section,
  }), []);

  // Fetch queue entries periodically
  const fetchQueue = useCallback(async () => {
    if (!queuePanelOpen || currentTrackId == null) {
      setEntries([]);
      return;
    }
    try {
      const snapshot = await getQueueSnapshot(50);
      const newEntries: QueueDisplayEntry[] = [];

      // History (returned most-recent-first, reverse to show oldest first)
      for (let i = snapshot.prev.length - 1; i >= 0; i--) {
        newEntries.push(toDisplay(snapshot.prev[i], "history"));
      }

      // Current
      if (snapshot.current) {
        newEntries.push(toDisplay(snapshot.current, "current"));
      }

      // Upcoming
      for (const entry of snapshot.next) {
        newEntries.push(toDisplay(entry, "upcoming"));
      }

      setEntries(newEntries);
    } catch {
      // Ignore
    }
  }, [queuePanelOpen, currentTrackId, toDisplay]);

  useEffect(() => {
    fetchQueue();
    if (!queuePanelOpen) return;
    const timer = setInterval(fetchQueue, 2000);
    return () => clearInterval(timer);
  }, [fetchQueue, queuePanelOpen]);

  const handleJump = useCallback(async (entry: QueueDisplayEntry) => {
    if (entry.section === "current") return;
    try {
      const trackId = await jumpToQueueIndex(entry.queueIndex);
      usePlaybackStore.setState({ currentTrackId: trackId, position: 0, isPlaying: true });
      fetchQueue();
    } catch {
      // Ignore
    }
  }, [fetchQueue]);

  const handleRemove = useCallback(async (entry: QueueDisplayEntry) => {
    if (entry.section !== "upcoming") return;
    try {
      await removeFromQueue(entry.queueIndex);
      fetchQueue();
    } catch {
      // Ignore
    }
  }, [fetchQueue]);

  return (
    <div
      className={`fixed top-[56px] right-0 bottom-0 w-[320px] bg-n-900 border-l border-n-700 z-40 flex flex-col transition-transform duration-300 ease-in-out ${
        queuePanelOpen ? "translate-x-0" : "translate-x-full"
      }`}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-n-800 shrink-0">
        <span className="text-[13px] font-medium text-n-200">Play Queue</span>
        <button
          onClick={toggleQueuePanel}
          className="text-n-500 hover:text-n-300 transition-colors"
          title="Close"
        >
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <path d="M4 4l8 8M12 4l-8 8" />
          </svg>
        </button>
      </div>

      {/* Queue list */}
      <div className="flex-1 overflow-y-auto min-h-0">
        {entries.length === 0 ? (
          <div className="flex items-center justify-center h-32 text-n-500 text-[12px]">
            No tracks in queue
          </div>
        ) : (
          <div className="py-1">
            {entries.map((entry, i) => {
              const prevSection = i > 0 ? entries[i - 1].section : null;
              const showLabel = entry.section !== prevSection;

              return (
                <div key={`${entry.section}-${entry.queueIndex}-${entry.trackId}`}>
                  {showLabel && (
                    <div className="px-4 pt-3 pb-1 text-[10px] font-medium text-n-500 uppercase tracking-wider">
                      {entry.section === "history" && "History"}
                      {entry.section === "current" && "Now Playing"}
                      {entry.section === "upcoming" && "Up Next"}
                    </div>
                  )}
                  <QueueRow
                    entry={entry}
                    isPlaying={entry.section === "current" && isPlaying}
                    onJump={entry.section !== "current" ? handleJump : undefined}
                    onRemove={entry.section === "upcoming" ? handleRemove : undefined}
                  />
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

function QueueRow({
  entry,
  isPlaying,
  onJump,
  onRemove,
}: {
  entry: QueueDisplayEntry;
  isPlaying: boolean;
  onJump?: (entry: QueueDisplayEntry) => void;
  onRemove?: (entry: QueueDisplayEntry) => void;
}) {
  const track = entry.track;

  return (
    <div
      className={`group flex items-center gap-3 px-4 py-1.5 ${
        entry.section === "current"
          ? "bg-accent/10"
          : entry.section === "history"
          ? "opacity-50 cursor-pointer"
          : "hover:bg-n-800/50 cursor-pointer"
      }`}
      onDoubleClick={() => onJump?.(entry)}
    >
      {/* Playing indicator */}
      <div className="w-4 shrink-0 text-center">
        {isPlaying ? (
          <span className="text-accent">
            <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor">
              <rect x="2" y="2" width="4" height="12" rx="1" />
              <rect x="10" y="2" width="4" height="12" rx="1" />
            </svg>
          </span>
        ) : null}
      </div>

      {/* Track info */}
      <div className="flex-1 min-w-0">
        <div className={`text-[12px] truncate ${entry.section === "current" ? "text-accent font-medium" : "text-n-200"}`}>
          {track?.title ?? `Track ${entry.trackId}`}
        </div>
        <div className="text-[11px] text-n-500 truncate">
          {track?.artist ?? "Unknown Artist"}
        </div>
      </div>

      {/* Duration */}
      <span className={`text-[11px] text-n-500 tabular-nums shrink-0 ${onRemove ? "group-hover:hidden" : ""}`}>
        {formatDuration(track?.duration ?? null)}
      </span>

      {/* Remove button (shown on hover for upcoming tracks) */}
      {onRemove && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onRemove(entry);
          }}
          className="hidden group-hover:block text-n-500 hover:text-n-300 transition-colors shrink-0"
          title="Remove from queue"
        >
          <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <path d="M4 4l8 8M12 4l-8 8" />
          </svg>
        </button>
      )}
    </div>
  );
}
