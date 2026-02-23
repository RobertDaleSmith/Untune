import { invoke } from "@tauri-apps/api/core";
import type { ImportStats, Playlist, Track, TrackQuery } from "./types";

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
