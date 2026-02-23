import { useRef, useEffect, useCallback } from "react";
import { useLibraryStore } from "../stores/libraryStore";
import { searchTracks } from "../lib/commands";

export function SearchBar() {
  const { searchQuery, setSearchQuery, setSearchResults } = useLibraryStore();
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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

  return (
    <input
      type="text"
      value={searchQuery}
      onChange={handleChange}
      placeholder="Search..."
      className="bg-neutral-800 text-neutral-200 text-sm px-3 py-1.5 rounded-md border border-neutral-700 outline-none focus:border-neutral-500 w-64 placeholder:text-neutral-500"
    />
  );
}
