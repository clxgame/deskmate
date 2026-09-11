export type PetSleepState = "awake" | "sleep";
export interface SleepClock {
  readonly now: () => number;
  readonly schedule: (callback: () => void, delay: number) => number;
  readonly cancel: (token: number) => void;
}
export interface SleepInputs {
  readonly visible: boolean;
  readonly ready: boolean;
  readonly idle: boolean;
  readonly identity: string;
  readonly activityKey: string;
}
export const sleepClock: SleepClock = {
  now: () => performance.now(),
  schedule: (callback, delay) => window.setTimeout(callback, delay),
  cancel: (token) => window.clearTimeout(token),
};

export function createPetSleep(clock: SleepClock = sleepClock) {
  let state: PetSleepState = "awake";
  let inputs: SleepInputs | null = null;
  let held = false;
  let idleSince: number | null = null;
  let timer: number | null = null;
  const listeners = new Set<() => void>();
  const cancel = () => { if (timer !== null) clock.cancel(timer); timer = null; };
  const publish = (next: PetSleepState) => { if (state === next) return; state = next; for (const listener of listeners) listener(); };
  const reset = () => { idleSince = null; publish("awake"); };
  const reconcile = () => {
    cancel();
    if (!inputs?.visible || !inputs.ready || !inputs.idle || held) { reset(); return; }
    if (state === "sleep") return;
    const now = clock.now();
    idleSince ??= now;
    const remaining = idleSince + 60000 - now;
    if (remaining <= 0) { publish("sleep"); return; }
    timer = clock.schedule(reconcile, remaining);
  };
  return {
    getSnapshot: () => state,
    subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    update: (next: SleepInputs) => {
      if (inputs?.identity !== next.identity || inputs.activityKey !== next.activityKey) reset();
      inputs = next;
      reconcile();
    },
    interact: () => { reset(); reconcile(); },
    setHeld: (next: boolean) => { if (held === next) return; held = next; reset(); reconcile(); },
    dispose: cancel,
  };
}
