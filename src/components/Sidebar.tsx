import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigationStore, type View } from "../stores/navigationStore";
import { usePlaybackStore } from "../stores/playbackStore";
import { useLibraryStore } from "../stores/libraryStore";
import { getPlaylists, deletePlaylist, reorderPlaylists, createPlaylist, createPlaylistFolder } from "../lib/commands";
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

  // New playlist menu state
  const [newMenuOpen, setNewMenuOpen] = useState(false);
  const newMenuRef = useRef<HTMLDivElement>(null);

  // Mouse-based drag-and-drop state
  const [dragId, setDragId] = useState<number | null>(null);
  const [dropTarget, setDropTarget] = useState<{
    id: number;
    position: "before" | "after" | "inside";
  } | null>(null);
  const dragRef = useRef<{
    startY: number;
    playlistId: number;
    active: boolean;
  } | null>(null);
  const wasDraggingRef = useRef(false);
  const playlistNavRef = useRef<HTMLElement>(null);

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

  // Close new-playlist menu on click outside
  useEffect(() => {
    if (!newMenuOpen) return;
    const handler = (e: MouseEvent) => {
      if (newMenuRef.current && !newMenuRef.current.contains(e.target as Node)) {
        setNewMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [newMenuOpen]);

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

  // --- Mouse-based drag-and-drop ---

  const handleMouseDown = useCallback(
    (e: React.MouseEvent, pl: Playlist) => {
      if (e.button !== 0) return;
      wasDraggingRef.current = false;
      dragRef.current = { startY: e.clientY, playlistId: pl.id, active: false };
    },
    [],
  );

  const commitDrop = useCallback(
    async (currentDragId: number, target: { id: number; position: "before" | "after" | "inside" }) => {
      const targetPl = playlists.find((p) => p.id === target.id);
      const draggedPl = playlists.find((p) => p.id === currentDragId);
      if (!targetPl || !draggedPl) return;

      let newParentId: number | null;
      if (target.position === "inside") {
        newParentId = targetPl.id;
      } else {
        newParentId = targetPl.parentId;
      }

      // Prevent folder-into-folder
      if (draggedPl.isFolder && newParentId !== null) return;

      const oldParentId = draggedPl.parentId;

      const targetSiblings = playlists
        .filter((p) => p.parentId === newParentId && p.id !== currentDragId)
        .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name));

      let insertIdx: number;
      const targetIdx = targetSiblings.findIndex((p) => p.id === target.id);
      if (target.position === "inside") {
        insertIdx = targetSiblings.length;
      } else if (targetIdx === -1) {
        insertIdx = targetSiblings.length;
      } else if (target.position === "before") {
        insertIdx = targetIdx;
      } else {
        insertIdx = targetIdx + 1;
      }

      const newOrder = [...targetSiblings];
      newOrder.splice(insertIdx, 0, draggedPl);

      const updates: { id: number; sortOrder: number; parentId: number | null }[] =
        newOrder.map((p, i) => ({
          id: p.id,
          sortOrder: i,
          parentId: newParentId,
        }));

      if (oldParentId !== newParentId) {
        const oldSiblings = playlists
          .filter((p) => p.parentId === oldParentId && p.id !== currentDragId)
          .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name));
        oldSiblings.forEach((p, i) => {
          updates.push({ id: p.id, sortOrder: i, parentId: oldParentId });
        });
      }

      try {
        await reorderPlaylists(updates);
        refreshPlaylists();
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
    },
    [playlists, refreshPlaylists],
  );

  // Global mousemove / mouseup for drag
  useEffect(() => {
    const onMouseMove = (e: MouseEvent) => {
      const drag = dragRef.current;
      if (!drag) return;

      // Require 5px movement to start drag
      if (!drag.active) {
        if (Math.abs(e.clientY - drag.startY) < 5) return;
        drag.active = true;
        setDragId(drag.playlistId);
      }

      // Find which playlist item the cursor is over
      const nav = playlistNavRef.current;
      if (!nav) return;

      const buttons = nav.querySelectorAll<HTMLElement>("[data-playlist-id]");
      let found = false;
      for (const btn of buttons) {
        const id = Number(btn.dataset.playlistId);
        if (id === drag.playlistId) continue;

        const rect = btn.getBoundingClientRect();
        if (e.clientY >= rect.top && e.clientY <= rect.bottom) {
          const y = e.clientY - rect.top;
          const third = rect.height / 3;

          const targetPl = playlists.find((p) => p.id === id);
          const draggedPl = playlists.find((p) => p.id === drag.playlistId);
          const isTargetFolder = targetPl?.isFolder ?? false;
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

          setDropTarget({ id, position });
          found = true;
          break;
        }
      }
      if (!found) {
        setDropTarget(null);
      }
    };

    const onMouseUp = () => {
      const drag = dragRef.current;
      if (!drag) return;
      dragRef.current = null;

      if (drag.active) {
        wasDraggingRef.current = true;
        setDropTarget((currentTarget) => {
          if (currentTarget) {
            commitDrop(drag.playlistId, currentTarget);
          }
          return null;
        });
        setDragId(null);
      }
    };

    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", onMouseUp);
    return () => {
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseup", onMouseUp);
    };
  }, [playlists, commitDrop]);

  // Helper to get drop indicator styles for a playlist item
  const getDropStyles = (plId: number): { className: string; style?: React.CSSProperties } => {
    if (!dropTarget || dropTarget.id !== plId) return { className: "" };
    switch (dropTarget.position) {
      case "before":
        return {
          className: "",
          style: { boxShadow: "0 -2px 0 0 var(--color-accent)", marginTop: "4px", transition: "margin 150ms ease" },
        };
      case "after":
        return {
          className: "",
          style: { boxShadow: "0 2px 0 0 var(--color-accent)", marginBottom: "4px", transition: "margin 150ms ease" },
        };
      case "inside":
        return {
          className: "bg-accent/20 ring-1 ring-accent/50 rounded-md",
        };
      default:
        return { className: "" };
    }
  };

  const { rootItems, childrenMap } = buildPlaylistTree(playlists);

  const isNativeSmart = (pl: Playlist) => pl.isSmart && !!pl.rulesJson;

  const renderPlaylistButton = (pl: Playlist, depth: number) => {
    const drop = getDropStyles(pl.id);
    return (
      <button
        key={pl.id}
        data-playlist-id={pl.id}
        onMouseDown={(e) => handleMouseDown(e, pl)}
        onClick={() => {
          if (wasDraggingRef.current) { wasDraggingRef.current = false; return; }
          navigateToPlaylist(pl.id, pl.name);
        }}
        onContextMenu={(e) => handleContextMenu(e, pl)}
        className={`w-full text-left py-1 text-sm rounded-md truncate transition-colors flex items-center gap-1 ${
          view === "playlist" && playlistId === pl.id
            ? "bg-accent/20 text-n-100"
            : "text-n-400 hover:text-n-200 hover:bg-n-800/50"
        } ${dragId === pl.id ? "opacity-30 scale-95" : ""} ${drop.className}`}
        style={{ paddingLeft: `${8 + depth * 12}px`, paddingRight: "8px", transition: "opacity 150ms, transform 150ms, margin 150ms", ...drop.style }}
      >
        {pl.isSmart && <SmartIcon native={isNativeSmart(pl)} />}
        <span className="truncate">{pl.name}</span>
      </button>
    );
  };

  const renderFolder = (folder: Playlist, depth: number) => {
    const isExpanded = expanded.has(folder.id);
    const children = childrenMap[folder.id] || [];

    const drop = getDropStyles(folder.id);
    return (
      <div key={folder.id}>
        <button
          data-playlist-id={folder.id}
          onMouseDown={(e) => handleMouseDown(e, folder)}
          onClick={() => {
            if (wasDraggingRef.current) { wasDraggingRef.current = false; return; }
            toggleFolder(folder.id);
          }}
          className={`w-full text-left py-1 text-sm rounded-md truncate transition-colors text-n-400 hover:text-n-200 hover:bg-n-800/50 flex items-center gap-1 ${
            dragId === folder.id ? "opacity-30 scale-95" : ""
          } ${drop.className}`}
          style={{ paddingLeft: `${4 + depth * 12}px`, paddingRight: "8px", transition: "opacity 150ms, transform 150ms, margin 150ms", ...drop.style }}
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
        <div ref={newMenuRef} className="relative">
          <button
            onClick={() => setNewMenuOpen((v) => !v)}
            className="text-n-500 hover:text-n-300 transition-colors"
            title="New Playlist"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="12" y1="5" x2="12" y2="19" />
              <line x1="5" y1="12" x2="19" y2="12" />
            </svg>
          </button>
          {newMenuOpen && (
            <div className="absolute right-0 top-full mt-1 w-44 bg-n-800 border border-n-700 rounded-lg shadow-xl overflow-hidden z-50">
              <button
                onClick={async () => {
                  setNewMenuOpen(false);
                  try {
                    const id = await createPlaylist("Untitled Playlist");
                    refreshPlaylists();
                    navigateToPlaylist(id, "Untitled Playlist");
                  } catch (err) {
                    console.error("Failed to create playlist:", err);
                  }
                }}
                className="w-full text-left px-3 py-1.5 text-[11px] text-n-300 hover:bg-n-700 transition-colors"
              >
                Playlist
              </button>
              <button
                onClick={() => {
                  setNewMenuOpen(false);
                  setEditingPlaylist(undefined);
                  setEditorOpen(true);
                }}
                className="w-full text-left px-3 py-1.5 text-[11px] text-n-300 hover:bg-n-700 transition-colors"
              >
                Smart Playlist
              </button>
              <button
                onClick={async () => {
                  setNewMenuOpen(false);
                  try {
                    await createPlaylistFolder("New Folder");
                    refreshPlaylists();
                  } catch (err) {
                    console.error("Failed to create folder:", err);
                  }
                }}
                className="w-full text-left px-3 py-1.5 text-[11px] text-n-300 hover:bg-n-700 transition-colors"
              >
                Folder
              </button>
            </div>
          )}
        </div>
      </div>
      <nav
        ref={playlistNavRef}
        className="px-1 flex-1 overflow-y-auto min-h-0"
      >
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
