import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigationStore, type View } from "../stores/navigationStore";
import { usePlaybackStore } from "../stores/playbackStore";
import { useLibraryStore } from "../stores/libraryStore";
import { getPlaylists, deletePlaylist, reorderPlaylists } from "../lib/commands";
import { ArtworkLightbox } from "./ArtworkLightbox";
import { SmartPlaylistEditor } from "./SmartPlaylistEditor";
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

// Smart playlist icon (gear)
function SmartIcon({ native }: { native: boolean }) {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      className={`shrink-0 ${native ? "opacity-80" : "opacity-40"}`}
    >
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  );
}

export function Sidebar() {
  const { view, playlistId, navigateTo, navigateToPlaylist } =
    useNavigationStore();
  const [playlists, setPlaylists] = useState<Playlist[]>([]);
  const [expanded, setExpanded] = useState<Set<number>>(loadExpandedState);
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [lightboxRect, setLightboxRect] = useState<DOMRect | null>(null);
  const artworkRef = useRef<HTMLDivElement>(null);

  // Smart playlist editor state
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingPlaylist, setEditingPlaylist] = useState<Playlist | undefined>();

  // Context menu state
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    playlist: Playlist;
  } | null>(null);

  // Drag-and-drop state
  const [dragId, setDragId] = useState<number | null>(null);
  const [dropTarget, setDropTarget] = useState<{
    id: number;
    position: "before" | "after" | "inside";
  } | null>(null);

  const currentTrackId = usePlaybackStore((s) => s.currentTrackId);
  const artworkUrl = usePlaybackStore((s) => s.currentArtworkUrl);
  const tracks = useLibraryStore((s) => s.tracks);

  const currentTrack = currentTrackId
    ? tracks.find((t) => t.id === currentTrackId)
    : null;

  const isImporting = useLibraryStore((s) => s.isImporting);
  const sidebarRefresh = useNavigationStore((s) => s.sidebarRefresh);

  const refreshPlaylists = useCallback(() => {
    getPlaylists().then(setPlaylists).catch(console.error);
  }, []);

  useEffect(() => {
    if (!isImporting) {
      refreshPlaylists();
    }
  }, [isImporting, refreshPlaylists, sidebarRefresh]);

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
    if (!currentTrackId) return;
    const rect = artworkRef.current?.getBoundingClientRect();
    if (!rect) return;
    setLightboxRect(rect);
    setLightboxOpen(true);
  }, [currentTrackId]);

  const handleContextMenu = useCallback(
    (e: React.MouseEvent, pl: Playlist) => {
      e.preventDefault();
      setContextMenu({ x: e.clientX, y: e.clientY, playlist: pl });
    },
    [],
  );

  // Listen for "open smart editor" event from App (Cmd+Alt+N menu)
  useEffect(() => {
    const handler = () => {
      setEditingPlaylist(undefined);
      setEditorOpen(true);
    };
    window.addEventListener("waves-open-smart-editor", handler);
    return () => window.removeEventListener("waves-open-smart-editor", handler);
  }, []);

  // Close context menu on click anywhere
  useEffect(() => {
    if (!contextMenu) return;
    const handler = () => setContextMenu(null);
    document.addEventListener("click", handler);
    return () => document.removeEventListener("click", handler);
  }, [contextMenu]);

  const handleEditSmartPlaylist = useCallback((pl: Playlist) => {
    setEditingPlaylist(pl);
    setEditorOpen(true);
    setContextMenu(null);
  }, []);

  const handleDeletePlaylist = useCallback(
    async (pl: Playlist) => {
      setContextMenu(null);
      try {
        await deletePlaylist(pl.id);
        refreshPlaylists();
        // If we were viewing this playlist, navigate away
        if (playlistId === pl.id) {
          navigateTo("songs");
        }
      } catch (err) {
        console.error("Failed to delete playlist:", err);
      }
    },
    [refreshPlaylists, playlistId, navigateTo],
  );

  const handleEditorSave = useCallback(
    (_id: number) => {
      setEditorOpen(false);
      setEditingPlaylist(undefined);
      refreshPlaylists();
      useNavigationStore.getState().requestDetailRefresh();
    },
    [refreshPlaylists],
  );

  const handleEditorClose = useCallback(() => {
    setEditorOpen(false);
    setEditingPlaylist(undefined);
  }, []);

  // --- Drag-and-drop handlers ---

  const handleDragStart = useCallback(
    (e: React.DragEvent, pl: Playlist) => {
      setDragId(pl.id);
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData("text/plain", String(pl.id));
    },
    [],
  );

  const handleDragOver = useCallback(
    (e: React.DragEvent, targetPl: Playlist) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
      if (dragId === null || dragId === targetPl.id) return;

      const rect = e.currentTarget.getBoundingClientRect();
      const y = e.clientY - rect.top;
      const third = rect.height / 3;

      // Folders can accept "inside" drops (middle third), but not folder-into-folder
      const draggedPl = playlists.find((p) => p.id === dragId);
      const isTargetFolder = targetPl.isFolder;
      const isDraggedFolder = draggedPl?.isFolder ?? false;

      let position: "before" | "after" | "inside";
      if (y < third) {
        position = "before";
      } else if (y > third * 2) {
        position = "after";
      } else if (isTargetFolder && !isDraggedFolder) {
        position = "inside";
      } else if (y < rect.height / 2) {
        position = "before";
      } else {
        position = "after";
      }

      setDropTarget({ id: targetPl.id, position });
    },
    [dragId, playlists],
  );

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    // Only clear if we're actually leaving the element (not entering a child)
    const related = e.relatedTarget as Node | null;
    if (!e.currentTarget.contains(related)) {
      setDropTarget(null);
    }
  }, []);

  const handleDrop = useCallback(
    async (e: React.DragEvent) => {
      e.preventDefault();
      if (dragId === null || dropTarget === null) {
        setDragId(null);
        setDropTarget(null);
        return;
      }

      const targetPl = playlists.find((p) => p.id === dropTarget.id);
      const draggedPl = playlists.find((p) => p.id === dragId);
      if (!targetPl || !draggedPl) {
        setDragId(null);
        setDropTarget(null);
        return;
      }

      // Determine new parent for dragged item
      let newParentId: number | null;
      if (dropTarget.position === "inside") {
        newParentId = targetPl.id;
      } else {
        newParentId = targetPl.parentId;
      }

      // Prevent folder-into-folder
      if (draggedPl.isFolder && newParentId !== null) {
        setDragId(null);
        setDropTarget(null);
        return;
      }

      const oldParentId = draggedPl.parentId;

      // Build the sibling list at the target level (excluding the dragged item)
      const targetSiblings = playlists
        .filter((p) => p.parentId === newParentId && p.id !== dragId)
        .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name));

      // Find insertion index
      let insertIdx: number;
      const targetIdx = targetSiblings.findIndex((p) => p.id === dropTarget.id);
      if (dropTarget.position === "inside") {
        // Append to end of folder's children
        insertIdx = targetSiblings.length;
      } else if (targetIdx === -1) {
        // Target is the dragged item itself or not found at this level
        insertIdx = targetSiblings.length;
      } else if (dropTarget.position === "before") {
        insertIdx = targetIdx;
      } else {
        insertIdx = targetIdx + 1;
      }

      // Insert dragged item
      const newOrder = [...targetSiblings];
      newOrder.splice(insertIdx, 0, draggedPl);

      // Build updates for target level
      const updates: { id: number; sortOrder: number; parentId: number | null }[] =
        newOrder.map((p, i) => ({
          id: p.id,
          sortOrder: i,
          parentId: newParentId,
        }));

      // If parent changed, also re-number old siblings to close gaps
      if (oldParentId !== newParentId) {
        const oldSiblings = playlists
          .filter((p) => p.parentId === oldParentId && p.id !== dragId)
          .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name));
        oldSiblings.forEach((p, i) => {
          updates.push({ id: p.id, sortOrder: i, parentId: oldParentId });
        });
      }

      try {
        await reorderPlaylists(updates);
        refreshPlaylists();
        // Auto-expand target folder so the moved item is visible
        if (newParentId !== null) {
          setExpanded((prev) => {
            const next = new Set(prev);
            next.add(newParentId);
            saveExpandedState(next);
            return next;
          });
        }
      } catch (err) {
        console.error("Failed to reorder playlists:", err);
      }

      setDragId(null);
      setDropTarget(null);
    },
    [dragId, dropTarget, playlists, refreshPlaylists],
  );

  const handleDragEnd = useCallback(() => {
    setDragId(null);
    setDropTarget(null);
  }, []);

  // Helper to get drop indicator styles for a playlist item
  const getDropIndicatorClass = (plId: number) => {
    if (!dropTarget || dropTarget.id !== plId) return "";
    switch (dropTarget.position) {
      case "before":
        return "border-t-2 border-accent";
      case "after":
        return "border-b-2 border-accent";
      case "inside":
        return "bg-accent/15 border border-accent/50 rounded-md";
      default:
        return "";
    }
  };

  const { rootItems, childrenMap } = buildPlaylistTree(playlists);

  const isNativeSmart = (pl: Playlist) => pl.isSmart && !!pl.rulesJson;

  const renderPlaylistButton = (pl: Playlist, depth: number) => (
    <button
      key={pl.id}
      draggable
      onDragStart={(e) => handleDragStart(e, pl)}
      onDragOver={(e) => handleDragOver(e, pl)}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      onDragEnd={handleDragEnd}
      onClick={() => navigateToPlaylist(pl.id, pl.name)}
      onContextMenu={(e) => handleContextMenu(e, pl)}
      className={`w-full text-left py-1 text-sm rounded-md truncate transition-colors flex items-center gap-1 ${
        view === "playlist" && playlistId === pl.id
          ? "bg-accent/20 text-n-100"
          : "text-n-400 hover:text-n-200 hover:bg-n-800/50"
      } ${dragId === pl.id ? "opacity-50" : ""} ${getDropIndicatorClass(pl.id)}`}
      style={{ paddingLeft: `${8 + depth * 12}px`, paddingRight: "8px" }}
    >
      {pl.isSmart && <SmartIcon native={isNativeSmart(pl)} />}
      <span className="truncate">{pl.name}</span>
    </button>
  );

  const renderFolder = (folder: Playlist, depth: number) => {
    const isExpanded = expanded.has(folder.id);
    const children = childrenMap[folder.id] || [];

    return (
      <div key={folder.id}>
        <button
          draggable
          onDragStart={(e) => handleDragStart(e, folder)}
          onDragOver={(e) => handleDragOver(e, folder)}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          onDragEnd={handleDragEnd}
          onClick={() => toggleFolder(folder.id)}
          className={`w-full text-left py-1 text-sm rounded-md truncate transition-colors text-n-400 hover:text-n-200 hover:bg-n-800/50 flex items-center gap-1 ${
            dragId === folder.id ? "opacity-50" : ""
          } ${getDropIndicatorClass(folder.id)}`}
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
                ? "bg-accent/20 text-n-100"
                : "text-n-400 hover:text-n-200 hover:bg-n-800/50"
            }`}
          >
            {item.label}
          </button>
        ))}
      </nav>

      <div className="px-3 pt-4 pb-1 flex items-center justify-between">
        <h2 className="text-[11px] font-semibold text-n-500 uppercase tracking-wider">
          Playlists
        </h2>
        <button
          onClick={() => {
            setEditingPlaylist(undefined);
            setEditorOpen(true);
          }}
          className="text-n-500 hover:text-n-300 transition-colors"
          title="New Smart Playlist"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <line x1="12" y1="5" x2="12" y2="19" />
            <line x1="5" y1="12" x2="19" y2="12" />
          </svg>
        </button>
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
          className={`aspect-square w-full overflow-hidden bg-n-800${currentTrackId ? " cursor-pointer" : ""}`}
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

      {lightboxOpen && currentTrackId && lightboxRect && (
        <ArtworkLightbox
          trackId={currentTrackId}
          artworkUrl={artworkUrl}
          originRect={lightboxRect}
          trackInfo={currentTrack ? { title: currentTrack.title, artist: currentTrack.artist, album: currentTrack.album, year: currentTrack.year } : undefined}
          duration={currentTrack?.duration ?? null}
          onClose={() => setLightboxOpen(false)}
        />
      )}

      {/* Context menu */}
      {contextMenu && (
        <div
          className="fixed z-50 bg-n-800 border border-n-700 rounded-md shadow-lg py-1 min-w-[140px]"
          style={{ left: contextMenu.x, top: contextMenu.y }}
        >
          {isNativeSmart(contextMenu.playlist) && (
            <button
              onClick={() => handleEditSmartPlaylist(contextMenu.playlist)}
              className="w-full text-left px-3 py-1.5 text-xs text-n-200 hover:bg-n-700 transition-colors"
            >
              Edit Rules...
            </button>
          )}
          <button
            onClick={() => handleDeletePlaylist(contextMenu.playlist)}
            className="w-full text-left px-3 py-1.5 text-xs text-red-400 hover:bg-n-700 transition-colors"
          >
            Delete
          </button>
        </div>
      )}

      {/* Smart playlist editor modal */}
      {editorOpen && (
        <SmartPlaylistEditor
          onSave={handleEditorSave}
          onClose={handleEditorClose}
          editingPlaylist={editingPlaylist}
        />
      )}
    </aside>
  );
}
