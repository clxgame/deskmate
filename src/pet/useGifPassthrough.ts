import { useCallback, useEffect, useRef, type RefObject } from "react";
import { cursorPosition, getCurrentWindow } from "@tauri-apps/api/window";
import { pointInPetContent } from "./gifGeometry";
export { pointInPetContent } from "./gifGeometry";

const report = (error: unknown) => console.error("pet mouse passthrough unavailable", error instanceof Error ? error.message : String(error));

export function createCursorWriter(write: (ignored: boolean) => Promise<void>) {
  let desired = false;
  let applied = false;
  let running = false;
  const flush = async () => {
    if (running) return;
    running = true;
    try {
      while (applied !== desired) {
        const value = desired;
        await write(value);
        applied = value;
      }
    } finally { running = false; }
  };
  return (value: boolean) => { desired = value; void flush().catch(report); };
}

export function useGifPassthrough(enabled: boolean, root: RefObject<HTMLDivElement | null>) {
  const version = useRef(0);
  const locked = useRef(false);
  const writer = useRef<ReturnType<typeof createCursorWriter> | null>(null);
  const setLocked = useCallback((value: boolean) => {
    locked.current = value;
    version.current += 1;
    if (value) writer.current?.(false);
  }, []);
  useEffect(() => {
    const petWindow = getCurrentWindow();
    writer.current ??= createCursorWriter((value) => petWindow.setIgnoreCursorEvents(value));
    const setIgnored = writer.current;
    version.current += 1;
    if (!enabled) { setIgnored(false); return; }
    let disposed = false;
    let busy = false;
    const poll = async () => {
      if (disposed || busy || root.current === null) return;
      if (locked.current) { setIgnored(false); return; }
      busy = true;
      const generation = version.current;
      const current = () => !disposed && generation === version.current && !locked.current;
      try {
        const cursor = await cursorPosition();
        if (!current()) return;
        const origin = await petWindow.outerPosition();
        if (!current()) return;
        const ratio = await petWindow.scaleFactor();
        if (!current() || root.current === null) return;
        setIgnored(!pointInPetContent(root.current, (cursor.x - origin.x) / ratio, (cursor.y - origin.y) / ratio));
      } catch (error: unknown) { report(error); } // no-excuse-ok: catch -- native polling boundary reports failures and retries next tick
      finally { busy = false; }
    };
    void poll();
    const timer = window.setInterval(() => { void poll(); }, 40);
    return () => { disposed = true; version.current += 1; window.clearInterval(timer); setIgnored(false); };
  }, [enabled, root]);
  return setLocked;
}
