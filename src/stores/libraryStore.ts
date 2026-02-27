import { create } from "zustand";
import type { Track } from "../lib/types";
import { setTrackRating as setTrackRatingCmd } from "../lib/commands";

interface LibraryState {
  tracks: Track[];
  isLoading: boolean;
  isImported: boolean;
  isImporting: boolean;
  tracksLoading: boolean;
  importError: string | null;
  searchQuery: string;
  searchResults: Track[] | null;
  sortColumn: string;
  sortDirection: "asc" | "desc";
  trackCount: number;
  statusBarTracks: Track[];
  selectedTrackIds: number[];

  setTracks: (tracks: Track[]) => void;
  setIsLoading: (v: boolean) => void;
  setIsImported: (v: boolean) => void;
  setIsImporting: (v: boolean) => void;
  setTracksLoading: (v: boolean) => void;
  setImportError: (err: string | null) => void;
  setSearchQuery: (q: string) => void;
  setSearchResults: (results: Track[] | null) => void;
  setSorting: (column: string, direction: "asc" | "desc") => void;
  setTrackCount: (count: number) => void;
  setStatusBarTracks: (tracks: Track[]) => void;
  setSelectedTrackIds: (ids: number[]) => void;
  updateTrackRating: (trackId: number, rating: number | null) => void;
}

export const useLibraryStore = create<LibraryState>((set) => ({
  tracks: [],
  isLoading: true,
  isImported: false,
  isImporting: false,
  tracksLoading: false,
  importError: null,
  searchQuery: "",
  searchResults: null,
  sortColumn: "id",
  sortDirection: "asc",
  trackCount: 0,
  statusBarTracks: [],
  selectedTrackIds: [],

  setTracks: (tracks) => set({ tracks, isImported: true, isLoading: false, tracksLoading: false }),
  setIsLoading: (isLoading) => set({ isLoading }),
  setIsImported: (isImported) => set({ isImported }),
  setIsImporting: (isImporting) => set({ isImporting }),
  setTracksLoading: (tracksLoading) => set({ tracksLoading }),
  setImportError: (importError) => set({ importError }),
  setSearchQuery: (searchQuery) => set({ searchQuery }),
  setSearchResults: (searchResults) => set({ searchResults }),
  setSorting: (sortColumn, sortDirection) => set({ sortColumn, sortDirection }),
  setTrackCount: (trackCount) => set({ trackCount }),
  setStatusBarTracks: (statusBarTracks) => set({ statusBarTracks }),
  setSelectedTrackIds: (selectedTrackIds) => set({ selectedTrackIds }),
  updateTrackRating: (trackId, rating) => {
    const dbRating = rating != null ? rating * 20 : null;
    const updateTrack = (t: Track) =>
      t.id === trackId ? { ...t, rating: dbRating } : t;
    set((state) => ({
      tracks: state.tracks.map(updateTrack),
      searchResults: state.searchResults?.map(updateTrack) ?? null,
    }));
    setTrackRatingCmd(trackId, dbRating);
  },
}));
