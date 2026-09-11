import { useEffect, useRef, type RefObject } from "react";
import { cursorPosition, getCurrentWindow } from "@tauri-apps/api/window";
import type { PetMood } from "../lib/petState";
import type { Settings } from "../lib/settings";
import { PetRenderer } from "./PetRenderer";

interface GlbPetViewProps {
  readonly mood: PetMood;
  readonly settings: Settings;
  readonly width: number;
  readonly height: number;
  readonly rendererRef: RefObject<PetRenderer | null>;
  readonly onReady?: (ready: boolean) => void;
  readonly onError: (message: string | null) => void;
}

export function GlbPetView({ settings, mood, width, height, rendererRef, onError, onReady }: GlbPetViewProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas === null) return;
    let renderer: PetRenderer;
    try { renderer = new PetRenderer(canvas); }
    catch (error: unknown) { onError(error instanceof Error ? error.message : String(error)); return; }
    rendererRef.current = renderer;
    return () => {
      rendererRef.current = null;
      renderer.dispose();
    };
  }, [rendererRef, onError]);
  useEffect(() => { rendererRef.current?.setMood(mood); }, [mood, rendererRef]);
  useEffect(() => {
    const renderer = rendererRef.current;
    if (renderer === null) return;
    let disposed = false;
    onError(null);
    onReady?.(false);
    void renderer.load(settings.personaId).then(() => { if (!disposed) onReady?.(true); }).catch((error: unknown) => {
      if (!disposed) onError(error instanceof Error ? error.message : String(error));
    });
    return () => { disposed = true; };
  }, [settings.personaId, rendererRef, onError, onReady]);
  useEffect(() => {
    rendererRef.current?.setRenderTuning(settings);
    rendererRef.current?.setMouseFollowEnabled(settings.mouseFollow);
  }, [settings, rendererRef]);
  useEffect(() => {
    const renderer = rendererRef.current;
    const canvas = canvasRef.current;
    if (!settings.mouseFollow || renderer === null || canvas === null) return;
    const petWindow = getCurrentWindow();
    let disposed = false;
    let busy = false;
    let geometry: { readonly x: number; readonly y: number; readonly ratio: number } | null = null;
    const refresh = () => {
      void Promise.all([petWindow.outerPosition(), petWindow.scaleFactor()]).then(([position, ratio]) => {
        if (!disposed) geometry = { x: position.x, y: position.y, ratio };
      }).catch((error: unknown) => console.error("pet geometry unavailable", error instanceof Error ? error.message : String(error)));
    };
    refresh();
    const moved = petWindow.onMoved(refresh);
    const resized = petWindow.onResized(refresh);
    const interval = window.setInterval(() => {
      if (busy || geometry === null) return;
      const bounds = canvas.getBoundingClientRect();
      const origin = geometry;
      busy = true;
      void cursorPosition().then((cursor) => {
        if (!disposed) renderer.setMouseTarget({
          x: ((cursor.x - origin.x) / origin.ratio - bounds.left - bounds.width / 2) / Math.max(bounds.width / 2, 1),
          y: ((cursor.y - origin.y) / origin.ratio - bounds.top - bounds.height / 2) / Math.max(bounds.height / 2, 1),
        });
      }).catch((error: unknown) => console.error("pet cursor unavailable", error instanceof Error ? error.message : String(error)))
        .finally(() => { busy = false; });
    }, 40);
    return () => { disposed = true; window.clearInterval(interval); void moved.then((stop) => stop()); void resized.then((stop) => stop()); };
  }, [settings.mouseFollow, rendererRef]);
  return <canvas ref={canvasRef} aria-label="3D desktop pet" style={{ width, height, display: "block" }} />;
}
