import { useEffect, useState, useCallback } from "react";
import type { Track } from "../lib/types";
import { getArtworkDataUrl } from "../lib/commands";
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

  useEffect(() => {
    if (track.artworkHash) {
      getArtworkDataUrl(track.artworkHash)
        .then(setArtworkUrl)
        .catch(() => setArtworkUrl(null));
    } else {
      setArtworkUrl(null);
    }
  }, [track.artworkHash]);

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
              {track.title}
            </h2>
            {track.artist && (
              <p className="text-xs text-n-400 truncate">{track.artist}</p>
            )}
            {track.album && (
              <p className="text-xs text-n-500 truncate">{track.album}</p>
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
            <InfoRow label="Title" value={track.title} />
            <InfoRow label="Artist" value={track.artist} />
            <InfoRow label="Album Artist" value={track.albumArtist} />
            <InfoRow label="Album" value={track.album} />
            <InfoRow label="Genre" value={track.genre} />
            <InfoRow label="Year" value={track.year} />
            <InfoRow label="Composer" value={track.composer} />
            <InfoRow label="Grouping" value={track.grouping} />
            <InfoRow label="Comments" value={track.comments} />
          </Section>

          <Section title="Details">
            <InfoRow label="Duration" value={formatDuration(track.duration)} />
            <InfoRow
              label="Size"
              value={track.size ? formatFileSize(track.size) : null}
            />
            <InfoRow
              label="Bit Rate"
              value={track.bitRate ? `${track.bitRate} kbps` : null}
            />
            <InfoRow
              label="Sample Rate"
              value={
                track.sampleRate
                  ? `${(track.sampleRate / 1000).toFixed(1)} kHz`
                  : null
              }
            />
            <InfoRow
              label="Track"
              value={
                track.trackNumber
                  ? track.trackCount
                    ? `${track.trackNumber} of ${track.trackCount}`
                    : String(track.trackNumber)
                  : null
              }
            />
            <InfoRow
              label="Disc"
              value={
                track.discNumber
                  ? track.discCount
                    ? `${track.discNumber} of ${track.discCount}`
                    : String(track.discNumber)
                  : null
              }
            />
          </Section>

          <Section title="Stats">
            <InfoRow label="Play Count" value={track.playCount ?? 0} />
            <InfoRow label="Skip Count" value={track.skipCount ?? 0} />
            <InfoRow label="Rating" value={ratingStars(track.rating)} />
            <InfoRow
              label="Loved"
              value={
                track.loved != null ? (track.loved ? "Yes" : "No") : null
              }
            />
            <InfoRow label="Date Added" value={formatDate(track.dateAdded)} />
            <InfoRow
              label="Last Played"
              value={formatDate(track.lastPlayedAt)}
            />
            <InfoRow
              label="Last Skipped"
              value={formatDate(track.lastSkippedAt)}
            />
          </Section>

          <Section title="Sort Fields">
            <InfoRow label="Sort Title" value={track.sortTitle} />
            <InfoRow label="Sort Artist" value={track.sortArtist} />
            <InfoRow label="Sort Album" value={track.sortAlbum} />
            <InfoRow
              label="Sort Album Artist"
              value={track.sortAlbumArtist}
            />
            <InfoRow label="Sort Composer" value={track.sortComposer} />
          </Section>

          <Section title="File">
            <InfoRow label="File Path" value={track.filePath} />
            <InfoRow label="Persistent ID" value={track.persistentId} />
            <InfoRow label="Artwork Hash" value={track.artworkHash} />
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
