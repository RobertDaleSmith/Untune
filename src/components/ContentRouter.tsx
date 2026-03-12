import { useEffect, useMemo, useRef } from "react";
import { useNavigationStore } from "../stores/navigationStore";
import { useLibraryStore } from "../stores/libraryStore";
import { useColumnBrowserStore } from "../stores/columnBrowserStore";
import { TrackTable } from "./TrackTable";
import { AlbumsView } from "./AlbumsView";
import { ArtistsView } from "./ArtistsView";
import { GenresView } from "./GenresView";
import { DetailView } from "./DetailView";
import { SmartViewDetail } from "./SmartViewDetail";
import { ColumnBrowser } from "./ColumnBrowser";
import type { Track } from "../lib/types";

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

export function ContentRouter() {
  const { view, playlistId, playlistName, albumKey, albumArtist, artistName, genreName, smartViewId, smartViewName } =
    useNavigationStore();
  const { tracks, searchResults } = useLibraryStore();
  const browserVisible = useColumnBrowserStore((s) => s.visible);
  const selectedGenre = useColumnBrowserStore((s) => s.selectedGenre);
  const selectedArtist = useColumnBrowserStore((s) => s.selectedArtist);
  const selectedAlbum = useColumnBrowserStore((s) => s.selectedAlbum);
  const useAlbumArtist = useColumnBrowserStore((s) => s.useAlbumArtist);

  const displayTracks = searchResults ?? tracks;

  // Apply column browser filtering for songs view
  const filteredTracks = useMemo(() => {
    if (!browserVisible) return displayTracks;
    return applyColumnFilter(displayTracks, selectedGenre, selectedArtist, selectedAlbum, useAlbumArtist);
  }, [displayTracks, browserVisible, selectedGenre, selectedArtist, selectedAlbum, useAlbumArtist]);

  // Update status bar tracks based on current view
  useEffect(() => {
    if (view === "songs") {
      useLibraryStore.getState().setStatusBarTracks(filteredTracks);
    } else if (view === "albums" || view === "artists" || view === "genres") {
      // Browse views show full library stats
      useLibraryStore.getState().setStatusBarTracks(tracks);
    }
    // Detail views set their own status bar tracks
  }, [view, filteredTracks, tracks]);

  // Track whether songs view has ever been shown so we can keep it mounted
  const songsEverShown = useRef(false);
  if (view === "songs") songsEverShown.current = true;
  const isSongs = view === "songs";

  // Render the non-songs overlay view
  let overlayView: React.ReactNode = null;
  switch (view) {
    case "albums":
      overlayView = <AlbumsView />;
      break;
    case "artists":
      overlayView = <ArtistsView />;
      break;
    case "genres":
      overlayView = <GenresView />;
      break;
    case "playlist":
      overlayView = (
        <DetailView
          key={`playlist-${playlistId}`}
          kind="playlist"
          title={playlistName ?? "Playlist"}
          playlistId={playlistId!}
        />
      );
      break;
    case "album-detail":
      overlayView = (
        <DetailView
          key={`album-${albumKey}-${albumArtist}`}
          kind="album"
          title={albumKey ?? ""}
          subtitle={albumArtist}
          album={albumKey!}
          albumArtist={albumArtist}
        />
      );
      break;
    case "artist-detail":
      overlayView = (
        <DetailView
          key={`artist-${artistName}`}
          kind="artist"
          title={artistName ?? ""}
          artistName={artistName!}
        />
      );
      break;
    case "genre-detail":
      overlayView = (
        <DetailView
          key={`genre-${genreName}`}
          kind="genre"
          title={genreName ?? ""}
          genreName={genreName!}
        />
      );
      break;
    case "smart-view":
      overlayView = (
        <SmartViewDetail
          key={`smart-${smartViewId}`}
          viewId={smartViewId ?? ""}
          viewName={smartViewName ?? ""}
        />
      );
      break;
  }

  return (
    <>
      {/* Songs view stays mounted (hidden) once first shown, so switching back is instant */}
      {songsEverShown.current && (
        <div className={`flex-1 flex flex-col min-h-0 ${isSongs ? "" : "hidden"}`}>
          <ColumnBrowser tracks={displayTracks} />
          <TrackTable tracks={filteredTracks} source="songs" />
        </div>
      )}
      {overlayView}
    </>
  );
}
