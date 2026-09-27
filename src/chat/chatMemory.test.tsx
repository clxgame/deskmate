import { catalogPageFixture, historyArgument, nativeHistoryFixture, registeredHistoryFixture } from "../testing/historyCatalogFixtures";
// allow: SIZE_OK — chat memory acceptance cases share one end-to-end ChatApp harness.
import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import * as tauriCore from "@tauri-apps/api/core";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

/**
 * Component tests for background registration, a clean chat surface and retrieval.
 *
 * The OpenCode transport and Tauri IPC are both mocked so the test drives the
 * real component without a sidecar or a database.
 */

const invoke = mock<(command: string, args?: unknown) => Promise<unknown>>(
  () => Promise.resolve(undefined),
);
const listen = mock(() => Promise.resolve(() => {}));
const originalFetch = globalThis.fetch;
const OriginalEventSource = globalThis.EventSource;

type PromptRequest = {
  readonly system?: string;
};

const promptRequests: PromptRequest[] = [];

// Keep the module's other exports (convertFileSrc, ...) so replacing invoke
// does not hide them from modules loaded later in the same process.
mock.module("@tauri-apps/api/core", () => ({ ...tauriCore, invoke }));
mock.module("@tauri-apps/api/event", () => ({
  listen,
  emit: () => Promise.resolve(),
}));

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

function installOpenCodeTransport(): void {
  const fetchMock = mock((input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input)).pathname;
    if (url.endsWith("/session") && init?.method === "GET") {
      return Promise.resolve(new Response(null, { status: 200 }));
    }
    if (url.endsWith("/session") && init?.method === "POST") {
      return Promise.resolve(jsonResponse({ id: "ses_1", title: "t", directory: "." }));
    }
    if (url.endsWith("/session/ses_1/prompt_async") && init?.method === "POST") {
      promptRequests.push(JSON.parse(String(init.body ?? "{}")) as PromptRequest);
      return Promise.resolve(new Response(null, { status: 204 }));
    }
    if (url.endsWith("/session/ses_1/abort") && init?.method === "POST") {
      return Promise.resolve(new Response(null, { status: 204 }));
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
    }

    close(): void {}
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
  personaId: "aimisi",
  mouseFollow: false,
  userName: "",
  memoryAutoExtract: false,
  memoryAiUse: true,
  updateRepo: "clxgame/deskmate",
};

const PERSONA = { persona: "你是爱弥斯。", skills: undefined, placeholders: null };

/** Route each command to its handler, defaulting to the real-ish response. */
function handleInvoke(handlers: Record<string, () => Promise<unknown>>) {
  invoke.mockImplementation((command: string, args?: unknown) => {
    if (handlers[command]) return handlers[command]();
    switch (command) {
      case "chat_model_resolve":
        return Promise.resolve({ configuredProviderId: "test-entry", sidecarId: "yume-2", modelId: "claude-sonnet-4.5", modelName: "Claude Sonnet 4.5" });
      case "history_model_selection_get":
        return Promise.resolve({ mode: "inherit" });
      case "history_model_selection_set":
        return Promise.resolve(undefined);
      case "history_recent_workspaces":
        return Promise.resolve([]);
      case "history_register_native_session":
        return Promise.resolve(registeredHistoryFixture({ sessionId: "ses_1", directory: "." }));
      case "history_catalog_list":
        return Promise.resolve(catalogPageFixture([nativeHistoryFixture("ses_old", ".", "旧会话")]));
      case "history_catalog_load": {
        const isOld = historyArgument(args, "key") === nativeHistoryFixture("ses_old").key;
        return Promise.resolve({ entry: nativeHistoryFixture(isOld ? "ses_old" : "ses_1", ".", isOld ? "旧会话" : "t"), messages: isOld ? [{ role: "user", text: "你好", time: 1 }] : [] });
      }
      case "history_catalog_mutate":
        return Promise.resolve(null);
      case "sidecar_base_url":
        return Promise.resolve("http://127.0.0.1:48888");
      case "get_settings":
        return Promise.resolve(SETTINGS);
      case "load_persona":
        return Promise.resolve(PERSONA);
      case "memory_context":
        return Promise.resolve({ memories: [], promptBlock: "" });
      case "history_save":
      case "hide_chat":
      case "open_settings":
        return Promise.resolve(undefined);
      default:
        return Promise.resolve(undefined);
    }
  });
}

/** Send a message so there is something to remember. */
async function sendMessage(text: string) {
  const user = userEvent.setup();
  const input = await screen.findByPlaceholderText("输入消息,Enter 发送");
  await user.type(input, text);
  const send = screen.getByRole("button", { name: "发送" });
  await waitFor(() => {
    expect((send as HTMLButtonElement).disabled).toBe(false);
  });
  await user.click(send);
  return user;
}

beforeEach(() => {
  invoke.mockReset();
  promptRequests.length = 0;
  handleInvoke({});
  installOpenCodeTransport();
});

afterEach(() => {
  cleanup();
  globalThis.fetch = originalFetch;
  globalThis.EventSource = OriginalEventSource;
});

describe("automatic memory in chat", () => {
  test("uses a saved nickname over the persona's default form of address", async () => {
    handleInvoke({
      get_settings: () => Promise.resolve({ ...SETTINGS, userName: "指挥官" }),
    });
    render(<ChatApp />);

    await sendMessage("帮我安排今天的工作");

    await waitFor(() => expect(promptRequests).toHaveLength(1));
    const system = promptRequests[0]?.system ?? "";
    expect(system).toContain("指挥官");
    expect(system).toContain("最高优先级");
    expect(system).toContain("覆盖角色设定中的默认称呼");
  });

  test("ordinary messages register in the background without per-message actions", async () => {
    render(<ChatApp />);
    await sendMessage("以后请用简短中文回答");
    await waitFor(() => expect(promptRequests).toHaveLength(1));
    expect(screen.queryByRole("button", { name: "记住这件事" })).toBeNull();
    expect(screen.queryByRole("button", { name: "保存到工作日志" })).toBeNull();
    expect(screen.queryByRole("button", { name: /安排周五/ })).toBeNull();
    const call = invoke.mock.calls.find(([name]) => name === "memory_register_turn");
    expect(call).toBeDefined();
    expect((call![1] as { registration: { sessionId: string } }).registration.sessionId).toBe("ses_1");
    expect(invoke.mock.calls.some(([name]) => name === "memory_create")).toBe(false);
  });

  test("background registration failure leaves normal chat usable", async () => {
    handleInvoke({ memory_register_turn: () => Promise.reject(new Error("unavailable")) });
    render(<ChatApp />);
    await sendMessage("继续聊吧");
    await waitFor(() => expect(promptRequests).toHaveLength(1));
    expect(screen.getByText("继续聊吧")).toBeDefined();
  });
});

describe("deleting a conversation", () => {
  test("by default it also drops memories that came only from it", async () => {
    invoke.mockReset();
    invoke.mockImplementation((command: string, args?: unknown) => {
      switch (command) {
      case "chat_model_resolve":
        return Promise.resolve({ configuredProviderId: "test-entry", sidecarId: "yume-2", modelId: "claude-sonnet-4.5", modelName: "Claude Sonnet 4.5" });
      case "history_model_selection_get":
        return Promise.resolve({ mode: "inherit" });
      case "history_model_selection_set":
        return Promise.resolve(undefined);
      case "history_recent_workspaces":
        return Promise.resolve([]);
        case "history_register_native_session":
        return Promise.resolve(registeredHistoryFixture({ sessionId: "ses_1", directory: "." }));
      case "history_catalog_list":
        return Promise.resolve(catalogPageFixture([nativeHistoryFixture("ses_old", ".", "旧会话")]));
      case "history_catalog_load": {
        const isOld = historyArgument(args, "key") === nativeHistoryFixture("ses_old").key;
        return Promise.resolve({ entry: nativeHistoryFixture(isOld ? "ses_old" : "ses_1", ".", isOld ? "旧会话" : "t"), messages: isOld ? [{ role: "user", text: "你好", time: 1 }] : [] });
      }
      case "history_catalog_mutate":
        return Promise.resolve(null);
      case "sidecar_base_url":
          return Promise.resolve("http://127.0.0.1:48888");
        case "get_settings":
          return Promise.resolve(SETTINGS);
        case "load_persona":
          return Promise.resolve(PERSONA);
        case "history_list":
          return Promise.resolve([
            { id: "ses_old", title: "旧会话", created: 1, updated: 2, count: 3 },
          ]);
        case "memory_forget_conversation":
          return Promise.resolve(1);
        default:
          return Promise.resolve(undefined);
      }
    });
    render(<ChatApp />);
    const user = userEvent.setup();

    await user.click(await screen.findByRole("button", { name: "历史" }));
    await user.click(await screen.findByRole("button", { name: "会话操作 旧会话" }));
    await user.click(screen.getByRole("button", { name: "删除" }));
    const option = await screen.findByLabelText(
      "同时删除仅由此对话产生的记忆",
    );
    expect((option as HTMLInputElement).checked).toBe(true);

    await user.click(screen.getByRole("button", { name: "永久删除" }));

    await waitFor(() => {
      const call = invoke.mock.calls.find(
        ([command]) => command === "memory_forget_conversation",
      );
      expect(call).toBeDefined();
      expect(call![1]).toEqual({ conversationId: "ses_old", catalogKey: nativeHistoryFixture("ses_old").key });
    });
  });

  test("unchecking the option leaves memories alone", async () => {
    invoke.mockReset();
    invoke.mockImplementation((command: string, args?: unknown) => {
      switch (command) {
      case "chat_model_resolve":
        return Promise.resolve({ configuredProviderId: "test-entry", sidecarId: "yume-2", modelId: "claude-sonnet-4.5", modelName: "Claude Sonnet 4.5" });
      case "history_model_selection_get":
        return Promise.resolve({ mode: "inherit" });
      case "history_model_selection_set":
        return Promise.resolve(undefined);
      case "history_recent_workspaces":
        return Promise.resolve([]);
        case "history_register_native_session":
        return Promise.resolve(registeredHistoryFixture({ sessionId: "ses_1", directory: "." }));
      case "history_catalog_list":
        return Promise.resolve(catalogPageFixture([nativeHistoryFixture("ses_old", ".", "旧会话")]));
      case "history_catalog_load": {
        const isOld = historyArgument(args, "key") === nativeHistoryFixture("ses_old").key;
        return Promise.resolve({ entry: nativeHistoryFixture(isOld ? "ses_old" : "ses_1", ".", isOld ? "旧会话" : "t"), messages: isOld ? [{ role: "user", text: "你好", time: 1 }] : [] });
      }
      case "history_catalog_mutate":
        return Promise.resolve(null);
      case "sidecar_base_url":
          return Promise.resolve("http://127.0.0.1:48888");
        case "get_settings":
          return Promise.resolve(SETTINGS);
        case "load_persona":
          return Promise.resolve(PERSONA);
        case "history_list":
          return Promise.resolve([
            { id: "ses_old", title: "旧会话", created: 1, updated: 2, count: 3 },
          ]);
        default:
          return Promise.resolve(undefined);
      }
    });
    render(<ChatApp />);
    const user = userEvent.setup();

    await user.click(await screen.findByRole("button", { name: "历史" }));
    await user.click(await screen.findByRole("button", { name: "会话操作 旧会话" }));
    await user.click(screen.getByRole("button", { name: "删除" }));
    await user.click(
      await screen.findByLabelText("同时删除仅由此对话产生的记忆"),
    );
    await user.click(screen.getByRole("button", { name: "永久删除" }));

    await waitFor(() => {
      expect(
        invoke.mock.calls.some(([command]) => command === "history_catalog_mutate"),
      ).toBe(true);
    });
    expect(
      invoke.mock.calls.some(
        ([command]) => command === "memory_forget_conversation",
      ),
    ).toBe(false);
  });
});

describe("resuming a conversation from history", () => {
  test("clicking a history row resumes it without a separate continue button", async () => {
    invoke.mockReset();
    invoke.mockImplementation((command: string, args?: unknown) => {
      switch (command) {
      case "chat_model_resolve":
        return Promise.resolve({ configuredProviderId: "test-entry", sidecarId: "yume-2", modelId: "claude-sonnet-4.5", modelName: "Claude Sonnet 4.5" });
      case "history_model_selection_get":
        return Promise.resolve({ mode: "inherit" });
      case "history_model_selection_set":
        return Promise.resolve(undefined);
      case "history_recent_workspaces":
        return Promise.resolve([]);
        case "history_register_native_session":
        return Promise.resolve(registeredHistoryFixture({ sessionId: "ses_1", directory: "." }));
      case "history_catalog_list":
        return Promise.resolve(catalogPageFixture([nativeHistoryFixture("ses_old", ".", "旧会话")]));
      case "history_catalog_load": {
        const isOld = historyArgument(args, "key") === nativeHistoryFixture("ses_old").key;
        return Promise.resolve({ entry: nativeHistoryFixture(isOld ? "ses_old" : "ses_1", ".", isOld ? "旧会话" : "t"), messages: isOld ? [{ role: "user", text: "你好", time: 1 }] : [] });
      }
      case "history_catalog_mutate":
        return Promise.resolve(null);
      case "sidecar_base_url":
          return Promise.resolve("http://127.0.0.1:48888");
        case "get_settings":
          return Promise.resolve(SETTINGS);
        case "load_persona":
          return Promise.resolve(PERSONA);
        case "history_list":
          return Promise.resolve([
            { id: "ses_old", title: "旧会话", created: 1, updated: 2, count: 1 },
          ]);
        case "history_load":
          return Promise.resolve({
            id: "ses_old",
            title: "旧会话",
            created: 1,
            updated: 2,
            messages: [{ role: "user", text: "你好" }],
          });
        default:
          return Promise.resolve(undefined);
      }
    });
    render(<ChatApp />);
    const user = userEvent.setup();

    await user.click(await screen.findByRole("button", { name: "历史" }));
    expect(screen.queryByRole("button", { name: "继续对话" })).toBeNull();

    await user.click(await screen.findByRole("button", { name: "打开 旧会话" }));

    expect(await screen.findByText("你好")).toBeDefined();
    expect(
      invoke.mock.calls.some(
        ([command, args]) =>
          command === "history_catalog_load" &&
          historyArgument(args, "key") === nativeHistoryFixture("ses_old").key,
      ),
    ).toBe(true);
  });
});

describe("memory retrieval on send", () => {
  test("a turn asks for context for the active persona", async () => {
    handleInvoke({});
    render(<ChatApp />);
    await sendMessage("你好");

    await waitFor(() => {
      const call = invoke.mock.calls.find(([command]) => command === "memory_context");
      expect(call).toBeDefined();
      const args = call![1] as { personaId: string; enabled: boolean };
      expect(args.personaId).toBe("aimisi");
      expect(args.enabled).toBe(true);
    });
  });

  test("disabling AI use stops the retrieval call entirely", async () => {
    invoke.mockReset();
    invoke.mockImplementation((command: string, args?: unknown) => {
      switch (command) {
      case "chat_model_resolve":
        return Promise.resolve({ configuredProviderId: "test-entry", sidecarId: "yume-2", modelId: "claude-sonnet-4.5", modelName: "Claude Sonnet 4.5" });
      case "history_model_selection_get":
        return Promise.resolve({ mode: "inherit" });
      case "history_model_selection_set":
        return Promise.resolve(undefined);
      case "history_recent_workspaces":
        return Promise.resolve([]);
        case "history_register_native_session":
        return Promise.resolve(registeredHistoryFixture({ sessionId: "ses_1", directory: "." }));
      case "history_catalog_list":
        return Promise.resolve(catalogPageFixture([nativeHistoryFixture("ses_old", ".", "旧会话")]));
      case "history_catalog_load": {
        const isOld = historyArgument(args, "key") === nativeHistoryFixture("ses_old").key;
        return Promise.resolve({ entry: nativeHistoryFixture(isOld ? "ses_old" : "ses_1", ".", isOld ? "旧会话" : "t"), messages: isOld ? [{ role: "user", text: "你好", time: 1 }] : [] });
      }
      case "history_catalog_mutate":
        return Promise.resolve(null);
      case "sidecar_base_url":
          return Promise.resolve("http://127.0.0.1:48888");
        case "get_settings":
          return Promise.resolve({ ...SETTINGS, memoryAiUse: false });
        case "load_persona":
          return Promise.resolve(PERSONA);
        default:
          return Promise.resolve(undefined);
      }
    });
    render(<ChatApp />);
    await sendMessage("你好");

    // The message went out (it is rendered), so the send path ran to
    // completion; retrieval was simply never requested.
    expect(await screen.findByText("你好")).toBeDefined();
    await waitFor(() => {
      expect(
        invoke.mock.calls.some(([command]) => command === "load_persona"),
      ).toBe(true);
    });
    expect(
      invoke.mock.calls.some(([command]) => command === "memory_context"),
    ).toBe(false);
  });
});
