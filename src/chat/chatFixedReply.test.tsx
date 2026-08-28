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

const invoke = mock<(command: string, args?: unknown) => Promise<unknown>>(
  () => Promise.resolve(undefined),
);
const listen = mock(() => Promise.resolve(() => {}));
let eventHandler: ((event: OpenCodeEvent) => void) | null = null;
const originalFetch = globalThis.fetch;
const OriginalEventSource = globalThis.EventSource;

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

describe("小著固定名字由来回复", () => {
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
      fireEvent.change(input, { target: { value: "给我一句慢回复" } });
    });
    await waitFor(() => expect((send as HTMLButtonElement).disabled).toBe(false));

    jest.useFakeTimers();
    await act(async () => {
      fireEvent.click(send);
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
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
            text: "这是超过两秒才到的内容",
          },
        },
      });
      await Promise.resolve();
    });
    expect(screen.getByText("这是超过两秒才到的内容")).toBeDefined();
    expect(document.querySelector(".chat-typing")).not.toBeNull();

    await act(async () => {
      receive({ type: "session.idle", properties: { sessionID: "ses_fixed" } });
      await Promise.resolve();
    });
    expect(document.querySelector(".chat-typing")).toBeNull();
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
    expect(document.querySelector(".chat-activity")?.textContent).toContain("读取文件");
    expect(document.querySelectorAll(".chat-msg-assistant .chat-bubble")).toHaveLength(1);
    expect(screen.getByText("正在思考..")).toBeDefined();
    expect(screen.getAllByText("正在输入..")).toHaveLength(1);
    expect(document.querySelector(".chat-typing")).not.toBeNull();
  });
});
