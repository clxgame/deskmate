// allow: SIZE_OK — fixed-reply timing cases stay together to preserve shared fake-clock setup.
import {
  afterEach,
  beforeEach,
  expect,
  jest,
  mock,
  test,
} from "bun:test";
import * as tauriCore from "@tauri-apps/api/core";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import type { PetActivityEvent } from "../lib/petState";
import type { OpenCodeEvent } from "../lib/opencode";

const invoke = mock<(command: string, args?: unknown) => Promise<unknown>>(
  () => Promise.resolve(undefined),
);
const listen = mock(() => Promise.resolve(() => {}));
let eventHandler: ((event: OpenCodeEvent) => void) | null = null;
const activityEvents: PetActivityEvent[] = [];
const originalFetch = globalThis.fetch;
const OriginalEventSource = globalThis.EventSource;

mock.module("@tauri-apps/api/core", () => ({ ...tauriCore, invoke }));
mock.module("@tauri-apps/api/event", () => ({
  listen,
  emit: (name: string, payload: PetActivityEvent) => { if (name === "deskmate://pet-activity") activityEvents.push(payload); return Promise.resolve(); },
}));

function makeJsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

function installOpenCodeTransport(): void {
  const fetchMock = mock((input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.endsWith("/session") && init?.method === "GET") {
      return Promise.resolve(new Response(null, { status: 200 }));
    }
    if (url.endsWith("/session") && init?.method === "POST") {
      return Promise.resolve(makeJsonResponse({ id: "ses_fixed", title: "t", directory: "." }));
    }
    if (url.endsWith("/session/ses_fixed/prompt_async") && init?.method === "POST") {
      return Promise.resolve(new Response(null, { status: 204 }));
    }
    if (url.endsWith("/session/ses_fixed/abort") && init?.method === "POST") {
      return Promise.resolve(new Response(null, { status: 204 }));
    }
    if (url.includes("/session/ses_fixed/message?")) {
      return Promise.resolve(makeJsonResponse([]));
    }
    return Promise.resolve(new Response("unexpected opencode test request", { status: 500 }));
  });
  globalThis.fetch = Object.assign(fetchMock, {
    preconnect: originalFetch.preconnect,
  });

  globalThis.EventSource = class {
    onmessage: ((message: MessageEvent) => void) | null = null;

    constructor(readonly url: string) {
      expect(url).toBe("http://127.0.0.1:48888/event");
      eventHandler = (event: OpenCodeEvent) => {
        this.onmessage?.(
          new MessageEvent("message", {
            data: JSON.stringify(event),
          }),
        );
      };
    }

    close(): void {
      activityEvents.length = 0;
  eventHandler = null;
    }
  } as typeof EventSource;
}

const { default: ChatApp } = await import("./ChatApp");

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

beforeEach(() => {
  activityEvents.length = 0;
  eventHandler = null;
  invoke.mockReset();
  invoke.mockImplementation((command: string) => {
    switch (command) {
      case "sidecar_base_url":
        return Promise.resolve("http://127.0.0.1:48888");
      case "get_settings":
        return Promise.resolve(SETTINGS);
      case "load_persona":
        return Promise.resolve({ persona: "你是小著。", skills: undefined, placeholders: null });
      case "memory_context":
        return Promise.resolve({ memories: [], promptBlock: "" });
      case "history_save":
        return Promise.resolve(undefined);
      default:
        return Promise.resolve(undefined);
    }
  });
  installOpenCodeTransport();
});

afterEach(() => {
  jest.useRealTimers();
  cleanup();
  globalThis.fetch = originalFetch;
  globalThis.EventSource = OriginalEventSource;
});


async function sendPrompt() {
  render(<ChatApp />);
  const input = await screen.findByPlaceholderText("输入消息,Enter 发送");
  const send = screen.getByRole("button", { name: "发送" });
  fireEvent.change(input, { target: { value: "请回答一个测试问题" } });
  fireEvent.click(send);
  await waitFor(() => expect(activityEvents.some((event) => event.type === "start")).toBe(true));
  const start = activityEvents.find((event) => event.type === "start");
  if (!start) throw new Error("missing start event");
  return { id: "assistant", role: "assistant", sessionID: start.sessionId, parentID: start.requestId, time: { created: 1, completed: 2 }, finish: "stop" };
}

test("chat emits scoped success once after terminal assistant SSE even after idle", async () => {
  const info = await sendPrompt();
  act(() => {
    eventHandler?.({ type: "session.idle", properties: { sessionID: info.sessionID } });
  });
  expect(activityEvents.filter((event) => event.type === "success")).toHaveLength(0);
  act(() => {
    eventHandler?.({ type: "message.updated", properties: { info } });
    eventHandler?.({ type: "message.updated", properties: { info } });
  });
  expect(activityEvents.filter((event) => event.type === "success")).toHaveLength(1);
});

test("chat cancellation rejects a late terminal SSE", async () => {
  const info = await sendPrompt();
  fireEvent.click(screen.getByRole("button", { name: "停" }));
  act(() => eventHandler?.({ type: "message.updated", properties: { info } }));
  expect(activityEvents.filter((event) => event.type === "success")).toHaveLength(0);
});

test("chat session failure rejects a later success", async () => {
  const info = await sendPrompt();
  act(() => {
    eventHandler?.({ type: "session.error", properties: { sessionID: info.sessionID, error: { name: "TestFailure" } } });
    eventHandler?.({ type: "message.updated", properties: { info } });
  });
  expect(activityEvents.filter((event) => event.type === "error")).toHaveLength(1);
  expect(activityEvents.filter((event) => event.type === "success")).toHaveLength(0);
});

test("fixed identity reply emits exactly one completion", async () => {
  render(<ChatApp />);
  const input = await screen.findByPlaceholderText("输入消息,Enter 发送");
  jest.useFakeTimers();
  await act(async () => {
    fireEvent.change(input, { target: { value: "你是谁？" } });
    fireEvent.click(screen.getByRole("button", { name: "发送" }));
    await Promise.resolve(); await Promise.resolve();
  });
  await act(async () => { jest.advanceTimersByTime(1000); await Promise.resolve(); });
  await act(async () => { jest.advanceTimersByTime(1000); await Promise.resolve(); });
  expect(activityEvents.filter((event) => event.type === "success")).toHaveLength(1);
});

test("real SSE tool stop cannot celebrate before the tool follow-up response", async () => {
  const info = await sendPrompt();
  act(() => {
    eventHandler?.({ type: "message.updated", properties: { info: { ...info, time: { created: 1 }, finish: undefined } } });
    eventHandler?.({ type: "message.part.updated", properties: { part: { sessionID: info.sessionID, messageID: info.id, id: "part-tool", type: "tool", tool: "bash", state: { status: "completed", title: "test" } } } });
    eventHandler?.({ type: "message.updated", properties: { info } });
  });
  expect(activityEvents.filter((event) => event.type === "success")).toHaveLength(0);
  act(() => {
    eventHandler?.({ type: "message.updated", properties: { info: { ...info, id: "final" } } });
    eventHandler?.({ type: "session.idle", properties: { sessionID: info.sessionID } });
  });
  expect(activityEvents.filter((event) => event.type === "success")).toHaveLength(1);
});
