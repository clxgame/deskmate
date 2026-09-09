import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { acknowledgePetVisibility, getPetVisibility, onPetVisibility, registerPetVisibility } from "../lib/petVisibility";

export interface VisibilityClock {
  readonly schedule: (callback: () => void, delay: number) => number;
  readonly cancel: (token: number) => void;
}
const browserClock: VisibilityClock = {
  schedule: (callback, delay) => window.setTimeout(callback, delay),
  cancel: (token) => window.clearTimeout(token),
};

export function useGifVisibility(personaId: string, gif: boolean, duration: number, clock: VisibilityClock = browserClock) {
  const [departure, setDeparture] = useState({ personaId, leaving: false, visible: false });
  const durationRef = useRef(duration);
  durationRef.current = duration;
  useLayoutEffect(() => {
    setDeparture((current) => ({ ...current, personaId, leaving: false, visible: false }));
  }, [personaId, gif]);
  useEffect(() => {
    let disposed = false;
    let eventObserved = false;
    let timer: number | null = null;
    const report = (error: unknown) => console.error("pet visibility unavailable", error instanceof Error ? error.message : String(error));
    const unlisten = onPetVisibility((event) => {
      if (disposed) return;
      eventObserved = true;
      if (timer !== null) clock.cancel(timer);
      flushSync(() => setDeparture({ personaId, leaving: event.phase === "leaving", visible: event.phase === "reset" }));
      timer = clock.schedule(() => {
        timer = null;
        if (!disposed) void acknowledgePetVisibility(event.token).catch(report);
      }, event.phase === "leaving" && gif ? durationRef.current : 0);
    });
    void unlisten.then(async () => {
      if (disposed || personaId === "") return;
      await registerPetVisibility(personaId, gif);
      const visible = await getPetVisibility();
      if (!disposed && !eventObserved) setDeparture({ personaId, leaving: false, visible });
    }).catch(report);
    return () => {
      disposed = true;
      if (timer !== null) clock.cancel(timer);
      void unlisten.then((stop) => stop()).catch(report);
    };
  }, [personaId, gif, clock]);
  return { leaving: departure.personaId === personaId && departure.leaving, visible: departure.visible };
}
