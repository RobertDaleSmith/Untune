import { useEffect, useState } from "react";
import { useNavigationStore, type View } from "../stores/navigationStore";
import { usePlaybackStore } from "../stores/playbackStore";
import { useLibraryStore } from "../stores/libraryStore";
import { getPlaylists, getArtworkDataUrl } from "../lib/commands";
import type { Playlist } from "../lib/types";
import logoUrl from "../assets/logo.png";

const libraryItems: { label: string; view: View }[] = [
  { label: "Songs", view: "songs" },
  { label: "Albums", view: "albums" },
  { label: "Artists", view: "artists" },
  { label: "Genres", view: "genres" },
];

export function Sidebar() {
  const { view, playlistId, navigateTo, navigateToPlaylist } =
    useNavigationStore();
  const [playlists, setPlaylists] = useState<Playlist[]>([]);
  const [artworkUrl, setArtworkUrl] = useState<string | null>(null);

  const currentTrackId = usePlaybackStore((s) => s.currentTrackId);
  const tracks = useLibraryStore((s) => s.tracks);

  const currentTrack = currentTrackId
    ? tracks.find((t) => t.id === currentTrackId)
    : null;

  useEffect(() => {
    getPlaylists().then(setPlaylists).catch(console.error);
  }, []);

  // Load artwork for the current track
  useEffect(() => {
    if (!currentTrack?.artworkHash) {
      setArtworkUrl(null);
      return;
    }
    let cancelled = false;
    getArtworkDataUrl(currentTrack.artworkHash).then((dataUrl) => {
      if (!cancelled) setArtworkUrl(dataUrl);
    }).catch(() => {
      if (!cancelled) setArtworkUrl(null);
    });
    return () => { cancelled = true; };
  }, [currentTrack?.artworkHash]);

  return (
    <aside className="w-48 shrink-0 bg-neutral-900/50 border-r border-neutral-800 flex flex-col overflow-hidden">
      <div className="px-3 pt-3 pb-2 flex items-center gap-2">
        <img src={logoUrl} alt="Waves" className="w-6 h-6 rounded" />
        <span className="text-sm font-semibold text-neutral-200">Waves</span>
      </div>
      <div className="px-3 pb-1">
        <h2 className="text-[11px] font-semibold text-neutral-500 uppercase tracking-wider">
          Library
        </h2>
      </div>
      <nav className="px-1">
        {libraryItems.map((item) => (
          <button
            key={item.view}
            onClick={() => navigateTo(item.view)}
            className={`w-full text-left px-2 py-1 text-sm rounded-md transition-colors ${
              view === item.view
                ? "bg-neutral-700/60 text-neutral-100"
                : "text-neutral-400 hover:text-neutral-200 hover:bg-neutral-800/50"
            }`}
          >
            {item.label}
          </button>
        ))}
      </nav>

      <div className="px-3 pt-4 pb-1">
        <h2 className="text-[11px] font-semibold text-neutral-500 uppercase tracking-wider">
          Playlists
        </h2>
      </div>
      <nav className="px-1 flex-1 overflow-y-auto min-h-0">
        {playlists.map((pl) => (
          <button
            key={pl.id}
            onClick={() => navigateToPlaylist(pl.id, pl.name)}
            className={`w-full text-left px-2 py-1 text-sm rounded-md truncate transition-colors ${
              view === "playlist" && playlistId === pl.id
                ? "bg-neutral-700/60 text-neutral-100"
                : "text-neutral-400 hover:text-neutral-200 hover:bg-neutral-800/50"
            }`}
          >
            {pl.name}
          </button>
        ))}
      </nav>

      {/* Now Playing artwork */}
      {currentTrack && (
        <div className="p-2 border-t border-neutral-800">
          <div className="aspect-square w-full rounded-md overflow-hidden bg-neutral-800">
            {artworkUrl ? (
              <img
                src={artworkUrl}
                alt={currentTrack.album ?? currentTrack.title}
                className="w-full h-full object-cover"
              />
            ) : (
              <div className="w-full h-full flex items-center justify-center text-neutral-600">
                <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                  <circle cx="12" cy="12" r="10" />
                  <circle cx="12" cy="12" r="3" />
                </svg>
              </div>
            )}
          </div>
        </div>
      )}
    </aside>
  );
}
