import { useCallback, useEffect, useRef, useState } from "react";
import { queueUrlDownload } from "../lib/commands";

interface Props {
  open: boolean;
  onClose: () => void;
  initialUrl?: string;
}

export function AddFromUrlDialog({ open, onClose, initialUrl }: Props) {
  const [url, setUrl] = useState("");
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Focus input when dialog opens
  useEffect(() => {
    if (open) {
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [open]);

  // Auto-fill and auto-submit when opened via deep link
  const autoSubmittedRef = useRef(false);
  const pendingAutoSubmitRef = useRef<string | null>(null);
  useEffect(() => {
    if (open && initialUrl && !autoSubmittedRef.current) {
      autoSubmittedRef.current = true;
      setUrl(initialUrl);
      pendingAutoSubmitRef.current = initialUrl;
    }
  }, [open, initialUrl]);

  // Reset auto-submit flag when dialog closes
  useEffect(() => {
    if (!open) {
      autoSubmittedRef.current = false;
      pendingAutoSubmitRef.current = null;
    }
  }, [open]);

  const handleClose = useCallback(() => {
    setUrl("");
    setError(null);
    onClose();
  }, [onClose]);

  const handleSubmit = useCallback(async (overrideUrl?: string) => {
    const trimmed = (overrideUrl ?? url).trim();
    if (!trimmed) return;
    setError(null);
    try {
      await queueUrlDownload(trimmed);
      // Queued successfully — close immediately
      handleClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [url, handleClose]);

  // Trigger auto-submit for deep-link URLs
  useEffect(() => {
    if (pendingAutoSubmitRef.current) {
      const autoUrl = pendingAutoSubmitRef.current;
      pendingAutoSubmitRef.current = null;
      setTimeout(() => handleSubmit(autoUrl), 100);
    }
  }, [handleSubmit]);

  // Handle Escape key
  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        handleClose();
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [open, handleClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/60">
      <div className="bg-n-900 border border-n-700 rounded-xl w-[480px] p-6 shadow-2xl">
        <h2 className="text-[15px] font-medium text-n-100 mb-1">Add from URL</h2>
        <p className="text-[12px] text-n-400 mb-4">
          Paste a YouTube or other supported URL to download and add to your library.
        </p>

        <input
          ref={inputRef}
          type="url"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleSubmit()}
          placeholder="https://youtube.com/watch?v=..."
          className="w-full bg-n-800 border border-n-700 rounded-lg px-3 py-2 text-[13px] text-n-200 placeholder-n-600 outline-none focus:border-n-500 transition-colors font-mono"
        />

        {error && (
          <p className="text-red-400 text-[11px] mt-2">{error}</p>
        )}

        <div className="flex justify-end gap-2 mt-4">
          <button
            onClick={handleClose}
            className="px-3 py-1.5 text-[12px] text-n-400 hover:text-n-200 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={() => handleSubmit()}
            disabled={!url.trim()}
            className="px-4 py-1.5 text-[12px] bg-accent/20 text-accent rounded-lg hover:bg-accent/30 transition-colors disabled:opacity-40"
          >
            Add
          </button>
        </div>
      </div>
    </div>
  );
}
