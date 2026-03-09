import { create } from "zustand";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

export type ActivityTaskId = "artwork" | "ai-tagging" | "import" | "find-tags" | "url-download";

export interface ActivityTask {
  id: ActivityTaskId;
  label: string;
  current: number;
  total: number;
  message?: string;
  startedAt: number;
  completedAt?: number;
}

interface ActivityState {
  tasks: Record<string, ActivityTask>;
  panelOpen: boolean;
  /** Set whenever a task completes — subscribers can react (e.g. reload tracks) */
  lastCompletedTaskId: ActivityTaskId | null;

  togglePanel: () => void;
  closePanel: () => void;
  init: () => void;
  cleanup: () => void;
}

let unlisteners: UnlistenFn[] = [];
let purgeTimers: Record<string, ReturnType<typeof setTimeout>> = {};
let initialized = false;

export const useActivityStore = create<ActivityState>((set) => ({
  tasks: {},
  panelOpen: false,
  lastCompletedTaskId: null,

  togglePanel: () => set((s) => ({ panelOpen: !s.panelOpen })),
  closePanel: () => set({ panelOpen: false }),

  init: () => {
    if (initialized) return;
    initialized = true;

    const upsert = (
      id: ActivityTaskId,
      label: string,
      current: number,
      total: number,
      message?: string,
    ) => {
      set((s) => {
        const existing = s.tasks[id];
        return {
          tasks: {
            ...s.tasks,
            [id]: {
              id,
              label,
              current,
              total,
              message,
              startedAt: existing?.startedAt ?? Date.now(),
              completedAt: undefined,
            },
          },
        };
      });
      // Clear any pending purge when task is active again
      if (purgeTimers[id]) {
        clearTimeout(purgeTimers[id]);
        delete purgeTimers[id];
      }
    };

    const markComplete = (id: ActivityTaskId) => {
      set((s) => {
        const task = s.tasks[id];
        if (!task) return s;
        return {
          tasks: {
            ...s.tasks,
            [id]: { ...task, completedAt: Date.now() },
          },
          lastCompletedTaskId: id,
        };
      });
      // Auto-purge after 60s
      purgeTimers[id] = setTimeout(() => {
        set((s) => {
          const { [id]: _, ...rest } = s.tasks;
          return { tasks: rest };
        });
        delete purgeTimers[id];
      }, 60_000);
    };

    // Set up listeners
    const setup = async () => {
      const u1 = await listen<{ current: number; total: number; done: boolean }>(
        "artwork-progress",
        (e) => {
          if (e.payload.done) {
            // Update to final count before marking complete
            upsert("artwork", "Album artwork", e.payload.current, e.payload.total);
            markComplete("artwork");
          } else {
            upsert("artwork", "Album artwork", e.payload.current, e.payload.total);
          }
        },
      );

      const u2 = await listen<{ tagged: number; total: number; done?: boolean }>(
        "ai-tag-progress",
        (e) => {
          if (e.payload.done) {
            upsert("ai-tagging", "AI Tagging", e.payload.tagged, e.payload.total);
            markComplete("ai-tagging");
          } else {
            upsert("ai-tagging", "AI Tagging", e.payload.tagged, e.payload.total);
          }
        },
      );

      const u3 = await listen<{ phase: string; message: string; current: number; total: number }>(
        "import-progress",
        (e) => {
          if (e.payload.phase === "complete") {
            upsert("import", "Library import", e.payload.current, e.payload.total, e.payload.message);
            markComplete("import");
          } else {
            upsert("import", "Library import", e.payload.current, e.payload.total, e.payload.message);
          }
        },
      );

      const u4 = await listen<{ current: number; total: number; updated: number; currentTrack: string }>(
        "find-tags-progress",
        (e) => {
          const { current, total, updated, currentTrack } = e.payload;
          const msg = currentTrack === "Done"
            ? `Updated ${updated} of ${total} tracks`
            : currentTrack;
          if (current >= total && currentTrack === "Done") {
            upsert("find-tags", "Find Missing Tags", current, total, msg);
            markComplete("find-tags");
          } else {
            upsert("find-tags", "Find Missing Tags", current, total, msg);
          }
        },
      );

      const u5 = await listen<{
        phase: string;
        message: string;
        current?: number;
        total?: number;
        playlistName?: string;
      }>(
        "url-download-progress",
        (e) => {
          const { phase, message, current, total, playlistName } = e.payload;
          const label = playlistName ? `Playlist: ${playlistName}` : "URL Download";
          if (phase === "complete" || phase === "error") {
            upsert("url-download", label, current ?? 1, total ?? 1, message);
            markComplete("url-download");
          } else {
            upsert("url-download", label, current ?? 0, total ?? 1, message);
          }
        },
      );

      unlisteners = [u1, u2, u3, u4, u5];
    };

    setup();
  },

  cleanup: () => {
    initialized = false;
    unlisteners.forEach((fn) => fn());
    unlisteners = [];
    Object.values(purgeTimers).forEach(clearTimeout);
    purgeTimers = {};
  },
}));
