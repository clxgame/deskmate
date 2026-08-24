import { afterEach, describe, expect, mock, test } from "bun:test";
import * as tauriCore from "@tauri-apps/api/core";

/**
 * Chat memory-action tests. Tauri `invoke` is mocked at the module boundary so
 * these run without a backend, exactly like the existing chat tests.
 */

const invoke = mock<(command: string, args?: unknown) => Promise<unknown>>(
  () => Promise.resolve(undefined),
);

// Keep the module's other exports (convertFileSrc, ...) so replacing invoke
// does not hide them from modules loaded later in the same process.
mock.module("@tauri-apps/api/core", () => ({ ...tauriCore, invoke }));
mock.module("@tauri-apps/api/event", () => ({
  listen: () => Promise.resolve(() => {}),
  emit: () => Promise.resolve(),
}));

const {
  composeSystemPrompt,
  draftFromMessage,
  editMemory,
  forgetMemory,
  memoryBlockForTurn,
  saveMemory,
  stableKeyFor,
} = await import("./memoryActions");

afterEach(() => {
  invoke.mockReset();
  invoke.mockImplementation(() => Promise.resolve(undefined));
});

function storedMemory(overrides: Record<string, unknown> = {}) {
  return {
    id: "m1",
    scope: "global",
    personaId: null,
    type: "identity",
    memoryKey: "identity.preferred_name",
    content: "叫我小林",
    status: "active",
    confidence: 1,
    importance: 3,
    sensitivity: "normal",
    sourceKind: "explicit",
    validFrom: "2026-01-01T00:00:00Z",
    expiresAt: null,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    revision: 1,
    supersedesId: null,
    ...overrides,
  };
}

describe("classifying what the user asked to remember", () => {
  test("a name request becomes a global identity fact with a stable key", () => {
    const draft = draftFromMessage({
      text: "以后叫我小林",
      personaId: "aimisi",
      conversationId: "ses_1",
      messageId: "msg_1",
    });
    expect(draft.type).toBe("identity");
    expect(draft.scope).toBe("global");
    expect(draft.personaId).toBeNull();
    expect(stableKeyFor(draft)).toBe("identity.preferred_name");
  });

  test("a limit becomes a boundary, and a liking becomes a preference", () => {
    const boundary = draftFromMessage({
      text: "不要反复催我",
      personaId: "aimisi",
      conversationId: null,
      messageId: null,
    });
    expect(boundary.type).toBe("boundary");
    expect(stableKeyFor(boundary)).toStartWith("boundary.");

    const preference = draftFromMessage({
      text: "我讨厌甜食",
      personaId: "aimisi",
      conversationId: null,
      messageId: null,
    });
    expect(preference.type).toBe("preference");
    expect(stableKeyFor(preference)).toStartWith("preference.");
  });

  test("a shared moment stays scoped to the current persona", () => {
    const draft = draftFromMessage({
      text: "今天我们一起看了流星雨",
      personaId: "aimisi",
      conversationId: null,
      messageId: null,
    });
    expect(draft.type).toBe("shared_moment");
    expect(draft.scope).toBe("persona");
    expect(draft.personaId).toBe("aimisi");
  });

  test("a dated thing appends instead of overwriting", () => {
    const draft = draftFromMessage({
      text: "周五下午三点答辩",
      personaId: "aimisi",
      conversationId: null,
      messageId: null,
    });
    expect(draft.type).toBe("event");
    expect(stableKeyFor(draft)).toBeNull();
  });

  test("the same stable fact reuses its key so the new value supersedes", () => {
    const first = draftFromMessage({
      text: "我讨厌甜食",
      personaId: "aimisi",
      conversationId: null,
      messageId: null,
    });
    const again = draftFromMessage({
      text: "我讨厌甜食",
      personaId: "aimisi",
      conversationId: null,
      messageId: null,
    });
    expect(stableKeyFor(first)).toBe(stableKeyFor(again));
  });
});

describe("saving, editing, and forgetting", () => {
  test("an explicit save sends provenance and yields an undoable receipt", async () => {
    invoke.mockImplementation(() => Promise.resolve(storedMemory()));
    const draft = draftFromMessage({
      text: "以后叫我小林",
      personaId: "aimisi",
      conversationId: "ses_1",
      messageId: "msg_1",
    });

    const result = await saveMemory(draft);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect(result.value).toEqual({
      kind: "saved",
      memoryId: "m1",
      content: "叫我小林",
      undoable: true,
    });

    const [command, args] = invoke.mock.calls[0] as [string, { memory: Record<string, unknown> }];
    expect(command).toBe("memory_create");
    expect(args.memory.conversationId).toBe("ses_1");
    expect(args.memory.messageId).toBe("msg_1");
    expect(args.memory.sourceKind).toBe("explicit");
    expect(args.memory.sensitiveConfirmed).toBe(false);
  });

  test("sensitive content asks for confirmation, then saves once confirmed", async () => {
    invoke.mockImplementation(() =>
      Promise.reject({
        code: "SENSITIVE_CONFIRMATION_REQUIRED",
        message: "sensitive content needs explicit confirmation",
      }),
    );
    const draft = draftFromMessage({
      text: "我讨厌讨论月薪两万三这件事",
      personaId: "aimisi",
      conversationId: null,
      messageId: null,
    });
    const blocked = await saveMemory(draft);
    expect(blocked.ok).toBe(false);
    if (blocked.ok) throw new Error("unreachable");
    expect(blocked.failure.kind).toBe("sensitive-confirmation");

    invoke.mockImplementation(() =>
      Promise.resolve(storedMemory({ sensitivity: "sensitive" })),
    );
    const confirmed = await saveMemory(draft, { sensitiveConfirmed: true });
    expect(confirmed.ok).toBe(true);
    const [, args] = invoke.mock.calls.at(-1) as [
      string,
      { memory: Record<string, unknown> },
    ];
    expect(args.memory.sensitiveConfirmed).toBe(true);
  });

  test("a secret is refused without echoing it back", async () => {
    invoke.mockImplementation(() =>
      Promise.reject({
        code: "SECRET_REJECTED",
        message: "credential-like content is never stored",
      }),
    );
    const draft = draftFromMessage({
      text: "记住我的密码是 hunter2",
      personaId: "aimisi",
      conversationId: null,
      messageId: null,
    });
    const result = await saveMemory(draft);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.failure).toEqual({ kind: "secret-rejected" });
    expect(JSON.stringify(result.failure)).not.toContain("hunter2");
  });

  test("an edit passes the expected revision and surfaces a conflict", async () => {
    invoke.mockImplementation(() =>
      Promise.resolve(storedMemory({ content: "叫我林同学", revision: 2 })),
    );
    const updated = await editMemory({
      id: "m1",
      content: "叫我林同学",
      expectedRevision: 1,
    });
    expect(updated.ok).toBe(true);
    const [, args] = invoke.mock.calls[0] as [
      string,
      { update: Record<string, unknown> },
    ];
    expect(args.update.expectedRevision).toBe(1);

    invoke.mockImplementation(() =>
      Promise.reject({ code: "CONFLICT", message: "memory changed in another window" }),
    );
    const stale = await editMemory({
      id: "m1",
      content: "覆盖",
      expectedRevision: 1,
    });
    expect(stale.ok).toBe(false);
    if (stale.ok) throw new Error("unreachable");
    expect(stale.failure).toEqual({ kind: "conflict", memoryId: "m1" });
  });

  test("undo forgets the memory that was just saved", async () => {
    invoke.mockImplementation(() => Promise.resolve(undefined));
    const result = await forgetMemory("m1");
    expect(result.ok).toBe(true);
    expect(invoke.mock.calls[0]).toEqual(["memory_forget", { id: "m1" }]);
  });

  test("a disabled memory store reports a recoverable state", async () => {
    invoke.mockImplementation(() =>
      Promise.reject({ code: "MEMORY_DISABLED", message: "memory storage is unavailable" }),
    );
    const result = await forgetMemory("m1");
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.failure).toEqual({ kind: "disabled" });
  });
});

describe("prompt assembly", () => {
  test("the memory block always follows the persona instructions", () => {
    const prompt = composeSystemPrompt({
      personaPrompt: "# 角色\n你是爱弥斯。",
      memoryBlock: "# 关于用户的已确认信息\n<user-memory>\n- [identity] 叫我小林\n</user-memory>",
    });
    expect(prompt).not.toBeUndefined();
    const personaIndex = prompt!.indexOf("你是爱弥斯");
    const memoryIndex = prompt!.indexOf("<user-memory>");
    expect(personaIndex).toBeGreaterThanOrEqual(0);
    expect(memoryIndex).toBeGreaterThan(personaIndex);
  });

  test("no persona and no memory means no system prompt at all", () => {
    expect(
      composeSystemPrompt({ personaPrompt: undefined, memoryBlock: "" }),
    ).toBeUndefined();
    expect(
      composeSystemPrompt({ personaPrompt: "  ", memoryBlock: "  " }),
    ).toBeUndefined();
  });

  test("a persona without memories is passed through unchanged", () => {
    expect(
      composeSystemPrompt({ personaPrompt: "角色设定", memoryBlock: "" }),
    ).toBe("角色设定");
  });

  test("disabling AI use skips the retrieval call entirely", async () => {
    const block = await memoryBlockForTurn({
      personaId: "aimisi",
      userText: "你好",
      enabled: false,
    });
    expect(block).toBe("");
    expect(invoke).not.toHaveBeenCalled();
  });

  test("retrieval is requested for the current persona when enabled", async () => {
    invoke.mockImplementation(() =>
      Promise.resolve({
        memories: [
          { id: "m1", type: "identity", scope: "global", content: "叫我小林", importance: 5 },
        ],
        promptBlock: "block",
      }),
    );
    const block = await memoryBlockForTurn({
      personaId: "aimisi",
      userText: "你好",
      enabled: true,
    });
    expect(block).toBe("block");
    expect(invoke.mock.calls[0]).toEqual([
      "memory_context",
      { personaId: "aimisi", userText: "你好", enabled: true },
    ]);
  });

  test("a retrieval failure degrades to no memory instead of blocking the turn", async () => {
    invoke.mockImplementation(() =>
      Promise.reject({ code: "STORAGE_UNAVAILABLE", message: "database is locked" }),
    );
    const block = await memoryBlockForTurn({
      personaId: "aimisi",
      userText: "你好",
      enabled: true,
    });
    expect(block).toBe("");
  });
});
