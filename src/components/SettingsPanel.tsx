import { useThemeStore } from "../stores/themeStore";
import { usePlaybackStore } from "../stores/playbackStore";
import { useColumnBrowserStore } from "../stores/columnBrowserStore";

interface SettingsPanelProps {
  onClose: () => void;
}

export function SettingsPanel({ onClose }: SettingsPanelProps) {
  const { theme, setTheme, showStatusBar, setShowStatusBar, showAlbumAccent, setShowAlbumAccent } = useThemeStore();
  const { crossfadeDuration, setCrossfadeDuration } = usePlaybackStore();
  const { visible: columnBrowserVisible, setVisible: setColumnBrowserVisible } = useColumnBrowserStore();

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      onKeyDown={(e) => { if (e.key === "Escape") onClose(); }}
    >
      <div className="bg-n-900 border border-n-700 rounded-xl shadow-2xl w-[480px] max-h-[80vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-n-800">
          <span className="text-[15px] font-medium text-n-100">Settings</span>
          <button
            onClick={onClose}
            className="text-n-500 hover:text-n-300 transition-colors"
            title="Close"
          >
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M4 4l8 8M12 4l-8 8" />
            </svg>
          </button>
        </div>

        {/* Appearance */}
        <div className="px-6 py-4 border-b border-n-800">
          <h3 className="text-[11px] font-medium text-n-500 uppercase tracking-wider mb-3">Appearance</h3>

          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-[13px] text-n-200">Theme</span>
              <div className="flex gap-1">
                {(["system", "dark", "light"] as const).map((t) => (
                  <button
                    key={t}
                    onClick={() => setTheme(t)}
                    className={`px-3 py-1 text-[11px] rounded-md transition-colors ${
                      theme === t
                        ? "bg-accent/20 text-accent"
                        : "bg-n-800 text-n-400 hover:text-n-200"
                    }`}
                  >
                    {t.charAt(0).toUpperCase() + t.slice(1)}
                  </button>
                ))}
              </div>
            </div>

            <SettingToggle
              label="Status bar"
              description="Show track count and duration at bottom"
              checked={showStatusBar}
              onChange={setShowStatusBar}
            />

            <SettingToggle
              label="Album accent color"
              description="Tint background with album artwork color"
              checked={showAlbumAccent}
              onChange={setShowAlbumAccent}
            />

            <SettingToggle
              label="Column browser"
              description="Show genre/artist/album filter panels"
              checked={columnBrowserVisible}
              onChange={setColumnBrowserVisible}
            />
          </div>
        </div>

        {/* Playback */}
        <div className="px-6 py-4 border-b border-n-800">
          <h3 className="text-[11px] font-medium text-n-500 uppercase tracking-wider mb-3">Playback</h3>

          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <span className="text-[13px] text-n-200">Crossfade</span>
                <p className="text-[11px] text-n-500">Blend between tracks</p>
              </div>
              <div className="flex items-center gap-2">
                <input
                  type="range"
                  min="0"
                  max="12"
                  step="1"
                  value={crossfadeDuration}
                  onChange={(e) => setCrossfadeDuration(Number(e.target.value))}
                  className="w-24 accent-accent"
                />
                <span className="text-[11px] text-n-400 w-8 text-right tabular-nums">
                  {crossfadeDuration > 0 ? `${crossfadeDuration}s` : "Off"}
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* About */}
        <div className="px-6 py-4">
          <h3 className="text-[11px] font-medium text-n-500 uppercase tracking-wider mb-3">About</h3>
          <div className="text-[12px] text-n-400 space-y-1">
            <p><span className="text-n-300">Untune</span> — Music Player</p>
            <p>Built with Tauri, React, and Rust</p>
          </div>
        </div>
      </div>
    </div>
  );
}

function SettingToggle({
  label,
  description,
  checked,
  onChange,
}: {
  label: string;
  description: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between">
      <div>
        <span className="text-[13px] text-n-200">{label}</span>
        <p className="text-[11px] text-n-500">{description}</p>
      </div>
      <button
        onClick={() => onChange(!checked)}
        className={`w-9 h-5 rounded-full transition-colors relative ${
          checked ? "bg-accent" : "bg-n-700"
        }`}
      >
        <div
          className={`w-3.5 h-3.5 rounded-full bg-white absolute top-[3px] transition-transform ${
            checked ? "translate-x-[18px]" : "translate-x-[3px]"
          }`}
        />
      </button>
    </div>
  );
}
