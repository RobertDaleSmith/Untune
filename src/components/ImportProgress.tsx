import { useState, useEffect } from "react";
import { listen } from "@tauri-apps/api/event";
import type { ImportProgress as ImportProgressType } from "../lib/types";

interface ImportProgressProps {
  onComplete: () => void;
}

const PHASE_LABELS: Record<string, string> = {
  jxa_tracks: "Extracting from Music app",
  file_scan: "Scanning music files",
  matching: "Matching tracks to files",
  db_insert: "Importing to database",
  playlists: "Importing playlists",
  complete: "Import complete",
};

export function ImportProgress({ onComplete }: ImportProgressProps) {
  const [progress, setProgress] = useState<ImportProgressType>({
    phase: "",
    message: "Starting import...",
    current: 0,
    total: 0,
  });

  useEffect(() => {
    const unlisten = listen<ImportProgressType>("import-progress", (event) => {
      setProgress(event.payload);
      if (event.payload.phase === "complete") {
        setTimeout(onComplete, 1000);
      }
    });

    return () => {
      unlisten.then((fn) => fn());
    };
  }, [onComplete]);

  const pct =
    progress.total > 0
      ? Math.round((progress.current / progress.total) * 100)
      : 0;
  const phaseLabel = PHASE_LABELS[progress.phase] ?? progress.phase;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80">
      <div className="bg-neutral-900 border border-neutral-700 rounded-lg p-8 w-96 shadow-2xl">
        <h2 className="text-lg font-semibold text-neutral-100 mb-4">
          Importing Library
        </h2>
        <p className="text-sm text-neutral-400 mb-1">{phaseLabel}</p>
        <p className="text-xs text-neutral-500 mb-3">{progress.message}</p>
        <div className="w-full bg-neutral-800 rounded-full h-2 mb-2">
          <div
            className="bg-blue-500 h-2 rounded-full transition-all duration-300"
            style={{ width: `${pct}%` }}
          />
        </div>
        {progress.total > 0 && (
          <p className="text-xs text-neutral-500 text-right">
            {progress.current.toLocaleString()} /{" "}
            {progress.total.toLocaleString()}
          </p>
        )}
      </div>
    </div>
  );
}
