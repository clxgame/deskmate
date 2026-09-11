import { expect, test } from "bun:test";
import { initialGifState, reduceGifState, gifDisplayState, gifNextDeadline, applyGifEvent, gifIdleEligible } from "./gifState";

const start = { type: "start", sessionId: "s", requestId: "r", eventId: "1" } as const;
test("escalates continuous thinking only at eight seconds", () => {
  // Given a current request waiting for a response.
  const state = reduceGifState(initialGifState, start, 100);
  // When the clock reaches the threshold.
  expect(gifDisplayState(state, 8099)).toBe("thinking");
  // Then it switches to working at exactly eight seconds.
  expect(gifDisplayState(state, 8100)).toBe("working");
});
test("ignores stale success and does not infer success from idle", () => {
  // Given a current request.
  const state = reduceGifState(initialGifState, start, 0);
  // When an old request completes.
  const next = reduceGifState(state, { ...start, type: "success", requestId: "old", eventId: "2" }, 50);
  // Then the current waiting state remains.
  expect(gifDisplayState(next, 50)).toBe("thinking");
  expect(gifDisplayState(reduceGifState(state, { ...start, type: "mood", mood: "idle", eventId: "3" }, 50), 50)).toBe("idle");
});
test("new request interrupts feedback and duplicate success does not replay", () => {
  // Given completed current work.
  const state = reduceGifState(reduceGifState(initialGifState, start, 0), { ...start, type: "success", eventId: "2" }, 20);
  // When another completion arrives for the same request.
  const duplicate = reduceGifState(state, { ...start, type: "success", eventId: "3" }, 500);
  // Then the original feedback deadline remains, and a new start supersedes it.
  expect(gifDisplayState(duplicate, 1420)).toBe("idle");
  expect(gifDisplayState(reduceGifState(state, { ...start, requestId: "next", eventId: "4" }, 50), 50)).toBe("thinking");
});
test("cancel and hidden completion never celebrate", () => {
  // Given a request and a hidden surface.
  const state = reduceGifState(initialGifState, start, 0);
  // When cancelled or completed while hidden.
  const cancelled = reduceGifState(state, { ...start, type: "cancel", eventId: "2" }, 50);
  const hidden = reduceGifState(state, { ...start, type: "success", eventId: "3" }, 50, false);
  // Then both display idle.
  expect(gifDisplayState(cancelled, 50)).toBe("idle");
  expect(gifDisplayState(hidden, 50)).toBe("idle");
});

test("replayed start and duplicate mood cannot resurrect an old request", () => {
  const first = reduceGifState(initialGifState, start, 0);
  const next = reduceGifState(first, { ...start, requestId: "next", eventId: "2" }, 1);
  const stale = reduceGifState(next, { ...start, eventId: "late-start" }, 2);
  expect(stale).toBe(next);
  const thinking = { ...start, requestId: "next", type: "mood", mood: "thinking", eventId: "3" } as const;
  const accepted = reduceGifState(next, thinking, 3);
  const talking = reduceGifState(accepted, { ...thinking, mood: "talking", eventId: "4" }, 4);
  expect(reduceGifState(talking, thinking, 5).base).toBe("talking");
});

test("error feedback lasts 1440ms and success cannot override a terminal error", () => {
  const state = reduceGifState(reduceGifState(initialGifState, start, 0), { ...start, type: "error", eventId: "2" }, 20);
  const late = reduceGifState(state, { ...start, type: "success", eventId: "3" }, 30);
  expect(gifDisplayState(late, 1459)).toBe("error");
  expect(gifDisplayState(late, 1460)).toBe("idle");
});

const randomPlayback = { successMs: 1400, errorMs: 1440, thinkingSelection: "random" } as const;
test("keeps selected thinking variant beyond eight seconds", () => {
  // Given a random-policy request with a selected variant.
  const state = reduceGifState(initialGifState, start, 100, true, randomPlayback);
  // When the original escalation deadline passes.
  // Then the same variant remains and no escalation is scheduled.
  expect(gifDisplayState(state, 9000, randomPlayback)).toBe("thinking");
  expect(gifNextDeadline(state, 100, randomPlayback)).toBeNull();
});
test("samples only accepted new thinking episodes", () => {
  // Given a deterministic sequence and a new request.
  let calls = 0;
  const random = () => (++calls === 1 ? 0.9 : 0.1);
  const first = applyGifEvent(initialGifState, start, 0, true, randomPlayback, random);
  // When duplicate, repeated, stale, working and returning-thinking events arrive.
  let state = applyGifEvent(first, start, 1, true, randomPlayback, random);
  state = applyGifEvent(state, { ...start, type: "mood", mood: "thinking", eventId: "2" }, 2, true, randomPlayback, random);
  state = applyGifEvent(state, { ...start, requestId: "old", type: "mood", mood: "thinking", eventId: "3" }, 3, true, randomPlayback, random);
  expect(calls).toBe(1);
  expect(gifDisplayState(state, 9000, randomPlayback)).toBe("working");
  state = applyGifEvent(state, { ...start, type: "mood", mood: "working", eventId: "4" }, 4, true, randomPlayback, random);
  expect(gifDisplayState(state, 4, randomPlayback)).toBe("working");
  state = applyGifEvent(state, { ...start, type: "mood", mood: "thinking", eventId: "5" }, 5, true, randomPlayback, random);
  // Then returning creates exactly one new selection.
  expect(calls).toBe(2);
  expect(gifDisplayState(state, 9000, randomPlayback)).toBe("thinking");
});


test.each([0.1, 0.499999, 0.5, 0.9])("selects the half-open 50/50 boundary for sample %s", (sample) => {
  // Given a fixed sample at either side of the selection boundary.
  // When a request starts.
  const state = applyGifEvent(initialGifState, start, 0, true, randomPlayback, () => sample);
  // Then display selection is stable even far beyond the v1 deadline.
  expect(gifDisplayState(state, 100000, randomPlayback)).toBe(sample < 0.5 ? "thinking" : "working");
});
test("terminal, duplicate-request and stale events never consume another sample", () => {
  // Given a cancelled random-policy request.
  let calls = 0;
  const random = () => { calls++; return 0.9; };
  const active = applyGifEvent(initialGifState, start, 0, true, randomPlayback, random);
  const cancelled = applyGifEvent(active, { ...start, type: "cancel", eventId: "2" }, 1, true, randomPlayback, random);
  // When terminal mood, replayed start, and stale completion arrive.
  let state = applyGifEvent(cancelled, { ...start, type: "mood", mood: "thinking", eventId: "3" }, 2, true, randomPlayback, random);
  state = applyGifEvent(state, { ...start, eventId: "4" }, 3, true, randomPlayback, random);
  state = applyGifEvent(state, { ...start, type: "success", requestId: "old", eventId: "5" }, 4, true, randomPlayback, random);
  // Then cancellation stays idle and no selection is consumed.
  expect(gifDisplayState(state, 4, randomPlayback)).toBe("idle");
  expect(calls).toBe(1);
});

test("idle visual during an active request is not sleep eligible", () => {
  // Given an active request whose visual mood became idle.
  const active = reduceGifState(initialGifState, start, 0);
  const idle = reduceGifState(active, { ...start, type: "mood", mood: "idle", eventId: "idle" }, 1);
  // When checking true lifecycle eligibility.
  // Then an idle animation does not imply completed work.
  expect(gifIdleEligible(idle, 90000)).toBe(false);
});
test("feedback must expire before becoming sleep eligible", () => {
  // Given completed work with success feedback.
  const active = reduceGifState(initialGifState, start, 0);
  const done = reduceGifState(active, { ...start, type: "success", eventId: "done" }, 10);
  // When the exact feedback deadline arrives.
  // Then eligibility begins only at that deadline.
  expect(gifIdleEligible(done, 1409)).toBe(false);
  expect(gifIdleEligible(done, 1410)).toBe(true);
});
