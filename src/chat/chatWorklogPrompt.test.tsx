import { afterEach, beforeEach, expect, mock, test } from "bun:test";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

type PromptOptions = {
  readonly messageID?: string;
  readonly system?: string;
  readonly attachments?: readonly unknown[];
  readonly model?: {
    readonly providerID?: string;
    readonly modelID?: string;
  };
};

type PromptRequest = {
  readonly sessionId: string;
  readonly prompt: unknown;
  readonly options: PromptOptions;
};

const invoke = mock((command: string): Promise<unknown> => {
  switch (command) {
    case "get_settings":
      return Promise.resolve({
        autostart: false,
        language: "zh-CN",
        theme: "dark",
        providerId: "yume-2",
        modelId: "claude-sonnet-4.5",
        personaId: "xiaozhu",
        userName: "",
        memoryAiUse: true,
      });
    case "load_persona":
      return Promise.resolve({ persona: "你是小著。", placeholders: null });
    case "memory_context":
      return Promise.resolve({ memories: [], promptBlock: "" });
    case "history_save":
    case "worklog_register_turn":
      return Promise.resolve(undefined);
    default:
      return Promise.resolve(undefined);
  }
});

const promptRequests: PromptRequest[] = [];
const promptAsync = mock((sessionId: string, prompt: unknown, options: PromptOptions): Promise<void> => {
  promptRequests.push({ sessionId, prompt, options });
  return Promise.resolve();
});

mock.module("@tauri-apps/api/core", () => ({ invoke }));
mock.module("@tauri-apps/api/event", () => ({
  listen: () => Promise.resolve(() => {}),
}));
mock.module("../lib/opencode", () => ({
  abortSession: () => Promise.resolve(),
  createSession: () => Promise.resolve({ id: "ses_worklog_prompt", title: "YUME chat", directory: "." }),
  getSessionMessages: () => Promise.resolve([]),
  promptAsync,
  subscribeEvents: () => Promise.resolve(() => {}),
  waitForServer: () => Promise.resolve(),
}));

const { default: ChatApp } = await import("./ChatApp");

beforeEach(() => {
  invoke.mockClear();
  promptAsync.mockClear();
  promptRequests.length = 0;
});

afterEach(cleanup);

test("ChatApp sends dynamic local-date worklog guidance with each prompt", async () => {
  render(<ChatApp />);
  const input = await screen.findByPlaceholderText("输入消息,Enter 发送");
  fireEvent.change(input, { target: { value: "昨天我做了什么" } });
  fireEvent.click(screen.getByRole("button", { name: "发送" }));

  await waitFor(() => expect(promptRequests).toHaveLength(1));
  const system = promptRequests[0]?.options.system ?? "";
  expect(system).toContain("今天的本地日期");
  expect(system).toContain("worklog_query");
  expect(system).toContain("昨天我做了什么");
  expect(system).toContain("{entries,reports}");
});
