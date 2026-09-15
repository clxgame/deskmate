import { afterEach, beforeEach, expect, mock, test } from "bun:test";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import * as tauriCore from "@tauri-apps/api/core";
import * as tauriEvent from "@tauri-apps/api/event";

type PromptRequest = {
  readonly system?: string;
};
const originalFetch = globalThis.fetch;
const OriginalEventSource = globalThis.EventSource;

const invoke = mock((command: string): Promise<unknown> => {
  switch (command) {
    case "sidecar_base_url":
      return Promise.resolve("http://127.0.0.1:48888");
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

mock.module("@tauri-apps/api/core", () => ({ ...tauriCore, invoke }));
mock.module("@tauri-apps/api/event", () => ({
  ...tauriEvent,
  emit: () => Promise.resolve(),
  listen: () => Promise.resolve(() => {}),
}));

const { default: ChatApp } = await import("./ChatApp");

beforeEach(() => {
  invoke.mockClear();
  promptRequests.length = 0;
  // Mock the transport, not the shared client module. Bun's module replacement
  // otherwise leaves this test's session/functions installed for later files.
  const fetchMock = mock((input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.endsWith("/session")) {
      return Promise.resolve(Response.json(init?.method === "POST"
        ? { id: "ses_worklog_prompt", title: "YUME chat", directory: "." } : []));
    }
    if (url.endsWith("/session/ses_worklog_prompt/prompt_async") && init?.method === "POST") {
      promptRequests.push(JSON.parse(String(init.body)) as PromptRequest);
      return Promise.resolve(new Response(null, { status: 204 }));
    }
    if (url.endsWith("/abort")) return Promise.resolve(new Response(null, { status: 204 }));
    return Promise.resolve(new Response("unexpected worklog test request", { status: 500 }));
  });
  globalThis.fetch = Object.assign(fetchMock, { preconnect: originalFetch.preconnect });
  globalThis.EventSource = class {
    onmessage: ((message: MessageEvent) => void) | null = null;
    constructor(readonly url: string) {}
    close(): void {}
  } as typeof EventSource;
});

afterEach(() => {
  cleanup();
  globalThis.fetch = originalFetch;
  globalThis.EventSource = OriginalEventSource;
});

test("ChatApp sends dynamic local-date worklog guidance with each prompt", async () => {
  render(<ChatApp />);
  const input = await screen.findByPlaceholderText("输入消息,Enter 发送");
  fireEvent.change(input, { target: { value: "昨天我做了什么" } });
  fireEvent.click(screen.getByRole("button", { name: "发送" }));

  await waitFor(() => expect(promptRequests).toHaveLength(1));
  const system = promptRequests[0]?.system ?? "";
  expect(system).toContain("当前真实本地日期");
  expect(system).toContain("时区:");
  expect(system).toContain("websearch");
  expect(system).toContain("工作归属日期");
  expect(system).toContain("worklog_query");
  expect(system).toContain("昨天我做了什么");
  expect(system).toContain("{entries,reports}");
});
