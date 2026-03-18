import { create } from "zustand";
import { getCurrentWindow, LogicalSize, LogicalPosition, currentMonitor } from "@tauri-apps/api/window";
import { getPreference, setPreference, setTrafficLightsVisible, setClickThroughFocus, setAppIcon } from "../lib/commands";

type Theme = "light" | "dark" | "system";

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
  _savedWindowGeometry: SavedGeometry | null;
  _savedMiniGeometry: { x: number; y: number } | null;
  applyTheme: () => void;
  setTheme: (t: Theme) => void;
  setShowStatusBar: (show: boolean) => void;
  setShowAlbumAccent: (show: boolean) => void;
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

  toggleMiniPlayer: async () => {
    const win = getCurrentWindow();
    const entering = !get().isMiniPlayer;
    if (entering) {
      const scaleFactor = await win.scaleFactor();
      const physSize = await win.innerSize();
      const physPos = await win.outerPosition();
      // Convert physical pixels to logical so restore is exact
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
      await win.setAlwaysOnTop(true);
      setTrafficLightsVisible(false).catch(() => {});
      setClickThroughFocus(true).catch(() => {});
      await win.setMinSize(new LogicalSize(300, 32));
      await win.setSize(new LogicalSize(300, 32));
      // Restore mini player position, or center at top of screen
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
    } else {
      // Save mini player position before exiting
      try {
        const scaleFactor = await win.scaleFactor();
        const miniPos = await win.outerPosition();
        const miniLogical = miniPos.toLogical(scaleFactor);
        set({ _savedMiniGeometry: { x: miniLogical.x, y: miniLogical.y } });
      } catch { /* ignore */ }

      setClickThroughFocus(false).catch(() => {});
      setTrafficLightsVisible(true).catch(() => {});
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

      set({ theme, showStatusBar, showAlbumAccent });
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
