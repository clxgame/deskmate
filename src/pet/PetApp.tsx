import { useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { PetRenderer } from "./PetRenderer";
import { onMood } from "../lib/petState";

const MODEL_URL = "/models/pet.vrm";

/** Anchoring + show/hide is done in Rust (`toggle_chat`) because IPC into a
 * hidden WebView2 window is unreliable on Windows. */
function toggleChat(): Promise<boolean> {
  return invoke<boolean>("toggle_chat");
}

export default function PetApp() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const renderer = new PetRenderer(canvas);
    // Pet size is handled natively (window resize); canvas just fills it.
    renderer.load(MODEL_URL).catch((e) => console.error("VRM load failed:", e));
    const unlistenMood = onMood((mood) => renderer.setMood(mood));
    return () => {
      void unlistenMood.then((fn) => fn());
      renderer.dispose();
    };
  }, []);

  // Drag = move window; quick click (no movement) = toggle chat.
  const downAt = useRef<{ x: number; y: number; t: number } | null>(null);

  const onMouseDown = (e: React.MouseEvent) => {
    if (e.button !== 0) return;
    downAt.current = { x: e.screenX, y: e.screenY, t: Date.now() };
  };

  const onMouseMove = (e: React.MouseEvent) => {
    const d = downAt.current;
    if (!d) return;
    const moved = Math.hypot(e.screenX - d.x, e.screenY - d.y);
    if (moved > 4) {
      downAt.current = null;
      void getCurrentWindow().startDragging();
    }
  };

  const onMouseUp = () => {
    if (downAt.current && Date.now() - downAt.current.t < 400) {
      void toggleChat();
    }
    downAt.current = null;
  };

  return (
    <canvas
      ref={canvasRef}
      style={{ width: "100vw", height: "100vh", cursor: "grab" }}
      onMouseDown={onMouseDown}
      onMouseMove={onMouseMove}
      onMouseUp={onMouseUp}
    />
  );
}
