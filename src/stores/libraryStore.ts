import { create } from "zustand";
import type { Track } from "../lib/types";

interface LibraryState {
  tracks: Track[];
  isImported: boolean;
  isImporting: boolean;
  importError: string | null;
  searchQuery: string;
  searchResults: Track[] | null;
  sortColumn: string;
  sortDirection: "asc" | "desc";
  trackCount: number;

  setTracks: (tracks: Track[]) => void;
  setIsImported: (v: boolean) => void;
  setIsImporting: (v: boolean) => void;
  setImportError: (err: string | null) => void;
  setSearchQuery: (q: string) => void;
  setSearchResults: (results: Track[] | null) => void;
  setSorting: (column: string, direction: "asc" | "desc") => void;
  setTrackCount: (count: number) => void;
}

export const useLibraryStore = create<LibraryState>((set) => ({
  tracks: [],
  isImported: false,
  isImporting: false,
  importError: null,
  searchQuery: "",
  searchResults: null,
  sortColumn: "id",
  sortDirection: "asc",
  trackCount: 0,

  setTracks: (tracks) => set({ tracks, isImported: true }),
  setIsImported: (isImported) => set({ isImported }),
  setIsImporting: (isImporting) => set({ isImporting }),
  setImportError: (importError) => set({ importError }),
  setSearchQuery: (searchQuery) => set({ searchQuery }),
  setSearchResults: (searchResults) => set({ searchResults }),
  setSorting: (sortColumn, sortDirection) => set({ sortColumn, sortDirection }),
  setTrackCount: (trackCount) => set({ trackCount }),
}));
