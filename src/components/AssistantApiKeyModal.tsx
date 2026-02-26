import { useCallback, useRef, useState } from "react";
import { useAssistantStore } from "../stores/assistantStore";

export function AssistantApiKeyModal() {
  const { showApiKeyModal, setShowApiKeyModal, saveApiKey } = useAssistantStore();
  const [key, setKey] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleSave = useCallback(async () => {
    const trimmed = key.trim();
    if (!trimmed) return;
    if (!trimmed.startsWith("sk-ant-")) {
      setError("API key should start with sk-ant-");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await saveApiKey(trimmed);
      setKey("");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }, [key, saveApiKey]);

  if (!showApiKeyModal) return null;

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/60">
      <div className="bg-n-900 border border-n-700 rounded-xl w-[400px] p-6 shadow-2xl">
        <h2 className="text-[15px] font-medium text-n-100 mb-1">Voice Assistant</h2>
        <p className="text-[12px] text-n-400 mb-4">
          Enter your Anthropic API key to enable the assistant. It will be stored locally.
        </p>

        <input
          ref={inputRef}
          type="password"
          value={key}
          onChange={(e) => setKey(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleSave()}
          placeholder="sk-ant-..."
          autoFocus
          className="w-full bg-n-800 border border-n-700 rounded-lg px-3 py-2 text-[13px] text-n-200 placeholder-n-600 outline-none focus:border-n-500 transition-colors font-mono"
        />

        {error && (
          <p className="text-red-400 text-[11px] mt-2">{error}</p>
        )}

        <div className="flex justify-end gap-2 mt-4">
          <button
            onClick={() => {
              setShowApiKeyModal(false);
              setKey("");
              setError(null);
            }}
            className="px-3 py-1.5 text-[12px] text-n-400 hover:text-n-200 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={saving || !key.trim()}
            className="px-4 py-1.5 text-[12px] bg-accent/20 text-accent rounded-lg hover:bg-accent/30 transition-colors disabled:opacity-40"
          >
            {saving ? "Saving..." : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}
