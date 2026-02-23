import { create } from "zustand";
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
} from "../lib/commands";

interface PlaybackState {
  currentTrackId: number | null;
  isPlaying: boolean;
  position: number;
  duration: number | null;
  volume: number;
  shuffle: boolean;
  repeatMode: string;
  queueSource: string | null;
  _pollTimer: ReturnType<typeof setInterval> | null;

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
}

export const usePlaybackStore = create<PlaybackState>((set, get) => ({
  currentTrackId: null,
  isPlaying: false,
  position: 0,
  duration: null,
  volume: 1.0,
  shuffle: false,
  repeatMode: "off",
  queueSource: null,
  _pollTimer: null,

  play: async (trackIds, startIndex, source) => {
    const newSource = source ?? null;
    if (newSource && newSource !== get().queueSource) {
      try {
        const settings = await getViewSettings(newSource);
        if (settings) {
          await setShuffleCmd(settings.shuffle);
          await setRepeatModeCmd(settings.repeatMode);
          set({ shuffle: settings.shuffle, repeatMode: settings.repeatMode });
        }
      } catch {
        // Use current settings
      }
    }
    set({ queueSource: newSource });
    await playQueue(trackIds, startIndex);
    set({
      currentTrackId: trackIds[startIndex],
      isPlaying: true,
      position: 0,
    });
    get().startPolling();
  },

  pause: async () => {
    await pausePlayback();
    set({ isPlaying: false });
  },

  resume: async () => {
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
      set({
        isPlaying: info.isPlaying,
        currentTrackId: info.trackId,
        position: info.position,
        duration: info.duration,
        volume: info.volume,
        shuffle: info.shuffle,
        repeatMode: info.repeatMode,
      });
      // Track ended naturally: was playing, now stopped but track still set
      if (prev.isPlaying && !info.isPlaying && info.trackId != null) {
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
    set({ _pollTimer: timer });
  },

  stopPolling: () => {
    const timer = get()._pollTimer;
    if (timer) {
      clearInterval(timer);
      set({ _pollTimer: null });
    }
  },
}));
