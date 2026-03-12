import { useState, useEffect, useCallback } from "react";
import { useThemeStore } from "../stores/themeStore";
import { usePlaybackStore } from "../stores/playbackStore";
import { useColumnBrowserStore } from "../stores/columnBrowserStore";
import { useActivityStore } from "../stores/activityStore";
import { save, open } from "@tauri-apps/plugin-dialog";
import {
  getPreference,
  setPreference,
  startAiTagging,
  cancelAiTagging,
  resetLibrary,
  hasAssistantApiKey,
  setAssistantApiKey,
  exportAiTags,
  importAiTags,
  startSyncServer,
  stopSyncServer,
  generatePairingCode,
  getSyncStatus,
  unpairDevice,
  setSyncPlaylists,
  getPlaylists,
  getHandoffConfig,
  configureHandoff,
  generateHandoffToken,
  checkDependencies,
} from "../lib/commands";
import type { DependencyStatus } from "../lib/commands";
import type { SyncStatus, Playlist } from "../lib/types";

interface SettingsPanelProps {
  onClose: () => void;
}

export function SettingsPanel({ onClose }: SettingsPanelProps) {
  const { theme, setTheme, showStatusBar, setShowStatusBar, showAlbumAccent, setShowAlbumAccent } = useThemeStore();
  const { crossfadeDuration, setCrossfadeDuration } = usePlaybackStore();
  const { visible: columnBrowserVisible, setVisible: setColumnBrowserVisible } = useColumnBrowserStore();

  const aiTask = useActivityStore((s) => s.tasks["ai-tagging"]);
  const aiTagging = aiTask != null && !aiTask.completedAt;
  const aiProgress = aiTask ? { tagged: aiTask.current, total: aiTask.total } : null;

  const [aiAutoTag, setAiAutoTag] = useState(false);
  const [assistantTts, setAssistantTts] = useState(false);
  const [resetConfirm, setResetConfirm] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [hasApiKey, setHasApiKey] = useState(false);
  const [apiKeyInput, setApiKeyInput] = useState("");
  const [apiKeyEditing, setApiKeyEditing] = useState(false);
  const [apiKeySaving, setApiKeySaving] = useState(false);
  const [apiKeyError, setApiKeyError] = useState<string | null>(null);
  const [tagBackupStatus, setTagBackupStatus] = useState<string | null>(null);

  // Sync state
  const [syncStatus, setSyncStatus] = useState<SyncStatus | null>(null);
  const [allPlaylists, setAllPlaylists] = useState<Playlist[]>([]);
  const [syncLoading, setSyncLoading] = useState(false);

  // Handoff state
  const [handoffUrl, setHandoffUrl] = useState("");
  const [handoffToken, setHandoffToken] = useState("");
  const [handoffConfigured, setHandoffConfigured] = useState(false);
  const [handoffCopied, setHandoffCopied] = useState(false);

  // Dependencies state
  const [deps, setDeps] = useState<DependencyStatus[]>([]);

  useEffect(() => {
    getPreference("ai_auto_tag").then((v) => setAiAutoTag(v === "true"));
    getPreference("assistant_tts_enabled").then((v) => setAssistantTts(v === "true"));
    hasAssistantApiKey().then(setHasApiKey);
    getSyncStatus().then(setSyncStatus).catch(() => {});
    getPlaylists().then(setAllPlaylists).catch(() => {});
    getHandoffConfig().then((cfg) => {
      if (cfg) {
        setHandoffUrl(cfg.url);
        setHandoffToken(cfg.token);
        setHandoffConfigured(true);
      }
    }).catch(() => {});
    checkDependencies().then(setDeps).catch(() => {});
  }, []);

  const handleAutoTagToggle = useCallback((v: boolean) => {
    setAiAutoTag(v);
    setPreference("ai_auto_tag", v ? "true" : "false");
  }, []);

  const handleSaveApiKey = useCallback(async () => {
    const trimmed = apiKeyInput.trim();
    if (!trimmed) return;
    if (!trimmed.startsWith("sk-ant-")) {
      setApiKeyError("API key should start with sk-ant-");
      return;
    }
    setApiKeySaving(true);
    setApiKeyError(null);
    try {
      await setAssistantApiKey(trimmed);
      setHasApiKey(true);
      setApiKeyInput("");
      setApiKeyEditing(false);
    } catch (err) {
      setApiKeyError(err instanceof Error ? err.message : String(err));
    } finally {
      setApiKeySaving(false);
    }
  }, [apiKeyInput]);

  const handleTtsToggle = useCallback((v: boolean) => {
    setAssistantTts(v);
    setPreference("assistant_tts_enabled", v ? "true" : "false");
  }, []);

  const handleTagAll = useCallback(() => {
    startAiTagging().catch(console.error);
  }, []);

  const handleCancelTag = useCallback(() => {
    cancelAiTagging().catch(console.error);
  }, []);

  const handleExportTags = useCallback(async () => {
    const path = await save({
      defaultPath: "ai_tags_backup.json",
      filters: [{ name: "JSON", extensions: ["json"] }],
    });
    if (!path) return;
    try {
      const count = await exportAiTags(path);
      setTagBackupStatus(`Exported ${count.toLocaleString()} tags`);
    } catch (err) {
      setTagBackupStatus(`Export failed: ${err}`);
    }
  }, []);

  const handleRestoreTags = useCallback(async () => {
    const path = await open({
      filters: [{ name: "JSON", extensions: ["json"] }],
      multiple: false,
    });
    if (!path) return;
    try {
      const count = await importAiTags(path);
      setTagBackupStatus(`Restored ${count.toLocaleString()} tags`);
    } catch (err) {
      setTagBackupStatus(`Restore failed: ${err}`);
    }
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
            <div>
              <div className="flex items-center justify-between">
                <div>
                  <span className="text-[13px] text-n-200">Anthropic API key</span>
                  <p className="text-[11px] text-n-500">
                    {hasApiKey ? "Key configured" : "Required for AI tagging, bios, and assistant"}
                  </p>
                </div>
                {!apiKeyEditing && (
                  <button
                    onClick={() => setApiKeyEditing(true)}
                    className="px-3 py-1 text-[11px] rounded-md bg-n-800 text-n-300 hover:text-n-100 hover:bg-n-700 transition-colors"
                  >
                    {hasApiKey ? "Update" : "Set Key"}
                  </button>
                )}
              </div>
              {apiKeyEditing && (
                <div className="mt-2">
                  <input
                    type="password"
                    value={apiKeyInput}
                    onChange={(e) => setApiKeyInput(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && handleSaveApiKey()}
                    placeholder="sk-ant-..."
                    autoFocus
                    className="w-full bg-n-800 border border-n-700 rounded-lg px-3 py-1.5 text-[12px] text-n-200 placeholder-n-600 outline-none focus:border-n-500 transition-colors font-mono"
                  />
                  {apiKeyError && (
                    <p className="text-red-400 text-[11px] mt-1">{apiKeyError}</p>
                  )}
                  <div className="flex justify-end gap-2 mt-2">
                    <button
                      onClick={() => { setApiKeyEditing(false); setApiKeyInput(""); setApiKeyError(null); }}
                      className="px-3 py-1 text-[11px] text-n-400 hover:text-n-200 transition-colors"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={handleSaveApiKey}
                      disabled={apiKeySaving || !apiKeyInput.trim()}
                      className="px-3 py-1 text-[11px] rounded-md bg-accent/20 text-accent hover:bg-accent/30 transition-colors disabled:opacity-40"
                    >
                      {apiKeySaving ? "Saving..." : "Save"}
                    </button>
                  </div>
                </div>
              )}
            </div>

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

            <div className="flex items-center justify-between">
              <div>
                <span className="text-[13px] text-n-200">Backup AI tags</span>
                <p className="text-[11px] text-n-500">
                  {tagBackupStatus || "Export or restore tags to/from a file"}
                </p>
              </div>
              <div className="flex gap-1.5">
                <button
                  onClick={handleExportTags}
                  className="px-3 py-1 text-[11px] rounded-md bg-n-800 text-n-300 hover:text-n-100 hover:bg-n-700 transition-colors"
                >
                  Export
                </button>
                <button
                  onClick={handleRestoreTags}
                  className="px-3 py-1 text-[11px] rounded-md bg-n-800 text-n-300 hover:text-n-100 hover:bg-n-700 transition-colors"
                >
                  Restore
                </button>
              </div>
            </div>

            <SettingToggle
              label="Speak assistant responses"
              description="Read assistant responses aloud via macOS TTS"
              checked={assistantTts}
              onChange={handleTtsToggle}
            />
          </div>
        </div>

        {/* Mobile Sync */}
        <div className="px-6 py-4 border-t border-n-800">
          <h3 className="text-[11px] font-medium text-n-500 uppercase tracking-wider mb-3">Mobile Sync</h3>
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <span className="text-[13px] text-n-200">Sync Server</span>
                <p className="text-[11px] text-n-500">Allow iOS devices to sync over local network</p>
              </div>
              <button
                disabled={syncLoading}
                onClick={async () => {
                  setSyncLoading(true);
                  try {
                    if (syncStatus?.running) {
                      await stopSyncServer();
                    } else {
                      await startSyncServer();
                    }
                    const s = await getSyncStatus();
                    setSyncStatus(s);
                  } catch (e) {
                    console.error("Sync toggle failed:", e);
                  }
                  setSyncLoading(false);
                }}
                className={`w-9 h-5 rounded-full transition-colors relative ${
                  syncStatus?.running ? "bg-accent" : "bg-n-700"
                }`}
              >
                <div
                  className={`w-3.5 h-3.5 rounded-full bg-white absolute top-[3px] transition-transform ${
                    syncStatus?.running ? "translate-x-[18px]" : "translate-x-[3px]"
                  }`}
                />
              </button>
            </div>

            {syncStatus?.running && (
              <>
                {/* Pairing */}
                <div className="bg-n-900 rounded-lg p-3">
                  {syncStatus.pairingCode ? (
                    <div className="text-center">
                      <p className="text-[11px] text-n-500 mb-1">Pairing Code</p>
                      <p className="text-[28px] font-mono font-bold text-n-100 tracking-[0.3em]">{syncStatus.pairingCode}</p>
                      <p className="text-[10px] text-n-600 mt-1">Enter this code on your iOS device</p>
                    </div>
                  ) : (
                    <button
                      onClick={async () => {
                        await generatePairingCode();
                        const s = await getSyncStatus();
                        setSyncStatus(s);
                      }}
                      className="w-full px-3 py-1.5 text-[11px] rounded-md bg-accent/20 text-accent hover:bg-accent/30 transition-colors"
                    >
                      Generate Pairing Code
                    </button>
                  )}
                </div>

                {/* Paired Devices */}
                {syncStatus.devices.length > 0 && (
                  <div>
                    <p className="text-[11px] text-n-500 mb-2">Paired Devices</p>
                    {syncStatus.devices.map((d) => (
                      <div key={d.id} className="flex items-center justify-between bg-n-900 rounded-lg px-3 py-2 mb-1">
                        <div>
                          <span className="text-[12px] text-n-200">{d.name}</span>
                          <p className="text-[10px] text-n-600">
                            {d.lastSyncAt ? `Last sync: ${new Date(d.lastSyncAt).toLocaleDateString()}` : "Never synced"}
                          </p>
                        </div>
                        <button
                          onClick={async () => {
                            await unpairDevice(d.id);
                            const s = await getSyncStatus();
                            setSyncStatus(s);
                          }}
                          className="text-[10px] text-red-400 hover:text-red-300"
                        >
                          Unpair
                        </button>
                      </div>
                    ))}

                    {/* Playlist Selection */}
                    <p className="text-[11px] text-n-500 mt-3 mb-2">Sync Playlists</p>
                    <div className="max-h-32 overflow-y-auto space-y-1">
                      {allPlaylists.filter((p) => !p.isFolder).map((p) => {
                        const selected = syncStatus.selectedPlaylists.includes(p.id);
                        return (
                          <label key={p.id} className="flex items-center gap-2 text-[12px] text-n-300 cursor-pointer hover:text-n-100">
                            <input
                              type="checkbox"
                              checked={selected}
                              onChange={async () => {
                                const device = syncStatus.devices[0];
                                if (!device) return;
                                const newIds = selected
                                  ? syncStatus.selectedPlaylists.filter((id) => id !== p.id)
                                  : [...syncStatus.selectedPlaylists, p.id];
                                await setSyncPlaylists(device.id, newIds);
                                const s = await getSyncStatus();
                                setSyncStatus(s);
                              }}
                              className="rounded"
                            />
                            {p.name}
                          </label>
                        );
                      })}
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        </div>

        {/* Handoff */}
        <div className="px-6 py-4 border-b border-n-800">
          <h3 className="text-[11px] font-medium text-n-500 uppercase tracking-wider mb-3">Handoff</h3>
          <div className="space-y-3">
            <div>
              <div className="flex items-center justify-between mb-1">
                <span className="text-[13px] text-n-200">Server URL</span>
                {handoffConfigured && (
                  <span className="text-[10px] text-green-400">Configured</span>
                )}
              </div>
              <input
                type="text"
                value={handoffUrl}
                onChange={(e) => setHandoffUrl(e.target.value)}
                onBlur={() => {
                  if (handoffUrl && handoffToken) {
                    configureHandoff(handoffUrl, handoffToken).then(() => setHandoffConfigured(true)).catch(() => {});
                  }
                }}
                placeholder="https://your-project.vercel.app"
                className="w-full bg-n-800 border border-n-700 rounded-lg px-3 py-1.5 text-[12px] text-n-200 placeholder-n-600 outline-none focus:border-n-500 transition-colors font-mono"
              />
            </div>

            <div>
              <span className="text-[13px] text-n-200">Token</span>
              <div className="flex gap-1.5 mt-1">
                <input
                  type="text"
                  value={handoffToken}
                  readOnly
                  className="flex-1 bg-n-800 border border-n-700 rounded-lg px-3 py-1.5 text-[11px] text-n-400 font-mono outline-none truncate"
                  placeholder="Click Generate to create a token"
                />
                <button
                  onClick={() => {
                    if (handoffToken) {
                      navigator.clipboard.writeText(handoffToken);
                      setHandoffCopied(true);
                      setTimeout(() => setHandoffCopied(false), 2000);
                    }
                  }}
                  className="px-2.5 py-1 text-[11px] rounded-md bg-n-800 text-n-300 hover:text-n-100 hover:bg-n-700 transition-colors"
                  title="Copy token"
                >
                  {handoffCopied ? "Copied" : "Copy"}
                </button>
                <button
                  onClick={async () => {
                    const token = await generateHandoffToken();
                    setHandoffToken(token);
                    if (handoffUrl) {
                      await configureHandoff(handoffUrl, token);
                      setHandoffConfigured(true);
                    }
                  }}
                  className="px-2.5 py-1 text-[11px] rounded-md bg-accent/20 text-accent hover:bg-accent/30 transition-colors"
                >
                  Generate
                </button>
              </div>
              <p className="text-[10px] text-n-600 mt-1">
                Use the same URL and token on all devices to enable cross-device resume
              </p>
            </div>
          </div>
        </div>

        {/* Dependencies */}
        <div className="px-6 py-4 border-b border-n-800">
          <h3 className="text-[11px] font-medium text-n-500 uppercase tracking-wider mb-3">Dependencies</h3>
          <p className="text-[11px] text-n-500 mb-3">Required for downloading from YouTube and other URLs</p>
          <div className="space-y-2">
            {deps.map((dep) => (
              <div key={dep.name} className="flex items-start justify-between">
                <div className="flex items-center gap-2 min-w-0">
                  <div className={`w-2 h-2 rounded-full shrink-0 ${dep.installed ? "bg-green-400" : "bg-red-400"}`} />
                  <div className="min-w-0">
                    <span className="text-[13px] text-n-200">{dep.name}</span>
                    {dep.installed ? (
                      <p className="text-[10px] text-n-600 truncate" title={dep.path ?? undefined}>
                        {dep.version ?? dep.path}
                      </p>
                    ) : (
                      <p className="text-[11px] text-n-500">
                        Not found — run: <code className="text-amber-400/80 font-mono">{dep.installHint}</code>
                      </p>
                    )}
                  </div>
                </div>
              </div>
            ))}
            {deps.length === 0 && (
              <p className="text-[11px] text-n-600">Checking...</p>
            )}
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
