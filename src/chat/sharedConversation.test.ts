import { expect, test } from "bun:test";
import { validateSharedConversation, type ConversationAccess } from "./sharedConversation";

const light: ConversationAccess = {
  key: "native:one:a:ses-same",
  identity: { kind: "native", sidecarId: "one", directory: "C:/project-a", sessionId: "ses-same" },
  capabilities: { send: true, readOnlyReason: null },
};

test("a native handoff preserves directory and native session identity", () => {
  expect(validateSharedConversation(light, { ...light })?.sessionId).toBe("ses-same");
  expect(validateSharedConversation(light, { ...light })?.directory).toBe("C:/project-a");
});

test("colliding bare IDs from another project cannot receive a send", () => {
  expect(validateSharedConversation(light, {
    ...light, identity: { ...light.identity, kind: "native", sidecarId: "one", directory: "C:/project-b", sessionId: "ses-same" },
  })).toBeNull();
});

test("fresh host capabilities deny workbench, active, unavailable and legacy writes", () => {
  for (const reason of ["workbench_owned", "agent_active", "unavailable", "archived"]) {
    expect(validateSharedConversation(light, { ...light, capabilities: { send: false, readOnlyReason: reason } })).toBeNull();
  }
  const legacy: ConversationAccess = { ...light, identity: { kind: "legacy", historyId: "old" } };
  expect(validateSharedConversation(legacy, legacy)).toBeNull();
});

test("switching catalog key prevents stale authorization from resuming the old view", () => {
  expect(validateSharedConversation({ ...light, key: "native:other" }, light)).toBeNull();
});
