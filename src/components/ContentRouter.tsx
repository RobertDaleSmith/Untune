import { useNavigationStore } from "../stores/navigationStore";
import { useLibraryStore } from "../stores/libraryStore";
import { TrackTable } from "./TrackTable";
import { AlbumsView } from "./AlbumsView";
import { ArtistsView } from "./ArtistsView";
import { GenresView } from "./GenresView";
import { DetailView } from "./DetailView";

export function ContentRouter() {
  const { view, playlistId, playlistName, albumKey, albumArtist, artistName, genreName } =
    useNavigationStore();
  const { tracks, searchResults } = useLibraryStore();

  const displayTracks = searchResults ?? tracks;

  switch (view) {
    case "songs":
      return <TrackTable tracks={displayTracks} source="songs" />;
    case "albums":
      return <AlbumsView />;
    case "artists":
      return <ArtistsView />;
    case "genres":
      return <GenresView />;
    case "playlist":
      return (
        <DetailView
          key={`playlist-${playlistId}`}
          kind="playlist"
          title={playlistName ?? "Playlist"}
          playlistId={playlistId!}
        />
      );
    case "album-detail":
      return (
        <DetailView
          key={`album-${albumKey}-${albumArtist}`}
          kind="album"
          title={albumKey ?? ""}
          subtitle={albumArtist}
          album={albumKey!}
          albumArtist={albumArtist}
        />
      );
    case "artist-detail":
      return (
        <DetailView
          key={`artist-${artistName}`}
          kind="artist"
          title={artistName ?? ""}
          artistName={artistName!}
        />
      );
    case "genre-detail":
      return (
        <DetailView
          key={`genre-${genreName}`}
          kind="genre"
          title={genreName ?? ""}
          genreName={genreName!}
        />
      );
    default:
      return <TrackTable tracks={displayTracks} source="songs" />;
  }
}
