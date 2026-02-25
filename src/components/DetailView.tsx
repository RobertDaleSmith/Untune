import { useCallback, useEffect, useMemo, useState } from "react";
import { TrackTable } from "./TrackTable";
import { ColumnBrowser } from "./ColumnBrowser";
import { useNavigationStore } from "../stores/navigationStore";
import { useLibraryStore } from "../stores/libraryStore";
import { useColumnBrowserStore } from "../stores/columnBrowserStore";
import {
  getPlaylistTracks,
  getPlaylists,
  getAlbumTracks,
  getArtistTracks,
  getGenreTracks,
} from "../lib/commands";
import { SmartPlaylistEditor } from "./SmartPlaylistEditor";
import { useArtwork } from "../hooks/useArtwork";
import { formatTotalDuration } from "../utils/formatters";
import type { Playlist, Track } from "../lib/types";

function applyColumnFilter(
  tracks: Track[],
  genre: string | null,
  artist: string | null,
  album: string | null,
  useAlbumArtist: boolean,
): Track[] {
  let filtered = tracks;
  if (genre) {
    filtered = filtered.filter(
      (t) => (t.genre || "(Unknown Genre)") === genre,
    );
  }
  if (artist) {
    filtered = filtered.filter((t) => {
      const a = useAlbumArtist
        ? t.albumArtist || t.artist || "(Unknown Artist)"
        : t.artist || "(Unknown Artist)";
      return a === artist;
    });
  }
  if (album) {
    filtered = filtered.filter(
      (t) => (t.album || "(Unknown Album)") === album,
    );
  }
  return filtered;
}

interface DetailViewProps {
  kind: "playlist" | "album" | "artist" | "genre";
  title: string;
  subtitle?: string | null;
  playlistId?: number;
  album?: string;
  albumArtist?: string | null;
  artistName?: string;
  genreName?: string;
}

export function DetailView({
  kind,
  title,
  subtitle,
  playlistId,
  album,
  albumArtist,
  artistName,
  genreName,
}: DetailViewProps) {
  const [tracks, setTracks] = useState<Track[]>([]);
  const [loading, setLoading] = useState(true);
  const [playlist, setPlaylist] = useState<Playlist | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const navigateTo = useNavigationStore((s) => s.navigateTo);
  const detailVersion = useNavigationStore((s) => s.detailVersion);
  const browserVisible = useColumnBrowserStore((s) => s.visible);
  const selectedGenre = useColumnBrowserStore((s) => s.selectedGenre);
  const selectedArtist = useColumnBrowserStore((s) => s.selectedArtist);
  const selectedAlbum = useColumnBrowserStore((s) => s.selectedAlbum);
  const cbUseAlbumArtist = useColumnBrowserStore((s) => s.useAlbumArtist);

  // Clear column browser selections when this detail view mounts
  useEffect(() => {
    useColumnBrowserStore.getState().clearSelections();
  }, [kind, playlistId, album, albumArtist, artistName, genreName]);

  // Apply column browser filtering
  const filteredTracks = useMemo(() => {
    if (!browserVisible) return tracks;
    return applyColumnFilter(tracks, selectedGenre, selectedArtist, selectedAlbum, cbUseAlbumArtist);
  }, [tracks, browserVisible, selectedGenre, selectedArtist, selectedAlbum, cbUseAlbumArtist]);

  const loadTracks = useCallback(() => {
    setLoading(true);
    let promise: Promise<Track[]>;
    switch (kind) {
      case "playlist":
        promise = getPlaylistTracks(playlistId!);
        break;
      case "album":
        promise = getAlbumTracks(album!, albumArtist ?? "");
        break;
      case "artist":
        promise = getArtistTracks(artistName!);
        break;
      case "genre":
        promise = getGenreTracks(genreName!);
        break;
    }
    promise
      .then(setTracks)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [kind, playlistId, album, albumArtist, artistName, genreName]);

  useEffect(() => {
    loadTracks();
  }, [loadTracks, detailVersion]);

  // Update status bar with this view's tracks (filtered if column browser active)
  useEffect(() => {
    if (!loading) {
      useLibraryStore.getState().setStatusBarTracks(filteredTracks);
    }
  }, [filteredTracks, loading]);

  // Load playlist metadata to check if it's a native smart playlist
  useEffect(() => {
    if (kind !== "playlist" || !playlistId) return;
    getPlaylists()
      .then((all) => {
        const found = all.find((p) => p.id === playlistId);
        setPlaylist(found ?? null);
      })
      .catch(console.error);
  }, [kind, playlistId]);

  const isNativeSmart = playlist?.isSmart && !!playlist?.rulesJson;

  const handleEditorSave = useCallback(
    (_id: number) => {
      setEditorOpen(false);
      // Re-fetch playlist metadata and tracks
      if (playlistId) {
        getPlaylists()
          .then((all) => setPlaylist(all.find((p) => p.id === playlistId) ?? null))
          .catch(console.error);
      }
      loadTracks();
    },
    [playlistId, loadTracks],
  );

  const parentView =
    kind === "playlist"
      ? "songs"
      : kind === "album"
        ? "albums"
        : kind === "artist"
          ? "artists"
          : "genres";

  const source =
    kind === "playlist"
      ? `playlist:${playlistId}:${title}`
      : kind === "album"
        ? `album:${album}:${albumArtist ?? ""}`
        : kind === "artist"
          ? `artist:${artistName}`
          : `genre:${genreName}`;

  if (kind === "album") {
    return (
      <AlbumDetailView
        title={title}
        subtitle={subtitle}
        tracks={tracks}
        loading={loading}
        source={source}
        onBack={() => navigateTo(parentView)}
      />
    );
  }

  return (
    <div className="flex-1 flex flex-col min-h-0">
      <div className="flex items-center gap-3 px-3 py-2 border-b border-n-800 bg-n-900/50">
        <button
          onClick={() => navigateTo(parentView)}
          className="text-n-400 hover:text-n-200 transition-colors text-sm"
        >
          &larr; Back
        </button>
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-semibold text-n-200 truncate">
            {title}
          </h2>
          {subtitle && (
            <p className="text-xs text-n-500 truncate">{subtitle}</p>
          )}
          <p className="text-xs text-n-500">
            {loading ? "Loading..." : `${tracks.length} tracks`}
          </p>
        </div>
        {isNativeSmart && (
          <button
            onClick={() => setEditorOpen(true)}
            className="text-xs text-n-400 hover:text-n-200 transition-colors border border-n-700 rounded px-2 py-1 shrink-0"
          >
            Edit Rules
          </button>
        )}
      </div>
      {!loading && (
        <>
          <ColumnBrowser tracks={tracks} />
          <TrackTable tracks={filteredTracks} source={source} />
        </>
      )}

      {editorOpen && playlist && (
        <SmartPlaylistEditor
          onSave={handleEditorSave}
          onClose={() => setEditorOpen(false)}
          editingPlaylist={playlist}
        />
      )}
    </div>
  );
}

// ── Album detail with cover art header ──────────────────────────

function AlbumDetailView({
  title,
  subtitle,
  tracks,
  loading,
  source,
  onBack,
}: {
  title: string;
  subtitle?: string | null;
  tracks: Track[];
  loading: boolean;
  source: string;
  onBack: () => void;
}) {
  // Use artwork from first track that has one
  const artworkHash = tracks.find((t) => t.artworkHash)?.artworkHash ?? null;
  const artworkUrl = useArtwork(artworkHash);

  const totalDuration = tracks.reduce((s, t) => s + (t.duration ?? 0), 0);
  const year = tracks.find((t) => t.year)?.year;
  const genre = tracks.find((t) => t.genre)?.genre;

  return (
    <div className="flex-1 flex flex-col min-h-0">
      {/* Album header */}
      <div className="shrink-0 px-5 py-4 border-b border-n-800 bg-n-900/50 flex gap-5 items-end">
        {/* Cover */}
        <div className="w-[140px] h-[140px] rounded-lg overflow-hidden bg-n-800 shadow-lg shrink-0">
          {artworkUrl ? (
            <img
              src={artworkUrl}
              alt={title}
              className="w-full h-full object-cover"
            />
          ) : (
            <div className="w-full h-full flex items-center justify-center text-n-600">
              <svg
                width="48"
                height="48"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1"
              >
                <circle cx="12" cy="12" r="10" />
                <circle cx="12" cy="12" r="3" />
              </svg>
            </div>
          )}
        </div>

        {/* Info */}
        <div className="min-w-0 flex-1 pb-1">
          <button
            onClick={onBack}
            className="text-n-500 hover:text-n-300 transition-colors text-xs mb-2 flex items-center gap-1"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <polyline points="15 18 9 12 15 6" />
            </svg>
            Albums
          </button>
          <h1 className="text-lg font-bold text-n-100 truncate leading-tight">
            {title}
          </h1>
          {subtitle && (
            <p className="text-sm text-n-300 truncate mt-0.5">{subtitle}</p>
          )}
          <div className="flex items-center gap-2 mt-2 text-xs text-n-500 flex-wrap">
            {year && <span>{year}</span>}
            {year && genre && <span className="text-n-700">&middot;</span>}
            {genre && <span>{genre}</span>}
            {(year || genre) && <span className="text-n-700">&middot;</span>}
            <span>
              {loading
                ? "Loading..."
                : `${tracks.length} ${tracks.length === 1 ? "song" : "songs"}, ${formatTotalDuration(totalDuration)}`}
            </span>
          </div>
        </div>
      </div>

      {/* Track list */}
      {!loading && <TrackTable tracks={tracks} source={source} />}
    </div>
  );
}
