// allow: SIZE_OK — fixed-reply timing cases stay together to preserve shared fake-clock setup.
import {
  afterEach,
  beforeEach,
  describe,
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
import type { OpenCodeEvent } from "../lib/opencode";
import type { UnifiedHistoryRow } from "../lib/unifiedHistory";
import type { HistoryMessage } from "../lib/history";

const invoke = mock<(command: string, args?: unknown) => Promise<unknown>>(
  () => Promise.resolve(undefined),
);
const listen = mock<
  (event: string, callback: () => void) => Promise<() => void>
>(() => Promise.resolve(() => {}));
let eventHandler: ((event: OpenCodeEvent) => void) | null = null;
let ownershipChanged: (() => void) | null = null;
let workbenchOwned = false;
let workbenchState: "busy" | "idle" | "unavailable" = "idle";
let workbenchOpenFailure: "history_native_missing" | "history_native_timeout" | Error | null = null;
const originalFetch = globalThis.fetch;
let localMessages: HistoryMessage[] = [];
let catalogUnavailable = false;
let promptCount = 0;
const nativeEntry: UnifiedHistoryRow = {
  key: 'native:["test",".","ses_fixed"]',
  identity: { kind: "native", sidecarId: "test", directory: ".", sessionId: "ses_fixed" },
  title: "t", userTitle: null, displayTitle: "t", source: "light_chat",
  created: 1, updated: 1, pinned: false, archived: false, availability: "available",
  ownership: "unowned", runtime: "idle", tombstone: null,
  capabilities: { open: true, openWorkbench: true, send: true, rename: true, pin: true, archive: true, delete: true, readOnlyReason: null },
};

mock.module("@tauri-apps/api/core", () => ({ ...tauriCore, invoke }));
mock.module("@tauri-apps/api/event", () => ({
  listen,
  emit: () => Promise.resolve(),
}));

function makeJsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

function installOpenCodeTransport(): void {
  const fetchMock = mock((input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input).split("?")[0] ?? "";
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
      promptCount += 1;
      return Promise.resolve(new Response(null, { status: 204 }));
    }
    if (url.endsWith("/session/ses_fixed/abort") && init?.method === "POST") {
      return Promise.resolve(makeJsonResponse(true));
    }
    if (url.endsWith("/session/status")) {
      return Promise.resolve(makeJsonResponse({ ses_fixed: { type: "idle" } }));
    }
    if (url.endsWith("/session/ses_fixed/message")) {
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
  eventHandler = null;
  localMessages = [];
  catalogUnavailable = false;
  promptCount = 0;
  ownershipChanged = null;
  workbenchOwned = false;
  workbenchState = "idle";
  workbenchOpenFailure = null;
  listen.mockReset();
  listen.mockImplementation((event: string, callback: () => void) => {
    if (event === "workbench://ownership-changed") ownershipChanged = callback;
    return Promise.resolve(() => {});
  });
  invoke.mockReset();
  invoke.mockImplementation((command: string, args?: unknown) => {
    switch (command) {
      case "sidecar_base_url":
        return Promise.resolve("http://127.0.0.1:48888");
      case "get_settings":
        return Promise.resolve(SETTINGS);
      case "load_persona":
        return Promise.resolve({ persona: "你是小著。", skills: undefined, placeholders: null });
      case "memory_context":
        return Promise.resolve({ memories: [], promptBlock: "" });
      case "history_register_native_session":
        return Promise.resolve({ ...nativeEntry, runtime: "unknown", capabilities: { ...nativeEntry.capabilities, send: false, readOnlyReason: "runtime_unknown" } });
      case "history_catalog_load":
        if (catalogUnavailable) return Promise.reject(new Error("synthetic unavailable"));
        return Promise.resolve({ entry: nativeEntry, messages: localMessages });
      case "history_catalog_list":
        return Promise.resolve({ items: [nativeEntry], total: 1, hasMore: false, offline: false, errors: [], directories: ["."] });
      case "history_save_local_messages": {
        if (!args || typeof args !== "object" || !("messages" in args) || !Array.isArray(args.messages)) throw new Error("Missing local messages");
        localMessages = args.messages.map((message: unknown): HistoryMessage => {
          if (!message || typeof message !== "object" || !("role" in message) || !("text" in message)
            || !("time" in message) || !("messageId" in message) || !("localOnly" in message)
            || (message.role !== "user" && message.role !== "assistant") || typeof message.text !== "string"
            || typeof message.time !== "number" || typeof message.messageId !== "string" || message.localOnly !== true) throw new Error("Invalid local message");
          return { role: message.role, text: message.text, time: message.time, messageId: message.messageId, localOnly: true };
        });
        return Promise.resolve();
      }
      case "history_save":
        return Promise.resolve(undefined);
      case "workbench_session_owned":
        return Promise.resolve(workbenchOwned);
      case "workbench_session_status":
        return Promise.resolve({ state: workbenchState });
      case "workbench_open_session":
        return workbenchOpenFailure ? Promise.reject(workbenchOpenFailure) : Promise.resolve();
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

describe("小著固定名字由来回复", () => {
  test.each([
    ["history_native_missing", "这段会话已不存在，无法在工作台打开。请新建会话或刷新历史。"],
    [new Error("history_native_missing"), "这段会话已不存在，无法在工作台打开。请新建会话或刷新历史。"],
    ["history_native_timeout", "工作台打开失败，请稍后重试。"],
  ] as const)("shows a visible error when the workbench rejects %s", async (failure, expected) => {
    workbenchOpenFailure = failure;
    render(<ChatApp />);
    const button = await screen.findByRole<HTMLButtonElement>("button", { name: "在工作台打开" });
    await waitFor(() => expect(button.disabled).toBe(false));

    fireEvent.click(button);

    expect((await screen.findByText(expected)).closest('[role="alert"]')).not.toBeNull();
  });

  test("a newly registered unknown session refreshes host capabilities before the first send", async () => {
    render(<ChatApp />);
    const input = await screen.findByPlaceholderText("输入消息,Enter 发送");
    await waitFor(() => expect(invoke.mock.calls.some(([command]) => command === "history_catalog_load")).toBe(true));
    fireEvent.change(input, { target: { value: "普通问题" } });
    fireEvent.click(screen.getByRole("button", { name: "发送" }));
    await waitFor(() => expect(promptCount).toBe(1));
  });

  test("a new session stays read only when its fresh host status cannot be loaded", async () => {
    catalogUnavailable = true;
    render(<ChatApp />);
    await screen.findByText("暂时无法确认对话状态，仅供阅读");
    expect(screen.queryByPlaceholderText("输入消息,Enter 发送")).toBeNull();
    expect(promptCount).toBe(0);
  });
  test("reopening a fixed reply preserves the local turn in the same native conversation", async () => {
    render(<ChatApp />);
    const input = await screen.findByPlaceholderText("输入消息,Enter 发送");
    await act(async () => { fireEvent.change(input, { target: { value: "你是谁啊" } }); });
    await waitFor(() => expect(screen.getByRole<HTMLButtonElement>("button", { name: "发送" }).disabled).toBe(false));
    jest.useFakeTimers();
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "发送" })); });
    await act(async () => { jest.advanceTimersByTime(1000); });
    await act(async () => { jest.advanceTimersByTime(1000); });
    await act(async () => { jest.advanceTimersByTime(300); });
    expect(localMessages).toHaveLength(2);
    expect(localMessages.every(message => message.localOnly && message.messageId?.startsWith("local_"))).toBe(true);
    expect(invoke.mock.calls.some(([command]) => command === "history_save")).toBe(false);
    const reply = localMessages.find(message => message.role === "assistant")?.text;
    expect(reply).toBeDefined();
    jest.useRealTimers();
    fireEvent.click(screen.getByRole("button", { name: "历史" }));
    fireEvent.click(await screen.findByRole("button", { name: "打开 t" }));
    await waitFor(() => expect(document.querySelector(".chat-msg-assistant .chat-bubble")?.textContent).toBe(reply));
    expect(screen.getByText("本地回复")).toBeDefined();
    expect(invoke.mock.calls.filter(([command]) => command === "history_register_native_session")).toHaveLength(1);
  });

  test("keeps input locked until a disconnected workbench session has a verified state", async () => {
    // Given a light-chat session handed to the workbench.
    render(<ChatApp />);
    await screen.findByPlaceholderText("输入消息,Enter 发送");
    await waitFor(() => expect(ownershipChanged).not.toBeNull());
    workbenchOwned = true;
    ownershipChanged?.();
    await screen.findByText("该会话正在工作台处理");
    expect(screen.queryByPlaceholderText("输入消息,Enter 发送")).toBeNull();

    // When the ownership lease expires but the native session cannot be read.
    workbenchOwned = false;
    workbenchState = "unavailable";
    ownershipChanged?.();

    // Then input remains locked until a later native status check succeeds.
    await screen.findByText("工作台已断开，但暂时无法确认会话状态；输入仍保持锁定，请稍后重试。");
    expect(screen.queryByPlaceholderText("输入消息,Enter 发送")).toBeNull();
    workbenchState = "idle";
    ownershipChanged?.();
    await screen.findByPlaceholderText("输入消息,Enter 发送");
  });

  test("sends four lines two seconds apart and shows typing while waiting", async () => {
    render(<ChatApp />);
    const input = await screen.findByPlaceholderText("输入消息,Enter 发送");
    const send = screen.getByRole("button", { name: "发送" });
    await act(async () => {
      fireEvent.change(input, { target: { value: "为什么是小著？" } });
    });
    await waitFor(() => expect((send as HTMLButtonElement).disabled).toBe(false));

    jest.useFakeTimers();
    await act(async () => {
      fireEvent.click(send);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(document.querySelectorAll(".chat-msg-assistant .chat-bubble")).toHaveLength(0);
    expect(document.querySelector(".chat-typing")).toBeNull();
    expect(screen.getByText("正在思考..")).toBeDefined();

    await act(async () => {
      jest.advanceTimersByTime(999);
      await Promise.resolve();
    });
    expect(document.querySelectorAll(".chat-msg-assistant .chat-bubble")).toHaveLength(0);

    await act(async () => {
      jest.advanceTimersByTime(1);
      await Promise.resolve();
    });
    expect(document.querySelector(".chat-typing")).not.toBeNull();
    expect(screen.getAllByText("正在输入..").length).toBeGreaterThanOrEqual(1);

    await act(async () => {
      jest.advanceTimersByTime(1000);
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(
      document.querySelector(".chat-msg-assistant .chat-bubble")?.textContent,
    ).toContain("因为本人：系著名当代游戏电子游戏音乐先锋级选手");
    expect(document.querySelectorAll(".chat-msg-assistant .chat-bubble")).toHaveLength(1);
    expect(document.querySelector(".chat-typing")).not.toBeNull();

    await act(async () => {
      jest.advanceTimersByTime(1999);
      await Promise.resolve();
    });
    expect(screen.queryByText("霄·太郎是也~")).toBeNull();

    await act(async () => {
      jest.advanceTimersByTime(1);
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(screen.getByText("霄·太郎是也~")).toBeDefined();

    await act(async () => {
      jest.advanceTimersByTime(2000);
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(document.querySelectorAll(".chat-msg-assistant .chat-bubble")).toHaveLength(3);
    expect(screen.getByText("当然..")).toBeDefined();

    await act(async () => {
      jest.advanceTimersByTime(2000);
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(
      document.querySelectorAll(".chat-msg-assistant .chat-bubble")[3]
        ?.textContent,
    ).toContain("您叫我小著就行..嘿嘿..");
    expect(document.querySelectorAll(".chat-msg-assistant .chat-bubble")).toHaveLength(4);
    expect(document.querySelector(".chat-typing")).toBeNull();
  });

  test("answers who-am-I directly with the requested intro", async () => {
    render(<ChatApp />);
    const input = await screen.findByPlaceholderText("输入消息,Enter 发送");
    const send = screen.getByRole("button", { name: "发送" });
    await act(async () => {
      fireEvent.change(input, { target: { value: "你是谁啊" } });
    });
    await waitFor(() => expect((send as HTMLButtonElement).disabled).toBe(false));

    jest.useFakeTimers();
    await act(async () => {
      fireEvent.click(send);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(document.querySelectorAll(".chat-msg-assistant .chat-bubble")).toHaveLength(0);
    expect(screen.getByText("正在思考..")).toBeDefined();

    await act(async () => {
      jest.advanceTimersByTime(1000);
      await Promise.resolve();
    });
    expect(document.querySelector(".chat-typing")).not.toBeNull();

    await act(async () => {
      jest.advanceTimersByTime(1000);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(document.querySelectorAll(".chat-msg-assistant .chat-bubble")).toHaveLength(1);
    expect(document.querySelector(".chat-msg-assistant .chat-bubble")?.textContent).toBe(
      "你好！我是当代游戏电子游戏音乐先锋——小著。",
    );
    expect(document.querySelector(".chat-typing")).toBeNull();
  });

  test("stopping during the wait prevents stale later bubbles", async () => {
    render(<ChatApp />);
    const input = await screen.findByPlaceholderText("输入消息,Enter 发送");
    const send = screen.getByRole("button", { name: "发送" });
    await act(async () => {
      fireEvent.change(input, { target: { value: "为什么是小著？" } });
    });
    await waitFor(() => expect((send as HTMLButtonElement).disabled).toBe(false));

    jest.useFakeTimers();
    await act(async () => {
      fireEvent.click(send);
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(document.querySelectorAll(".chat-msg-assistant .chat-bubble")).toHaveLength(0);

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "停" }));
      await Promise.resolve();
      jest.advanceTimersByTime(10000);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(document.querySelectorAll(".chat-msg-assistant .chat-bubble")).toHaveLength(0);
    expect(document.querySelector(".chat-typing")).toBeNull();
  });

  test("keeps a fast streaming reply hidden until two seconds have elapsed", async () => {
    render(<ChatApp />);
    const input = await screen.findByPlaceholderText("输入消息,Enter 发送");
    const send = screen.getByRole("button", { name: "发送" });
    await waitFor(() => expect(eventHandler).not.toBeNull());
    const receive = eventHandler;
    if (!receive) throw new Error("SSE handler was not registered");

    await act(async () => {
      fireEvent.change(input, { target: { value: "给我一句普通回复" } });
    });
    await waitFor(() => expect((send as HTMLButtonElement).disabled).toBe(false));

    jest.useFakeTimers();
    await act(async () => {
      fireEvent.click(send);
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(screen.getByText("正在思考..")).toBeDefined();

    await act(async () => {
      receive({
        type: "message.part.updated",
        properties: {
          part: {
            sessionID: "ses_fixed",
            messageID: "msg-fast",
            type: "text",
            text: "这是很快返回的内容",
          },
        },
      });
      receive({ type: "session.idle", properties: { sessionID: "ses_fixed" } });
      await Promise.resolve();
    });

    expect(document.querySelectorAll(".chat-msg-assistant .chat-bubble")).toHaveLength(0);
    expect(document.querySelector(".chat-typing")).not.toBeNull();

    await act(async () => {
      jest.advanceTimersByTime(1999);
      await Promise.resolve();
    });
    expect(screen.queryByText("这是很快返回的内容")).toBeNull();

    await act(async () => {
      jest.advanceTimersByTime(1);
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(screen.getByText("这是很快返回的内容")).toBeDefined();
    expect(document.querySelector(".chat-typing")).toBeNull();
  });

  test("shows slow streaming replies at their real arrival time after the minimum wait", async () => {
    render(<ChatApp />);
    const input = await screen.findByPlaceholderText("输入消息,Enter 发送");
    const send = screen.getByRole("button", { name: "发送" });
    await waitFor(() => expect(eventHandler).not.toBeNull());
    const receive = eventHandler;
    if (!receive) throw new Error("SSE handler was not registered");

    await act(async () => {
      fireEvent.change(input, { target: { value: "解释 **Markdown**" } });
    });
    await waitFor(() => expect((send as HTMLButtonElement).disabled).toBe(false));

    jest.useFakeTimers();
    await act(async () => {
      fireEvent.click(send);
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    await act(async () => {
      jest.advanceTimersByTime(2000);
      await Promise.resolve();
    });
    expect(screen.getByText("正在思考..")).toBeDefined();
    expect(document.querySelector(".chat-typing")).toBeNull();

    await act(async () => {
      receive({
        type: "message.part.updated",
        properties: {
          part: {
            sessionID: "ses_fixed",
            messageID: "msg-slow",
            type: "text",
            text: "这是超过两秒才到的**内容",
          },
        },
      });
      await Promise.resolve();
    });
    expect(document.querySelector(".chat-msg-user .chat-bubble")?.textContent).toBe("解释 **Markdown**");
    expect(document.querySelector(".chat-msg-user strong")).toBeNull();
    expect(document.querySelector(".chat-msg-assistant strong")?.textContent).toBe("内容");
    expect(document.querySelector(".chat-msg-assistant .chat-bubble")?.textContent).toBe("这是超过两秒才到的内容");
    expect(document.querySelector(".chat-typing")).not.toBeNull();

    const list = document.querySelector<HTMLDivElement>(".chat-list");
    if (!list) throw new Error("Missing chat list");
    Object.defineProperties(list, {
      scrollHeight: { configurable: true, value: 1000 },
      clientHeight: { configurable: true, value: 200 },
      scrollTop: { configurable: true, writable: true, value: 100 },
    });
    const scrollTo = mock(() => {});
    list.scrollTo = scrollTo;
    await act(async () => {
      fireEvent.scroll(list);
      receive({ type: "message.part.updated", properties: { part: {
        sessionID: "ses_fixed", messageID: "msg-slow", type: "text", text: "这是超过两秒才到的**内容",
      } } });
      await Promise.resolve();
    });
    expect(scrollTo).not.toHaveBeenCalled();
    await act(async () => {
      list.scrollTop = 800;
      fireEvent.scroll(list);
      receive({ type: "message.part.updated", properties: { part: {
        sessionID: "ses_fixed", messageID: "msg-slow", type: "text", text: "这是超过两秒才到的**内容",
      } } });
      await Promise.resolve();
    });
    expect(scrollTo).toHaveBeenCalledWith({ top: 1000 });

    await act(async () => {
      receive({ type: "session.idle", properties: { sessionID: "ses_fixed" } });
      await Promise.resolve();
    });
    expect(document.querySelector(".chat-typing")).toBeNull();
    expect(document.querySelector(".chat-msg-assistant strong")).toBeNull();
    expect(document.querySelector(".chat-msg-assistant .chat-bubble")?.textContent).toBe("这是超过两秒才到的**内容");
  });

  test("does not add an empty placeholder bubble next to the typing indicator", async () => {
    render(<ChatApp />);
    const input = await screen.findByPlaceholderText("输入消息,Enter 发送");
    const send = screen.getByRole("button", { name: "发送" });
    await waitFor(() => expect(eventHandler).not.toBeNull());
    const receive = eventHandler;
    if (!receive) throw new Error("SSE handler was not registered");

    await act(async () => {
      fireEvent.change(input, { target: { value: "测试输入状态" } });
    });
    await waitFor(() => expect((send as HTMLButtonElement).disabled).toBe(false));

    jest.useFakeTimers();
    await act(async () => {
      fireEvent.click(send);
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    await act(async () => {
      jest.advanceTimersByTime(2000);
      await Promise.resolve();
    });

    await act(async () => {
      receive({
        type: "message.part.updated",
        properties: {
          part: {
            sessionID: "ses_fixed",
            messageID: "msg-tool",
            type: "tool",
            tool: "读取文件",
            state: { title: "读取文件" },
          },
        },
      });
      receive({
        type: "message.part.updated",
        properties: {
          part: {
            sessionID: "ses_fixed",
            messageID: "msg-text",
            type: "text",
            text: "正文已经到达",
          },
        },
      });
      await Promise.resolve();
    });

    expect(screen.getByText("正文已经到达")).toBeDefined();
    const ordinaryActivity = document.querySelector(".chat-activity");
    expect(ordinaryActivity?.textContent).toContain("读取文件");
    expect(ordinaryActivity?.classList.contains("chat-activity-websearch")).toBe(false);
    expect(ordinaryActivity?.querySelector(".chat-activity-icon")).not.toBeNull();
    expect(ordinaryActivity?.querySelector(".app-icon-network")).toBeNull();
    expect(document.querySelectorAll(".chat-msg-assistant .chat-bubble")).toHaveLength(1);
    expect(screen.getByText("正在思考..")).toBeDefined();
    expect(screen.getAllByText("正在输入..")).toHaveLength(1);
    expect(document.querySelector(".chat-typing")).not.toBeNull();
  });

  test("shows web search as a breathing network activity that settles when completed", async () => {
    render(<ChatApp />);
    const input = await screen.findByPlaceholderText("输入消息,Enter 发送");
    const send = screen.getByRole("button", { name: "发送" });
    await waitFor(() => expect(eventHandler).not.toBeNull());
    const receive = eventHandler;
    if (!receive) throw new Error("SSE handler was not registered");

    await act(async () => {
      fireEvent.change(input, { target: { value: "搜索最新资料" } });
    });
    await waitFor(() => expect((send as HTMLButtonElement).disabled).toBe(false));

    jest.useFakeTimers();
    await act(async () => {
      fireEvent.click(send);
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    await act(async () => {
      jest.advanceTimersByTime(2000);
      await Promise.resolve();
    });

    await act(async () => {
      receive({
        type: "message.part.updated",
        properties: {
          part: {
            id: "part-websearch",
            sessionID: "ses_fixed",
            messageID: "msg-websearch",
            type: "tool",
            callID: "call-websearch",
            tool: "websearch",
            state: {
              status: "running",
              title: "Exa Web Search: latest models",
              input: { query: "latest models platform.openai.com" },
            },
          },
        },
      });
      receive({
        type: "message.part.updated",
        properties: {
          part: {
            sessionID: "ses_fixed",
            messageID: "msg-websearch",
            type: "text",
            text: "正在核对来源",
          },
        },
      });
      await Promise.resolve();
    });

    const running = screen.getByText("网页搜索").closest(".chat-activity");
    expect(running?.classList.contains("chat-activity-running")).toBe(true);
    expect(running?.textContent).not.toContain("Exa Web Search");
    expect(running?.querySelector(".app-icon-network")).not.toBeNull();
    expect(running?.textContent).toContain("platform.openai.com");

    await act(async () => {
      receive({
        type: "message.part.updated",
        properties: {
          part: {
            id: "part-websearch",
            sessionID: "ses_fixed",
            messageID: "msg-websearch",
            type: "tool",
            callID: "call-websearch",
            tool: "websearch",
            state: {
              status: "completed",
              input: { query: "latest models platform.openai.com" },
              output:
                "URL: https://developers.openai.com/api/docs/models\nURL: https://github.com/openai/openai-node\nURL: https://www.github.com/openai/openai-python",
            },
          },
        },
      });
      receive({ type: "session.idle", properties: { sessionID: "ses_fixed" } });
      await Promise.resolve();
    });

    const completed = screen.getByText("网页搜索").closest(".chat-activity");
    expect(completed?.classList.contains("chat-activity-running")).toBe(false);
    const sites = completed?.querySelector(".chat-websearch-sites");
    expect(sites?.classList.contains("chat-websearch-sites-scrolling")).toBe(true);
    expect(sites?.textContent).toContain("platform.openai.com");
    expect(sites?.textContent).toContain("developers.openai.com");
    expect(sites?.textContent).toContain("github.com");
    expect(sites?.textContent).not.toContain("https://");
    expect(sites?.getAttribute("title")).toBe(
      "platform.openai.com · developers.openai.com · github.com",
    );
  });
});







