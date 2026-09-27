import { afterEach, describe, expect, mock, test } from "bun:test";
import * as tauriCore from "@tauri-apps/api/core";
import { userNameInstruction } from "./chatPersona";

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

const { composeSystemPrompt, memoryBlockForTurn, } = await import("./memoryActions");

afterEach(() => {
  invoke.mockReset();
  invoke.mockImplementation(() => Promise.resolve(undefined));
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

  test("a custom nickname follows memories and overrides the persona default", () => {
    const prompt = composeSystemPrompt({
      personaPrompt: "# 我对你的称呼\n称呼你为\"漂泊者\"。",
      memoryBlock: "# 关于用户的已确认信息\n- [identity] 叫我小林",
      userNameInstruction: userNameInstruction("指挥官"),
    });

    if (prompt === undefined) throw new Error("expected a system prompt");
    expect(prompt.indexOf("指挥官")).toBeGreaterThan(
      prompt.indexOf("叫我小林"),
    );
    expect(prompt).toContain("覆盖角色设定中的默认称呼");
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
