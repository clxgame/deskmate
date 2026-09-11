import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { sleepClock, type SleepClock } from "./petSleep";
import { onPetActivity } from "../lib/petState";
import { applyGifEvent, defaultGifTiming, gifDisplayState, gifIdleEligible, gifNextDeadline, initialGifState, type GifPlayback } from "./gifState";

export function usePetActivityState(
  visible: boolean, timing: GifPlayback = defaultGifTiming,
  identity = "default", random: () => number = Math.random, clock: SleepClock = sleepClock,
) {
  const [state, setState] = useState(initialGifState);
  const [now, setNow] = useState(clock.now);
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
    const timestamp = clock.now();
    const active = current.current;
    const { timing: policy, random: sample } = inputs.current;
    current.current = { ...active, feedback: null,
      thinkingSince: active.base === "thinking" ? timestamp : null,
      thinkingVariant: active.base === "thinking" && "thinkingSelection" in policy && sample() >= 0.5 ? "working" : "thinking" };
    setState(current.current);
    setNow(timestamp);
  }, [policyKey, clock]);
  useEffect(() => {
    let disposed = false;
    const unlisten = onPetActivity((event) => {
      if (disposed) return;
      const timestamp = clock.now();
      const input = inputs.current;
      current.current = applyGifEvent(current.current, event, timestamp, input.visible, input.timing, input.random);
      setNow(timestamp);
      setState(current.current);
    });
    return () => { disposed = true; void unlisten.then((stop) => stop()); };
  }, [clock]);
  useLayoutEffect(() => {
    if (!visible) {
      current.current = { ...current.current, feedback: null };
      setState(current.current);
    }
  }, [visible]);
  useEffect(() => {
    const deadline = gifNextDeadline(state, clock.now(), timing);
    if (deadline === null) return;
    const timer = clock.schedule(() => setNow(clock.now()), Math.max(0, deadline - clock.now()));
    return () => clock.cancel(timer);
  }, [state, timing, now, clock]);
  const timestamp = Math.max(now, clock.now());
  return { display: gifDisplayState(state, timestamp, timing), idle: gifIdleEligible(state, timestamp),
    activityKey: state.request === null ? "" : JSON.stringify([state.request.sessionId, state.request.requestId]) };
}

export function useGifState(
  visible: boolean, timing: GifPlayback = defaultGifTiming,
  identity = "default", random: () => number = Math.random, clock: SleepClock = sleepClock,
) {
  return usePetActivityState(visible, timing, identity, random, clock).display;
}
