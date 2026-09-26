import { expect, test } from "bun:test";
import { completedUsageObservation } from "./localAiUsage";

test("records only completed assistant usage with cache tokens", () => {
  const info = {
    id: "msg-1", role: "assistant", providerID: "yume", modelID: "deepseek-flash",
    time: { created: 1780000000000, completed: 1780000001000 },
    tokens: { input: 2, output: 3, reasoning: 4, cache: { read: 5, write: 6 } },
  };
  expect(completedUsageObservation(info)).toEqual({
    messageId: "msg-1", sidecarId: "yume", modelId: "deepseek-flash",
    createdAtMs: 1780000000000, tokens: 20,
  });
  expect(completedUsageObservation({ ...info, role: "user" })).toBeNull();
  expect(completedUsageObservation({ ...info, time: { created: 1780000000000 } })).toBeNull();
});
