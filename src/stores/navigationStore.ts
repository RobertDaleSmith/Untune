import { create } from "zustand";

export type View =
  | "songs"
  | "albums"
  | "artists"
  | "genres"
  | "playlist"
  | "album-detail"
  | "artist-detail"
  | "genre-detail";

interface NavigationState {
  view: View;
  playlistId: number | null;
  playlistName: string | null;
  albumKey: string | null;
  albumArtist: string | null;
  artistName: string | null;
  genreName: string | null;
  sidebarRefresh: number;
  detailVersion: number;
  scrollPositions: Record<string, number>;

  navigateTo: (view: View) => void;
  navigateToPlaylist: (id: number, name: string) => void;
  navigateToAlbum: (album: string, artist: string | null) => void;
  navigateToArtist: (name: string) => void;
  navigateToGenre: (name: string) => void;
  requestSidebarRefresh: () => void;
  requestDetailRefresh: () => void;
  saveScrollPosition: (view: string, position: number) => void;
  getScrollPosition: (view: string) => number;
}

export const useNavigationStore = create<NavigationState>((set, get) => ({
  view: "songs",
  playlistId: null,
  playlistName: null,
  albumKey: null,
  albumArtist: null,
  artistName: null,
  genreName: null,
  sidebarRefresh: 0,
  detailVersion: 0,
  scrollPositions: {},

  navigateTo: (view) => set({ view }),

  navigateToPlaylist: (id, name) =>
    set({ view: "playlist", playlistId: id, playlistName: name }),

  navigateToAlbum: (album, artist) =>
    set({ view: "album-detail", albumKey: album, albumArtist: artist }),

  navigateToArtist: (name) =>
    set({ view: "artist-detail", artistName: name }),

  navigateToGenre: (name) =>
    set({ view: "genre-detail", genreName: name }),

  requestSidebarRefresh: () =>
    set((s) => ({ sidebarRefresh: s.sidebarRefresh + 1 })),

  requestDetailRefresh: () =>
    set((s) => ({ detailVersion: s.detailVersion + 1 })),

  saveScrollPosition: (view, position) =>
    set((s) => ({ scrollPositions: { ...s.scrollPositions, [view]: position } })),

  getScrollPosition: (view) => get().scrollPositions[view] ?? 0,
}));
