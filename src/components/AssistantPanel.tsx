import { useCallback, useEffect, useRef, useState } from "react";
import { useAssistantStore } from "../stores/assistantStore";
import type { AssistantMessage } from "../lib/types";

function ToolChip({ tool }: { tool: string }) {
  const labels: Record<string, string> = {
    search_library: "Searched library",
    query_tracks: "Queried tracks",
    get_playback_state: "Checked playback",
    play_tracks: "Playing tracks",
    play_album: "Playing album",
    play_artist: "Playing artist",
    play_playlist: "Playing playlist",
    control_playback: "Controlled playback",
    get_library_stats: "Got stats",
    get_playlists: "Listed playlists",
    create_playlist: "Created playlist",
    get_listening_history: "Checked history",
  };

  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-n-800 text-n-400 text-[10px]">
      <svg width="10" height="10" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
        <path d="M4 8h8M8 4v8" />
      </svg>
      {labels[tool] ?? tool}
    </span>
  );
}

function MessageBubble({ message }: { message: AssistantMessage }) {
  const isUser = message.role === "user";
  return (
    <div className={`flex flex-col gap-1 ${isUser ? "items-end" : "items-start"}`}>
      {message.toolCalls && message.toolCalls.length > 0 && (
        <div className="flex flex-wrap gap-1 mb-0.5">
          {message.toolCalls.map((tc, i) => (
            <ToolChip key={i} tool={tc.tool} />
          ))}
        </div>
      )}
      <div
        className={`max-w-[85%] px-3 py-2 rounded-xl text-[13px] leading-relaxed ${
          isUser
            ? "bg-accent/20 text-n-100"
            : "bg-n-800 text-n-200"
        }`}
      >
        {message.text}
      </div>
    </div>
  );
}

export function AssistantPanel() {
  const {
    isOpen,
    close,
    messages,
    status,
    streamingText,
    sendMessage,
    clearHistory,
    isListening,
    interimTranscript,
    speechPermission,
    startListening,
    stopListening,
  } = useAssistantStore();

  const [input, setInput] = useState("");
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, streamingText, interimTranscript]);

  // Focus input when panel opens
  useEffect(() => {
    if (isOpen) {
      setTimeout(() => inputRef.current?.focus(), 300);
    }
  }, [isOpen]);

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      const text = input.trim();
      if (!text || status === "processing") return;
      setInput("");
      await sendMessage(text);
    },
    [input, status, sendMessage],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Escape") {
        close();
      }
    },
    [close],
  );

  return (
    <div
      className={`fixed top-[56px] right-0 bottom-0 w-[360px] bg-n-900 border-l border-n-700 z-50 flex flex-col transition-transform duration-300 ease-in-out ${
        isOpen ? "translate-x-0" : "translate-x-full"
      }`}
      onKeyDown={handleKeyDown}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-n-800 shrink-0">
        <span className="text-[13px] font-medium text-n-200">Assistant</span>
        <div className="flex items-center gap-2">
          {messages.length > 0 && (
            <button
              onClick={clearHistory}
              className="text-n-500 hover:text-n-300 transition-colors text-[11px]"
              title="Clear conversation"
            >
              Clear
            </button>
          )}
          <button
            onClick={close}
            className="text-n-500 hover:text-n-300 transition-colors"
            title="Close"
          >
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M4 4l8 8M12 4l-8 8" />
            </svg>
          </button>
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
        {messages.length === 0 && status === "idle" && (
          <div className="flex flex-col items-center justify-center h-full text-n-600 gap-2">
            {/* Sparkle icon */}
            <svg width="32" height="32" viewBox="0 0 24 24" fill="currentColor" opacity="0.4">
              <path d="M12 1L14.2 8.2L21 8L15.5 12.8L17.8 20L12 15.6L6.2 20L8.5 12.8L3 8L9.8 8.2L12 1Z" />
              <circle cx="20" cy="4" r="1.5" />
              <circle cx="4" cy="20" r="1" />
            </svg>
            <p className="text-[12px]">Ask about your music</p>
            <p className="text-[11px] text-n-700 text-center px-4">
              Try: "Play something chill" or "What are my most played songs?"
            </p>
          </div>
        )}

        {messages.map((msg) => (
          <MessageBubble key={msg.id} message={msg} />
        ))}

        {/* Listening indicator */}
        {isListening && (
          <div className="flex flex-col items-end gap-1">
            <div className="max-w-[85%] px-3 py-2 rounded-xl text-[13px] leading-relaxed bg-accent/20 text-n-100 italic">
              {interimTranscript || "Listening..."}
            </div>
          </div>
        )}

        {/* Processing indicator */}
        {status === "processing" && (
          <div className="flex items-start gap-2">
            <div className="bg-n-800 text-n-200 px-3 py-2 rounded-xl text-[13px] leading-relaxed">
              {streamingText || (
                <span className="inline-flex gap-1">
                  <span className="w-1.5 h-1.5 bg-n-500 rounded-full animate-bounce" style={{ animationDelay: "0ms" }} />
                  <span className="w-1.5 h-1.5 bg-n-500 rounded-full animate-bounce" style={{ animationDelay: "150ms" }} />
                  <span className="w-1.5 h-1.5 bg-n-500 rounded-full animate-bounce" style={{ animationDelay: "300ms" }} />
                </span>
              )}
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <form onSubmit={handleSubmit} className="shrink-0 border-t border-n-800 px-3 py-3 flex items-center gap-2">
        <input
          ref={inputRef}
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={isListening ? "Listening..." : status === "processing" ? "Thinking..." : "Ask about your music..."}
          disabled={status === "processing" || isListening}
          className="flex-1 bg-n-800 border border-n-700 rounded-lg px-3 py-2 text-[13px] text-n-200 placeholder-n-600 outline-none focus:border-n-500 transition-colors disabled:opacity-50"
        />
        {speechPermission !== "unavailable" && (
          <button
            type="button"
            onClick={isListening ? stopListening : startListening}
            disabled={status === "processing"}
            className={`p-2 transition-colors disabled:text-n-700 disabled:cursor-default ${
              isListening
                ? "text-red-500 hover:text-red-400 animate-pulse"
                : "text-n-400 hover:text-n-200"
            }`}
            title={isListening ? "Stop listening" : "Voice input"}
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
              <rect x="5.5" y="1" width="5" height="9" rx="2.5" />
              <path d="M3 7a5 5 0 0 0 10 0" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              <line x1="8" y1="13" x2="8" y2="15" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </button>
        )}
        <button
          type="submit"
          disabled={status === "processing" || isListening || !input.trim()}
          className="p-2 text-n-400 hover:text-n-200 transition-colors disabled:text-n-700 disabled:cursor-default"
          title="Send"
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
            <path d="M1 1l14 7-14 7V9l10-1-10-1V1z" />
          </svg>
        </button>
      </form>
    </div>
  );
}
