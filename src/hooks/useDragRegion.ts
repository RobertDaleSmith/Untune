import { useCallback } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";

/**
 * Returns an onMouseDown handler that initiates window dragging.
 * Attach to a dedicated drag-region element (not a parent of interactive controls).
 */
export function useDragRegion() {
  return useCallback((e: React.MouseEvent) => {
    // Only left mouse button
    if (e.button !== 0) return;
    e.preventDefault();
    getCurrentWindow().startDragging().catch(() => {});
  }, []);
}
