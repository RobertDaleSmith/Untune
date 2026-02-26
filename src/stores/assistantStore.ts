import { create } from "zustand";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type { AssistantMessage, AssistantStatus, AssistantToolCall, SpeechTranscript } from "../lib/types";
import {
  assistantAvailable,
  assistantSendMessage,
  assistantClearHistory,
  hasAssistantApiKey,
  setAssistantApiKey,
  checkSpeechPermission,
  requestSpeechPermission,
  startSpeechRecognition,
  stopSpeechRecognition,
} from "../lib/commands";
import { useNavigationStore } from "./navigationStore";

interface AssistantStore {
  isOpen: boolean;
  status: AssistantStatus;
  messages: AssistantMessage[];
  streamingText: string;
  isAvailable: boolean;
  hasApiKey: boolean;
  showApiKeyModal: boolean;
  pendingToolCalls: AssistantToolCall[];
  isListening: boolean;
  interimTranscript: string;
  speechPermission: string;

  // Actions
  init: () => Promise<void>;
  toggle: () => void;
  open: () => void;
  close: () => void;
  sendMessage: (text: string) => Promise<void>;
  clearHistory: () => void;
  setShowApiKeyModal: (show: boolean) => void;
  saveApiKey: (key: string) => Promise<void>;
  startListening: () => Promise<void>;
  stopListening: () => Promise<void>;
  cleanup: () => void;
}

let unlisteners: UnlistenFn[] = [];
let msgIdCounter = 0;

function nextId(): string {
  return `msg-${++msgIdCounter}-${Date.now()}`;
}

export const useAssistantStore = create<AssistantStore>((set, get) => ({
  isOpen: false,
  status: "idle",
  messages: [],
  streamingText: "",
  isAvailable: false,
  hasApiKey: false,
  showApiKeyModal: false,
  pendingToolCalls: [],
  isListening: false,
  interimTranscript: "",
  speechPermission: "unknown",

  init: async () => {
    try {
      const available = await assistantAvailable();
      const apiKey = await hasAssistantApiKey();
      set({ isAvailable: true, hasApiKey: apiKey || available });
    } catch {
      set({ isAvailable: false, hasApiKey: false });
    }

    // Check speech permission
    try {
      const perm = await checkSpeechPermission();
      set({ speechPermission: perm });
    } catch {
      set({ speechPermission: "unavailable" });
    }

    // Set up event listeners for streaming
    const u1 = await listen<string>("assistant-text-delta", (event) => {
      set((s) => ({ streamingText: s.streamingText + event.payload }));
    });

    const u2 = await listen<{ tool: string; input: Record<string, unknown> }>(
      "assistant-tool-called",
      (event) => {
        set((s) => ({
          pendingToolCalls: [...s.pendingToolCalls, event.payload],
        }));
      },
    );

    const u3 = await listen<string>("assistant-response-complete", () => {
      // Response complete is handled in sendMessage
    });

    // Refresh sidebar when assistant creates a playlist
    const u4 = await listen("assistant-playlist-changed", () => {
      useNavigationStore.getState().requestSidebarRefresh();
    });

    // Speech transcript events from native SFSpeechRecognizer
    const u5 = await listen<SpeechTranscript>("speech-transcript", (event) => {
      const { text, isFinal } = event.payload;
      if (isFinal) {
        set({ isListening: false, interimTranscript: "" });
        if (text.trim()) {
          get().sendMessage(text.trim());
        }
      } else {
        set({ interimTranscript: text });
      }
    });

    const u6 = await listen<string>("speech-error", (event) => {
      console.warn("Speech error:", event.payload);
      set({ isListening: false, interimTranscript: "" });
    });

    unlisteners = [u1, u2, u3, u4, u5, u6];
  },

  toggle: () => {
    const { isOpen, hasApiKey } = get();
    if (!isOpen && !hasApiKey) {
      set({ showApiKeyModal: true });
      return;
    }
    set({ isOpen: !isOpen });
  },

  open: () => {
    const { hasApiKey } = get();
    if (!hasApiKey) {
      set({ showApiKeyModal: true });
      return;
    }
    set({ isOpen: true });
  },

  close: () => set({ isOpen: false }),

  sendMessage: async (text: string) => {
    const userMsg: AssistantMessage = {
      id: nextId(),
      role: "user",
      text,
      timestamp: Date.now(),
    };

    set((s) => ({
      messages: [...s.messages, userMsg],
      status: "processing",
      streamingText: "",
      pendingToolCalls: [],
    }));

    try {
      const response = await assistantSendMessage(text);
      const { pendingToolCalls } = get();

      const assistantMsg: AssistantMessage = {
        id: nextId(),
        role: "assistant",
        text: response.text,
        toolCalls: pendingToolCalls.length > 0 ? pendingToolCalls : undefined,
        timestamp: Date.now(),
      };

      set((s) => ({
        messages: [...s.messages, assistantMsg],
        status: "idle",
        streamingText: "",
        pendingToolCalls: [],
      }));

      return;
    } catch (err) {
      const errorMsg: AssistantMessage = {
        id: nextId(),
        role: "assistant",
        text: `Error: ${err instanceof Error ? err.message : String(err)}`,
        timestamp: Date.now(),
      };
      set((s) => ({
        messages: [...s.messages, errorMsg],
        status: "idle",
        streamingText: "",
        pendingToolCalls: [],
      }));
    }
  },

  clearHistory: () => {
    assistantClearHistory().catch(() => {});
    set({ messages: [], streamingText: "" });
  },

  setShowApiKeyModal: (show) => set({ showApiKeyModal: show }),

  saveApiKey: async (key: string) => {
    await setAssistantApiKey(key);
    set({ hasApiKey: true, showApiKeyModal: false });
  },

  startListening: async () => {
    const { speechPermission, isListening } = get();
    if (isListening) return;

    if (speechPermission === "notDetermined") {
      await requestSpeechPermission();
      const perm = await checkSpeechPermission();
      set({ speechPermission: perm });
      if (perm !== "authorized") return;
    }

    if (speechPermission !== "authorized") return;

    set({ isListening: true, interimTranscript: "" });
    try {
      await startSpeechRecognition();
    } catch {
      set({ isListening: false });
    }
  },

  stopListening: async () => {
    set({ isListening: false, interimTranscript: "" });
    try {
      await stopSpeechRecognition();
    } catch {
      // ignore
    }
  },

  cleanup: () => {
    unlisteners.forEach((fn) => fn());
    unlisteners = [];
  },
}));
