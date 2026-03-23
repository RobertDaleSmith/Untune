import { create } from "zustand";
import { getCurrentWindow, LogicalSize, LogicalPosition, currentMonitor } from "@tauri-apps/api/window";
import { getPreference, setPreference, setTrafficLightsVisible, setClickThroughFocus, setNotchMode, getNotchInfo, setAppIcon } from "../lib/commands";

type Theme = "light" | "dark" | "system";
type MiniPlayerMode = "floating" | "notch";

interface SavedGeometry {
  width: number;
  height: number;
  x: number;
  y: number;
}

interface ThemeState {
  theme: Theme;
  showStatusBar: boolean;
  showAlbumAccent: boolean;
  isMiniPlayer: boolean;
  miniPlayerMode: MiniPlayerMode;
  _notchHeight: number;
  _notchWidth: number;
  _savedWindowGeometry: SavedGeometry | null;
  _savedMiniGeometry: { x: number; y: number } | null;
  applyTheme: () => void;
  setTheme: (t: Theme) => void;
  setShowStatusBar: (show: boolean) => void;
  setShowAlbumAccent: (show: boolean) => void;
  setMiniPlayerMode: (mode: MiniPlayerMode) => void;
  toggleMiniPlayer: () => Promise<void>;
  init: () => Promise<void>;
}

function getSystemTheme(): "light" | "dark" {
  return window.matchMedia("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
}

function applyToDOM(theme: Theme) {
  const resolved = theme === "system" ? getSystemTheme() : theme;
  if (resolved === "dark") {
    document.documentElement.removeAttribute("data-theme");
  } else {
    document.documentElement.setAttribute("data-theme", "light");
  }
  // Sync dock icon with resolved theme
  setAppIcon(resolved).catch(() => {});
}

let mediaQueryListener: (() => void) | null = null;

export const useThemeStore = create<ThemeState>((set, get) => ({
  theme: "system",
  showStatusBar: true,
  showAlbumAccent: true,
  isMiniPlayer: false,
  miniPlayerMode: "floating" as MiniPlayerMode,
  _notchHeight: 34,
  _notchWidth: 200,
  _savedWindowGeometry: null,
  _savedMiniGeometry: null,

  applyTheme: () => {
    applyToDOM(get().theme);
  },

  setTheme: (t: Theme) => {
    set({ theme: t });
    applyToDOM(t);
    setPreference("theme", t).catch(() => {});

    // Re-setup media query listener
    if (mediaQueryListener) {
      window
        .matchMedia("(prefers-color-scheme: dark)")
        .removeEventListener("change", mediaQueryListener);
      mediaQueryListener = null;
    }
    if (t === "system") {
      mediaQueryListener = () => applyToDOM("system");
      window
        .matchMedia("(prefers-color-scheme: dark)")
        .addEventListener("change", mediaQueryListener);
    }
  },

  setShowStatusBar: (show: boolean) => {
    set({ showStatusBar: show });
    setPreference("showStatusBar", show ? "true" : "false").catch(() => {});
  },

  setShowAlbumAccent: (show: boolean) => {
    set({ showAlbumAccent: show });
    setPreference("showAlbumAccent", show ? "true" : "false").catch(() => {});
  },

  setMiniPlayerMode: (mode: MiniPlayerMode) => {
    set({ miniPlayerMode: mode });
    setPreference("miniPlayerMode", mode).catch(() => {});
  },

  toggleMiniPlayer: async () => {
    const win = getCurrentWindow();
    const entering = !get().isMiniPlayer;
    const mode = get().miniPlayerMode;
    const isNotch = mode === "notch";
    const PILL_W = 200;
    const PILL_H = 34;

    if (entering) {
      const scaleFactor = await win.scaleFactor();
      const physSize = await win.innerSize();
      const physPos = await win.outerPosition();
      const logicalSize = physSize.toLogical(scaleFactor);
      const logicalPos = physPos.toLogical(scaleFactor);
      set({
        _savedWindowGeometry: {
          width: logicalSize.width,
          height: logicalSize.height,
          x: logicalPos.x,
          y: logicalPos.y,
        },
      });

      await win.setResizable(false);
      setTrafficLightsVisible(false).catch(() => {});
      setClickThroughFocus(true).catch(() => {});

      if (isNotch) {
        // Query actual notch dimensions from the display
        let h = PILL_H;
        let w = PILL_W;
        try {
          const [nh, nw] = await getNotchInfo();
          if (nh > 0) h = nh;
          if (nw > 0) w = nw + 70; // wider than actual notch
        } catch {}
        set({ _notchHeight: h, _notchWidth: w });
        // Window needs extra width for the concave corner SVGs (h/2 on each side)
        const windowW = w + h;
        // Single Rust command: transparent, panel styles, level 33, centered at screen top
        await setNotchMode(true, windowW, h);
      } else {
        await win.setAlwaysOnTop(true);
        await win.setMinSize(new LogicalSize(300, 32));
        await win.setSize(new LogicalSize(300, 32));
        const savedMini = get()._savedMiniGeometry;
        if (savedMini) {
          await win.setPosition(new LogicalPosition(savedMini.x, savedMini.y));
        } else {
          try {
            const monitor = await currentMonitor();
            if (monitor) {
              const screenWidth = monitor.size.width / monitor.scaleFactor;
              const x = Math.round((screenWidth - 300) / 2);
              await win.setPosition(new LogicalPosition(x, 0));
            }
          } catch { /* ignore */ }
        }
      }
    } else {
      // Save floating mini player position before exiting (not for notch)
      if (!isNotch) {
        try {
          const scaleFactor = await win.scaleFactor();
          const miniPos = await win.outerPosition();
          const miniLogical = miniPos.toLogical(scaleFactor);
          set({ _savedMiniGeometry: { x: miniLogical.x, y: miniLogical.y } });
        } catch { /* ignore */ }
      }

      setClickThroughFocus(false).catch(() => {});
      setTrafficLightsVisible(true).catch(() => {});

      if (isNotch) {
        await setNotchMode(false, 0, 0);
      }
      await win.setAlwaysOnTop(false);

      await win.setResizable(true);
      const saved = get()._savedWindowGeometry;
      if (saved) {
        await win.setMinSize(null);
        await win.setSize(new LogicalSize(saved.width, saved.height));
        await win.setPosition(new LogicalPosition(saved.x, saved.y));
      } else {
        await win.setMinSize(null);
        await win.setSize(new LogicalSize(1200, 800));
      }
    }
    set({ isMiniPlayer: entering });
  },

  init: async () => {
    try {
      const saved = await getPreference("theme");
      const theme = (saved === "light" || saved === "dark" || saved === "system")
        ? saved
        : "system";
      const savedStatusBar = await getPreference("showStatusBar");
      const showStatusBar = savedStatusBar !== "false";
      const savedAlbumAccent = await getPreference("showAlbumAccent");
      const showAlbumAccent = savedAlbumAccent !== "false";
      const savedMiniMode = await getPreference("miniPlayerMode");
      const miniPlayerMode: MiniPlayerMode = savedMiniMode === "notch" ? "notch" : "floating";

      set({ theme, showStatusBar, showAlbumAccent, miniPlayerMode });
      applyToDOM(theme);

      // Listen for system theme changes when in "system" mode
      if (theme === "system") {
        mediaQueryListener = () => applyToDOM("system");
        window
          .matchMedia("(prefers-color-scheme: dark)")
          .addEventListener("change", mediaQueryListener);
      }
    } catch {
      applyToDOM("system");
    }
  },
}));
