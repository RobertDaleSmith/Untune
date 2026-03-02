import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useActivityStore, type ActivityTask } from "../stores/activityStore";

export function ActivityIndicator() {
  const tasks = useActivityStore((s) => s.tasks);
  const panelOpen = useActivityStore((s) => s.panelOpen);
  const togglePanel = useActivityStore((s) => s.togglePanel);
  const closePanel = useActivityStore((s) => s.closePanel);
  const btnRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [panelPos, setPanelPos] = useState<{ top: number; left: number }>({ top: 0, left: 0 });

  const taskList = Object.values(tasks) as ActivityTask[];
  const activeTasks = taskList.filter((t) => !t.completedAt);
  const completedTasks = taskList.filter((t) => t.completedAt);
  const hasAny = taskList.length > 0;

  // Close on outside click
  useEffect(() => {
    if (!panelOpen) return;
    const handle = (e: MouseEvent) => {
      if (
        panelRef.current &&
        !panelRef.current.contains(e.target as Node) &&
        btnRef.current &&
        !btnRef.current.contains(e.target as Node)
      ) {
        closePanel();
      }
    };
    document.addEventListener("mousedown", handle);
    return () => document.removeEventListener("mousedown", handle);
  }, [panelOpen, closePanel]);

  // Relative time helper
  const relTime = (completedAt: number) => {
    const seconds = Math.round((Date.now() - completedAt) / 1000);
    if (seconds < 60) return `${seconds}s ago`;
    return `${Math.round(seconds / 60)}m ago`;
  };

  // Update relative times every 5s
  const [, setTick] = useState(0);
  useEffect(() => {
    if (completedTasks.length === 0) return;
    const id = setInterval(() => setTick((v) => v + 1), 5000);
    return () => clearInterval(id);
  }, [completedTasks.length]);

  if (!hasAny) return null;

  // Hover summary
  const summaryParts = activeTasks.map(
    (t) => `${t.label}: ${t.current.toLocaleString()} / ${t.total.toLocaleString()}`,
  );
  const hoverTitle = summaryParts.length > 0
    ? summaryParts.join(" | ")
    : completedTasks.map((t) => `${t.label}: done`).join(" | ");

  return (
    <>
      <button
        ref={btnRef}
        onClick={() => {
          if (!panelOpen && btnRef.current) {
            const rect = btnRef.current.getBoundingClientRect();
            setPanelPos({ top: rect.bottom + 6, left: rect.left + rect.width / 2 - 140 });
          }
          togglePanel();
        }}
        className="p-1.5 transition-colors text-n-500 hover:text-n-300"
        title={hoverTitle}
      >
        <span
          className={`block w-2 h-2 rounded-full ${
            activeTasks.length > 0
              ? "bg-accent animate-activity-pulse"
              : "bg-n-500"
          }`}
        />
      </button>

      {panelOpen &&
        createPortal(
          <div
            ref={panelRef}
            className="fixed w-[280px] bg-n-800 border border-n-700 rounded-lg shadow-xl overflow-hidden z-[9999]"
            style={{ top: panelPos.top, left: Math.max(8, panelPos.left) }}
          >
            <div className="px-3 py-2 text-[10px] text-n-500 uppercase tracking-wider font-medium border-b border-n-700">
              Background Activity
            </div>
            <div className="py-1 max-h-60 overflow-y-auto">
              {activeTasks.map((task) => (
                <div key={task.id} className="px-3 py-2">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-[11px] text-n-200">{task.label}</span>
                    <span className="text-[10px] text-n-500 tabular-nums">
                      {task.current.toLocaleString()} / {task.total.toLocaleString()}
                    </span>
                  </div>
                  {task.message && (
                    <p className="text-[10px] text-n-500 mb-1 truncate">{task.message}</p>
                  )}
                  <div className="h-1 bg-n-700 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-accent/60 rounded-full transition-all duration-300"
                      style={{
                        width: `${task.total > 0 ? (task.current / task.total) * 100 : 0}%`,
                      }}
                    />
                  </div>
                </div>
              ))}

              {completedTasks.map((task) => (
                <div key={task.id} className="px-3 py-2 opacity-50">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-1.5">
                      <svg
                        width="10"
                        height="10"
                        viewBox="0 0 16 16"
                        fill="currentColor"
                        className="text-green-400 shrink-0"
                      >
                        <path d="M6 10.8L3.2 8l-1 1L6 12.8l8-8-1-1L6 10.8z" />
                      </svg>
                      <span className="text-[11px] text-n-300">{task.label}</span>
                    </div>
                    <span className="text-[10px] text-n-600">
                      {task.completedAt ? relTime(task.completedAt) : ""}
                    </span>
                  </div>
                </div>
              ))}

              {taskList.length === 0 && (
                <div className="px-3 py-3 text-[11px] text-n-500 text-center">
                  No activity
                </div>
              )}
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}
