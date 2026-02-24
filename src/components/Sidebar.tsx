import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigationStore, type View } from "../stores/navigationStore";
import { usePlaybackStore } from "../stores/playbackStore";
import { useLibraryStore } from "../stores/libraryStore";
import { getPlaylists } from "../lib/commands";
import { ArtworkLightbox } from "./ArtworkLightbox";
import type { Playlist } from "../lib/types";

const libraryItems: { label: string; view: View }[] = [
  { label: "Songs", view: "songs" },
  { label: "Albums", view: "albums" },
  { label: "Artists", view: "artists" },
  { label: "Genres", view: "genres" },
];

const STORAGE_KEY = "waves-folder-expanded";

function loadExpandedState(): Set<number> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return new Set(JSON.parse(raw));
  } catch { /* ignore */ }
  return new Set();
}

function saveExpandedState(expanded: Set<number>) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify([...expanded]));
}

function buildPlaylistTree(playlists: Playlist[]) {
  const childrenMap: Record<number, Playlist[]> = {};
  const rootItems: Playlist[] = [];

  for (const pl of playlists) {
    if (pl.parentId === null) {
      rootItems.push(pl);
    } else {
      if (!childrenMap[pl.parentId]) childrenMap[pl.parentId] = [];
      childrenMap[pl.parentId].push(pl);
    }
  }

  return { rootItems, childrenMap };
}

export function Sidebar() {
  const { view, playlistId, navigateTo, navigateToPlaylist } =
    useNavigationStore();
  const [playlists, setPlaylists] = useState<Playlist[]>([]);
  const [expanded, setExpanded] = useState<Set<number>>(loadExpandedState);
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [lightboxRect, setLightboxRect] = useState<DOMRect | null>(null);
  const artworkRef = useRef<HTMLDivElement>(null);

  const currentTrackId = usePlaybackStore((s) => s.currentTrackId);
  const artworkUrl = usePlaybackStore((s) => s.currentArtworkUrl);
  const tracks = useLibraryStore((s) => s.tracks);

  const currentTrack = currentTrackId
    ? tracks.find((t) => t.id === currentTrackId)
    : null;

  useEffect(() => {
    getPlaylists().then(setPlaylists).catch(console.error);
  }, []);

  const toggleFolder = useCallback((folderId: number) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(folderId)) {
        next.delete(folderId);
      } else {
        next.add(folderId);
      }
      saveExpandedState(next);
      return next;
    });
  }, []);

  const openLightbox = useCallback(() => {
    if (!artworkUrl || !currentTrackId) return;
    const rect = artworkRef.current?.getBoundingClientRect();
    if (!rect) return;
    setLightboxRect(rect);
    setLightboxOpen(true);
  }, [artworkUrl, currentTrackId]);

  const { rootItems, childrenMap } = buildPlaylistTree(playlists);

  const renderPlaylistButton = (pl: Playlist, depth: number) => (
    <button
      key={pl.id}
      onClick={() => navigateToPlaylist(pl.id, pl.name)}
      className={`w-full text-left py-1 text-sm rounded-md truncate transition-colors ${
        view === "playlist" && playlistId === pl.id
          ? "bg-n-700/60 text-n-100"
          : "text-n-400 hover:text-n-200 hover:bg-n-800/50"
      }`}
      style={{ paddingLeft: `${8 + depth * 12}px`, paddingRight: "8px" }}
    >
      {pl.name}
    </button>
  );

  const renderFolder = (folder: Playlist, depth: number) => {
    const isExpanded = expanded.has(folder.id);
    const children = childrenMap[folder.id] || [];

    return (
      <div key={folder.id}>
        <button
          onClick={() => toggleFolder(folder.id)}
          className="w-full text-left py-1 text-sm rounded-md truncate transition-colors text-n-400 hover:text-n-200 hover:bg-n-800/50 flex items-center gap-1"
          style={{ paddingLeft: `${4 + depth * 12}px`, paddingRight: "8px" }}
        >
          <svg
            width="12"
            height="12"
            viewBox="0 0 12 12"
            fill="currentColor"
            className={`shrink-0 transition-transform ${isExpanded ? "rotate-90" : ""}`}
          >
            <path d="M4.5 2L8.5 6L4.5 10V2Z" />
          </svg>
          <span className="truncate">{folder.name}</span>
        </button>
        {isExpanded && children.map((child) =>
          child.isFolder
            ? renderFolder(child, depth + 1)
            : renderPlaylistButton(child, depth + 1)
        )}
      </div>
    );
  };

  return (
    <aside className="w-48 shrink-0 bg-n-900/30 border-r border-n-800 flex flex-col overflow-hidden">
      <div className="h-[10px] shrink-0" />
      <div className="px-3 pb-1">
        <h2 className="text-[11px] font-semibold text-n-500 uppercase tracking-wider">
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
                ? "bg-n-700/60 text-n-100"
                : "text-n-400 hover:text-n-200 hover:bg-n-800/50"
            }`}
          >
            {item.label}
          </button>
        ))}
      </nav>

      <div className="px-3 pt-4 pb-1">
        <h2 className="text-[11px] font-semibold text-n-500 uppercase tracking-wider">
          Playlists
        </h2>
      </div>
      <nav className="px-1 flex-1 overflow-y-auto min-h-0">
        {rootItems.map((item) =>
          item.isFolder
            ? renderFolder(item, 0)
            : renderPlaylistButton(item, 0)
        )}
      </nav>

      {/* Bottom: artwork */}
      <div className="shrink-0 border-t border-n-800">
        <div
          ref={artworkRef}
          onClick={openLightbox}
          className={`aspect-square w-full overflow-hidden bg-n-800${artworkUrl ? " cursor-pointer" : ""}`}
        >
          {artworkUrl ? (
            <img
              src={artworkUrl}
              alt={currentTrack?.album ?? currentTrack?.title ?? ""}
              className="w-full h-full object-cover"
            />
          ) : (
            <div className="w-full h-full flex items-center justify-center text-n-600">
              <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                <circle cx="12" cy="12" r="10" />
                <circle cx="12" cy="12" r="3" />
              </svg>
            </div>
          )}
        </div>
      </div>

      {lightboxOpen && currentTrackId && artworkUrl && lightboxRect && (
        <ArtworkLightbox
          trackId={currentTrackId}
          initialUrl={artworkUrl}
          originRect={lightboxRect}
          onClose={() => setLightboxOpen(false)}
        />
      )}
    </aside>
  );
}
