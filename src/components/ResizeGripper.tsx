import { getCurrentWindow } from "@tauri-apps/api/window";

// The full-player window is borderless, so it has no native edge to drag for
// resizing. This is a small grab handle in the bottom-right corner that stays
// invisible until hovered, then drives a native resize drag from the SE corner.
export function ResizeGripper() {
  return (
    <div
      onMouseDown={(e) => {
        e.preventDefault();
        e.stopPropagation();
        getCurrentWindow().startResizeDragging("SouthEast").catch(() => {});
      }}
      className="fixed bottom-0 right-0 z-[99999] w-5 h-5 cursor-nwse-resize opacity-0 hover:opacity-100 transition-opacity duration-150"
      title="Drag to resize"
      aria-hidden="true"
    >
      <svg
        width="16"
        height="16"
        viewBox="0 0 16 16"
        className="absolute bottom-0 right-0 text-white/45"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
      >
        <path d="M11 15 L15 11" />
        <path d="M7 15 L15 7" />
      </svg>
    </div>
  );
}
