import { invoke } from "@tauri-apps/api/core";
import type {
  AlbumSummary,
  ArtistSummary,
  GenreSummary,
  ImportStats,
  PlaybackInfo,
  Playlist,
  Track,
  TrackQuery,
  ViewSettings,
} from "./types";

export async function importLibrary(): Promise<ImportStats> {
  return invoke<ImportStats>("import_library");
}

export async function getTracks(query: TrackQuery): Promise<Track[]> {
  return invoke<Track[]>("get_tracks", { query });
}

export async function getTrackCount(): Promise<number> {
  return invoke<number>("get_track_count");
}

export async function searchTracks(
  query: string,
  limit?: number,
): Promise<Track[]> {
  return invoke<Track[]>("search_tracks", { query, limit });
}

export async function getPlaylists(): Promise<Playlist[]> {
  return invoke<Playlist[]>("get_playlists");
}

export async function getPlaylistTracks(playlistId: number): Promise<Track[]> {
  return invoke<Track[]>("get_playlist_tracks", { playlistId });
}

export async function playTrack(trackId: number): Promise<void> {
  return invoke("play_track", { trackId });
}

export async function playQueue(trackIds: number[], startIndex: number): Promise<void> {
  return invoke("play_queue", { trackIds, startIndex });
}

export async function pausePlayback(): Promise<void> {
  return invoke("pause_playback");
}

export async function resumePlayback(): Promise<void> {
  return invoke("resume_playback");
}

export async function stopPlayback(): Promise<void> {
  return invoke("stop_playback");
}

export async function seekPlayback(positionSecs: number): Promise<void> {
  return invoke("seek_playback", { positionSecs });
}

export async function nextTrack(): Promise<number | null> {
  return invoke<number | null>("next_track");
}

export async function previousTrack(): Promise<number | null> {
  return invoke<number | null>("previous_track");
}

export async function getPlaybackInfo(): Promise<PlaybackInfo> {
  return invoke<PlaybackInfo>("get_playback_info");
}

export async function setVolume(level: number): Promise<void> {
  return invoke("set_volume", { level });
}

export async function toggleShuffle(): Promise<boolean> {
  return invoke<boolean>("toggle_shuffle");
}

export async function setShuffleCmd(enabled: boolean): Promise<void> {
  return invoke("set_shuffle", { enabled });
}

export async function setRepeatModeCmd(mode: string): Promise<void> {
  return invoke("set_repeat_mode", { mode });
}

export async function cycleRepeat(): Promise<string> {
  return invoke<string>("cycle_repeat");
}

export async function getViewSettings(viewKey: string): Promise<ViewSettings | null> {
  return invoke<ViewSettings | null>("get_view_settings", { viewKey });
}

export async function saveViewSettings(
  viewKey: string,
  shuffle: boolean,
  repeatMode: string,
): Promise<void> {
  return invoke("save_view_settings", { viewKey, shuffle, repeatMode });
}

export async function getAlbums(): Promise<AlbumSummary[]> {
  return invoke<AlbumSummary[]>("get_albums");
}

export async function getArtists(): Promise<ArtistSummary[]> {
  return invoke<ArtistSummary[]>("get_artists");
}

export async function getGenres(): Promise<GenreSummary[]> {
  return invoke<GenreSummary[]>("get_genres");
}

export async function getAlbumTracks(album: string, artist: string): Promise<Track[]> {
  return invoke<Track[]>("get_album_tracks", { album, artist });
}

export async function getArtistTracks(artist: string): Promise<Track[]> {
  return invoke<Track[]>("get_artist_tracks", { artist });
}

export async function getGenreTracks(genre: string): Promise<Track[]> {
  return invoke<Track[]>("get_genre_tracks", { genre });
}

export async function getArtworkDataUrl(artworkHash: string): Promise<string | null> {
  return invoke<string | null>("get_artwork_data_url", { artworkHash });
}
