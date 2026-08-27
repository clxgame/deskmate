import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  assistantMessage,
  cleanupChatHarness,
  completedTool,
  containsCcSwitchApiKey,
  invoke,
  receiveAppEvent,
  receiveChatEvent,
  renderChat,
  resetChatHarness,
  setSnapshotMessages,
  wasPromptSent,
  wasSessionMessageFetched,
} from "./ccSwitchSetupChatHarness.test";

beforeEach(resetChatHarness);
afterEach(cleanupChatHarness);

describe("CC Switch setup tool handling in chat", () => {
  test("blocks likely API keys before chat history or transport and opens the secure card", async () => {
    await renderChat();
    const user = userEvent.setup();
    const canary = `sk-${crypto.randomUUID().replaceAll("-", "")}`;
    const input = screen.getByPlaceholderText("输入消息,Enter 发送") as HTMLTextAreaElement;

    await user.type(input, `Configure OpenCode with apiKey=${canary}`);
    await user.click(screen.getByRole("button", { name: "发送" }));

    expect(await screen.findByRole("region", { name: "安全配置 OpenCode" })).toBeDefined();
    expect(input.value).toBe("");
    expect(document.body.innerHTML).not.toContain(canary);
    expect(wasPromptSent()).toBe(false);
    expect(invoke.mock.calls.some(([command]) => command === "history_save")).toBe(false);
  });

  test("recognizes JSON assignments and bearer values only in setup context", () => {
    expect(
      containsCcSwitchApiKey('OpenCode config: {"apiKey":"secret-value-123"}'),
    ).toBe(true);
    expect(containsCcSwitchApiKey("CC Switch Authorization: Bearer token_value_123")).toBe(
      true,
    );
    expect(containsCcSwitchApiKey("OpenCode has no credential here")).toBe(false);
    expect(containsCcSwitchApiKey("unrelated sk-example_12345678")).toBe(false);
  });

  test("opens from the settings event and cancels the native handle on new-chat cleanup", async () => {
    await renderChat();
    receiveAppEvent("deskmate://ccswitch-setup-request", null);
    const user = userEvent.setup();

    expect(await screen.findByRole("region", { name: "安全配置 OpenCode" })).toBeDefined();
    await user.type(screen.getByLabelText("Base URL"), "https://api.example.test/v1");
    await user.type(screen.getByLabelText("API Key"), "temporary-test-key");
    await user.click(screen.getByRole("button", { name: "验证并准备" }));
    await screen.findByRole("combobox", { name: "模型" });

    await user.click(screen.getByRole("button", { name: "历史" }));
    await user.click(screen.getByRole("button", { name: /新会话/ }));

    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith("cancel_ccswitch_setup", {
        handleId: "selection-chat-1",
      });
      expect(screen.queryByRole("region", { name: "安全配置 OpenCode" })).toBeNull();
    });
  });

  test("keeps ordinary tools as activity instead of treating them as setup drafts", async () => {
    await renderChat();

    receiveChatEvent({
      type: "message.updated",
      properties: {
        info: { id: "msg-tool", sessionID: "ses-1", role: "assistant" },
      },
    });
    receiveChatEvent({
      type: "message.part.updated",
      properties: {
        part: {
          id: "part-tool",
          messageID: "msg-tool",
          sessionID: "ses-1",
          type: "tool",
          callID: "call-tool",
          tool: "bash",
          state: { status: "running", title: "npm test" },
        },
      },
    });

    expect(await screen.findByText(/npm test/)).toBeDefined();
    expect(screen.queryByText("CC Switch: 在聊天中配置")).toBeNull();
  });

  test("stores a valid CC Switch draft as non-raw chat state", async () => {
    await renderChat();

    receiveChatEvent({
      type: "message.updated",
      properties: {
        info: { id: "msg-draft", sessionID: "ses-1", role: "assistant" },
      },
    });
    receiveChatEvent({
      type: "message.part.updated",
      properties: {
        part: completedTool({
          version: 1,
          kind: "opencode_provider_draft",
          providerName: "Local Proxy",
          baseUrl: "https://api.example.test/v1",
          modelHint: "gpt-test",
        }),
      },
    });

    expect(await screen.findByText("CC Switch: 在聊天中配置")).toBeDefined();
    expect(document.body.textContent).not.toContain("opencode_provider_draft");
    expect(document.body.textContent).not.toContain("Local Proxy");
    expect(invoke.mock.calls.some(([command]) => command === "history_save")).toBe(false);
  });

  test("does not leave an empty assistant row after exact tool running then completed", async () => {
    await renderChat();

    receiveChatEvent({
      type: "message.updated",
      properties: {
        info: { id: "msg-running", sessionID: "ses-1", role: "assistant" },
      },
    });
    receiveChatEvent({
      type: "message.part.updated",
      properties: {
        part: {
          id: "part-running",
          messageID: "msg-running",
          sessionID: "ses-1",
          type: "tool",
          callID: "call-running",
          tool: "ccswitch_prepare_opencode_provider",
          state: { status: "running", title: "CC Switch" },
        },
      },
    });
    receiveChatEvent({
      type: "message.part.updated",
      properties: {
        part: {
          ...completedTool(
            {
              version: 1,
              kind: "opencode_provider_draft",
              providerName: "Local Proxy",
            },
            "call-running",
          ),
          messageID: "msg-running",
        },
      },
    });
    receiveChatEvent({ type: "session.idle", properties: { sessionID: "ses-1" } });

    expect(await screen.findByText("CC Switch: 在聊天中配置")).toBeDefined();
    const emptyAssistantRows = Array.from(
      document.querySelectorAll(".chat-msg-assistant"),
    ).filter((row) => row.textContent?.trim().length === 0).length;
    expect(emptyAssistantRows).toBe(0);
    expect(document.body.textContent).not.toContain("Local Proxy");
  });

  test("shows non-secret notices for malformed and errored CC Switch tool results", async () => {
    await renderChat();

    receiveChatEvent({
      type: "message.updated",
      properties: {
        info: { id: "msg-bad", sessionID: "ses-1", role: "assistant" },
      },
    });
    receiveChatEvent({
      type: "message.part.updated",
      properties: {
        part: completedTool({
          version: 1,
          kind: "opencode_provider_draft",
          providerName: "credential-marker",
        }),
      },
    });

    expect(await screen.findByText("这看起来像密码或密钥，不会被保存")).toBeDefined();
    expect(document.body.textContent).not.toContain("credential-marker");

    receiveChatEvent({
      type: "message.part.updated",
      properties: {
        part: {
          ...completedTool({ version: 1, kind: "opencode_provider_draft" }, "call-error"),
          state: {
            status: "error",
            error: { name: "ToolError", message: "credential-marker failed" },
          },
        },
      },
    });

    expect(await screen.findByText("出错了: CC Switch")).toBeDefined();
    expect(document.body.textContent).not.toContain("credential-marker failed");
  });

  test("recovers valid drafts and malformed notices from idle snapshots", async () => {
    setSnapshotMessages([
      assistantMessage([
        completedTool(
          {
            version: 1,
            kind: "opencode_provider_draft",
            providerName: "Snapshot Proxy",
            baseUrl: "https://api.example.test/v1",
          },
          "call-snapshot",
        ),
      ]),
    ]);
    await renderChat();

    receiveChatEvent({ type: "session.idle", properties: { sessionID: "ses-1" } });

    expect(await screen.findByText("CC Switch: 在聊天中配置")).toBeDefined();
    expect(wasSessionMessageFetched()).toBe(true);
    expect(document.body.textContent).not.toContain("Snapshot Proxy");

    cleanupChatHarness();
    resetChatHarness();
    setSnapshotMessages([
      assistantMessage([
        completedTool(
          {
            version: 1,
            kind: "opencode_provider_draft",
            modelHint: "credential-marker",
          },
          "call-snapshot-bad",
        ),
      ]),
    ]);
    await renderChat();

    receiveChatEvent({ type: "session.idle", properties: { sessionID: "ses-1" } });

    expect(await screen.findByText("这看起来像密码或密钥，不会被保存")).toBeDefined();
    expect(document.body.textContent).not.toContain("credential-marker");
  });

  test("keeps a retry success when idle snapshot also has an older secret failure", async () => {
    await renderChat();

    receiveChatEvent({
      type: "message.updated",
      properties: {
        info: { id: "msg-replay", sessionID: "ses-1", role: "assistant" },
      },
    });
    receiveChatEvent({
      type: "message.part.updated",
      properties: {
        part: completedTool(
          {
            version: 1,
            kind: "opencode_provider_draft",
            providerName: "Live Proxy",
          },
          "call-replay",
        ),
      },
    });

    expect(await screen.findByText("CC Switch: 在聊天中配置")).toBeDefined();

    setSnapshotMessages([
      assistantMessage([
        completedTool(
          {
            version: 1,
            kind: "opencode_provider_draft",
            providerName: "Live Proxy",
          },
          "call-replay",
        ),
        completedTool(
          {
            version: 1,
            kind: "opencode_provider_draft",
            providerName: "credential-marker",
          },
          "call-stale",
        ),
      ]),
    ]);
    receiveChatEvent({ type: "session.idle", properties: { sessionID: "ses-1" } });

    expect(await screen.findByText("CC Switch: 在聊天中配置")).toBeDefined();
    expect(screen.queryByText("这看起来像密码或密钥，不会被保存")).toBeNull();
    expect(screen.queryByText("出错了: CC Switch")).toBeNull();
    expect(document.body.textContent).not.toContain("Live Proxy");
    expect(document.body.textContent).not.toContain("credential-marker");
  });
});
