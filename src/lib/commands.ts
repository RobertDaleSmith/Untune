import { invoke } from "@tauri-apps/api/core";
import type {
  AlbumSummary,
  ArtistSummary,
  AssistantResponse,
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

export interface ImportFilesResult {
  imported: number;
  skipped: number;
  failed: number;
}

export async function importFiles(paths: string[]): Promise<ImportFilesResult> {
  return invoke<ImportFilesResult>("import_files", { paths });
}

export async function resetLibrary(): Promise<void> {
  return invoke("reset_library");
}

export async function exportLibrary(outputPath: string): Promise<number> {
  return invoke<number>("export_library", { outputPath });
}

export async function getTrackById(trackId: number): Promise<Track | null> {
  return invoke<Track | null>("get_track_by_id", { trackId });
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

export async function playQueueAtPosition(trackIds: number[], startIndex: number, positionSecs: number): Promise<void> {
  return invoke("play_queue_at_position", { trackIds, startIndex, positionSecs });
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

export async function setAppIcon(variant: "light" | "dark"): Promise<void> {
  return invoke("set_app_icon", { variant });
}

export async function revealInFinder(path: string): Promise<void> {
  return invoke("reveal_in_finder", { path });
}

export async function setTrackRating(trackId: number, rating: number | null): Promise<void> {
  return invoke("set_track_rating", { trackId, rating });
}

export async function setTrackSourceUrl(trackId: number, sourceUrl: string | null): Promise<void> {
  return invoke("set_track_source_url", { trackId, sourceUrl });
}

export async function getSmartViewTracks(viewName: string): Promise<Track[]> {
  return invoke<Track[]>("get_smart_view_tracks", { viewName });
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

export interface QueueEntry {
  trackId: number;
  queueIndex: number;
}

export interface QueueSnapshot {
  prev: QueueEntry[];
  current: QueueEntry | null;
  next: QueueEntry[];
}

export async function getQueueSnapshot(count: number): Promise<QueueSnapshot> {
  return invoke<QueueSnapshot>("get_queue_snapshot", { count });
}

export async function removeFromQueue(index: number): Promise<void> {
  return invoke("remove_from_queue", { index });
}

export async function jumpToQueueIndex(index: number): Promise<number> {
  return invoke<number>("jump_to_queue_index", { index });
}

export async function moveQueueItem(fromIndex: number, toIndex: number): Promise<void> {
  return invoke("move_queue_item", { fromIndex, toIndex });
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

export async function addTracksToPlaylist(playlistId: number, trackIds: number[]): Promise<void> {
  return invoke("add_tracks_to_playlist", { playlistId, trackIds });
}

export async function exportPlaylistM3u(playlistId: number, outputPath: string): Promise<void> {
  return invoke("export_playlist_m3u", { playlistId, outputPath });
}

export async function importPlaylistM3u(filePath: string): Promise<number> {
  return invoke<number>("import_playlist_m3u", { filePath });
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

export async function setCrossfadeDuration(seconds: number): Promise<void> {
  return invoke("set_crossfade_duration", { seconds });
}

export async function getCrossfadeDuration(): Promise<number> {
  return invoke<number>("get_crossfade_duration");
}

export async function preBufferNext(trackId: number): Promise<boolean> {
  return invoke<boolean>("pre_buffer_next", { trackId });
}

// --- Sleep timer ---

export async function setSleepTimer(minutes: number): Promise<void> {
  return invoke("set_sleep_timer", { minutes });
}

export async function cancelSleepTimer(): Promise<void> {
  return invoke("cancel_sleep_timer");
}

export async function getSleepTimerRemaining(): Promise<number | null> {
  return invoke<number | null>("get_sleep_timer_remaining");
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

// --- Assistant ---

export async function assistantAvailable(): Promise<boolean> {
  return invoke<boolean>("assistant_available");
}

export async function hasAssistantApiKey(): Promise<boolean> {
  return invoke<boolean>("has_assistant_api_key");
}

export async function setAssistantApiKey(key: string): Promise<void> {
  return invoke("set_assistant_api_key", { key });
}

export async function assistantSendMessage(message: string): Promise<AssistantResponse> {
  return invoke<AssistantResponse>("assistant_send_message", { message });
}

export async function assistantClearHistory(): Promise<void> {
  return invoke("assistant_clear_history");
}

// --- Speech ---

export async function checkSpeechPermission(): Promise<string> {
  return invoke<string>("check_speech_permission");
}

export async function requestSpeechPermission(): Promise<void> {
  return invoke("request_speech_permission");
}

export async function startSpeechRecognition(): Promise<void> {
  return invoke("start_speech_recognition");
}

export async function stopSpeechRecognition(): Promise<void> {
  return invoke("stop_speech_recognition");
}

// --- AI Tagging ---

export async function startAiTagging(): Promise<void> {
  return invoke("start_ai_tagging");
}

export async function cancelAiTagging(): Promise<void> {
  return invoke("cancel_ai_tagging");
}

export interface AiTagProgress {
  tagged: number;
  total: number;
}

export async function getAiTagProgress(): Promise<AiTagProgress> {
  return invoke<AiTagProgress>("get_ai_tag_progress");
}

export async function retagTracks(trackIds: number[]): Promise<void> {
  return invoke("retag_tracks", { trackIds });
}

export async function exportAiTags(outputPath: string): Promise<number> {
  return invoke<number>("export_ai_tags", { outputPath });
}

export async function importAiTags(filePath: string): Promise<number> {
  return invoke<number>("import_ai_tags", { filePath });
}

// --- Bios ---

export interface BioResult {
  bio: string;
  generatedAt: string;
  cached: boolean;
}

export async function getBio(
  entityType: string,
  entityName: string,
  entityDetail?: string,
): Promise<BioResult> {
  return invoke<BioResult>("get_bio", { entityType, entityName, entityDetail });
}

// --- Play Similar / Radio ---

export async function playSimilar(trackId: number): Promise<number> {
  return invoke<number>("play_similar", { trackId });
}

export interface RadioState {
  enabled: boolean;
  seedTrackId: number | null;
}

export async function toggleRadioMode(): Promise<RadioState> {
  return invoke<RadioState>("toggle_radio_mode");
}

export async function startRadio(trackId: number): Promise<RadioState> {
  return invoke<RadioState>("start_radio", { trackId });
}

export async function getRadioState(): Promise<RadioState> {
  return invoke<RadioState>("get_radio_state");
}

// --- TTS ---

export async function speakText(text: string): Promise<void> {
  return invoke("speak_text", { text });
}

export async function stopSpeaking(): Promise<void> {
  return invoke("stop_speaking");
}

export async function isSpeaking(): Promise<boolean> {
  return invoke<boolean>("is_speaking");
}

// --- URL Download ---

export async function queueUrlDownload(url: string): Promise<void> {
  return invoke<void>("queue_url_download", { url });
}

export interface DependencyStatus {
  name: string;
  installed: boolean;
  version: string | null;
  path: string | null;
  installHint: string;
}

export async function checkDependencies(): Promise<DependencyStatus[]> {
  return invoke<DependencyStatus[]>("check_dependencies");
}

export interface FindTagsResult {
  updated: number;
  total: number;
}

export async function findMissingTags(trackIds: number[]): Promise<FindTagsResult> {
  return invoke<FindTagsResult>("find_missing_tags", { trackIds });
}

export interface TagSearchResult {
  title: string | null;
  artist: string | null;
  album: string | null;
  albumArtist: string | null;
  year: number | null;
  trackNumber: number | null;
  trackCount: number | null;
  discNumber: number | null;
  genre: string | null;
  releaseType: string | null;
}

export async function searchTrackTags(artist: string, title: string): Promise<TagSearchResult[]> {
  return invoke<TagSearchResult[]>("search_track_tags", { artist, title });
}

export async function applyTrackTags(trackId: number, tags: TagSearchResult): Promise<Track> {
  return invoke<Track>("apply_track_tags", { trackId, tags });
}

// --- Sync ---

export async function startSyncServer(): Promise<void> {
  return invoke("start_sync_server");
}

export async function stopSyncServer(): Promise<void> {
  return invoke("stop_sync_server");
}

export async function generatePairingCode(): Promise<string> {
  return invoke<string>("generate_pairing_code");
}

export async function getSyncStatus(): Promise<import("./types").SyncStatus> {
  return invoke<import("./types").SyncStatus>("get_sync_status");
}

export async function unpairDevice(deviceId: string): Promise<void> {
  return invoke("unpair_device", { deviceId });
}

export async function setSyncPlaylists(deviceId: string, playlistIds: number[]): Promise<void> {
  return invoke("set_sync_playlists", { deviceId, playlistIds });
}

// --- Handoff ---

export interface HandoffState {
  trackPersistentId: string;
  position: number;
  queueSource: string | null;
  shuffle: boolean;
  repeatMode: string;
  updatedAt: number;
  deviceName: string;
}

export interface HandoffConfig {
  url: string;
  token: string;
}

export interface HandoffTrackInfo {
  state: HandoffState;
  trackId: number | null;
  title: string | null;
  artist: string | null;
  artworkHash: string | null;
  deviceName: string | null;
  localDeviceName: string | null;
}

export async function generateHandoffToken(): Promise<string> {
  return invoke<string>("generate_handoff_token");
}

export async function configureHandoff(url: string, token: string): Promise<void> {
  return invoke("configure_handoff", { url, token });
}

export async function getHandoffConfig(): Promise<HandoffConfig | null> {
  return invoke<HandoffConfig | null>("get_handoff_config");
}

export async function pushHandoffState(): Promise<void> {
  return invoke("push_handoff_state");
}

export async function pullHandoffState(): Promise<HandoffTrackInfo | null> {
  return invoke<HandoffTrackInfo | null>("pull_handoff_state");
}

export async function dismissHandoff(): Promise<void> {
  return invoke("dismiss_handoff");
}
