import { useEffect, useRef, useState } from "react";
import { onPetActivity } from "../lib/petState";
import { defaultGifTiming, gifDisplayState, gifNextDeadline, initialGifState, reduceGifState, type GifTiming } from "./gifState";

export function useGifState(visible: boolean, timing: GifTiming = defaultGifTiming) {
  const [state, setState] = useState(initialGifState);
  const [now, setNow] = useState(Date.now);
  const visibleRef = useRef(visible);
  const timingRef = useRef(timing);
  visibleRef.current = visible;
  timingRef.current = timing;
  useEffect(() => {
    let disposed = false;
    const unlisten = onPetActivity((event) => {
      if (disposed) return;
      const timestamp = Date.now();
      setNow(timestamp);
      setState((current) => reduceGifState(current, event, timestamp, visibleRef.current, timingRef.current));
    });
    return () => { disposed = true; void unlisten.then((stop) => stop()); };
  }, []);
  useEffect(() => {
    if (!visible) setState((current) => ({ ...current, feedback: null }));
  }, [visible]);
  useEffect(() => {
    const deadline = gifNextDeadline(state, Date.now(), timing);
    if (deadline === null) return;
    const timer = window.setTimeout(() => setNow(Date.now()), Math.max(0, deadline - Date.now()));
    return () => window.clearTimeout(timer);
  }, [state, timing, now]);
  return gifDisplayState(state, Math.max(now, Date.now()), timing);
}
