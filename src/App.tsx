import { useEffect, useCallback } from "react";
import { useLibraryStore } from "./stores/libraryStore";
import { usePlaybackStore } from "./stores/playbackStore";
import { useNavigationStore } from "./stores/navigationStore";
import { getTracks, getTrackCount, importLibrary } from "./lib/commands";
import { SearchBar } from "./components/SearchBar";
import { ImportProgress } from "./components/ImportProgress";
import { StatusBar } from "./components/StatusBar";
import { PlaybackBar } from "./components/PlaybackBar";
import { Sidebar } from "./components/Sidebar";
import { ContentRouter } from "./components/ContentRouter";

function App() {
  const {
    tracks,
    isImported,
    isImporting,
    importError,
    setTracks,
    setIsImporting,
    setImportError,
    setTrackCount,
  } = useLibraryStore();

  const currentTrackId = usePlaybackStore((s) => s.currentTrackId);
  const navigateTo = useNavigationStore((s) => s.navigateTo);
  const searchResults = useLibraryStore((s) => s.searchResults);

  const loadTracks = useCallback(async () => {
    try {
      const count = await getTrackCount();
      if (count > 0) {
        setTrackCount(count);
        const allTracks = await getTracks({
          limit: 200000,
          sortColumn: "id",
          sortDir: "asc",
        });
        setTracks(allTracks);
      }
    } catch (err) {
      console.error("Failed to load tracks:", err);
    }
  }, [setTracks, setTrackCount]);

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

  const handleImportComplete = useCallback(() => {
    // Progress modal auto-dismisses, tracks load in handleImport
  }, []);

  if (!isImported && !isImporting) {
    return (
      <div className="h-screen bg-neutral-950 text-neutral-100 flex flex-col items-center justify-center">
        <h1 className="text-3xl font-bold mb-2">Waves</h1>
        <p className="text-neutral-400 mb-6">
          Import your Music library to get started.
        </p>
        {importError && (
          <div className="mb-4 p-3 bg-red-950 border border-red-800 rounded-lg max-w-lg">
            <p className="text-red-300 text-sm font-medium mb-1">Import failed</p>
            <p className="text-red-400 text-xs font-mono break-all">{importError}</p>
          </div>
        )}
        <button
          onClick={handleImport}
          className="px-6 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg font-medium transition-colors"
        >
          Import Library
        </button>
      </div>
    );
  }

  return (
    <div
      className="h-screen bg-neutral-950 text-neutral-100 flex flex-col overflow-hidden"
      onContextMenu={(e) => e.preventDefault()}
    >
      {isImporting && <ImportProgress onComplete={handleImportComplete} />}

      <header className="flex items-center justify-between px-3 py-2 bg-neutral-900 border-b border-neutral-800">
        <div className="flex items-center gap-3">
          <h1 className="text-sm font-bold tracking-wide">Waves</h1>
        </div>
        <div className="flex items-center gap-2">
          <SearchBar />
          <button
            onClick={handleImport}
            disabled={isImporting}
            className="px-3 py-1.5 text-xs bg-neutral-800 hover:bg-neutral-700 text-neutral-300 rounded-md border border-neutral-700 transition-colors disabled:opacity-50"
          >
            Re-import
          </button>
        </div>
      </header>

      <div className="flex flex-1 min-h-0">
        <Sidebar />
        <ContentRouter />
      </div>

      {currentTrackId ? (
        <PlaybackBar tracks={tracks} />
      ) : (
        <StatusBar tracks={tracks} />
      )}
    </div>
  );
}

export default App;
