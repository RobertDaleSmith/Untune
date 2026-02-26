import { useAssistantStore } from "../stores/assistantStore";

export function AssistantButton() {
  const { isOpen, toggle, status } = useAssistantStore();
  const isActive = isOpen || status === "listening";

  return (
    <button
      onClick={toggle}
      className={`p-1.5 transition-colors relative ${
        isActive ? "text-accent" : "text-n-500 hover:text-n-300"
      }`}
      title="Assistant (Cmd+J)"
    >
      {/* Sparkle icon */}
      <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
        <path d="M12 1L14.2 8.2L21 8L15.5 12.8L17.8 20L12 15.6L6.2 20L8.5 12.8L3 8L9.8 8.2L12 1Z" />
        <circle cx="20" cy="4" r="1.5" />
        <circle cx="4" cy="20" r="1" />
      </svg>
      {status === "listening" && (
        <span className="absolute -top-0.5 -right-0.5 w-2 h-2 bg-red-500 rounded-full animate-pulse" />
      )}
    </button>
  );
}
