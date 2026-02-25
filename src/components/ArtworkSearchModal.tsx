import { useEffect, useState, useCallback, useRef } from "react";
import {
  searchArtwork,
  applyArtworkFromUrl,
  type ArtworkSearchResult,
  type ApplyArtworkResult,
} from "../lib/commands";

interface ArtworkSearchModalProps {
  artist: string;
  album: string;
  onApply: (result: ApplyArtworkResult) => void;
  onClose: () => void;
}

export function ArtworkSearchModal({
  artist,
  album,
  onApply,
  onClose,
}: ArtworkSearchModalProps) {
  const defaultQuery = [artist, album].filter(Boolean).join(" ");
  const [query, setQuery] = useState(defaultQuery);
  const [results, setResults] = useState<ArtworkSearchResult[]>([]);
  const [loading, setLoading] = useState(true);
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const doSearch = useCallback((q: string) => {
    setLoading(true);
    setError(null);
    setResults([]);
    searchArtwork(q, "")
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
    searchArtwork(artist, album)
      .then((r) => {
        setResults(r);
        setLoading(false);
      })
      .catch((e) => {
        setError(String(e));
        setLoading(false);
      });
  }, [artist, album]);

  const handleSelect = useCallback(
    async (result: ArtworkSearchResult) => {
      setApplying(true);
      try {
        const applied = await applyArtworkFromUrl(result.fullUrl, album, artist);
        onApply(applied);
      } catch (e) {
        setError(String(e));
        setApplying(false);
      }
    },
    [album, artist, onApply],
  );

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    },
    [onClose],
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
      <div className="bg-n-900 border border-n-700 rounded-lg shadow-xl w-[520px] max-h-[80vh] flex flex-col">
        {/* Header */}
        <div className="px-4 pt-4 pb-3 border-b border-n-800">
          <h2 className="text-sm font-semibold text-n-100 mb-2">
            Find Album Artwork
          </h2>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (query.trim()) doSearch(query.trim());
            }}
            className="flex gap-2"
          >
            <input
              ref={inputRef}
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => e.stopPropagation()}
              className="flex-1 bg-n-800 border border-n-700 rounded px-2 py-1 text-xs text-n-200 placeholder-n-500 outline-none focus:border-n-600"
              placeholder="Search artist, album..."
            />
            <button
              type="submit"
              disabled={loading || !query.trim()}
              className="px-3 py-1 text-xs bg-n-700 hover:bg-n-600 text-n-200 rounded transition-colors disabled:opacity-50"
            >
              Search
            </button>
          </form>
        </div>

        {/* Body */}
        <div className="px-4 py-4 flex-1 overflow-y-auto min-h-0">
          {loading && (
            <div className="flex items-center justify-center py-12">
              <svg
                className="animate-spin h-5 w-5 text-n-400"
                viewBox="0 0 24 24"
                fill="none"
              >
                <circle
                  className="opacity-25"
                  cx="12"
                  cy="12"
                  r="10"
                  stroke="currentColor"
                  strokeWidth="4"
                />
                <path
                  className="opacity-75"
                  fill="currentColor"
                  d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
                />
              </svg>
              <span className="ml-2 text-xs text-n-400">Searching...</span>
            </div>
          )}

          {applying && (
            <div className="flex items-center justify-center py-12">
              <svg
                className="animate-spin h-5 w-5 text-n-400"
                viewBox="0 0 24 24"
                fill="none"
              >
                <circle
                  className="opacity-25"
                  cx="12"
                  cy="12"
                  r="10"
                  stroke="currentColor"
                  strokeWidth="4"
                />
                <path
                  className="opacity-75"
                  fill="currentColor"
                  d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
                />
              </svg>
              <span className="ml-2 text-xs text-n-400">Applying...</span>
            </div>
          )}

          {error && (
            <p className="text-xs text-red-400 text-center py-8">{error}</p>
          )}

          {!loading && !applying && !error && results.length === 0 && (
            <p className="text-xs text-n-500 text-center py-8">
              No results found
            </p>
          )}

          {!loading && !applying && !error && results.length > 0 && (
            <div className="grid grid-cols-4 gap-3">
              {results.map((r, i) => (
                <button
                  key={i}
                  className="group flex flex-col items-center text-center rounded-lg p-1.5 hover:bg-n-800 transition-colors"
                  onClick={() => handleSelect(r)}
                >
                  <div className="w-full aspect-square rounded overflow-hidden bg-n-800 ring-2 ring-transparent group-hover:ring-blue-500 transition-all">
                    <img
                      src={r.thumbnailUrl}
                      alt={r.albumName}
                      className="w-full h-full object-cover"
                      loading="lazy"
                    />
                  </div>
                  <span className="text-[10px] text-n-300 mt-1.5 line-clamp-1 w-full">
                    {r.albumName}
                  </span>
                  <span className="text-[10px] text-n-500 line-clamp-1 w-full">
                    {r.artistName}
                  </span>
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
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
