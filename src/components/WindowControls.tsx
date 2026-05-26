import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useThemeStore } from "../stores/themeStore";

export function WindowControls() {
  const [hovered, setHovered] = useState(false);
  const toggleMiniPlayer = useThemeStore((s) => s.toggleMiniPlayer);

  const btn = (color: string, icon: React.ReactNode, action: () => void) => (
    <div
      className="w-[13px] h-[13px] rounded-full flex items-center justify-center relative"
      style={{ background: hovered ? color : "rgba(255,255,255,0.12)" }}
    >
      {hovered && icon}
      {/* <a> tags are excluded from Tauri's drag region, so clicks pass through */}
      <a
        href="#"
        className="absolute inset-[-4px] block"
        onClick={(e) => { e.preventDefault(); e.stopPropagation(); action(); }}
        draggable={false}
      />
    </div>
  );

  return (
    <div
      className="flex items-center gap-[6px] relative z-[99999]"
      style={{ paddingLeft: 13, paddingTop: 13 }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {btn("#ff5f57", (
        <svg width="7" height="7" viewBox="0 0 10 10" stroke="rgba(0,0,0,0.5)" strokeWidth="1.2" strokeLinecap="round">
          <path d="M2.5 2.5l5 5M7.5 2.5l-5 5" />
        </svg>
      ), () => invoke("quit_app"))}

      {btn("#febc2e", (
        <svg width="7" height="2" viewBox="0 0 8 2">
          <path d="M1 1h6" stroke="rgba(0,0,0,0.5)" strokeWidth="1.2" strokeLinecap="round" />
        </svg>
      ), () => toggleMiniPlayer())}

      {btn("#28c840", (
        <svg width="7" height="7" viewBox="0 0 10 10" stroke="rgba(0,0,0,0.5)" strokeWidth="1.2" strokeLinecap="round">
          <path d="M2 5L5 2l3 3M8 5L5 8l-3-3" />
        </svg>
      ), () => window.dispatchEvent(new CustomEvent("untune-toggle-visualizer")))}
    </div>
  );
}
