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

export async function setTrafficLightsVisible(visible: boolean): Promise<void> {
  return invoke("set_traffic_lights_visible", { visible });
}

export async function revealInFinder(path: string): Promise<void> {
  return invoke("reveal_in_finder", { path });
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

export async function getTrackAllArtworks(trackId: number): Promise<string[]> {
  return invoke<string[]>("get_track_all_artworks", { trackId });
}

export async function updateNowPlaying(
  title: string,
  artist: string | null,
  album: string | null,
  duration: number | null,
  position: number | null,
  isPlaying: boolean,
  artworkHash: string | null,
): Promise<void> {
  return invoke("update_now_playing", { title, artist, album, duration, position, isPlaying, artworkHash });
}

export async function clearNowPlaying(): Promise<void> {
  return invoke("clear_now_playing");
}

export interface UpcomingTracks {
  prevTrackIds: number[];
  nextTrackIds: number[];
}

export async function getUpcomingTracks(count: number): Promise<UpcomingTracks> {
  return invoke<UpcomingTracks>("get_upcoming_tracks", { count });
}

export async function getPreference(key: string): Promise<string | null> {
  return invoke<string | null>("get_preference", { key });
}

export async function setPreference(key: string, value: string): Promise<void> {
  return invoke("set_preference", { key, value });
}

export async function createSmartPlaylist(
  name: string,
  rulesJson: string,
  parentId?: number | null,
): Promise<number> {
  return invoke<number>("create_smart_playlist", { name, rulesJson, parentId });
}

export async function updateSmartPlaylist(
  playlistId: number,
  name?: string | null,
  rulesJson?: string | null,
): Promise<void> {
  return invoke("update_smart_playlist", { playlistId, name, rulesJson });
}

export async function renamePlaylist(playlistId: number, newName: string): Promise<void> {
  return invoke("rename_playlist", { playlistId, newName });
}

export async function deletePlaylist(playlistId: number): Promise<void> {
  return invoke("delete_playlist", { playlistId });
}

export async function createPlaylist(
  name: string,
  parentId?: number | null,
  trackIds?: number[] | null,
): Promise<number> {
  return invoke<number>("create_playlist", { name, parentId, trackIds });
}

export async function createPlaylistFolder(
  name: string,
  parentId?: number | null,
): Promise<number> {
  return invoke<number>("create_playlist_folder", { name, parentId });
}

export async function reorderPlaylists(
  updates: { id: number; sortOrder: number; parentId: number | null }[],
): Promise<void> {
  return invoke("reorder_playlists", { updates });
}

// --- Artwork search ---

export interface ArtworkSearchResult {
  thumbnailUrl: string;
  fullUrl: string;
  albumName: string;
  artistName: string;
  source: string;
}

export interface ApplyArtworkResult {
  artworkHash: string;
  updatedTrackIds: number[];
}

export async function searchArtwork(
  artist: string,
  album: string,
): Promise<ArtworkSearchResult[]> {
  return invoke<ArtworkSearchResult[]>("search_artwork", { artist, album });
}

export async function applyArtworkFromUrl(
  imageUrl: string,
  album: string,
  artist: string,
): Promise<ApplyArtworkResult> {
  return invoke<ApplyArtworkResult>("apply_artwork_from_url", { imageUrl, album, artist });
}

// --- Audio Devices ---

export interface AudioRoute {
  name: string;
  isAirplay: boolean;
}

export interface AudioDevice {
  id: number;
  name: string;
  isAirplay: boolean;
  isDefault: boolean;
}

export async function getAudioRoute(): Promise<AudioRoute> {
  return invoke<AudioRoute>("get_audio_route");
}

export async function getAudioDevices(): Promise<AudioDevice[]> {
  return invoke<AudioDevice[]>("get_audio_devices");
}

export async function setAudioDevice(deviceId: number): Promise<void> {
  return invoke("set_audio_device", { deviceId });
}

// --- Frequency data (visualizer) ---

export interface FrequencyData {
  bands: number[];
  waveform: number[];
  energy: number;
}

export async function getFrequencyData(): Promise<FrequencyData> {
  return invoke<FrequencyData>("get_frequency_data");
}

// --- Lyrics ---

export interface LyricsResult {
  syncedLyrics: string | null;
  plainLyrics: string | null;
  instrumental: boolean;
}

export async function fetchLyrics(
  trackName: string,
  artistName: string,
  albumName: string,
  duration: number | null,
): Promise<LyricsResult> {
  return invoke<LyricsResult>("fetch_lyrics", { trackName, artistName, albumName, duration });
}
