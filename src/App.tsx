import { useEffect, useCallback, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { useLibraryStore } from "./stores/libraryStore";
import { useNavigationStore } from "./stores/navigationStore";
import { usePlaybackStore } from "./stores/playbackStore";
import { useThemeStore } from "./stores/themeStore";
import { useColumnBrowserStore, type BrowserColumn } from "./stores/columnBrowserStore";
import { getTracks, getTrackCount, importLibrary, updateNowPlaying, clearNowPlaying, stopPlayback, getArtworkDataUrl, createPlaylist, createPlaylistFolder } from "./lib/commands";
import { ImportProgress } from "./components/ImportProgress";
import { PlaybackBar } from "./components/PlaybackBar";
import { Sidebar } from "./components/Sidebar";
import { ContentRouter } from "./components/ContentRouter";
import { StatusBar } from "./components/StatusBar";
import { useDragRegion } from "./hooks/useDragRegion";
import { WelcomeAnimation } from "./components/WelcomeAnimation";
import { MiniPlayer } from "./components/MiniPlayer";

function App() {
  const onDrag = useDragRegion();
  const {
    tracks,
    isLoading,
    isImported,
    isImporting,
    importError,
    setTracks,
    setIsLoading,
    setIsImported,
    setIsImporting,
    setImportError,
    setTrackCount,
  } = useLibraryStore();

  const navigateTo = useNavigationStore((s) => s.navigateTo);
  const searchResults = useLibraryStore((s) => s.searchResults);
  const showStatusBar = useThemeStore((s) => s.showStatusBar);
  const showAlbumAccent = useThemeStore((s) => s.showAlbumAccent);
  const isMiniPlayer = useThemeStore((s) => s.isMiniPlayer);

  const loadTracks = useCallback(async () => {
    try {
      const count = await getTrackCount();
      if (count > 0) {
        setTrackCount(count);
        setIsImported(true);
        setIsLoading(false);
        const allTracks = await getTracks({
          limit: 200000,
          sortColumn: "id",
          sortDir: "asc",
        });
        setTracks(allTracks);
      } else {
        setIsLoading(false);
      }
    } catch (err) {
      console.error("Failed to load tracks:", err);
      setIsLoading(false);
    }
  }, [setTracks, setTrackCount, setIsLoading, setIsImported]);

  useEffect(() => {
    loadTracks();
  }, [loadTracks]);

  // When search results appear, switch to songs view
  useEffect(() => {
    if (searchResults != null) {
      navigateTo("songs");
    }
  }, [searchResults, navigateTo]);

  const handleImport = useCallback(async () => {
    if (useLibraryStore.getState().isImporting) return;
    setIsImporting(true);
    setImportError(null);
    try {
      const stats = await importLibrary();
      console.log("Import stats:", stats);
      await loadTracks();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error("Import failed:", message);
      setImportError(message);
    } finally {
      setIsImporting(false);
    }
  }, [setIsImporting, setImportError, loadTracks]);

  // Use a ref so the menu event listener always sees the latest handleImport
  const handleImportRef = useRef(handleImport);
  handleImportRef.current = handleImport;

  // Initialize theme and column browser on mount
  useEffect(() => {
    useThemeStore.getState().init();
    useColumnBrowserStore.getState().init();
  }, []);

  // Listen for menu "Re-import Library", theme changes, and system media key events
  useEffect(() => {
    const unlisteners = [
      listen("menu-reimport", () => handleImportRef.current()),
      listen<string>("theme-change", (event) => {
        const t = event.payload as "light" | "dark" | "system";
        useThemeStore.getState().setTheme(t);
      }),
      listen("artwork-updated", () => {
        loadTracks();
      }),
      listen("media-toggle", () => usePlaybackStore.getState().togglePlayPause()),
      listen("media-play", () => {
        const s = usePlaybackStore.getState();
        if (!s.isPlaying && s.currentTrackId != null) s.resume();
      }),
      listen("media-pause", () => {
        const s = usePlaybackStore.getState();
        if (s.isPlaying) s.pause();
      }),
      listen("media-goto-current", () => {
        const qs = usePlaybackStore.getState().queueSource;
        const ns = useNavigationStore.getState();
        if (qs?.startsWith("playlist:")) {
          const id = parseInt(qs.split(":")[1], 10);
          const name = qs.split(":").slice(2).join(":") || "Playlist";
          ns.navigateToPlaylist(id, name);
        } else if (qs?.startsWith("album:")) {
          const parts = qs.split(":");
          ns.navigateToAlbum(parts[1] ?? "", parts.slice(2).join(":") || null);
        } else if (qs?.startsWith("artist:")) {
          ns.navigateToArtist(qs.slice(7));
        } else if (qs?.startsWith("genre:")) {
          ns.navigateToGenre(qs.slice(6));
        } else {
          ns.navigateTo("songs");
        }
        // Allow React to process navigation and mount the target view
        setTimeout(() => {
          usePlaybackStore.getState().requestScrollToNowPlaying();
        }, 50);
      }),
      listen("media-next", () => usePlaybackStore.getState().next()),
      listen("media-prev", () => usePlaybackStore.getState().prev()),
      listen("media-stop", () => {
        usePlaybackStore.getState().stopPolling();
        stopPlayback().catch(() => {});
        usePlaybackStore.setState({ isPlaying: false, currentTrackId: null, position: 0, duration: null });
      }),
      listen("media-vol-up", () => {
        const s = usePlaybackStore.getState();
        s.setVolume(Math.min(1, s.volume + 0.1));
      }),
      listen("media-vol-down", () => {
        const s = usePlaybackStore.getState();
        s.setVolume(Math.max(0, s.volume - 0.1));
      }),
      listen<boolean>("toggle-status-bar", (event) => {
        useThemeStore.getState().setShowStatusBar(event.payload);
      }),
      listen<boolean>("toggle-album-accent", (event) => {
        useThemeStore.getState().setShowAlbumAccent(event.payload);
      }),
      listen<boolean>("media-shuffle", (event) => {
        usePlaybackStore.setState({ shuffle: event.payload });
      }),
      listen<string>("media-repeat", (event) => {
        usePlaybackStore.setState({ repeatMode: event.payload });
      }),
      listen<boolean>("col-browser-toggle", (event) => {
        useColumnBrowserStore.getState().setVisible(event.payload);
      }),
      listen<string>("col-browser-column", (event) => {
        try {
          const { column, enabled } = JSON.parse(event.payload) as { column: BrowserColumn; enabled: boolean };
          const store = useColumnBrowserStore.getState();
          if (enabled && !store.columns.includes(column)) {
            store.toggleColumn(column);
          } else if (!enabled && store.columns.includes(column)) {
            store.toggleColumn(column);
          }
        } catch { /* ignore parse errors */ }
      }),
      listen<boolean>("col-browser-album-artist", (event) => {
        useColumnBrowserStore.getState().setUseAlbumArtist(event.payload);
      }),
      listen("menu-new-playlist", async () => {
        try {
          const id = await createPlaylist("Untitled Playlist");
          useNavigationStore.getState().requestSidebarRefresh();
          useNavigationStore.getState().navigateToPlaylist(id, "Untitled Playlist");
        } catch (err) {
          console.error("Failed to create playlist:", err);
        }
      }),
      listen("menu-new-playlist-from-selection", async () => {
        try {
          // Use table selection first, fall back to currently playing track
          let trackIds = useLibraryStore.getState().selectedTrackIds;
          if (trackIds.length === 0) {
            const pb = usePlaybackStore.getState();
            if (pb.currentTrackId != null) {
              trackIds = [pb.currentTrackId];
            }
          }
          const id = await createPlaylist(
            "Untitled Playlist",
            null,
            trackIds.length > 0 ? trackIds : null,
          );
          useNavigationStore.getState().requestSidebarRefresh();
          useNavigationStore.getState().navigateToPlaylist(id, "Untitled Playlist");
        } catch (err) {
          console.error("Failed to create playlist from selection:", err);
        }
      }),
      listen("menu-new-smart-playlist", () => {
        // Emit an event the Sidebar can listen to, or set global state
        useNavigationStore.getState().requestSidebarRefresh();
        window.dispatchEvent(new CustomEvent("waves-open-smart-editor"));
      }),
      listen("toggle-mini-player", () => {
        useThemeStore.getState().toggleMiniPlayer();
      }),
      listen("menu-new-playlist-folder", async () => {
        try {
          await createPlaylistFolder("New Folder");
          useNavigationStore.getState().requestSidebarRefresh();
        } catch (err) {
          console.error("Failed to create playlist folder:", err);
        }
      }),
    ];
    return () => {
      unlisteners.forEach((p) => p.then((fn) => fn()));
    };
  }, []);

  // Global keyboard shortcuts (arrow keys for prev/next when not in an input)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;

      if (e.key === "ArrowLeft") {
        e.preventDefault();
        usePlaybackStore.getState().prev();
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        usePlaybackStore.getState().next();
      } else if (e.key === "ArrowUp" && e.metaKey && e.shiftKey) {
        e.preventDefault();
        const s = usePlaybackStore.getState();
        s.setVolume(Math.min(1, s.volume + 0.1));
      } else if (e.key === "ArrowDown" && e.metaKey && e.shiftKey) {
        e.preventDefault();
        const s = usePlaybackStore.getState();
        s.setVolume(Math.max(0, s.volume - 0.1));
      } else if (e.key === "ArrowUp" && e.metaKey) {
        e.preventDefault();
        // Scroll to top of current list
        const el = document.querySelector<HTMLElement>(".flex-1.overflow-auto");
        if (el) el.scrollTop = 0;
      } else if (e.key === "ArrowDown" && e.metaKey) {
        e.preventDefault();
        // Scroll to bottom of current list
        const el = document.querySelector<HTMLElement>(".flex-1.overflow-auto");
        if (el) el.scrollTop = el.scrollHeight;
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, []);

  // Update macOS Now Playing info when track or playback state changes
  const currentTrackId = usePlaybackStore((s) => s.currentTrackId);
  const isPlaying = usePlaybackStore((s) => s.isPlaying);
  const currentArtworkUrl = usePlaybackStore((s) => s.currentArtworkUrl);

  useEffect(() => {
    if (currentTrackId == null) {
      clearNowPlaying().catch(() => {});
      return;
    }
    const track = tracks.find((t) => t.id === currentTrackId);
    if (!track) return;
    updateNowPlaying(
      track.title,
      track.artist,
      track.album,
      track.duration,
      null,
      isPlaying,
      track.artworkHash,
    ).catch(() => {});
  }, [currentTrackId, isPlaying, tracks]);

  // Load artwork globally when current track changes
  useEffect(() => {
    const track = currentTrackId != null ? tracks.find((t) => t.id === currentTrackId) : null;
    if (!track?.artworkHash) {
      usePlaybackStore.setState({ currentArtworkUrl: null });
      return;
    }
    let cancelled = false;
    getArtworkDataUrl(track.artworkHash).then((url) => {
      if (!cancelled) usePlaybackStore.setState({ currentArtworkUrl: url });
    }).catch(() => {
      if (!cancelled) usePlaybackStore.setState({ currentArtworkUrl: null });
    });
    return () => { cancelled = true; };
  }, [currentTrackId, tracks]);

  // Blurred background crossfade state
  const [bgReady, setBgReady] = useState(false);
  const [bgSrc, setBgSrc] = useState<string | null>(null);
  const prevArtworkRef = useRef<string | null>(null);

  useEffect(() => {
    if (currentArtworkUrl === prevArtworkRef.current) return;
    prevArtworkRef.current = currentArtworkUrl;
    if (!currentArtworkUrl) {
      setBgReady(false);
      // After fade out, clear the src
      const t = setTimeout(() => setBgSrc(null), 800);
      return () => clearTimeout(t);
    }
    // Preload the image, then swap
    setBgReady(false);
    const img = new Image();
    img.onload = () => {
      setBgSrc(currentArtworkUrl);
      // Small delay to ensure the src is set before fading in
      requestAnimationFrame(() => {
        requestAnimationFrame(() => setBgReady(true));
      });
    };
    img.src = currentArtworkUrl;
  }, [currentArtworkUrl]);

  const handleImportComplete = useCallback(() => {
    // Progress modal auto-dismisses, tracks load in handleImport
  }, []);

  // Loading splash — show logo while checking for existing library
  if (isLoading) {
    return (
      <div className="h-screen bg-white flex flex-col">
        <div className="h-10 flex-shrink-0" data-tauri-drag-region onMouseDown={onDrag} />
        <div className="flex-1 flex items-center justify-center overflow-hidden min-h-0">
          <WelcomeAnimation />
        </div>
      </div>
    );
  }

  if (!isImported && !isImporting) {
    return (
      <div className="h-screen bg-white flex flex-col">
        {/* Title bar drag region */}
        <div className="h-10 flex-shrink-0" data-tauri-drag-region onMouseDown={onDrag} />

        {/* Icon video — fills available space */}
        <div className="flex-1 flex items-center justify-center overflow-hidden min-h-0">
          <WelcomeAnimation />
        </div>

        {/* Import controls */}
        <div className="flex-shrink-0 pb-12 pt-2 flex flex-col items-center gap-3">
          {importError && (
            <div className="mb-2 p-3 bg-red-50 border border-red-200 rounded-lg max-w-lg">
              <p className="text-red-600 text-sm font-medium mb-1">Import failed</p>
              <p className="text-red-500 text-xs font-mono break-all">{importError}</p>
            </div>
          )}
          <button
            onClick={handleImport}
            className="px-8 py-2.5 bg-neutral-900 hover:bg-neutral-800 text-white rounded-lg font-medium transition-colors text-[15px]"
          >
            Import Library
          </button>
          <p className="text-neutral-400 text-xs">Import your Apple Music library to get started</p>
        </div>
      </div>
    );
  }

  if (!isImported && isImporting) {
    return (
      <div data-tauri-drag-region onMouseDown={onDrag} className="h-screen bg-n-950 text-n-100 flex flex-col">
        <ImportProgress onComplete={handleImportComplete} mode="initial" />
      </div>
    );
  }

  if (isMiniPlayer) {
    return <MiniPlayer tracks={tracks} />;
  }

  return (
    <div
      className="h-screen bg-n-950 text-n-100 relative overflow-hidden"
      onContextMenu={(e) => e.preventDefault()}
    >
      {/* Blurred artwork background */}
      {showAlbumAccent && (
        <div className="absolute inset-0 overflow-hidden" aria-hidden="true">
          <div
            className="absolute inset-[-48px] will-change-[filter]"
            style={{ filter: "var(--accent-filter)" }}
          >
            {bgSrc && (
              <img
                src={bgSrc}
                alt=""
                className="w-full h-full object-cover transition-opacity duration-800 ease-in-out"
                style={{ opacity: bgReady ? 1 : 0 }}
              />
            )}
          </div>
          {/* Theme-adaptive overlay for readability */}
          <div className="absolute inset-0" style={{ backgroundColor: "var(--accent-overlay)" }} />
        </div>
      )}

      {/* Main UI */}
      <div className="relative z-10 flex flex-col h-full">
        {isImporting && <ImportProgress onComplete={handleImportComplete} mode="reimport" />}

        <PlaybackBar tracks={tracks} />

        <div className="flex flex-1 min-h-0">
          <Sidebar />
          <div className="flex flex-col flex-1 min-w-0">
            <ContentRouter />
            {showStatusBar && <StatusBar />}
          </div>
        </div>
      </div>
    </div>
  );
}

export default App;
