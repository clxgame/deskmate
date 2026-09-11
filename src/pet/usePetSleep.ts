import { useLayoutEffect, useMemo, useSyncExternalStore } from "react";
import { createPetSleep, sleepClock, type SleepClock, type SleepInputs } from "./petSleep";

export function usePetSleep(inputs: SleepInputs, clock: SleepClock = sleepClock) {
  const controller = useMemo(() => createPetSleep(clock), [clock]);
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot);
  const { visible, ready, idle, identity, activityKey } = inputs;
  useLayoutEffect(() => {
    controller.update({ visible, ready, idle, identity, activityKey });
    return controller.dispose;
  }, [controller, visible, ready, idle, identity, activityKey]);
  return { state, interact: controller.interact, setHeld: controller.setHeld };
}
