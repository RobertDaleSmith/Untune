import { create } from "zustand";
import { getCurrentWindow, LogicalSize, LogicalPosition } from "@tauri-apps/api/window";
import { getPreference, setPreference, setTrafficLightsVisible, setAppIcon } from "../lib/commands";

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
      await setTrafficLightsVisible(false);
      await win.setMinSize(new LogicalSize(350, 48));
      await win.setSize(new LogicalSize(350, 48));
    } else {
      await setTrafficLightsVisible(true);
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
