import { useEffect, useCallback, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useLibraryStore } from "./stores/libraryStore";
import { useNavigationStore } from "./stores/navigationStore";
import { usePlaybackStore } from "./stores/playbackStore";
import { useThemeStore } from "./stores/themeStore";
import { useColumnBrowserStore, type BrowserColumn } from "./stores/columnBrowserStore";
import { useActivityStore } from "./stores/activityStore";
import { save, open } from "@tauri-apps/plugin-dialog";
import { getTracks, getTrackCount, importLibrary, updateNowPlaying, clearNowPlaying, stopPlayback, getUpcomingTracks, createPlaylist, createPlaylistFolder, exportLibrary, exportAiTags, importAiTags, exportPlaylistM3u, setTrafficLightsVisible } from "./lib/commands";
import { fetchArtwork } from "./lib/artworkQueue";
import { ImportProgress } from "./components/ImportProgress";
import { WindowControls } from "./components/WindowControls";
import { ResizeGripper } from "./components/ResizeGripper";
import { PlaybackBar } from "./components/PlaybackBar";
import { Sidebar } from "./components/Sidebar";
import { ContentRouter } from "./components/ContentRouter";
import { StatusBar } from "./components/StatusBar";
import { AssistantPanel } from "./components/AssistantPanel";
import { AssistantApiKeyModal } from "./components/AssistantApiKeyModal";
import { useAssistantStore } from "./stores/assistantStore";
import { useDragRegion } from "./hooks/useDragRegion";
import { MiniPlayer } from "./components/MiniPlayer";
import { KeyboardShortcutsModal } from "./components/KeyboardShortcutsModal";
import { QueuePanel } from "./components/QueuePanel";
import { SettingsPanel } from "./components/SettingsPanel";
import { AddFromUrlDialog } from "./components/AddFromUrlDialog";
import { HandoffBanner } from "./components/HandoffBanner";
import { extractAccentColor, adjustForTheme } from "./lib/extractAccentColor";
import { onOpenUrl } from "@tauri-apps/plugin-deep-link";

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

  const tracksLoading = useLibraryStore((s) => s.tracksLoading);
  const trackCount = useLibraryStore((s) => s.trackCount);
  const navigateTo = useNavigationStore((s) => s.navigateTo);
  const searchResults = useLibraryStore((s) => s.searchResults);
  const showStatusBar = useThemeStore((s) => s.showStatusBar);
  const showAlbumAccent = useThemeStore((s) => s.showAlbumAccent);
  const isMiniPlayer = useThemeStore((s) => s.isMiniPlayer);
  const miniPlayerMode = useThemeStore((s) => s.miniPlayerMode);
  const isNotchMode = isMiniPlayer && miniPlayerMode === "notch";

  // Transparent document background for notch mode
  useEffect(() => {
    document.documentElement.style.background = isNotchMode ? "transparent" : "";
    document.body.style.background = isNotchMode ? "transparent" : "";
  }, [isNotchMode]);

  // Hide native traffic lights — we use custom window controls
  useEffect(() => {
    setTrafficLightsVisible(false).catch(() => {});
  }, []);

  const [showShortcuts, setShowShortcuts] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showAddFromUrl, setShowAddFromUrl] = useState(false);
  const [deepLinkUrl, setDeepLinkUrl] = useState<string | null>(null);

  const setTracksLoading = useLibraryStore((s) => s.setTracksLoading);

  const loadTracks = useCallback(async () => {
    try {
      const count = await getTrackCount();
      if (count > 0) {
        setTrackCount(count);
        setIsImported(true);
        setIsLoading(false);
        setTracksLoading(true);
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
      setTracksLoading(false);
    }
  }, [setTracks, setTrackCount, setIsLoading, setIsImported, setTracksLoading]);

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

  // Initialize stores on mount
  useEffect(() => {
    useThemeStore.getState().init();
    useColumnBrowserStore.getState().init();
    useNavigationStore.getState().init();
    usePlaybackStore.getState().init();
    useAssistantStore.getState().init();
    useActivityStore.getState().init();
  }, []);

  // Check for handoff state when window regains focus
  useEffect(() => {
    const check = () => {
      usePlaybackStore.getState().checkHandoff();
    };
    const onVisible = () => {
      if (document.visibilityState === "visible") check();
    };
    const onFocus = () => check();
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onFocus);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onFocus);
    };
  }, []);

  // Listen for deep-link URLs (untune://add?url=...)
  useEffect(() => {
    const unlisten = onOpenUrl((urls) => {
      for (const raw of urls) {
        try {
          const parsed = new URL(raw);
          if (parsed.host === "add") {
            const targetUrl = parsed.searchParams.get("url");
            if (targetUrl) {
              setDeepLinkUrl(targetUrl);
              setShowAddFromUrl(true);
            }
          }
        } catch {
          // ignore malformed URLs
        }
      }
    });
    return () => { unlisten.then((fn) => fn()); };
  }, []);

  // Reload tracks when a background task completes (artwork, ai-tagging, url-download)
  useEffect(() => {
    return useActivityStore.subscribe((s, prev) => {
      if (s.lastCompletedTaskId && s.lastCompletedTaskId !== prev.lastCompletedTaskId) {
        if (s.lastCompletedTaskId === "artwork" || s.lastCompletedTaskId === "ai-tagging" || s.lastCompletedTaskId === "find-tags" || s.lastCompletedTaskId === "url-download") {
          loadTracks();
        }
        // URL downloads may create playlists and add tracks — refresh sidebar + detail views
        if (s.lastCompletedTaskId === "url-download") {
          useNavigationStore.getState().requestSidebarRefresh();
          useNavigationStore.getState().requestDetailRefresh();
        }
      }
    });
  }, [loadTracks]);

  // Listen for menu "Re-import Library", theme changes, and system media key events
  useEffect(() => {
    const unlisteners = [
      listen("menu-reimport", () => handleImportRef.current()),
      listen("menu-add-files", async () => {
        const selected = await open({
          multiple: true,
          directory: false,
          filters: [{
            name: "Audio Files",
            extensions: ["mp3", "m4a", "aac", "flac", "aif", "aiff", "wav", "ogg", "alac", "opus",
                         "spc", "nsf", "nsfe", "gbs", "vgm", "vgz", "gym", "ay", "hes", "kss", "sap",
                         "psf", "minipsf", "psf2", "minipsf2"]
          }],
        });
        if (selected) {
          const paths = Array.isArray(selected) ? selected : [selected];
          const { importFiles } = await import("./lib/commands");
          const result = await importFiles(paths);
          if (result.imported > 0) loadTracks();
        }
      }),
      listen("menu-add-folder", async () => {
        const selected = await open({ directory: true, multiple: true });
        if (selected) {
          const paths = Array.isArray(selected) ? selected : [selected];
          const { importFiles } = await import("./lib/commands");
          const result = await importFiles(paths);
          if (result.imported > 0) loadTracks();
        }
      }),
      listen("menu-settings", () => setShowSettings(true)),
      listen<string>("theme-change", (event) => {
        const t = event.payload as "light" | "dark" | "system";
        useThemeStore.getState().setTheme(t);
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
        window.dispatchEvent(new CustomEvent("untune-open-smart-editor"));
      }),
      listen("toggle-mini-player", async () => {
        const store = useThemeStore.getState();
        if (store.isMiniPlayer && store.miniPlayerMode === "floating") {
          await store.toggleMiniPlayer(); // exit
        } else {
          if (store.isMiniPlayer) await store.toggleMiniPlayer(); // exit notch first
          store.setMiniPlayerMode("floating");
          await useThemeStore.getState().toggleMiniPlayer(); // enter floating
        }
      }),
      listen("toggle-mini-player-island", async () => {
        const store = useThemeStore.getState();
        if (store.isMiniPlayer && store.miniPlayerMode === "notch") {
          await store.toggleMiniPlayer(); // exit
        } else {
          if (store.isMiniPlayer) await store.toggleMiniPlayer(); // exit floating first
          store.setMiniPlayerMode("notch");
          await useThemeStore.getState().toggleMiniPlayer(); // enter notch
        }
      }),
      listen("menu-new-playlist-folder", async () => {
        try {
          await createPlaylistFolder("New Folder");
          useNavigationStore.getState().requestSidebarRefresh();
        } catch (err) {
          console.error("Failed to create playlist folder:", err);
        }
      }),
      listen("menu-export-library", async () => {
        const path = await save({
          defaultPath: "untune_library.json",
          filters: [{ name: "JSON", extensions: ["json"] }],
        });
        if (!path) return;
        try {
          const count = await exportLibrary(path);
          console.log(`Exported ${count} tracks`);
        } catch (err) {
          console.error("Export library failed:", err);
        }
      }),
      listen("menu-export-ai-tags", async () => {
        const path = await save({
          defaultPath: "ai_tags_backup.json",
          filters: [{ name: "JSON", extensions: ["json"] }],
        });
        if (!path) return;
        try {
          const count = await exportAiTags(path);
          console.log(`Exported ${count} AI tags`);
        } catch (err) {
          console.error("Export AI tags failed:", err);
        }
      }),
      listen("menu-import-ai-tags", async () => {
        const path = await open({
          filters: [{ name: "JSON", extensions: ["json"] }],
          multiple: false,
        });
        if (!path) return;
        try {
          const count = await importAiTags(path);
          console.log(`Restored ${count} AI tags`);
          loadTracks();
        } catch (err) {
          console.error("Import AI tags failed:", err);
        }
      }),
      listen("menu-add-from-url", () => setShowAddFromUrl(true)),
      listen("menu-export-playlist-m3u", async () => {
        const nav = useNavigationStore.getState();
        let playlistId = nav.view === "playlist" ? nav.playlistId : null;
        let playlistName = nav.view === "playlist" ? nav.playlistName : null;

        if (playlistId == null) {
          // No playlist selected — let user pick from available playlists
          // Fall back: just show the save dialog and hope they pick one
          // For now, alert if no playlist is active
          console.warn("No playlist selected for M3U export");
          return;
        }

        const safeName = (playlistName ?? "playlist").replace(/[^a-zA-Z0-9_-]/g, "_");
        const path = await save({
          defaultPath: `${safeName}.m3u`,
          filters: [{ name: "M3U Playlist", extensions: ["m3u"] }],
        });
        if (!path) return;
        try {
          await exportPlaylistM3u(playlistId, path);
          console.log(`Exported playlist as M3U`);
        } catch (err) {
          console.error("Export playlist M3U failed:", err);
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
      } else if (e.key === "j" && e.metaKey) {
        e.preventDefault();
        useAssistantStore.getState().toggle();
      } else if (e.key === "?" && !e.metaKey && !e.ctrlKey && !e.altKey) {
        e.preventDefault();
        setShowShortcuts((v) => !v);
      } else if (e.key === "," && e.metaKey) {
        e.preventDefault();
        setShowSettings((v) => !v);
      } else if (e.key === "u" && e.metaKey && !e.shiftKey && !e.altKey) {
        e.preventDefault();
        setShowAddFromUrl(true);
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
    fetchArtwork(track.artworkHash, { priority: true }).then((url) => {
      if (!cancelled) usePlaybackStore.setState({ currentArtworkUrl: url ?? null });
    });
    return () => { cancelled = true; };
  }, [currentTrackId, tracks]);

  // Pre-warm artwork for upcoming tracks. The immediate next + previous go
  // through the priority lane (bypass the 6-slot queue) so they're guaranteed
  // cached even if AlbumsView/TrackTable tiles are saturating the queue —
  // hitting Next/Prev should never wait on an IPC. Re-runs when shuffle or
  // repeat changes since those reshape what "next" means.
  const _shuffle = usePlaybackStore((s) => s.shuffle);
  const _repeatMode = usePlaybackStore((s) => s.repeatMode);
  useEffect(() => {
    if (currentTrackId == null || tracks.length === 0) return;
    let cancelled = false;
    getUpcomingTracks(5).then(({ prevTrackIds, nextTrackIds }) => {
      if (cancelled) return;
      const trackMap = new Map(tracks.map((t) => [t.id, t]));

      // Priority lane: immediate next + prev. Cached before the user can
      // possibly click the button.
      const immediate = [nextTrackIds[0], prevTrackIds[0]].filter(
        (id): id is number => id != null,
      );
      for (const id of immediate) {
        const t = trackMap.get(id);
        if (t?.artworkHash) {
          fetchArtwork(t.artworkHash, { priority: true }).catch(() => {});
        }
      }

      // Lookahead: nice-to-have, normal queue.
      const rest = [...nextTrackIds.slice(1), ...prevTrackIds.slice(1)];
      for (const id of rest) {
        const t = trackMap.get(id);
        if (t?.artworkHash) fetchArtwork(t.artworkHash).catch(() => {});
      }
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [currentTrackId, tracks, _shuffle, _repeatMode]);

  // Extract accent color from artwork and set CSS custom properties
  const theme = useThemeStore((s) => s.theme);

  useEffect(() => {
    const root = document.documentElement;

    // Resolve actual dark/light from current DOM state
    const getIsDark = () => root.getAttribute("data-theme") !== "light";

    const setNeutral = (isDark: boolean) => {
      if (isDark) {
        root.style.setProperty("--color-accent", "rgb(255 255 255)");
        root.style.setProperty("--accent-row", "rgba(255,255,255,0.18)");
        root.style.setProperty("--accent-row-hover", "rgba(255,255,255,0.24)");
      } else {
        root.style.setProperty("--color-accent", "rgb(64 64 64)");
        root.style.setProperty("--accent-row", "rgba(0,0,0,0.10)");
        root.style.setProperty("--accent-row-hover", "rgba(0,0,0,0.15)");
      }
    };

    if (!showAlbumAccent || !currentArtworkUrl) {
      setNeutral(getIsDark());
      return;
    }

    // Snap the CSS vars in one go. The previous 60fps rAF animation mutated
    // these three vars 30 times during a 500ms transition; every visible
    // TrackTable row depends on them, so the browser had to repaint every row
    // on every frame — that's where the stutter came from.
    const setAccent = (accent: string, row: string, rowHover: string) => {
      root.style.setProperty("--color-accent", accent);
      root.style.setProperty("--accent-row", row);
      root.style.setProperty("--accent-row-hover", rowHover);
    };

    let cancelled = false;
    extractAccentColor(currentArtworkUrl).then((color) => {
      if (cancelled) return;
      const isDark = getIsDark();
      if (color) {
        const accent = adjustForTheme(color, isDark);
        const [r, g, b] = color;
        if (isDark) {
          setAccent(accent, `rgba(${r},${g},${b},0.18)`, `rgba(${r},${g},${b},0.24)`);
        } else {
          setAccent(accent, `rgba(${r},${g},${b},0.12)`, `rgba(${r},${g},${b},0.18)`);
        }
      } else {
        setNeutral(isDark);
      }
    });
    return () => { cancelled = true; };
  }, [currentArtworkUrl, showAlbumAccent, theme]);


  // Drop the expensive blurred background while the window is actively resizing.
  // A 64px blur on a full-window box re-rasterizes on every live-resize frame,
  // which makes dragging the resize handle crawl. Hide the blurred layers during
  // the drag (the theme overlay stays, so there's no flash) and bring them back
  // ~150ms after the last resize event.
  const [resizing, setResizing] = useState(false);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const unlisten = getCurrentWindow().onResized(() => {
      setResizing(true);
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => setResizing(false), 150);
    });
    return () => { if (timer) clearTimeout(timer); unlisten.then((f) => f()); };
  }, []);


  const handleImportComplete = useCallback(() => {
    // Progress modal auto-dismisses, tracks load in handleImport
  }, []);

  const isDarkSystem = window.matchMedia("(prefers-color-scheme: dark)").matches;

  // Loading splash — the HTML #initial-loader stays visible until we dismiss it
  const showSplash = isLoading || (tracksLoading && tracks.length === 0);

  useEffect(() => {
    const loader = document.getElementById("initial-loader");
    if (!loader) return;
    if (!showSplash && isImported) {
      // Library loaded — remove the loader entirely
      loader.remove();
    } else if (!showSplash && !isImported) {
      // Welcome/import screen — hide spinner but keep starfield + logo
      const spinner = loader.querySelector('.spinner') as HTMLElement;
      if (spinner) spinner.style.display = 'none';
    }
  }, [showSplash, isImported]);

  if (showSplash) {
    return null;
  }

  if (!isImported && !isImporting) {
    return (
      <div className="fixed inset-0 z-[10000] flex flex-col">
        {/* Title bar with window controls */}
        <div className="h-10 flex-shrink-0 flex items-center">
          <WindowControls />
          <div className="flex-1 h-full" data-tauri-drag-region onMouseDown={onDrag} />
        </div>

        <div className="flex-1" data-tauri-drag-region onMouseDown={onDrag} />

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
            className={`px-8 py-2.5 rounded-lg font-medium transition-colors text-[15px] ${
              isDarkSystem
                ? "bg-neutral-100 hover:bg-neutral-200 text-neutral-900"
                : "bg-neutral-900 hover:bg-neutral-800 text-white"
            }`}
          >
            Import Library
          </button>
          <p className={`text-xs ${isDarkSystem ? "text-neutral-500" : "text-neutral-400"}`}>
            Import your Apple Music library to get started
          </p>
        </div>
      </div>
    );
  }

  if (!isImported && isImporting) {
    return (
      <div data-tauri-drag-region onMouseDown={onDrag} className="fixed inset-0 z-[10000] text-n-100 flex flex-col">
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
      {/* Blurred artwork background — single img, src swaps on track change.
          Quarter-res container + blur(16px) keeps paint cheap (~15× vs full
          size with blur(64px)). No fade animation; the new art just snaps in.
          Resize gate hides the img during window resize so the blur isn't
          re-rasterized every frame of a live resize. */}
      {showAlbumAccent && (
        <div className="absolute inset-0 overflow-hidden" aria-hidden="true" style={{ transform: "translateZ(0)" }}>
          <div
            className="absolute"
            style={{
              top: 0,
              left: 0,
              width: "25%",
              height: "25%",
              transform: "scale(4)",
              transformOrigin: "top left",
            }}
          >
            {!resizing && currentArtworkUrl && (
              <img
                src={currentArtworkUrl}
                alt=""
                className="absolute inset-[-12px] w-[calc(100%+24px)] h-[calc(100%+24px)] object-cover"
                style={{ filter: "var(--accent-filter)", transform: "translateZ(0)", backfaceVisibility: "hidden" }}
              />
            )}
          </div>
          <div className="absolute inset-0" style={{ backgroundColor: "var(--accent-overlay)" }} />
        </div>
      )}

      {/* Window controls */}
      <div className="fixed top-0 left-0 z-[9999]">
        <WindowControls />
      </div>

      {/* Resize handle (borderless window has no native resize edge) */}
      <ResizeGripper />

      {/* Main UI */}
      <div className="relative z-10 flex flex-col h-full">
        {isImporting && <ImportProgress onComplete={handleImportComplete} mode="reimport" />}

        <PlaybackBar tracks={tracks} />

        <div className="flex flex-1 min-h-0">
          <Sidebar />
          <div className="flex flex-col flex-1 min-w-0">
            {tracksLoading ? (
              <div className="flex-1 flex items-center justify-center">
                <div className="flex flex-col items-center gap-3">
                  <div className="w-8 h-8 border-[2.5px] border-n-700 border-t-n-300 rounded-full animate-spin" />
                  <span className="text-n-500 text-xs">Loading {trackCount.toLocaleString()} tracks...</span>
                </div>
              </div>
            ) : (
              <ContentRouter />
            )}
            {showStatusBar && <StatusBar />}
          </div>
        </div>
      </div>

      <HandoffBanner />
      <QueuePanel />
      <AssistantPanel />
      <AssistantApiKeyModal />
      {showShortcuts && <KeyboardShortcutsModal onClose={() => setShowShortcuts(false)} />}
      {showSettings && <SettingsPanel onClose={() => setShowSettings(false)} />}
      <AddFromUrlDialog
        open={showAddFromUrl}
        onClose={() => { setShowAddFromUrl(false); setDeepLinkUrl(null); }}
        initialUrl={deepLinkUrl ?? undefined}
      />
    </div>
  );
}

export default App;
