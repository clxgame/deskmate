import { expect, test } from "bun:test";
import { initialGifState, reduceGifState, gifDisplayState } from "./gifState";

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
