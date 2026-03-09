import { create } from "zustand";
import type { Track } from "../lib/types";
import { setTrackRating as setTrackRatingCmd, setTrackSourceUrl as setTrackSourceUrlCmd } from "../lib/commands";

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
  draggedTrackIds: number[];

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
  setDraggedTrackIds: (ids: number[]) => void;
  updateTrackRating: (trackId: number, rating: number | null) => void;
  updateTrackSourceUrl: (trackId: number, sourceUrl: string | null) => void;
  recordTrackPlayed: (trackId: number) => void;
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
  draggedTrackIds: [],

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
  setDraggedTrackIds: (draggedTrackIds) => set({ draggedTrackIds }),
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
  updateTrackSourceUrl: (trackId, sourceUrl) => {
    const updateTrack = (t: Track) =>
      t.id === trackId ? { ...t, sourceUrl } : t;
    set((state) => ({
      tracks: state.tracks.map(updateTrack),
      searchResults: state.searchResults?.map(updateTrack) ?? null,
    }));
    setTrackSourceUrlCmd(trackId, sourceUrl);
  },
  recordTrackPlayed: (trackId) => {
    const now = new Date().toISOString();
    const updateTrack = (t: Track) =>
      t.id === trackId
        ? { ...t, playCount: (t.playCount ?? 0) + 1, lastPlayedAt: now }
        : t;
    set((state) => ({
      tracks: state.tracks.map(updateTrack),
      searchResults: state.searchResults?.map(updateTrack) ?? null,
    }));
  },
}));
