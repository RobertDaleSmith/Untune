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

  navigateTo: (view: View) => void;
  navigateToPlaylist: (id: number, name: string) => void;
  navigateToAlbum: (album: string, artist: string | null) => void;
  navigateToArtist: (name: string) => void;
  navigateToGenre: (name: string) => void;
}

export const useNavigationStore = create<NavigationState>((set) => ({
  view: "songs",
  playlistId: null,
  playlistName: null,
  albumKey: null,
  albumArtist: null,
  artistName: null,
  genreName: null,

  navigateTo: (view) => set({ view }),

  navigateToPlaylist: (id, name) =>
    set({ view: "playlist", playlistId: id, playlistName: name }),

  navigateToAlbum: (album, artist) =>
    set({ view: "album-detail", albumKey: album, albumArtist: artist }),

  navigateToArtist: (name) =>
    set({ view: "artist-detail", artistName: name }),

  navigateToGenre: (name) =>
    set({ view: "genre-detail", genreName: name }),
}));
