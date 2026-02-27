import { create } from "zustand";
import { getPreference, setPreference } from "../lib/commands";

export type View =
  | "songs"
  | "albums"
  | "artists"
  | "genres"
  | "playlist"
  | "album-detail"
  | "artist-detail"
  | "genre-detail"
  | "smart-view";

interface NavigationState {
  view: View;
  playlistId: number | null;
  playlistName: string | null;
  albumKey: string | null;
  albumArtist: string | null;
  artistName: string | null;
  genreName: string | null;
  smartViewId: string | null;
  smartViewName: string | null;
  sidebarRefresh: number;
  detailVersion: number;
  scrollPositions: Record<string, number>;

  navigateTo: (view: View) => void;
  navigateToPlaylist: (id: number, name: string) => void;
  navigateToAlbum: (album: string, artist: string | null) => void;
  navigateToArtist: (name: string) => void;
  navigateToGenre: (name: string) => void;
  navigateToSmartView: (id: string, name: string) => void;
  requestSidebarRefresh: () => void;
  requestDetailRefresh: () => void;
  saveScrollPosition: (view: string, position: number) => void;
  getScrollPosition: (view: string) => number;
  init: () => Promise<void>;
}

const VALID_VIEWS: View[] = ["songs", "albums", "artists", "genres", "playlist", "album-detail", "artist-detail", "genre-detail", "smart-view"];

function saveNavigation(get: () => NavigationState) {
  const { view, playlistId, playlistName, albumKey, albumArtist, artistName, genreName, smartViewId, smartViewName } = get();
  const data = JSON.stringify({ view, playlistId, playlistName, albumKey, albumArtist, artistName, genreName, smartViewId, smartViewName });
  setPreference("session.navigation", data).catch(() => {});
}

export const useNavigationStore = create<NavigationState>((set, get) => ({
  view: "songs",
  playlistId: null,
  playlistName: null,
  albumKey: null,
  albumArtist: null,
  artistName: null,
  genreName: null,
  smartViewId: null,
  smartViewName: null,
  sidebarRefresh: 0,
  detailVersion: 0,
  scrollPositions: {},

  navigateTo: (view) => {
    set({ view });
    saveNavigation(get);
  },

  navigateToPlaylist: (id, name) => {
    set({ view: "playlist", playlistId: id, playlistName: name });
    saveNavigation(get);
  },

  navigateToAlbum: (album, artist) => {
    set({ view: "album-detail", albumKey: album, albumArtist: artist });
    saveNavigation(get);
  },

  navigateToArtist: (name) => {
    set({ view: "artist-detail", artistName: name });
    saveNavigation(get);
  },

  navigateToGenre: (name) => {
    set({ view: "genre-detail", genreName: name });
    saveNavigation(get);
  },

  navigateToSmartView: (id, name) => {
    set({ view: "smart-view", smartViewId: id, smartViewName: name });
    saveNavigation(get);
  },

  requestSidebarRefresh: () =>
    set((s) => ({ sidebarRefresh: s.sidebarRefresh + 1 })),

  requestDetailRefresh: () =>
    set((s) => ({ detailVersion: s.detailVersion + 1 })),

  saveScrollPosition: (view, position) =>
    set((s) => ({ scrollPositions: { ...s.scrollPositions, [view]: position } })),

  getScrollPosition: (view) => get().scrollPositions[view] ?? 0,

  init: async () => {
    try {
      const raw = await getPreference("session.navigation");
      if (!raw) return;
      const data = JSON.parse(raw);
      if (!data.view || !VALID_VIEWS.includes(data.view)) return;
      set({
        view: data.view,
        playlistId: data.playlistId ?? null,
        playlistName: data.playlistName ?? null,
        albumKey: data.albumKey ?? null,
        albumArtist: data.albumArtist ?? null,
        artistName: data.artistName ?? null,
        genreName: data.genreName ?? null,
        smartViewId: data.smartViewId ?? null,
        smartViewName: data.smartViewName ?? null,
      });
    } catch {
      // Ignore corrupt preferences
    }
  },
}));
