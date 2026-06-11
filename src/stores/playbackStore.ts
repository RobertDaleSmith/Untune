import { create } from "zustand";
import { listen } from "@tauri-apps/api/event";
import { useLibraryStore } from "./libraryStore";
import {
  getPlaybackInfo,
  getPlaylistTracks,
  pausePlayback,
  resumePlayback,
  nextTrack,
  previousTrack,
  seekPlayback,
  setVolume as setVolumeCmd,
  playQueue,
  playQueueAtPosition,
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
  getRadioState,
  playSimilar,
  pushHandoffState,
  pullHandoffState,
  dismissHandoff as dismissHandoffCmd,
} from "../lib/commands";
import type { AudioRoute, AudioDevice, HandoffTrackInfo } from "../lib/commands";

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
  videoMode: boolean;
  handoffInfo: HandoffTrackInfo | null;
  handoffDismissed: boolean;
  _handoffDismissedAt: number;
  _handoffDebounce: ReturnType<typeof setTimeout> | null;
  _handoffAutoHide: ReturnType<typeof setTimeout> | null;

  setVideoMode: (on: boolean) => void;
  toggleVideoMode: () => void;
  showError: (msg: string) => void;
  debouncedPushHandoff: () => void;
  checkHandoff: () => void;
  acceptHandoff: () => Promise<void>;
  dismissHandoff: () => void;
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
  volume: 0.8,
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
  videoMode: false,
  queuePanelOpen: false,
  handoffInfo: null,
  handoffDismissed: false,
  _handoffDismissedAt: 0,
  _handoffDebounce: null,
  _handoffAutoHide: null,

  setVideoMode: (on) => set({ videoMode: on }),
  toggleVideoMode: () => set((s) => ({ videoMode: !s.videoMode })),

  checkHandoff: () => {
    // Skip if banner is already showing or if currently playing locally
    if (get().handoffInfo) return;
    if (get().isPlaying) return;
    pullHandoffState()
      .then((info) => {
        if (info && info.trackId != null && info.deviceName) {
          const thisDevice = info.localDeviceName;
          if (thisDevice && info.deviceName === thisDevice) return;
          const updatedAt = info.state.updatedAt;
          const ageSeconds = Date.now() / 1000 - updatedAt;
          if (ageSeconds > 86400) return;
          // Only show if remote state is newer than our last dismiss
          const dismissedAt = get()._handoffDismissedAt;
          if (dismissedAt > 0 && updatedAt <= dismissedAt) return;
          set({ handoffInfo: info, handoffDismissed: false });
          const prev = get()._handoffAutoHide;
          if (prev) clearTimeout(prev);
          const timer = setTimeout(() => {
            if (get().handoffInfo) {
              set({ handoffInfo: null, handoffDismissed: true, _handoffDismissedAt: Date.now() / 1000 });
            }
          }, 15_000);
          set({ _handoffAutoHide: timer });
        }
      })
      .catch(() => {});
  },

  debouncedPushHandoff: () => {
    const prev = get()._handoffDebounce;
    if (prev) clearTimeout(prev);
    const timer = setTimeout(() => {
      pushHandoffState().catch(() => {});
    }, 400);
    set({ _handoffDebounce: timer });
  },

  acceptHandoff: async () => {
    const info = get().handoffInfo;
    if (!info || info.trackId == null) return;
    set({ handoffInfo: null, handoffDismissed: true, _handoffDismissedAt: Date.now() / 1000 });

    // Build queue and play, then seek to handoff position
    const allTracks = useLibraryStore.getState().tracks;
    const trackIds = allTracks.map((t) => t.id);
    const idx = trackIds.indexOf(info.trackId);
    if (idx >= 0) {
      const source = info.state.queueSource ?? undefined;
      const pos = info.state.position > 0 ? info.state.position : 0;
      set({ queueSource: source ?? null, _restoredFromSession: false });
      // Single command: load track, seek to position, then play — avoids race
      await playQueueAtPosition(trackIds, idx, pos);
      set({
        currentTrackId: trackIds[idx],
        isPlaying: true,
        position: pos,
      });
      setPreference("session.trackId", String(trackIds[idx])).catch(() => {});
      setPreference("session.position", String(pos)).catch(() => {});
      get().startPolling();
    }
  },

  dismissHandoff: () => {
    set({ handoffInfo: null, handoffDismissed: true, _handoffDismissedAt: Date.now() / 1000 });
    dismissHandoffCmd().catch(() => {});
  },

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

    // Optimistic UI update. playQueue() ships the entire trackIds array over
    // IPC to Rust, which for a 62k-row library takes a couple seconds even
    // though audio starts the moment Rust processes the first ID. Setting
    // currentTrackId now lets the artwork crossfade, accent color, and
    // now-playing highlight kick off immediately instead of waiting for the
    // IPC roundtrip.
    const prevState = {
      currentTrackId: get().currentTrackId,
      isPlaying: get().isPlaying,
      position: get().position,
      queueSource: get().queueSource,
    };
    set({
      queueSource: newSource,
      _restoredFromSession: false,
      currentTrackId: trackIds[startIndex],
      isPlaying: true,
      position: 0,
    });
    // User started playing — dismiss handoff banner
    if (get().handoffInfo) {
      set({ handoffInfo: null, handoffDismissed: true, _handoffDismissedAt: Date.now() / 1000 });
    }
    try {
      await playQueue(trackIds, startIndex);
      setPreference("session.trackId", String(trackIds[startIndex])).catch(() => {});
      setPreference("session.position", "0").catch(() => {});
      if (newSource) setPreference("session.queueSource", newSource).catch(() => {});
      // Apply view settings after playback started (PlaybackInner now exists)
      if (viewSettings) {
        await setShuffleCmd(viewSettings.shuffle);
        await setRepeatModeCmd(viewSettings.repeatMode);
        set({ shuffle: viewSettings.shuffle, repeatMode: viewSettings.repeatMode });
      }
      get().startPolling();
    } catch (e) {
      // Roll back the optimistic update — playback didn't actually start.
      set(prevState);
      const msg = typeof e === "string" ? e : e instanceof Error ? e.message : "Playback failed";
      get().showError(msg);
    }
  },

  pause: async () => {
    await pausePlayback();
    set({ isPlaying: false });
    get().debouncedPushHandoff();
  },

  resume: async () => {
    if (get()._restoredFromSession) {
      // Cold start: track was restored from session, no audio loaded yet
      const trackId = get().currentTrackId;
      const pos = get().position;
      if (trackId != null) {
        set({ _restoredFromSession: false });
        // Build queue from the saved source (playlist/view)
        let trackIds: number[];
        const source = get().queueSource;
        if (source && source.startsWith("playlist:")) {
          try {
            const plId = parseInt(source.replace("playlist:", ""), 10);
            const plTracks = await getPlaylistTracks(plId);
            trackIds = plTracks.map((t) => t.id);
          } catch {
            trackIds = useLibraryStore.getState().tracks.map((t) => t.id);
          }
        } else {
          trackIds = useLibraryStore.getState().tracks.map((t) => t.id);
        }
        const idx = trackIds.indexOf(trackId);
        if (idx >= 0 && trackIds.length > 1) {
          await playQueue(trackIds, idx);
        } else {
          await playQueue([trackId], 0);
        }
        // Restore shuffle/repeat to backend (queue now exists)
        await setShuffleCmd(get().shuffle).catch(() => {});
        await setRepeatModeCmd(get().repeatMode).catch(() => {});
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
        get().debouncedPushHandoff();
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
        get().debouncedPushHandoff();
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
      setPreference("session.shuffle", String(newVal)).catch(() => {});
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
      setPreference("session.repeatMode", newMode).catch(() => {});
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
      // Handle crossfade transition — next track already started playing
      if (info.crossfadeInto != null) {
        set({ currentTrackId: info.crossfadeInto, position: 0, isPlaying: true });
        setPreference("session.trackId", String(info.crossfadeInto)).catch(() => {});
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
      // Track ended naturally: backend's auto-advance watchdog handles this now
      // (Rust thread keeps playback going even when webview throttles intervals).
      // Frontend just reflects the new state on the next poll.
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
      const [trackIdStr, posStr, queueSourceStr, shuffleStr, repeatStr] = await Promise.all([
        getPreference("session.trackId"),
        getPreference("session.position"),
        getPreference("session.queueSource"),
        getPreference("session.shuffle"),
        getPreference("session.repeatMode"),
      ]);
      if (!trackIdStr) return;
      const trackId = parseInt(trackIdStr, 10);
      if (isNaN(trackId)) return;
      const position = posStr ? parseFloat(posStr) : 0;
      const shuffle = shuffleStr === "true";
      const repeatMode = repeatStr || "off";
      set({
        currentTrackId: trackId,
        position: isNaN(position) ? 0 : position,
        isPlaying: false,
        queueSource: queueSourceStr ?? null,
        shuffle,
        repeatMode,
        _restoredFromSession: true,
      });
      // Apply shuffle/repeat to the backend
      setShuffleCmd(shuffle).catch(() => {});
      setRepeatModeCmd(repeatMode).catch(() => {});
    } catch {
      // Ignore corrupt preferences
    }

    // Pull handoff state from remote (only show if from a different device)
    pullHandoffState()
      .then((info) => {
        if (info && info.trackId != null && info.deviceName) {
          // Ignore state pushed by this device
          const thisDevice = info.localDeviceName;
          if (thisDevice && info.deviceName === thisDevice) return;
          // Show banner if remote state is less than 24 hours old
          const ageSeconds = Date.now() / 1000 - info.state.updatedAt;
          if (ageSeconds < 86400) {
            set({ handoffInfo: info, handoffDismissed: false });
            // Auto-dismiss after 15 seconds
            const prev = get()._handoffAutoHide;
            if (prev) clearTimeout(prev);
            const timer = setTimeout(() => {
              if (get().handoffInfo) {
                set({ handoffInfo: null, handoffDismissed: true });
              }
            }, 15_000);
            set({ _handoffAutoHide: timer });
          }
        }
      })
      .catch(() => {});

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

    // Backend auto-advance watchdog notifies us when a track ended and the
    // next one started (or playback stopped at end of queue). Sync state and
    // refresh radio queue if needed.
    listen<number | null>("track-auto-advanced", (event) => {
      const nextId = event.payload;
      if (nextId == null) {
        set({ isPlaying: false, currentTrackId: null, position: 0 });
        get().stopPolling();
        return;
      }
      set({ currentTrackId: nextId, position: 0, isPlaying: true });
      setPreference("session.trackId", String(nextId)).catch(() => {});
      setPreference("session.position", "0").catch(() => {});
      get().startPolling();
      // Radio auto-queue: top up similar tracks when queue runs low
      getRadioState().then((radio) => {
        if (radio.enabled && radio.seedTrackId) {
          getUpcomingTracks(5).then(({ nextTrackIds }) => {
            if (nextTrackIds.length < 3) {
              playSimilar(radio.seedTrackId!).catch(() => {});
            }
          }).catch(() => {});
        }
      }).catch(() => {});
    }).catch(() => {});

    // Backend watchdog recorded a play (threshold crossed or track finished) —
    // keep the in-memory play count fresh even when the poll didn't observe it.
    listen<number>("track-play-recorded", (event) => {
      useLibraryStore.getState().recordTrackPlayed(event.payload);
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
