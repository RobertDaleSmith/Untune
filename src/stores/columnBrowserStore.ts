import { create } from "zustand";
import { getPreference, setPreference } from "../lib/commands";

export type BrowserColumn = "genres" | "artists" | "albums";

const MIN_HEIGHT = 80;
const MAX_HEIGHT = 500;
const DEFAULT_HEIGHT = 180;

interface ColumnBrowserState {
  visible: boolean;
  height: number;
  columns: BrowserColumn[];
  useAlbumArtist: boolean;
  selectedGenre: string | null;
  selectedArtist: string | null;
  selectedAlbum: string | null;

  setVisible: (v: boolean) => void;
  toggleVisible: () => void;
  setHeight: (h: number) => void;
  setColumns: (cols: BrowserColumn[]) => void;
  toggleColumn: (col: BrowserColumn) => void;
  setUseAlbumArtist: (v: boolean) => void;
  setSelectedGenre: (v: string | null) => void;
  setSelectedArtist: (v: string | null) => void;
  setSelectedAlbum: (v: string | null) => void;
  clearSelections: () => void;
  init: () => Promise<void>;
}

export const useColumnBrowserStore = create<ColumnBrowserState>((set, get) => ({
  visible: false,
  height: DEFAULT_HEIGHT,
  columns: ["genres", "artists", "albums"],
  useAlbumArtist: false,
  selectedGenre: null,
  selectedArtist: null,
  selectedAlbum: null,

  setVisible: (v) => {
    set({ visible: v });
    setPreference("columnBrowserVisible", v ? "true" : "false").catch(() => {});
  },

  toggleVisible: () => {
    const next = !get().visible;
    set({ visible: next });
    setPreference("columnBrowserVisible", next ? "true" : "false").catch(() => {});
  },

  setHeight: (h) => {
    const clamped = Math.max(MIN_HEIGHT, Math.min(MAX_HEIGHT, Math.round(h)));
    set({ height: clamped });
    setPreference("columnBrowserHeight", String(clamped)).catch(() => {});
  },

  setColumns: (cols) => {
    set({ columns: cols });
    setPreference("columnBrowserColumns", JSON.stringify(cols)).catch(() => {});
  },

  toggleColumn: (col) => {
    const current = get().columns;
    let next: BrowserColumn[];
    if (current.includes(col)) {
      next = current.filter((c) => c !== col);
      // Must keep at least one column
      if (next.length === 0) return;
    } else {
      // Insert in canonical order
      const order: BrowserColumn[] = ["genres", "artists", "albums"];
      next = order.filter((c) => current.includes(c) || c === col);
    }
    set({ columns: next });
    setPreference("columnBrowserColumns", JSON.stringify(next)).catch(() => {});
  },

  setUseAlbumArtist: (v) => {
    set({ useAlbumArtist: v, selectedArtist: null, selectedAlbum: null });
    setPreference("columnBrowserAlbumArtist", v ? "true" : "false").catch(() => {});
  },

  setSelectedGenre: (v) => {
    set({ selectedGenre: v, selectedArtist: null, selectedAlbum: null });
  },

  setSelectedArtist: (v) => {
    set({ selectedArtist: v, selectedAlbum: null });
  },

  setSelectedAlbum: (v) => {
    set({ selectedAlbum: v });
  },

  clearSelections: () => {
    set({ selectedGenre: null, selectedArtist: null, selectedAlbum: null });
  },

  init: async () => {
    try {
      const [vis, cols, aa, h] = await Promise.all([
        getPreference("columnBrowserVisible"),
        getPreference("columnBrowserColumns"),
        getPreference("columnBrowserAlbumArtist"),
        getPreference("columnBrowserHeight"),
      ]);
      const visible = vis === "true";
      let columns: BrowserColumn[] = ["genres", "artists", "albums"];
      if (cols) {
        try {
          const parsed = JSON.parse(cols);
          if (Array.isArray(parsed) && parsed.length > 0) {
            columns = parsed.filter((c: string) =>
              ["genres", "artists", "albums"].includes(c),
            ) as BrowserColumn[];
            if (columns.length === 0) columns = ["genres", "artists", "albums"];
          }
        } catch { /* use default */ }
      }
      const useAlbumArtist = aa === "true";
      const height = h ? Math.max(MIN_HEIGHT, Math.min(MAX_HEIGHT, parseInt(h, 10) || DEFAULT_HEIGHT)) : DEFAULT_HEIGHT;
      set({ visible, columns, useAlbumArtist, height });
    } catch { /* use defaults */ }
  },
}));
