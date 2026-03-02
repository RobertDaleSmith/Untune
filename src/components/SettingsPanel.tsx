import { useState, useEffect, useCallback } from "react";
import { listen } from "@tauri-apps/api/event";
import { useThemeStore } from "../stores/themeStore";
import { usePlaybackStore } from "../stores/playbackStore";
import { useColumnBrowserStore } from "../stores/columnBrowserStore";
import {
  getPreference,
  setPreference,
  startAiTagging,
  cancelAiTagging,
  resetLibrary,
  type AiTagProgress,
} from "../lib/commands";

interface SettingsPanelProps {
  onClose: () => void;
}

export function SettingsPanel({ onClose }: SettingsPanelProps) {
  const { theme, setTheme, showStatusBar, setShowStatusBar, showAlbumAccent, setShowAlbumAccent } = useThemeStore();
  const { crossfadeDuration, setCrossfadeDuration } = usePlaybackStore();
  const { visible: columnBrowserVisible, setVisible: setColumnBrowserVisible } = useColumnBrowserStore();

  const [aiAutoTag, setAiAutoTag] = useState(false);
  const [assistantTts, setAssistantTts] = useState(false);
  const [aiTagging, setAiTagging] = useState(false);
  const [aiProgress, setAiProgress] = useState<AiTagProgress | null>(null);
  const [resetConfirm, setResetConfirm] = useState(false);
  const [resetting, setResetting] = useState(false);

  useEffect(() => {
    getPreference("ai_auto_tag").then((v) => setAiAutoTag(v === "true"));
    getPreference("assistant_tts_enabled").then((v) => setAssistantTts(v === "true"));
  }, []);

  useEffect(() => {
    const unlisten = listen<AiTagProgress & { done?: boolean }>("ai-tag-progress", (e) => {
      setAiProgress({ tagged: e.payload.tagged, total: e.payload.total });
      if (e.payload.done) {
        setAiTagging(false);
      }
    });
    return () => { unlisten.then((fn) => fn()); };
  }, []);

  const handleAutoTagToggle = useCallback((v: boolean) => {
    setAiAutoTag(v);
    setPreference("ai_auto_tag", v ? "true" : "false");
  }, []);

  const handleTtsToggle = useCallback((v: boolean) => {
    setAssistantTts(v);
    setPreference("assistant_tts_enabled", v ? "true" : "false");
  }, []);

  const handleTagAll = useCallback(() => {
    setAiTagging(true);
    setAiProgress(null);
    startAiTagging().catch(console.error);
  }, []);

  const handleCancelTag = useCallback(() => {
    cancelAiTagging().catch(console.error);
    setAiTagging(false);
  }, []);

  const handleResetLibrary = useCallback(async () => {
    setResetting(true);
    try {
      await resetLibrary();
      window.location.reload();
    } catch (err) {
      console.error("Failed to reset library:", err);
      setResetting(false);
      setResetConfirm(false);
    }
  }, []);

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

        {/* AI Features */}
        <div className="px-6 py-4 border-b border-n-800">
          <h3 className="text-[11px] font-medium text-n-500 uppercase tracking-wider mb-3">AI Features</h3>

          <div className="space-y-3">
            <SettingToggle
              label="Auto-tag after import"
              description="Analyze tracks with AI for mood, energy, BPM"
              checked={aiAutoTag}
              onChange={handleAutoTagToggle}
            />

            <div className="flex items-center justify-between">
              <div>
                <span className="text-[13px] text-n-200">Tag untagged tracks</span>
                <p className="text-[11px] text-n-500">
                  {aiTagging && aiProgress
                    ? `${aiProgress.tagged} / ${aiProgress.total} tagged`
                    : "Run AI analysis on all tracks"}
                </p>
              </div>
              {aiTagging ? (
                <button
                  onClick={handleCancelTag}
                  className="px-3 py-1 text-[11px] rounded-md bg-red-500/20 text-red-400 hover:bg-red-500/30 transition-colors"
                >
                  Cancel
                </button>
              ) : (
                <button
                  onClick={handleTagAll}
                  className="px-3 py-1 text-[11px] rounded-md bg-accent/20 text-accent hover:bg-accent/30 transition-colors"
                >
                  Tag All
                </button>
              )}
            </div>

            <SettingToggle
              label="Speak assistant responses"
              description="Read assistant responses aloud via macOS TTS"
              checked={assistantTts}
              onChange={handleTtsToggle}
            />
          </div>
        </div>

        {/* About */}
        <div className="px-6 py-4">
          <h3 className="text-[11px] font-medium text-n-500 uppercase tracking-wider mb-3">About</h3>
          <div className="text-[12px] text-n-400 space-y-1">
            <p><span className="text-n-300">Untune</span> — Music Player</p>
            <p>Built with Tauri, React, and Rust</p>
          </div>

          <div className="mt-4 pt-4 border-t border-n-800">
            {resetConfirm ? (
              <div>
                <p className="text-[12px] text-red-400 mb-3">
                  Are you sure? This will delete all tracks, playlists, and artwork.
                </p>
                <div className="flex gap-2">
                  <button
                    onClick={handleResetLibrary}
                    disabled={resetting}
                    className="px-3 py-1.5 text-[11px] rounded-md bg-red-600 text-white hover:bg-red-500 transition-colors disabled:opacity-50"
                  >
                    {resetting ? "Resetting..." : "Reset Everything"}
                  </button>
                  <button
                    onClick={() => setResetConfirm(false)}
                    disabled={resetting}
                    className="px-3 py-1.5 text-[11px] rounded-md bg-n-800 text-n-300 hover:bg-n-700 transition-colors disabled:opacity-50"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <button
                onClick={() => setResetConfirm(true)}
                className="px-3 py-1.5 text-[11px] rounded-md bg-red-500/15 text-red-400 hover:bg-red-500/25 transition-colors"
              >
                Reset Library
              </button>
            )}
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
