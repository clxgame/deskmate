import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { onPetActivity } from "../lib/petState";
import { applyGifEvent, defaultGifTiming, gifDisplayState, gifNextDeadline, initialGifState, type GifPlayback } from "./gifState";

export function useGifState(
  visible: boolean, timing: GifPlayback = defaultGifTiming,
  identity = "default", random: () => number = Math.random,
) {
  const [state, setState] = useState(initialGifState);
  const [now, setNow] = useState(Date.now);
  const current = useRef(state);
  const inputs = useRef({ visible, timing, random });
  useLayoutEffect(() => {
    inputs.current = { visible, timing, random };
  }, [visible, timing, random]);
  const policyKey = JSON.stringify([identity, timing.successMs, timing.errorMs,
    "thinkingSelection" in timing ? "random" : timing.thinkingEscalationMs]);
  const previousKey = useRef(policyKey);
  useLayoutEffect(() => {
    if (previousKey.current === policyKey) return;
    previousKey.current = policyKey;
    const timestamp = Date.now();
    const active = current.current;
    const { timing: policy, random: sample } = inputs.current;
    current.current = { ...active, feedback: null,
      thinkingSince: active.base === "thinking" ? timestamp : null,
      thinkingVariant: active.base === "thinking" && "thinkingSelection" in policy && sample() >= 0.5 ? "working" : "thinking" };
    setState(current.current);
    setNow(timestamp);
  }, [policyKey]);
  useEffect(() => {
    let disposed = false;
    const unlisten = onPetActivity((event) => {
      if (disposed) return;
      const timestamp = Date.now();
      const input = inputs.current;
      current.current = applyGifEvent(current.current, event, timestamp, input.visible, input.timing, input.random);
      setNow(timestamp);
      setState(current.current);
    });
    return () => { disposed = true; void unlisten.then((stop) => stop()); };
  }, []);
  useLayoutEffect(() => {
    if (!visible) {
      current.current = { ...current.current, feedback: null };
      setState(current.current);
    }
  }, [visible]);
  useEffect(() => {
    const deadline = gifNextDeadline(state, Date.now(), timing);
    if (deadline === null) return;
    const timer = window.setTimeout(() => setNow(Date.now()), Math.max(0, deadline - Date.now()));
    return () => window.clearTimeout(timer);
  }, [state, timing, now]);
  return gifDisplayState(state, Math.max(now, Date.now()), timing);
}
