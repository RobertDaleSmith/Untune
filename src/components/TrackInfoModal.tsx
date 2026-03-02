import { useEffect, useState, useCallback } from "react";
import { listen } from "@tauri-apps/api/event";
import type { Track } from "../lib/types";
import { getArtworkDataUrl, retagTracks, getTrackById } from "../lib/commands";
import {
  formatDuration,
  formatDate,
  formatFileSize,
} from "../utils/formatters";

interface TrackInfoModalProps {
  track: Track;
  onClose: () => void;
  onPrev?: () => void;
  onNext?: () => void;
}

function InfoRow({ label, value }: { label: string; value: React.ReactNode }) {
  if (value == null || value === "" || value === false) return null;
  return (
    <div className="flex py-0.5">
      <span className="text-n-500 text-xs w-[120px] shrink-0 text-right pr-3">
        {label}
      </span>
      <span className="text-n-200 text-xs break-all min-w-0">{value}</span>
    </div>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <h3 className="text-[11px] font-semibold text-n-400 uppercase tracking-wider mb-1 mt-3 first:mt-0">
        {title}
      </h3>
      <div className="border-t border-n-800 pt-1">{children}</div>
    </div>
  );
}

function ratingStars(rating: number | null): string {
  if (!rating) return "";
  return "★".repeat(Math.round(rating / 20));
}

export function TrackInfoModal({
  track,
  onClose,
  onPrev,
  onNext,
}: TrackInfoModalProps) {
  const [artworkUrl, setArtworkUrl] = useState<string | null>(null);
  const [localTrack, setLocalTrack] = useState<Track>(track);
  const [tagging, setTagging] = useState(false);

  // Sync local track when the prop changes (e.g. prev/next navigation)
  useEffect(() => {
    setLocalTrack(track);
    setTagging(false);
  }, [track]);

  useEffect(() => {
    if (localTrack.artworkHash) {
      getArtworkDataUrl(localTrack.artworkHash)
        .then(setArtworkUrl)
        .catch(() => setArtworkUrl(null));
    } else {
      setArtworkUrl(null);
    }
  }, [localTrack.artworkHash]);

  // Listen for tagging completion to refresh track data
  useEffect(() => {
    if (!tagging) return;
    const unlisten = listen<{ done?: boolean }>("ai-tag-progress", async (event) => {
      if (event.payload.done) {
        const updated = await getTrackById(localTrack.id);
        if (updated) setLocalTrack(updated);
        setTagging(false);
      }
    });
    return () => { unlisten.then((fn) => fn()); };
  }, [tagging, localTrack.id]);

  const handleFetchAiTags = useCallback(() => {
    setTagging(true);
    retagTracks([localTrack.id]).catch(() => setTagging(false));
  }, [localTrack.id]);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
      } else if (e.key === "[" && e.metaKey && onPrev) {
        e.preventDefault();
        onPrev();
      } else if (e.key === "]" && e.metaKey && onNext) {
        e.preventDefault();
        onNext();
      }
    },
    [onClose, onPrev, onNext],
  );

  useEffect(() => {
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [handleKeyDown]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="bg-n-900 border border-n-700 rounded-lg shadow-xl w-[480px] max-h-[80vh] flex flex-col">
        {/* Header with artwork and title */}
        <div className="px-4 pt-4 pb-3 border-b border-n-800 flex gap-3 items-start">
          {/* Artwork */}
          <div className="w-16 h-16 rounded bg-n-800 shrink-0 overflow-hidden">
            {artworkUrl ? (
              <img
                src={artworkUrl}
                alt=""
                className="w-full h-full object-cover"
              />
            ) : (
              <div className="w-full h-full flex items-center justify-center text-n-600">
                <svg
                  width="24"
                  height="24"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                >
                  <circle cx="12" cy="12" r="10" />
                  <circle cx="12" cy="12" r="3" />
                </svg>
              </div>
            )}
          </div>
          <div className="min-w-0 flex-1">
            <h2 className="text-sm font-semibold text-n-100 truncate">
              {localTrack.title}
            </h2>
            {localTrack.artist && (
              <p className="text-xs text-n-400 truncate">{localTrack.artist}</p>
            )}
            {localTrack.album && (
              <p className="text-xs text-n-500 truncate">{localTrack.album}</p>
            )}
          </div>
          {/* Nav arrows */}
          <div className="flex items-center gap-1 shrink-0">
            <button
              onClick={onPrev}
              disabled={!onPrev}
              className="text-n-500 hover:text-n-200 disabled:opacity-30 disabled:hover:text-n-500 transition-colors p-0.5"
              title="Previous (Cmd+[)"
            >
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <polyline points="15 18 9 12 15 6" />
              </svg>
            </button>
            <button
              onClick={onNext}
              disabled={!onNext}
              className="text-n-500 hover:text-n-200 disabled:opacity-30 disabled:hover:text-n-500 transition-colors p-0.5"
              title="Next (Cmd+])"
            >
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <polyline points="9 18 15 12 9 6" />
              </svg>
            </button>
          </div>
        </div>

        {/* Body — scrollable */}
        <div className="px-4 py-2 flex-1 overflow-y-auto min-h-0">
          <Section title="Summary">
            <InfoRow label="Title" value={localTrack.title} />
            <InfoRow label="Artist" value={localTrack.artist} />
            <InfoRow label="Album Artist" value={localTrack.albumArtist} />
            <InfoRow label="Album" value={localTrack.album} />
            <InfoRow label="Genre" value={localTrack.genre} />
            <InfoRow label="Year" value={localTrack.year} />
            <InfoRow label="Composer" value={localTrack.composer} />
            <InfoRow label="Grouping" value={localTrack.grouping} />
            <InfoRow label="Comments" value={localTrack.comments} />
          </Section>

          <Section title="Details">
            <InfoRow label="Duration" value={formatDuration(localTrack.duration)} />
            <InfoRow
              label="Size"
              value={localTrack.size ? formatFileSize(localTrack.size) : null}
            />
            <InfoRow
              label="Bit Rate"
              value={localTrack.bitRate ? `${localTrack.bitRate} kbps` : null}
            />
            <InfoRow
              label="Sample Rate"
              value={
                localTrack.sampleRate
                  ? `${(localTrack.sampleRate / 1000).toFixed(1)} kHz`
                  : null
              }
            />
            <InfoRow
              label="Track"
              value={
                localTrack.trackNumber
                  ? localTrack.trackCount
                    ? `${localTrack.trackNumber} of ${localTrack.trackCount}`
                    : String(localTrack.trackNumber)
                  : null
              }
            />
            <InfoRow
              label="Disc"
              value={
                localTrack.discNumber
                  ? localTrack.discCount
                    ? `${localTrack.discNumber} of ${localTrack.discCount}`
                    : String(localTrack.discNumber)
                  : null
              }
            />
          </Section>

          <Section title="Stats">
            <InfoRow label="Play Count" value={localTrack.playCount ?? 0} />
            <InfoRow label="Skip Count" value={localTrack.skipCount ?? 0} />
            <InfoRow label="Rating" value={ratingStars(localTrack.rating)} />
            <InfoRow
              label="Loved"
              value={
                localTrack.loved != null ? (localTrack.loved ? "Yes" : "No") : null
              }
            />
            <InfoRow label="Date Added" value={formatDate(localTrack.dateAdded)} />
            <InfoRow
              label="Last Played"
              value={formatDate(localTrack.lastPlayedAt)}
            />
            <InfoRow
              label="Last Skipped"
              value={formatDate(localTrack.lastSkippedAt)}
            />
          </Section>

          <Section title="Sort Fields">
            <InfoRow label="Sort Title" value={localTrack.sortTitle} />
            <InfoRow label="Sort Artist" value={localTrack.sortArtist} />
            <InfoRow label="Sort Album" value={localTrack.sortAlbum} />
            <InfoRow
              label="Sort Album Artist"
              value={localTrack.sortAlbumArtist}
            />
            <InfoRow label="Sort Composer" value={localTrack.sortComposer} />
          </Section>

          <Section title="AI Tags">
            {localTrack.aiTaggedAt ? (
              <>
                <InfoRow label="Mood" value={localTrack.mood} />
                <InfoRow label="Energy" value={localTrack.energy != null ? `${localTrack.energy}/10` : null} />
                <InfoRow label="BPM" value={localTrack.bpm} />
                <InfoRow label="Danceability" value={localTrack.danceability != null ? `${localTrack.danceability}/10` : null} />
                <InfoRow label="Acousticness" value={localTrack.acousticness != null ? `${localTrack.acousticness}/10` : null} />
                <InfoRow
                  label="Vibe Tags"
                  value={localTrack.vibeTags ? (() => {
                    try { return (JSON.parse(localTrack.vibeTags) as string[]).join(", "); }
                    catch { return localTrack.vibeTags; }
                  })() : null}
                />
                <InfoRow label="Tagged At" value={formatDate(localTrack.aiTaggedAt)} />
              </>
            ) : (
              <div className="flex items-center justify-between py-1">
                <span className="text-xs text-n-500">Not yet analyzed</span>
                <button
                  onClick={handleFetchAiTags}
                  disabled={tagging}
                  className="px-3 py-1 text-[11px] rounded-md bg-accent/20 text-accent hover:bg-accent/30 transition-colors disabled:opacity-50"
                >
                  {tagging ? "Tagging..." : "Fetch AI Tags"}
                </button>
              </div>
            )}
          </Section>

          <Section title="File">
            <InfoRow label="File Path" value={localTrack.filePath} />
            <InfoRow label="Persistent ID" value={localTrack.persistentId} />
            <InfoRow label="Artwork Hash" value={localTrack.artworkHash} />
          </Section>
        </div>

        {/* Footer */}
        <div className="px-4 py-3 border-t border-n-800 flex justify-end">
          <button
            onClick={onClose}
            className="px-4 py-1.5 text-xs bg-n-800 hover:bg-n-700 text-n-200 rounded transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
