import { catalogPageFixture, nativeHistoryFixture, registeredHistoryFixture } from "../testing/historyCatalogFixtures";
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
let abortStatus: "idle" | "busy" = "idle";
let promptTransport: "ok" | "lost_confirmed" | "lost_unknown" = "ok";
let submittedMessageId: string | null = null;
let promptAttempts = 0;

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
    const url = new URL(String(input)).pathname;
    if (url.endsWith("/event")) {
      return Promise.resolve(
        new Response(
          new ReadableStream<Uint8Array>({
            start(controller) {
              eventHandler = (event: OpenCodeEvent) => {
                controller.enqueue(
                  new TextEncoder().encode(`data: ${JSON.stringify(event)}\n\n`),
                );
              };
            },
          }),
          { status: 200 },
        ),
      );
    }
    if (url.endsWith("/session") && init?.method === "GET") {
      return Promise.resolve(new Response(null, { status: 200 }));
    }
    if (url.endsWith("/session") && init?.method === "POST") {
      return Promise.resolve(makeJsonResponse({ id: "ses_fixed", title: "t", directory: "." }));
    }
    if (url.endsWith("/session/ses_fixed/prompt_async") && init?.method === "POST") {
      promptAttempts += 1;
      const body = typeof init.body === "string" ? JSON.parse(init.body) as unknown : null;
      submittedMessageId = typeof body === "object" && body !== null && "messageID" in body
        ? String(Reflect.get(body, "messageID"))
        : null;
      if (promptTransport !== "ok") return Promise.reject(new Error("response lost"));
      return Promise.resolve(new Response(null, { status: 204 }));
    }
    if (url.endsWith("/session/ses_fixed/abort") && init?.method === "POST") {
      return Promise.resolve(makeJsonResponse(true));
    }
    if (url.endsWith("/session/status")) {
      return Promise.resolve(makeJsonResponse({ ses_fixed: { type: abortStatus } }));
    }
    if (url.endsWith("/session/ses_fixed/message")) {
      if (promptTransport === "lost_unknown") return Promise.reject(new Error("sidecar offline"));
      if (promptTransport === "lost_confirmed" && submittedMessageId) {
        return Promise.resolve(makeJsonResponse([{ info: {
          id: submittedMessageId,
          sessionID: "ses_fixed",
          role: "user",
        }, parts: [] }]));
      }
      return Promise.resolve(makeJsonResponse([]));
    }
    return Promise.resolve(new Response("unexpected opencode test request", { status: 500 }));
  });
  globalThis.fetch = Object.assign(fetchMock, {
    preconnect: originalFetch.preconnect,
  });
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
  abortStatus = "idle";
  promptTransport = "ok";
  submittedMessageId = null;
  promptAttempts = 0;
  eventHandler = null;
  invoke.mockReset();
  invoke.mockImplementation((command: string) => {
    switch (command) {
      case "history_register_native_session":
        return Promise.resolve(registeredHistoryFixture({ sessionId: "ses_fixed", directory: "." }));
      case "history_catalog_load":
        return Promise.resolve({ entry: nativeHistoryFixture("ses_fixed"), messages: [] });
      case "history_catalog_list":
        return Promise.resolve(catalogPageFixture([]));
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
      case "chat_abort_session":
        return abortStatus === "busy"
          ? Promise.reject(new Error("agent_abort_still_running"))
          : Promise.resolve(undefined);
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

async function deliverEvents(events: OpenCodeEvent[]): Promise<void> {
  await act(async () => {
    for (const event of events) eventHandler?.(event);
    // The event subscription is a real async fetch stream: let the reader
    // drain before asserting.
    await new Promise((resolve) => setTimeout(resolve, 20));
  });
}

test("chat emits scoped success once after terminal assistant SSE even after idle", async () => {
  const info = await sendPrompt();
  await deliverEvents([{ type: "session.idle", properties: { sessionID: info.sessionID } }]);
  expect(activityEvents.filter((event) => event.type === "success")).toHaveLength(0);
  await deliverEvents([
    { type: "message.updated", properties: { info } },
    { type: "message.updated", properties: { info } },
  ]);
  expect(activityEvents.filter((event) => event.type === "success")).toHaveLength(1);
});

test("chat cancellation rejects a late terminal SSE", async () => {
  const info = await sendPrompt();
  fireEvent.click(screen.getByRole("button", { name: "停" }));
  act(() => eventHandler?.({ type: "message.updated", properties: { info } }));
  expect(activityEvents.filter((event) => event.type === "success")).toHaveLength(0);
});

test("chat keeps the run active when cancellation cannot be confirmed", async () => {
  // Given: the native server accepts abort but still reports the session busy.
  await sendPrompt();
  abortStatus = "busy";

  // When: the user requests stop.
  fireEvent.click(screen.getByRole("button", { name: "停" }));

  // Then: the stop control remains and no confirmed-cancel activity is emitted.
  await waitFor(() => expect(screen.getByRole("button", { name: "停" })).toBeDefined());
  expect(activityEvents.filter((event) => event.type === "cancel")).toHaveLength(0);
});

test("chat reconciles a lost prompt response without resending the turn", async () => {
  // Given: the sidecar stores the stable user message but its HTTP response is lost.
  promptTransport = "lost_confirmed";
  await sendPrompt();

  // When / Then: the native record confirms delivery and only one prompt attempt exists.
  await waitFor(() => expect(promptAttempts).toBe(1));
  expect(screen.getByRole("button", { name: "停" })).toBeDefined();
  expect(screen.queryByText(/不会自动重发/)).toBeNull();
});

test("chat leaves an unreadable prompt submission pending without resending", async () => {
  // Given: both the prompt response and subsequent native record lookup fail.
  promptTransport = "lost_unknown";
  await sendPrompt();

  // When / Then: the UI preserves a stoppable pending state and does not replay the prompt.
  await screen.findByText("消息可能已提交，但暂时无法读取原生记录；不会自动重发，请等待恢复或手动停止。");
  expect(screen.getByRole("button", { name: "停" })).toBeDefined();
  expect(promptAttempts).toBe(1);
});

test("chat session failure rejects a later success", async () => {
  const info = await sendPrompt();
  await deliverEvents([
    { type: "session.error", properties: { sessionID: info.sessionID, error: { name: "TestFailure" } } },
    { type: "message.updated", properties: { info } },
  ]);
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
  await deliverEvents([
    { type: "message.updated", properties: { info: { ...info, time: { created: 1 }, finish: undefined } } },
    { type: "message.part.updated", properties: { part: { sessionID: info.sessionID, messageID: info.id, id: "part-tool", type: "tool", tool: "bash", state: { status: "completed", title: "test" } } } },
    { type: "message.updated", properties: { info } },
  ]);
  expect(activityEvents.filter((event) => event.type === "success")).toHaveLength(0);
  await deliverEvents([
    { type: "message.updated", properties: { info: { ...info, id: "final" } } },
    { type: "session.idle", properties: { sessionID: info.sessionID } },
  ]);
  expect(activityEvents.filter((event) => event.type === "success")).toHaveLength(1);
});
