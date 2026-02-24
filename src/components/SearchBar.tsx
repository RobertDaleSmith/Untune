import { useRef, useEffect, useCallback, useState } from "react";
import { useLibraryStore } from "../stores/libraryStore";
import { useNavigationStore } from "../stores/navigationStore";
import { searchTracks } from "../lib/commands";

function SearchIcon({ size = 13 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <circle cx="6.5" cy="6.5" r="5" />
      <path d="M10.5 10.5L14.5 14.5" />
    </svg>
  );
}

export function SearchBar() {
  const { searchQuery, setSearchQuery, setSearchResults } = useLibraryStore();
  const view = useNavigationStore((s) => s.view);
  const playlistName = useNavigationStore((s) => s.playlistName);

  const viewLabel = (() => {
    switch (view) {
      case "songs": return "Songs";
      case "albums": return "Albums";
      case "artists": return "Artists";
      case "genres": return "Genres";
      case "playlist": return playlistName ?? "Playlist";
      case "album-detail": return "Album";
      case "artist-detail": return "Artist";
      case "genre-detail": return "Genre";
      default: return "Library";
    }
  })();
  const placeholder = `Find in ${viewLabel}`;

  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [collapsed, setCollapsed] = useState(() => window.innerWidth < 900);
  const [overlayOpen, setOverlayOpen] = useState(false);

  const handleSearch = useCallback(
    async (query: string) => {
      if (!query.trim()) {
        setSearchResults(null);
        return;
      }
      try {
        const results = await searchTracks(query, 500);
        setSearchResults(results);
      } catch (err) {
        console.error("Search failed:", err);
      }
    },
    [setSearchResults],
  );

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const value = e.target.value;
      setSearchQuery(value);
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => handleSearch(value), 200);
    },
    [setSearchQuery, handleSearch],
  );

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  // Collapse based on window width
  useEffect(() => {
    const onResize = () => setCollapsed(window.innerWidth < 900);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  const handleClear = useCallback(() => {
    setSearchQuery("");
    setSearchResults(null);
    setOverlayOpen(false);
  }, [setSearchQuery, setSearchResults]);

  const closeOverlay = useCallback(() => {
    if (searchQuery) return;
    setOverlayOpen(false);
  }, [searchQuery]);

  const openOverlay = useCallback(() => {
    setOverlayOpen(true);
    requestAnimationFrame(() => inputRef.current?.focus());
  }, []);

  // Collapsed: icon button (force overlay if query is active)
  if (collapsed && !overlayOpen && !searchQuery) {
    return (
      <button
        onClick={openOverlay}
        className="text-n-500 hover:text-n-300 transition-colors p-1"
        title={placeholder}
      >
        <SearchIcon />
      </button>
    );
  }

  // Collapsed + overlay open
  if (collapsed) {
    return (
      <div className="relative">
        <button
          onClick={closeOverlay}
          className={`p-1 transition-colors ${searchQuery ? "text-blue-400" : "text-n-300"}`}
          title={placeholder}
        >
          <SearchIcon />
        </button>
        <div className="absolute right-0 top-full mt-1 z-50">
          <div className="relative">
            <input
              ref={inputRef}
              type="text"
              value={searchQuery}
              onChange={handleChange}
              placeholder={placeholder}
              className="bg-n-800 text-n-200 text-sm px-3 py-1.5 pr-7 rounded-md border border-n-700 outline-none focus:border-n-500 w-48 placeholder:text-n-500 shadow-lg"
              onKeyDown={(e) => { if (e.key === "Escape") closeOverlay(); }}
              onBlur={(e) => {
                if (!e.relatedTarget?.closest("[data-search-clear]")) closeOverlay();
              }}
            />
            {searchQuery && (
              <button
                data-search-clear
                onClick={handleClear}
                className="absolute right-1.5 top-1/2 -translate-y-1/2 text-n-500 hover:text-n-300 transition-colors"
                title="Clear search"
              >
                <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                  <path d="M4 4l8 8M12 4l-8 8" />
                </svg>
              </button>
            )}
          </div>
        </div>
      </div>
    );
  }

  // Normal inline mode
  return (
    <div className="relative">
      <span className="absolute left-1.5 top-1/2 -translate-y-1/2 text-n-500 pointer-events-none">
        <SearchIcon size={11} />
      </span>
      <input
        type="text"
        value={searchQuery}
        onChange={handleChange}
        placeholder={placeholder}
        className="bg-n-800 text-n-200 text-xs pl-6 pr-6 py-1 rounded-md border border-n-700 outline-none focus:border-n-500 w-full max-w-[140px] min-w-[80px] placeholder:text-n-500"
      />
      {searchQuery && (
        <button
          onClick={handleClear}
          className="absolute right-1.5 top-1/2 -translate-y-1/2 text-n-500 hover:text-n-300 transition-colors"
          title="Clear search"
        >
          <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <path d="M4 4l8 8M12 4l-8 8" />
          </svg>
        </button>
      )}
    </div>
  );
}
