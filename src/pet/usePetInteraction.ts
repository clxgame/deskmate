import { useCallback, useEffect, useRef, type MouseEvent, type RefObject } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { pointInPetContent } from "./gifGeometry";

const report = (error: unknown) => console.error("pet interaction failed", error instanceof Error ? error.message : String(error));
type InteractionSurface = { readonly gif: boolean; readonly active: boolean; readonly identity: string; readonly root: RefObject<HTMLDivElement | null> };
export function usePetInteraction(surface: InteractionSurface, setLocked: (locked: boolean) => void) {
  const downAt = useRef<{ readonly x: number; readonly y: number; readonly t: number } | null>(null);
  const holding = useRef(false);
  const epoch = useRef(0);
  const reset = useCallback(() => { epoch.current += 1; downAt.current = null; holding.current = false; setLocked(false); }, [setLocked]);
  useEffect(() => {
    reset();
    window.addEventListener("blur", reset);
    window.addEventListener("pointercancel", reset);
    const mouseup = () => { if (!holding.current) reset(); };
    window.addEventListener("mouseup", mouseup);
    const hidden = () => { if (document.hidden) reset(); };
    document.addEventListener("visibilitychange", hidden);
    return () => { reset(); window.removeEventListener("blur", reset); window.removeEventListener("pointercancel", reset); window.removeEventListener("mouseup", mouseup); document.removeEventListener("visibilitychange", hidden); };
  }, [reset, surface.active, surface.identity]);
  const hit = (event: MouseEvent) => !surface.gif || (surface.active && surface.root.current !== null && pointInPetContent(surface.root.current, event.clientX, event.clientY));
  const hold = () => { epoch.current += 1; holding.current = true; setLocked(true); const generation = epoch.current; return () => { if (generation === epoch.current) reset(); }; };
  return {
    hit, hold,
    onMouseDown: (event: MouseEvent) => {
      if (event.button !== 0 || !hit(event)) return;
      downAt.current = { x: event.screenX, y: event.screenY, t: Date.now() };
      setLocked(true);
    },
    onMouseMove: (event: MouseEvent) => {
      const start = downAt.current;
      if (start === null || Math.hypot(event.screenX - start.x, event.screenY - start.y) <= 4) return;
      downAt.current = null;
      const release = hold();
      const generation = epoch.current;
      void (async () => {
        await getCurrentWindow().startDragging();
        while (generation === epoch.current) {
          const pressed = await invoke<boolean>("pet_primary_button_down");
          if (!pressed || generation !== epoch.current) return;
          await new Promise<void>((resolve) => window.setTimeout(resolve, 40));
        }
      })().catch(report).finally(release);
    },
    onMouseUp: (event: MouseEvent) => {
      if (holding.current) return;
      const start = downAt.current;
      reset();
      if (event.button === 0 && start !== null && Date.now() - start.t < 400 && hit(event)) void invoke("toggle_chat").catch(report);
    },
  };
}
