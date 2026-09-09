import { useEffect, type RefObject } from "react";
import { cursorPosition, getCurrentWindow } from "@tauri-apps/api/window";

export function pointInPetContent(root: HTMLElement, x: number, y: number): boolean {
  return [...root.querySelectorAll(".gif-pet-image, .pet-pomodoro, .pet-load-error")].some((element) => {
    const rect = element.getBoundingClientRect();
    return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
  });
}
export function useGifPassthrough(enabled: boolean, root: RefObject<HTMLDivElement | null>) {
  useEffect(() => {
    if (!enabled) return;
    const petWindow = getCurrentWindow();
    let disposed = false;
    let busy = false;
    let ignored = false;
    const report = (error: unknown) => console.error("pet mouse passthrough unavailable", error instanceof Error ? error.message : String(error));
    const poll = () => {
      if (disposed || busy || root.current === null) return;
      busy = true;
      void Promise.all([cursorPosition(), petWindow.outerPosition(), petWindow.scaleFactor()]).then(async ([cursor, origin, ratio]) => {
        if (disposed || root.current === null) return;
        const next = !pointInPetContent(root.current, (cursor.x - origin.x) / ratio, (cursor.y - origin.y) / ratio);
        if (next !== ignored) { await petWindow.setIgnoreCursorEvents(next); ignored = next; }
        if (disposed) await petWindow.setIgnoreCursorEvents(false);
      }).catch(report).finally(() => { busy = false; });
    };
    poll();
    const timer = window.setInterval(poll, 40);
    return () => { disposed = true; window.clearInterval(timer); void petWindow.setIgnoreCursorEvents(false).catch(report); };
  }, [enabled, root]);
}
