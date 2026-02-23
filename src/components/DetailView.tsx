import { useEffect, useState } from "react";
import { TrackTable } from "./TrackTable";
import { useNavigationStore } from "../stores/navigationStore";
import {
  getPlaylistTracks,
  getAlbumTracks,
  getArtistTracks,
  getGenreTracks,
} from "../lib/commands";
import type { Track } from "../lib/types";

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
  const navigateTo = useNavigationStore((s) => s.navigateTo);

  useEffect(() => {
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
      ? `playlist:${playlistId}`
      : kind === "album"
        ? `album:${album}:${albumArtist ?? ""}`
        : kind === "artist"
          ? `artist:${artistName}`
          : `genre:${genreName}`;

  return (
    <div className="flex-1 flex flex-col min-h-0">
      <div className="flex items-center gap-3 px-3 py-2 border-b border-neutral-800 bg-neutral-900/50">
        <button
          onClick={() => navigateTo(parentView)}
          className="text-neutral-400 hover:text-neutral-200 transition-colors text-sm"
        >
          &larr; Back
        </button>
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-neutral-200 truncate">
            {title}
          </h2>
          {subtitle && (
            <p className="text-xs text-neutral-500 truncate">{subtitle}</p>
          )}
          <p className="text-xs text-neutral-500">
            {loading ? "Loading..." : `${tracks.length} tracks`}
          </p>
        </div>
      </div>
      {!loading && <TrackTable tracks={tracks} source={source} />}
    </div>
  );
}
