import { expect, test } from "bun:test";
import { createPetSleep } from "./petSleep";
import { manualClock } from "./petSleepTestClock";

const ready = { visible: true, ready: true, idle: true, identity: "a", activityKey: "" };
test("sleeps exactly at 60000ms and remains asleep without repeated timers", () => {
  // Given a ready visible idle pet.
  const time = manualClock(); const pet = createPetSleep(time.clock); pet.update(ready);
  // When the boundary is crossed.
  time.advance(59999); expect(pet.getSnapshot()).toBe("awake"); time.advance(1);
  // Then it sleeps with no polling timer.
  expect(pet.getSnapshot()).toBe("sleep"); expect(time.pending()).toBe(0); time.advance(120000); expect(pet.getSnapshot()).toBe("sleep");
});
test("interaction at second 59 starts a new full idle interval", () => {
  // Given nearly expired idle time.
  const time = manualClock(); const pet = createPetSleep(time.clock); pet.update(ready); time.advance(59000);
  // When a genuine activation occurs.
  pet.interact(); time.advance(59999);
  // Then the previous deadline cannot put it to sleep.
  expect(pet.getSnapshot()).toBe("awake"); time.advance(1); expect(pet.getSnapshot()).toBe("sleep");
});
for (const input of [{ idle: false }, { visible: false }, { ready: false }]) test(`suspends and restarts after ${JSON.stringify(input)}`, () => {
  // Given a nearly sleeping pet.
  const time = manualClock(); const pet = createPetSleep(time.clock); pet.update(ready); time.advance(59000);
  // When availability is suspended and restored.
  pet.update({ ...ready, ...input }); time.advance(90000); expect(pet.getSnapshot()).toBe("awake"); pet.update(ready); time.advance(59999);
  // Then a full new interval is required.
  expect(pet.getSnapshot()).toBe("awake"); time.advance(1); expect(pet.getSnapshot()).toBe("sleep");
});
test("held drag wakes immediately and never accrues idle time", () => {
  // Given a sleeping pet.
  const time = manualClock(); const pet = createPetSleep(time.clock); pet.update(ready); time.advance(60000);
  // When the body is held through a long drag.
  pet.setHeld(true); time.advance(180000);
  // Then release starts the next interval.
  expect(pet.getSnapshot()).toBe("awake"); expect(time.pending()).toBe(0); pet.setHeld(false); time.advance(60000); expect(pet.getSnapshot()).toBe("sleep");
});
for (const input of [{ identity: "b" }, { activityKey: "new-request" }]) test(`wakes on ${JSON.stringify(input)}`, () => {
  // Given a sleeping pet.
  const time = manualClock(); const pet = createPetSleep(time.clock); pet.update(ready); time.advance(60000);
  // When its identity or accepted request changes.
  pet.update({ ...ready, ...input });
  // Then it begins awake again.
  expect(pet.getSnapshot()).toBe("awake"); time.advance(60000); expect(pet.getSnapshot()).toBe("sleep");
});
test("dispose cancels the deadline", () => {
  // Given a scheduled sleep.
  const time = manualClock(); const pet = createPetSleep(time.clock); pet.update(ready);
  // When disposed.
  pet.dispose(); time.advance(90000);
  // Then no transition remains scheduled.
  expect(time.pending()).toBe(0); expect(pet.getSnapshot()).toBe("awake");
});


test("wall clock changes cannot advance a monotonic idle deadline", () => {
  // Given a monotonic clock independent of calendar time.
  const time = manualClock(); const pet = createPetSleep(time.clock); pet.update(ready);
  const original = Date.now;
  try {
    // When the system calendar jumps a day in either direction.
    Date.now = () => original() + 86400000; time.advance(30000);
    Date.now = () => original() - 86400000; time.advance(29999);
    // Then only the injected monotonic minute controls sleep.
    expect(pet.getSnapshot()).toBe("awake"); time.advance(1); expect(pet.getSnapshot()).toBe("sleep");
  } finally { Date.now = original; }
});
