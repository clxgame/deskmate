import type { SleepClock } from "./petSleep";
export function manualClock() {
  let now = 0;
  let token = 0;
  const tasks = new Map<number, { at: number; callback: () => void }>();
  const clock: SleepClock = { now: () => now, schedule: (callback, delay) => { const id = ++token; tasks.set(id, { at: now + delay, callback }); return id; }, cancel: (id) => { tasks.delete(id); } };
  return { clock, pending: () => tasks.size, advance: (duration: number) => { const end = now + duration; for (;;) { const next = [...tasks].sort((a, b) => a[1].at - b[1].at)[0]; if (!next || next[1].at > end) break; now = next[1].at; tasks.delete(next[0]); next[1].callback(); } now = end; } };
}
