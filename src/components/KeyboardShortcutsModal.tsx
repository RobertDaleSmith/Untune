interface ShortcutEntry {
  keys: string;
  description: string;
}

interface ShortcutSection {
  title: string;
  shortcuts: ShortcutEntry[];
}

const sections: ShortcutSection[] = [
  {
    title: "Playback",
    shortcuts: [
      { keys: "Space", description: "Play / Pause" },
      { keys: "\u2190", description: "Previous track" },
      { keys: "\u2192", description: "Next track" },
      { keys: "\u2318\u21e7\u2191", description: "Volume up" },
      { keys: "\u2318\u21e7\u2193", description: "Volume down" },
      { keys: "\u2318.", description: "Stop playback" },
    ],
  },
  {
    title: "Navigation",
    shortcuts: [
      { keys: "\u2318L", description: "Go to current song" },
      { keys: "\u2318B", description: "Toggle column browser" },
      { keys: "\u2318\u21e7M", description: "Toggle mini player" },
      { keys: "\u2318\u2191", description: "Scroll to top" },
      { keys: "\u2318\u2193", description: "Scroll to bottom" },
    ],
  },
  {
    title: "Library",
    shortcuts: [
      { keys: "\u2318A", description: "Select all tracks" },
      { keys: "\u2318I", description: "Get Info for selected track" },
      { keys: "\u2318N", description: "New playlist" },
      { keys: "\u2318\u21e7N", description: "Playlist from selection" },
      { keys: "\u2318\u2325N", description: "New smart playlist" },
      { keys: "\u2318\u21e7I", description: "Re-import library" },
      { keys: "\u2318F", description: "Search" },
    ],
  },
  {
    title: "General",
    shortcuts: [
      { keys: "\u2318J", description: "Toggle assistant" },
      { keys: "?", description: "Show keyboard shortcuts" },
      { keys: "Esc", description: "Close modal / clear search" },
    ],
  },
];

interface KeyboardShortcutsModalProps {
  onClose: () => void;
}

export function KeyboardShortcutsModal({ onClose }: KeyboardShortcutsModalProps) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      onKeyDown={(e) => {
        if (e.key === "Escape") onClose();
      }}
    >
      <div className="bg-n-900 border border-n-800 rounded-xl shadow-2xl w-[520px] max-h-[80vh] overflow-y-auto">
        <div className="flex items-center justify-between px-5 py-3 border-b border-n-800">
          <h2 className="text-sm font-medium text-n-200">Keyboard Shortcuts</h2>
          <button
            onClick={onClose}
            className="text-n-500 hover:text-n-300 transition-colors"
          >
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M4 4l8 8M12 4l-8 8" />
            </svg>
          </button>
        </div>

        <div className="p-5 grid grid-cols-2 gap-6">
          {sections.map((section) => (
            <div key={section.title}>
              <h3 className="text-[10px] uppercase tracking-wider text-n-500 font-medium mb-2">
                {section.title}
              </h3>
              <div className="space-y-1.5">
                {section.shortcuts.map((shortcut) => (
                  <div
                    key={shortcut.keys}
                    className="flex items-center justify-between text-xs"
                  >
                    <span className="text-n-400">{shortcut.description}</span>
                    <kbd className="ml-2 px-1.5 py-0.5 bg-n-800 border border-n-700 rounded text-[10px] text-n-300 font-mono shrink-0">
                      {shortcut.keys}
                    </kbd>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
