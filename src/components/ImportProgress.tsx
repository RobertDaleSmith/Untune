import { useState, useEffect } from "react";
import { listen } from "@tauri-apps/api/event";
import type { ImportProgress as ImportProgressType } from "../lib/types";

interface ImportProgressProps {
  onComplete: () => void;
  mode?: "initial" | "reimport";
}

const PHASE_LABELS: Record<string, string> = {
  jxa_tracks: "Extracting from Music app",
  file_scan: "Scanning music files",
  matching: "Matching tracks to files",
  db_insert: "Importing to database",
  playlists: "Importing playlists",
  complete: "Import complete",
};

export function ImportProgress({ onComplete, mode = "initial" }: ImportProgressProps) {
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

  const hasDeterminate = progress.total > 1;
  const pct = hasDeterminate
    ? Math.round((progress.current / progress.total) * 100)
    : 0;
  const phaseLabel = PHASE_LABELS[progress.phase] ?? progress.phase;
  const isDone = progress.phase === "complete";

  if (mode === "reimport") {
    return (
      <div className="shrink-0 bg-n-900/95 border-b border-n-700 px-4 py-2 flex items-center gap-3">
        <div className="flex items-center gap-2 text-sm text-n-300 whitespace-nowrap">
          {!isDone && (
            <svg className="animate-spin h-3.5 w-3.5 text-accent" viewBox="0 0 24 24" fill="none">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
          )}
          <span>{phaseLabel || "Re-importing library..."}</span>
        </div>
        <div className="flex-1 bg-n-800 rounded-full h-1.5 overflow-hidden">
          {hasDeterminate ? (
            <div
              className="bg-accent h-1.5 rounded-full transition-all duration-300"
              style={{ width: `${pct}%` }}
            />
          ) : !isDone ? (
            <div className="h-1.5 rounded-full bg-accent animate-indeterminate" />
          ) : (
            <div className="bg-accent h-1.5 rounded-full w-full" />
          )}
        </div>
        {hasDeterminate && (
          <span className="text-xs text-n-500 whitespace-nowrap tabular-nums">
            {progress.current.toLocaleString()} / {progress.total.toLocaleString()}
          </span>
        )}
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80">
      <div className="bg-n-900 border border-n-700 rounded-lg p-8 w-96 shadow-2xl">
        <h2 className="text-lg font-semibold text-n-100 mb-4">
          Importing Library
        </h2>
        <p className="text-sm text-n-400 mb-1">{phaseLabel}</p>
        <p className="text-xs text-n-500 mb-3">{progress.message}</p>
        <div className="w-full bg-n-800 rounded-full h-2 mb-2 overflow-hidden">
          {hasDeterminate ? (
            <div
              className="bg-accent h-2 rounded-full transition-all duration-300"
              style={{ width: `${pct}%` }}
            />
          ) : !isDone ? (
            <div className="h-2 rounded-full bg-accent animate-indeterminate" />
          ) : (
            <div className="bg-accent h-2 rounded-full w-full" />
          )}
        </div>
        {hasDeterminate && (
          <p className="text-xs text-n-500 text-right">
            {progress.current.toLocaleString()} /{" "}
            {progress.total.toLocaleString()}
          </p>
        )}
      </div>
    </div>
  );
}
