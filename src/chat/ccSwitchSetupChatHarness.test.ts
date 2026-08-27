import { expect, mock } from "bun:test";
import * as tauriCore from "@tauri-apps/api/core";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { createElement } from "react";
import type { OpenCodeMessage, ToolPart } from "../lib/opencode";
import { CCSWITCH_PREPARE_OPENCODE_PROVIDER_TOOL } from "./ccSwitchSetup";

export const invoke = mock<(command: string, args?: unknown) => Promise<unknown>>(
  () => Promise.resolve(undefined),
);

const originalFetch = globalThis.fetch;
const originalEventSource = globalThis.EventSource;
let chatEventHandler: ((event: unknown) => void) | null = null;
let snapshotMessages: readonly OpenCodeMessage[] = [];
let fetchLog: readonly string[] = [];

mock.module("@tauri-apps/api/core", () => ({ ...tauriCore, invoke }));
mock.module("@tauri-apps/api/event", () => ({
  listen: () => Promise.resolve(() => {}),
  emit: () => Promise.resolve(),
}));

const chatAppModule = await import("./ChatApp");
const ChatApp = chatAppModule.default;

const SETTINGS = {
  autostart: false,
  language: "zh-CN",
  theme: "dark",
  providerId: "",
  modelId: "",
  yolo: false,
  baseUrl: "",
  apiKey: "",
  petScale: 1,
  outlineWidth: 0.0073,
  rimWidth: 0.4,
  rimIntensity: 1,
  specularIntensity: 0.5,
  petVisible: true,
  alwaysOnTop: true,
  scheduledTasks: [],
  shortcutToggleChat: "Ctrl+Alt+D",
  shortcutTogglePet: "",
  personaId: "xiaozhu",
  mouseFollow: false,
  userName: "",
  memoryAutoExtract: false,
  memoryAiUse: true,
  updateRepo: "clxgame/deskmate",
};

export function completedTool(output: unknown, callID = "call-1"): ToolPart {
  return {
    id: `part-${callID}`,
    messageID: "msg-1",
    sessionID: "ses-1",
    type: "tool",
    callID,
    tool: CCSWITCH_PREPARE_OPENCODE_PROVIDER_TOOL,
    state: {
      status: "completed",
      input: { providerName: "YUME" },
      output,
    },
  };
}

export function assistantMessage(parts: readonly ToolPart[]): OpenCodeMessage {
  return {
    id: "msg-1",
    sessionID: "ses-1",
    role: "assistant",
    parts,
  };
}

export function setSnapshotMessages(messages: readonly OpenCodeMessage[]): void {
  snapshotMessages = messages;
}

export function wasSessionMessageFetched(): boolean {
  return fetchLog.some((url) =>
    url.includes("/session/ses-1/message?order=asc&limit=200"),
  );
}

export function receiveChatEvent(event: unknown): void {
  const handler = chatEventHandler;
  if (!handler) throw new Error("chat event handler was not registered");
  act(() => {
    handler(event);
  });
}

function installOpenCodeTransport(): void {
  const fetchMock = mock((input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    fetchLog = [...fetchLog, url];
    if (url.endsWith("/session") && init?.method === "GET") {
      return Promise.resolve(new Response("[]", { status: 200 }));
    }
    if (url.endsWith("/session") && init?.method === "POST") {
      return Promise.resolve(
        Response.json({ id: "ses-1", title: "YUME chat", directory: "." }),
      );
    }
    if (url.includes("/session/ses-1/message?order=asc&limit=200")) {
      return Promise.resolve(Response.json(snapshotMessages));
    }
    return Promise.resolve(new Response(null, { status: 204 }));
  });
  globalThis.fetch = Object.assign(
    (input: URL | RequestInfo, init?: RequestInit | BunFetchRequestInit) =>
      fetchMock(input, init),
    { preconnect: originalFetch.preconnect },
  );
  globalThis.EventSource = class {
    onmessage: ((message: MessageEvent) => void) | null = null;

    constructor(readonly url: string) {
      expect(url).toBe("http://127.0.0.1:48888/event");
      chatEventHandler = (event: unknown) => {
        this.onmessage?.(
          new MessageEvent("message", { data: JSON.stringify(event) }),
        );
      };
    }

    close(): void {
      chatEventHandler = null;
    }
  } as typeof EventSource;
}

function mockChatInvoke(): void {
  invoke.mockImplementation((command: string) => {
    switch (command) {
      case "sidecar_base_url":
        return Promise.resolve("http://127.0.0.1:48888");
      case "get_settings":
        return Promise.resolve(SETTINGS);
      case "load_persona":
        return Promise.resolve({
          persona: "你是小著。",
          skills: undefined,
          placeholders: null,
        });
      case "memory_context":
        return Promise.resolve({ memories: [], promptBlock: "" });
      default:
        return Promise.resolve(undefined);
    }
  });
}

export async function renderChat(): Promise<void> {
  installOpenCodeTransport();
  render(createElement(ChatApp));
  await screen.findByPlaceholderText("输入消息,Enter 发送");
  await waitFor(() => expect(chatEventHandler).not.toBeNull());
}

export function resetChatHarness(): void {
  chatEventHandler = null;
  snapshotMessages = [];
  fetchLog = [];
  invoke.mockReset();
  mockChatInvoke();
}

export function cleanupChatHarness(): void {
  globalThis.fetch = originalFetch;
  globalThis.EventSource = originalEventSource;
  cleanup();
}
