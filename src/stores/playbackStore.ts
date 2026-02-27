import { create } from "zustand";
import { listen } from "@tauri-apps/api/event";
import { useLibraryStore } from "./libraryStore";
import {
  getPlaybackInfo,
  pausePlayback,
  resumePlayback,
  nextTrack,
  previousTrack,
  seekPlayback,
  setVolume as setVolumeCmd,
  playQueue,
  toggleShuffle as toggleShuffleCmd,
  cycleRepeat as cycleRepeatCmd,
  setShuffleCmd,
  setRepeatModeCmd,
  getViewSettings,
  saveViewSettings,
  getPreference,
  setPreference,
  getAudioRoute,
  getAudioDevices,
  setAudioDevice,
  preBufferNext,
  getUpcomingTracks,
  setCrossfadeDuration as setCrossfadeDurationCmd,
  setSleepTimer as setSleepTimerCmd,
  cancelSleepTimer as cancelSleepTimerCmd,
  getSleepTimerRemaining,
} from "../lib/commands";
import type { AudioRoute, AudioDevice } from "../lib/commands";

interface PlaybackState {
  currentTrackId: number | null;
  currentArtworkUrl: string | null;
  isPlaying: boolean;
  position: number;
  duration: number | null;
  volume: number;
  shuffle: boolean;
  repeatMode: string;
  queueSource: string | null;
  playError: string | null;
  scrollToNowPlaying: number;
  _pollTimer: ReturnType<typeof setInterval> | null;
  _positionSaveTimer: ReturnType<typeof setInterval> | null;
  _errorTimer: ReturnType<typeof setTimeout> | null;
  _restoredFromSession: boolean;
  audioRoute: AudioRoute | null;
  audioDevices: AudioDevice[];
  sleepTimerRemaining: number | null;
  crossfadeDuration: number;
  queuePanelOpen: boolean;

  showError: (msg: string) => void;
  toggleQueuePanel: () => void;
  requestScrollToNowPlaying: () => void;
  play: (trackIds: number[], startIndex: number, source?: string) => Promise<void>;
  pause: () => Promise<void>;
  resume: () => Promise<void>;
  togglePlayPause: () => Promise<void>;
  next: () => Promise<void>;
  prev: () => Promise<void>;
  seek: (positionSecs: number) => Promise<void>;
  setVolume: (level: number) => Promise<void>;
  toggleShuffle: () => Promise<void>;
  cycleRepeat: () => Promise<void>;
  startPolling: () => void;
  stopPolling: () => void;
  poll: () => Promise<void>;
  refreshDevices: () => Promise<void>;
  switchDevice: (deviceId: number) => Promise<void>;
  setSleepTimer: (minutes: number) => Promise<void>;
  cancelSleepTimer: () => Promise<void>;
  setCrossfadeDuration: (seconds: number) => Promise<void>;
  init: () => Promise<void>;
}

export const usePlaybackStore = create<PlaybackState>((set, get) => ({
  currentTrackId: null,
  currentArtworkUrl: null,
  isPlaying: false,
  position: 0,
  duration: null,
  volume: 1.0,
  shuffle: false,
  repeatMode: "off",
  queueSource: null,
  playError: null,
  scrollToNowPlaying: 0,
  _pollTimer: null,
  _positionSaveTimer: null,
  _errorTimer: null,
  _restoredFromSession: false,
  audioRoute: null,
  audioDevices: [],
  sleepTimerRemaining: null,
  crossfadeDuration: 0,
  queuePanelOpen: false,

  toggleQueuePanel: () => set((s) => ({ queuePanelOpen: !s.queuePanelOpen })),

  showError: (msg: string) => {
    const prev = get()._errorTimer;
    if (prev) clearTimeout(prev);
    const timer = setTimeout(() => set({ playError: null, _errorTimer: null }), 5000);
    set({ playError: msg, _errorTimer: timer });
  },

  requestScrollToNowPlaying: () => set((s) => ({ scrollToNowPlaying: s.scrollToNowPlaying + 1 })),

  play: async (trackIds, startIndex, source) => {
    const newSource = source ?? null;
    let viewSettings: { shuffle: boolean; repeatMode: string } | null = null;
    if (newSource && newSource !== get().queueSource) {
      try {
        viewSettings = await getViewSettings(newSource);
      } catch {
        // Use current settings
      }
    }
    set({ queueSource: newSource, _restoredFromSession: false });
    try {
      await playQueue(trackIds, startIndex);
      set({
        currentTrackId: trackIds[startIndex],
        isPlaying: true,
        position: 0,
      });
      setPreference("session.trackId", String(trackIds[startIndex])).catch(() => {});
      setPreference("session.position", "0").catch(() => {});
      // Apply view settings after playback started (PlaybackInner now exists)
      if (viewSettings) {
        await setShuffleCmd(viewSettings.shuffle);
        await setRepeatModeCmd(viewSettings.repeatMode);
        set({ shuffle: viewSettings.shuffle, repeatMode: viewSettings.repeatMode });
      }
      get().startPolling();
    } catch (e) {
      const msg = typeof e === "string" ? e : e instanceof Error ? e.message : "Playback failed";
      get().showError(msg);
    }
  },

  pause: async () => {
    await pausePlayback();
    set({ isPlaying: false });
  },

  resume: async () => {
    if (get()._restoredFromSession) {
      // Cold start: track was restored from session, no audio loaded yet
      const trackId = get().currentTrackId;
      const pos = get().position;
      if (trackId != null) {
        set({ _restoredFromSession: false });
        // Build full queue from library so next/prev work after resume
        const allTracks = useLibraryStore.getState().tracks;
        const trackIds = allTracks.map((t) => t.id);
        const idx = trackIds.indexOf(trackId);
        if (idx >= 0 && trackIds.length > 1) {
          await playQueue(trackIds, idx);
        } else {
          await playQueue([trackId], 0);
        }
        if (pos > 0) await seekPlayback(pos);
        set({ isPlaying: true });
        get().startPolling();
      }
      return;
    }
    await resumePlayback();
    set({ isPlaying: true });
    get().startPolling();
  },

  togglePlayPause: async () => {
    if (get().isPlaying) {
      await get().pause();
    } else if (get().currentTrackId != null) {
      await get().resume();
    }
  },

  next: async () => {
    try {
      const trackId = await nextTrack();
      if (trackId != null) {
        set({ currentTrackId: trackId, position: 0, isPlaying: true });
        setPreference("session.trackId", String(trackId)).catch(() => {});
        setPreference("session.position", "0").catch(() => {});
        get().startPolling();
      }
    } catch (e) {
      console.error("next_track failed:", e);
    }
  },

  prev: async () => {
    try {
      const trackId = await previousTrack();
      if (trackId != null) {
        set({ currentTrackId: trackId, position: 0, isPlaying: true });
        setPreference("session.trackId", String(trackId)).catch(() => {});
        setPreference("session.position", "0").catch(() => {});
        get().startPolling();
      }
    } catch (e) {
      console.error("previous_track failed:", e);
    }
  },

  seek: async (positionSecs) => {
    await seekPlayback(positionSecs);
    set({ position: positionSecs });
  },

  setVolume: async (level) => {
    await setVolumeCmd(level);
    set({ volume: level });
  },

  toggleShuffle: async () => {
    try {
      const newVal = await toggleShuffleCmd();
      set({ shuffle: newVal });
      const src = get().queueSource;
      if (src) {
        saveViewSettings(src, newVal, get().repeatMode).catch(() => {});
      }
    } catch (e) {
      console.error("toggle_shuffle failed:", e);
    }
  },

  cycleRepeat: async () => {
    try {
      const newMode = await cycleRepeatCmd();
      set({ repeatMode: newMode });
      const src = get().queueSource;
      if (src) {
        saveViewSettings(src, get().shuffle, newMode).catch(() => {});
      }
    } catch (e) {
      console.error("cycle_repeat failed:", e);
    }
  },

  poll: async () => {
    try {
      const prev = get();
      const info = await getPlaybackInfo();
      // If polling was stopped while this poll was in-flight, discard stale result
      if (get()._pollTimer === null) return;
      set({
        isPlaying: info.isPlaying,
        currentTrackId: info.trackId,
        position: info.position,
        duration: info.duration,
        volume: info.volume,
        shuffle: info.shuffle,
        repeatMode: info.repeatMode,
      });
      // Handle gapless transition
      if (info.transitionedTo != null) {
        set({ currentTrackId: info.transitionedTo, position: 0, isPlaying: true });
        setPreference("session.trackId", String(info.transitionedTo)).catch(() => {});
        setPreference("session.position", "0").catch(() => {});
        return;
      }
      // Update in-memory track when play is recorded (crossed 50%/240s threshold)
      if (info.playRecordedTrackId != null) {
        useLibraryStore.getState().recordTrackPlayed(info.playRecordedTrackId);
      }
      // Pre-buffer next track when near end (within 10s) — only if crossfade is off
      if (info.isPlaying && info.duration && info.position > info.duration - 10 && get().crossfadeDuration <= 0) {
        getUpcomingTracks(1).then(({ nextTrackIds }) => {
          if (nextTrackIds.length > 0) {
            preBufferNext(nextTrackIds[0]).catch(() => {});
          }
        }).catch(() => {});
      }
      // Poll sleep timer
      getSleepTimerRemaining()
        .then((remaining) => set({ sleepTimerRemaining: remaining }))
        .catch(() => {});
      // Track ended naturally: was playing, now stopped (not paused) but track still set
      if (prev.isPlaying && !info.isPlaying && !info.isPaused && info.trackId != null) {
        const trackId = await nextTrack();
        if (trackId != null) {
          set({ currentTrackId: trackId, position: 0, isPlaying: true });
        } else {
          set({ isPlaying: false, currentTrackId: null, position: 0 });
          get().stopPolling();
        }
        return;
      }
      // Stop polling if fully stopped
      if (!info.isPlaying && info.trackId == null) {
        get().stopPolling();
      }
    } catch {
      // Ignore polling errors
    }
  },

  startPolling: () => {
    const existing = get()._pollTimer;
    if (existing) return; // Already polling
    const timer = setInterval(() => get().poll(), 500);
    // Save position to preferences every 10 seconds
    const posSaveTimer = setInterval(() => {
      const { currentTrackId, position } = get();
      if (currentTrackId != null) {
        setPreference("session.position", String(position)).catch(() => {});
      }
    }, 10_000);
    set({ _pollTimer: timer, _positionSaveTimer: posSaveTimer });
  },

  stopPolling: () => {
    const timer = get()._pollTimer;
    const posTimer = get()._positionSaveTimer;
    if (timer) clearInterval(timer);
    if (posTimer) clearInterval(posTimer);
    // Final position save
    const { currentTrackId, position } = get();
    if (currentTrackId != null) {
      setPreference("session.position", String(position)).catch(() => {});
    }
    set({ _pollTimer: null, _positionSaveTimer: null });
  },

  refreshDevices: async () => {
    try {
      const devices = await getAudioDevices();
      set({ audioDevices: devices });
    } catch {
      // Ignore — not available on non-macOS
    }
  },

  switchDevice: async (deviceId: number) => {
    try {
      await setAudioDevice(deviceId);
      // Refresh device list and route after switching
      await get().refreshDevices();
      const route = await getAudioRoute();
      set({ audioRoute: route });
    } catch (e) {
      const msg = typeof e === "string" ? e : e instanceof Error ? e.message : "Failed to switch device";
      get().showError(msg);
    }
  },

  setSleepTimer: async (minutes: number) => {
    await setSleepTimerCmd(minutes);
    set({ sleepTimerRemaining: minutes * 60 });
  },

  cancelSleepTimer: async () => {
    await cancelSleepTimerCmd();
    set({ sleepTimerRemaining: null });
  },

  setCrossfadeDuration: async (seconds: number) => {
    await setCrossfadeDurationCmd(seconds);
    set({ crossfadeDuration: seconds });
    setPreference("crossfadeDuration", String(seconds)).catch(() => {});
  },

  init: async () => {
    try {
      const [trackIdStr, posStr] = await Promise.all([
        getPreference("session.trackId"),
        getPreference("session.position"),
      ]);
      if (!trackIdStr) return;
      const trackId = parseInt(trackIdStr, 10);
      if (isNaN(trackId)) return;
      const position = posStr ? parseFloat(posStr) : 0;
      set({
        currentTrackId: trackId,
        position: isNaN(position) ? 0 : position,
        isPlaying: false,
        _restoredFromSession: true,
      });
    } catch {
      // Ignore corrupt preferences
    }

    // Load crossfade setting
    getPreference("crossfadeDuration")
      .then(async (val) => {
        const dur = val ? parseFloat(val) : 0;
        if (!isNaN(dur) && dur > 0) {
          set({ crossfadeDuration: dur });
          await setCrossfadeDurationCmd(dur);
        }
      })
      .catch(() => {});

    // Fetch initial audio route and device list
    getAudioRoute()
      .then((route) => set({ audioRoute: route }))
      .catch(() => {});
    get().refreshDevices();

    // Listen for audio route changes (AirPlay device switch, etc.)
    listen<AudioRoute>("audio-route-changed", (event) => {
      set({ audioRoute: event.payload });
      // Refresh device list so isDefault flags update
      get().refreshDevices();
    }).catch(() => {});

    // Listen for playback changes triggered by the assistant
    listen("assistant-playback-changed", async () => {
      try {
        const info = await getPlaybackInfo();
        set({
          isPlaying: info.isPlaying,
          currentTrackId: info.trackId,
          position: info.position,
          duration: info.duration,
          volume: info.volume,
          shuffle: info.shuffle,
          repeatMode: info.repeatMode,
          queueSource: get().queueSource ?? "assistant",
          _restoredFromSession: false,
        });
        if (info.isPlaying) {
          get().startPolling();
        }
      } catch {
        // Ignore sync errors
      }
    }).catch(() => {});
  },
}));
