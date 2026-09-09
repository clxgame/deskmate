import { expect, test } from "bun:test";
import { createChatPetActivity } from "./petActivity";
import type { PetActivityEvent } from "../lib/petState";

function fixture() {
  const events: PetActivityEvent[] = [];
  const activity = createChatPetActivity((event) => events.push(event));
  activity.start({ sessionId: "session", requestId: "request" });
  return { activity, events };
}
const completed = { id: "assistant", sessionID: "session", parentID: "request", role: "assistant", time: { completed: 42 }, finish: "stop" };

test("emits success once when the current assistant really finishes", () => {
  const { activity, events } = fixture(); // Given
  activity.message(completed); activity.idle("session"); activity.message(completed); // When: duplicated delivery
  expect(events.map((event) => event.type)).toEqual(["start", "success"]); // Then
});

for (const change of [{ parentID: "old" }, { sessionID: "old" }, { finish: "tool-calls" }, { finish: "unknown" }, { finish: "length" }, { finish: "content-filter" }, { time: {} }, { error: { name: "failed" } }]) {
  test(`does not celebrate an unconfirmed completion ${JSON.stringify(change)}`, () => {
    const { activity, events } = fixture(); // Given
    activity.message({ ...completed, ...change }); // When
    expect(events.some((event) => event.type === "success")).toBe(false); // Then
  });
}
test("ignores completion after cancel", () => {
  const { activity, events } = fixture(); activity.cancel(); // Given
  activity.message(completed); // When
  expect(events.map((event) => event.type)).toEqual(["start", "cancel"]); // Then
});
test("ignores old completion after a new request", () => {
  const { activity, events } = fixture(); activity.start({ sessionId: "session", requestId: "next" }); // Given
  activity.message(completed); // When
  expect(events.some((event) => event.type === "success")).toBe(false); // Then
});

test("tool continuation stays working until terminal assistant stop", () => {
  const { activity, events } = fixture();
  activity.message({ ...completed, time: { created: 1 }, finish: undefined });
  activity.part({ sessionID: "session", messageID: "assistant", type: "tool" });
  activity.message({ ...completed, finish: "tool-calls" });
  expect(events.map((event) => event.type)).toEqual(["start", "mood"]);
  activity.message({ ...completed, id: "final" }); activity.idle("session");
  expect(events.map((event) => event.type)).toEqual(["start", "mood", "success"]);
});

test("stale parts cannot overwrite the current request mood", () => {
  const { activity, events } = fixture();
  activity.message({ ...completed, parentID: "old" });
  activity.part({ sessionID: "session", messageID: "assistant", type: "text" });
  expect(events.map((event) => event.type)).toEqual(["start"]);
});

test("provider stop on a tool-bearing message waits for the final response", () => {
  const { activity, events } = fixture();
  activity.message({ ...completed, time: { created: 1 }, finish: undefined });
  activity.part({ sessionID: "session", messageID: "assistant", type: "tool" });
  activity.message(completed);
  expect(events.some((event) => event.type === "success")).toBe(false);
  activity.message({ ...completed, id: "final" }); activity.idle("session");
  expect(events.filter((event) => event.type === "success")).toHaveLength(1);
});

test("provider-executed tool allows a terminal response", () => {
  const { activity, events } = fixture();
  activity.message({ ...completed, time: { created: 1 }, finish: undefined });
  activity.part({ sessionID: "session", messageID: "assistant", type: "tool", metadata: { providerExecuted: true } });
  activity.message(completed); activity.idle("session");
  expect(events.filter((event) => event.type === "success")).toHaveLength(1);
});

test("completed stop waits for idle confirmation", () => {
  const { activity, events } = fixture();
  activity.message(completed);
  expect(events.some((event) => event.type === "success")).toBe(false);
  activity.idle("session");
  expect(events.filter((event) => event.type === "success")).toHaveLength(1);
});

test("compaction continuation clears an earlier stop candidate", () => {
  const { activity, events } = fixture();
  activity.message(completed);
  activity.message({ ...completed, id: "summary", summary: true });
  activity.idle("session");
  expect(events.some((event) => event.type === "success")).toBe(false);
});

test("idle alone cannot celebrate a new request after a stale idle", () => {
  const { activity, events } = fixture();
  activity.idle("session");
  activity.start({ sessionId: "session", requestId: "next" });
  activity.message({ ...completed, parentID: "next" });
  expect(events.some((event) => event.type === "success")).toBe(false);
});

test("duplicate old completion cannot restore a cleared compaction candidate", () => {
  const { activity, events } = fixture();
  activity.message(completed);
  activity.message({ ...completed, id: "summary", summary: true });
  activity.message(completed);
  activity.idle("session");
  expect(events.some((event) => event.type === "success")).toBe(false);
});
