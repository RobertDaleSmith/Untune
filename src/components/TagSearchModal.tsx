import { useEffect, useState, useCallback, useRef } from "react";
import type { Track } from "../lib/types";
import {
  searchTrackTags,
  applyTrackTags,
  type TagSearchResult,
} from "../lib/commands";

interface TagSearchModalProps {
  track: Track;
  onApply: (updatedTrack: Track) => void;
  onClose: () => void;
}

function TagBadge({ label, value }: { label: string; value: string | number | null | undefined }) {
  if (value == null || value === "") return null;
  return (
    <span className="inline-flex items-center gap-1 text-[10px] text-n-400">
      <span className="text-n-600">{label}</span>
      {String(value)}
    </span>
  );
}

export function TagSearchModal({ track, onApply, onClose }: TagSearchModalProps) {
  const [results, setResults] = useState<TagSearchResult[]>([]);
  const [loading, setLoading] = useState(true);
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [applied, setApplied] = useState<number | null>(null);
  const [searchArtist, setSearchArtist] = useState(track.artist ?? "");
  const [searchTitle, setSearchTitle] = useState(track.title);
  const artistInputRef = useRef<HTMLInputElement>(null);

  const doSearch = useCallback((artist: string, title: string) => {
    if (!artist.trim()) {
      setError("Artist name is required to search");
      return;
    }
    setLoading(true);
    setError(null);
    setResults([]);
    setApplied(null);
    searchTrackTags(artist.trim(), title.trim())
      .then((r) => {
        setResults(r);
        setLoading(false);
      })
      .catch((e) => {
        setError(String(e));
        setLoading(false);
      });
  }, []);

  useEffect(() => {
    doSearch(searchArtist, searchTitle);
    // only run on mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleSelect = useCallback(
    async (result: TagSearchResult, index: number) => {
      setApplying(true);
      setError(null);
      try {
        const updated = await applyTrackTags(track.id, result);
        setApplied(index);
        setApplying(false);
        onApply(updated);
      } catch (e) {
        setError(String(e));
        setApplying(false);
      }
    },
    [track.id, onApply],
  );

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="bg-n-900 border border-n-700 rounded-lg shadow-xl w-[520px] max-h-[80vh] flex flex-col">
        {/* Header */}
        <div className="px-4 pt-4 pb-3 border-b border-n-800">
          <h2 className="text-sm font-semibold text-n-100 mb-2">
            Find Tags
          </h2>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              doSearch(searchArtist, searchTitle);
            }}
            className="flex gap-2 items-end"
          >
            <div className="flex-1 min-w-0">
              <label className="block text-[10px] text-n-500 mb-0.5">Artist</label>
              <input
                ref={artistInputRef}
                type="text"
                value={searchArtist}
                onChange={(e) => setSearchArtist(e.target.value)}
                onKeyDown={(e) => e.stopPropagation()}
                className="w-full bg-n-800 border border-n-700 rounded px-2 py-1 text-xs text-n-200 placeholder-n-500 outline-none focus:border-n-600"
                placeholder="Artist..."
              />
            </div>
            <div className="flex-1 min-w-0">
              <label className="block text-[10px] text-n-500 mb-0.5">Title</label>
              <input
                type="text"
                value={searchTitle}
                onChange={(e) => setSearchTitle(e.target.value)}
                onKeyDown={(e) => e.stopPropagation()}
                className="w-full bg-n-800 border border-n-700 rounded px-2 py-1 text-xs text-n-200 placeholder-n-500 outline-none focus:border-n-600"
                placeholder="Title..."
              />
            </div>
            <button
              type="submit"
              disabled={loading || !searchArtist.trim()}
              className="px-3 py-1 text-xs bg-n-700 hover:bg-n-600 text-n-200 rounded transition-colors disabled:opacity-50 shrink-0"
            >
              Search
            </button>
          </form>
        </div>

        {/* Body */}
        <div className="px-4 py-2 flex-1 overflow-y-auto min-h-0">
          {loading && (
            <div className="flex items-center justify-center py-12">
              <div className="w-4 h-4 border-[2px] border-n-600 border-t-n-300 rounded-full animate-spin" />
              <span className="ml-2 text-xs text-n-400">Searching MusicBrainz...</span>
            </div>
          )}

          {applying && (
            <div className="flex items-center justify-center py-12">
              <div className="w-4 h-4 border-[2px] border-n-600 border-t-n-300 rounded-full animate-spin" />
              <span className="ml-2 text-xs text-n-400">Applying tags...</span>
            </div>
          )}

          {error && (
            <p className="text-xs text-red-400 text-center py-8">{error}</p>
          )}

          {!loading && !applying && !error && results.length === 0 && (
            <p className="text-xs text-n-500 text-center py-8">
              No results found on MusicBrainz
            </p>
          )}

          {!loading && !applying && !error && results.length > 0 && (
            <div className="flex flex-col gap-1 py-1">
              {results.map((r, i) => (
                <button
                  key={i}
                  className={`w-full text-left px-3 py-2.5 rounded-lg transition-colors ${
                    applied === i
                      ? "bg-green-500/10 ring-1 ring-green-500/30"
                      : "hover:bg-n-800"
                  }`}
                  onClick={() => handleSelect(r, i)}
                  disabled={applying}
                >
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="text-[12px] text-n-100 font-medium truncate">
                      {r.album ?? "Unknown Album"}
                    </span>
                    <div className="flex items-center gap-2 shrink-0">
                      {r.releaseType && (
                        <span className={`text-[9px] px-1.5 py-0.5 rounded-full uppercase tracking-wider font-medium ${
                          r.releaseType === "Album"
                            ? "bg-accent/15 text-accent"
                            : r.releaseType === "EP"
                            ? "bg-blue-500/15 text-blue-400"
                            : "bg-n-700 text-n-400"
                        }`}>
                          {r.releaseType}
                        </span>
                      )}
                      {r.year && (
                        <span className="text-[11px] text-n-500 tabular-nums">{r.year}</span>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-1 mt-0.5 text-[11px] text-n-400 truncate">
                    {r.albumArtist ?? r.artist ?? ""}
                  </div>
                  <div className="flex items-center gap-3 mt-1">
                    <TagBadge label="Track" value={r.trackNumber != null ? (r.trackCount ? `${r.trackNumber}/${r.trackCount}` : r.trackNumber) : null} />
                    <TagBadge label="Disc" value={r.discNumber} />
                    <TagBadge label="Genre" value={r.genre} />
                  </div>
                  {applied === i && (
                    <div className="flex items-center gap-1 mt-1">
                      <svg width="10" height="10" viewBox="0 0 16 16" fill="currentColor" className="text-green-400">
                        <path d="M6 10.8L3.2 8l-1 1L6 12.8l8-8-1-1L6 10.8z" />
                      </svg>
                      <span className="text-[10px] text-green-400">Applied</span>
                    </div>
                  )}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-4 py-3 border-t border-n-800 flex justify-end">
          <button
            onClick={onClose}
            className="px-4 py-1.5 text-xs bg-n-800 hover:bg-n-700 text-n-200 rounded transition-colors"
          >
            {applied != null ? "Done" : "Cancel"}
          </button>
        </div>
      </div>
    </div>
  );
}
