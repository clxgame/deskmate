import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import * as tauriCore from "@tauri-apps/api/core";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

/**
 * Component tests for the chat memory surface: explicit save, inline receipt,
 * undo, forget, sensitive confirmation, and secret rejection.
 *
 * The OpenCode transport and Tauri IPC are both mocked so the test drives the
 * real component without a sidecar or a database.
 */

const invoke = mock<(command: string, args?: unknown) => Promise<unknown>>(
  () => Promise.resolve(undefined),
);
const listen = mock(() => Promise.resolve(() => {}));
const promptAsync = mock(
  (_sessionId: string, _text: string, _options?: { system?: string }) =>
    Promise.resolve(),
);

// Keep the module's other exports (convertFileSrc, ...) so replacing invoke
// does not hide them from modules loaded later in the same process.
mock.module("@tauri-apps/api/core", () => ({ ...tauriCore, invoke }));
mock.module("@tauri-apps/api/event", () => ({
  listen,
  emit: () => Promise.resolve(),
}));
mock.module("../lib/opencode", () => ({
  waitForServer: () => Promise.resolve(),
  createSession: () => Promise.resolve({ id: "ses_1", title: "t", directory: "." }),
  promptAsync,
  abortSession: () => Promise.resolve(),
  subscribeEvents: () => Promise.resolve(() => {}),
}));

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

function storedMemory(overrides: Record<string, unknown> = {}) {
  return {
    id: "m1",
    scope: "global",
    personaId: null,
    type: "identity",
    memoryKey: "identity.preferred_name",
    content: "以后叫我小林",
    status: "active",
    confidence: 1,
    importance: 3,
    sensitivity: "normal",
    sourceKind: "explicit",
    validFrom: "2026-01-01T00:00:00Z",
    expiresAt: null,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    revision: 1,
    supersedesId: null,
    ...overrides,
  };
}

/** Route each command to its handler, defaulting to the real-ish response. */
function handleInvoke(handlers: Record<string, () => Promise<unknown>>) {
  invoke.mockImplementation((command: string) => {
    if (handlers[command]) return handlers[command]();
    switch (command) {
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
  promptAsync.mockReset();
  promptAsync.mockImplementation(
    (_sessionId: string, _text: string, _options?: { system?: string }) =>
      Promise.resolve(),
  );
  handleInvoke({});
});

afterEach(cleanup);

describe("explicit memory controls in chat", () => {
  test("uses a saved nickname over the persona's default form of address", async () => {
    handleInvoke({
      get_settings: () => Promise.resolve({ ...SETTINGS, userName: "指挥官" }),
    });
    render(<ChatApp />);

    await sendMessage("帮我安排今天的工作");

    await waitFor(() => expect(promptAsync).toHaveBeenCalledTimes(1));
    const options = promptAsync.mock.calls[0]?.[2];
    expect(options?.system).toContain("指挥官");
    expect(options?.system).toContain("最高优先级");
    expect(options?.system).toContain("覆盖角色设定中的默认称呼");
  });

  test("saving a message shows an inline receipt with undo", async () => {
    handleInvoke({ memory_create: () => Promise.resolve(storedMemory()) });
    render(<ChatApp />);
    const user = await sendMessage("以后叫我小林");

    await user.click(await screen.findByRole("button", { name: "记住这件事" }));

    const receipt = await screen.findByText("已记住：以后叫我小林");
    expect(receipt).toBeDefined();
    expect(screen.getByRole("button", { name: "撤销" })).toBeDefined();

    const createCall = invoke.mock.calls.find(([command]) => command === "memory_create");
    expect(createCall).toBeDefined();
    const { memory } = createCall![1] as { memory: Record<string, unknown> };
    expect(memory.content).toBe("以后叫我小林");
    expect(memory.scope).toBe("global");
    expect(memory.type).toBe("identity");
    expect(memory.conversationId).toBe("ses_1");
  });

  test("undo removes the memory and the receipt", async () => {
    handleInvoke({
      memory_create: () => Promise.resolve(storedMemory()),
      memory_forget: () => Promise.resolve(undefined),
    });
    render(<ChatApp />);
    const user = await sendMessage("以后叫我小林");
    await user.click(await screen.findByRole("button", { name: "记住这件事" }));
    await screen.findByText("已记住：以后叫我小林");

    await user.click(screen.getByRole("button", { name: "撤销" }));

    await waitFor(() => {
      expect(screen.queryByText("已记住：以后叫我小林")).toBeNull();
    });
    expect(await screen.findByText("已撤销，这条记忆没有保存")).toBeDefined();
    expect(
      invoke.mock.calls.some(([command]) => command === "memory_forget"),
    ).toBe(true);
  });

  test("forgetting a saved memory reports it and clears the receipt", async () => {
    handleInvoke({
      memory_create: () => Promise.resolve(storedMemory()),
      memory_forget: () => Promise.resolve(undefined),
    });
    render(<ChatApp />);
    const user = await sendMessage("以后叫我小林");
    await user.click(await screen.findByRole("button", { name: "记住这件事" }));
    await screen.findByText("已记住：以后叫我小林");

    await user.click(screen.getByRole("button", { name: "忘掉相关记忆" }));

    expect(await screen.findByText("已忘掉这条记忆")).toBeDefined();
    await waitFor(() => {
      expect(screen.queryByText("已记住：以后叫我小林")).toBeNull();
    });
  });

  test("sensitive content is stored only after the disclosure is accepted", async () => {
    let attempts = 0;
    handleInvoke({
      memory_create: () => {
        attempts += 1;
        if (attempts === 1) {
          return Promise.reject({
            code: "SENSITIVE_CONFIRMATION_REQUIRED",
            message: "sensitive content needs explicit confirmation",
          });
        }
        return Promise.resolve(
          storedMemory({ content: "我讨厌被问月薪", sensitivity: "sensitive" }),
        );
      },
    });
    render(<ChatApp />);
    const user = await sendMessage("我讨厌被问月薪");
    await user.click(await screen.findByRole("button", { name: "记住这件事" }));

    // Nothing is saved yet: the user sees the local-storage disclosure first.
    expect(await screen.findByText("这条信息比较私密")).toBeDefined();
    expect(screen.queryByText(/^已记住：/)).toBeNull();

    await user.click(screen.getByRole("button", { name: "确认记住" }));

    expect(await screen.findByText("已记住：我讨厌被问月薪")).toBeDefined();
    const confirmed = invoke.mock.calls
      .filter(([command]) => command === "memory_create")
      .at(-1)![1] as { memory: Record<string, unknown> };
    expect(confirmed.memory.sensitiveConfirmed).toBe(true);
  });

  test("declining the disclosure stores nothing", async () => {
    handleInvoke({
      memory_create: () =>
        Promise.reject({
          code: "SENSITIVE_CONFIRMATION_REQUIRED",
          message: "sensitive content needs explicit confirmation",
        }),
    });
    render(<ChatApp />);
    const user = await sendMessage("我讨厌被问月薪");
    await user.click(await screen.findByRole("button", { name: "记住这件事" }));
    await screen.findByText("这条信息比较私密");

    await user.click(screen.getByRole("button", { name: "不记了" }));

    await waitFor(() => {
      expect(screen.queryByText("这条信息比较私密")).toBeNull();
    });
    expect(screen.queryByText(/^已记住：/)).toBeNull();
  });

  test("a secret is refused and never rendered back to the user", async () => {
    handleInvoke({
      memory_create: () =>
        Promise.reject({
          code: "SECRET_REJECTED",
          message: "credential-like content is never stored",
        }),
    });
    render(<ChatApp />);
    const user = await sendMessage("记住我的密码是 hunter2");
    await user.click(await screen.findByRole("button", { name: "记住这件事" }));

    expect(
      await screen.findByText("这看起来像密码或密钥，不会被保存"),
    ).toBeDefined();
    expect(screen.queryByText(/^已记住：/)).toBeNull();
    // The notice must not echo the credential.
    const notice = screen.getByText("这看起来像密码或密钥，不会被保存");
    expect(notice.textContent).not.toContain("hunter2");
  });

  test("a disabled memory store leaves chat usable and says so", async () => {
    handleInvoke({
      memory_create: () =>
        Promise.reject({
          code: "MEMORY_DISABLED",
          message: "memory storage is unavailable",
        }),
    });
    render(<ChatApp />);
    const user = await sendMessage("以后叫我小林");
    await user.click(await screen.findByRole("button", { name: "记住这件事" }));

    expect(
      await screen.findByText("记忆功能当前不可用，聊天不受影响"),
    ).toBeDefined();
    // The message itself is still in the conversation.
    expect(screen.getByText("以后叫我小林")).toBeDefined();
  });

  test("a stale revision surfaces the refresh notice instead of overwriting", async () => {
    handleInvoke({
      memory_create: () => Promise.resolve(storedMemory()),
      memory_forget: () =>
        Promise.reject({ code: "CONFLICT", message: "memory changed in another window" }),
    });
    render(<ChatApp />);
    const user = await sendMessage("以后叫我小林");
    await user.click(await screen.findByRole("button", { name: "记住这件事" }));
    await screen.findByText("已记住：以后叫我小林");

    await user.click(screen.getByRole("button", { name: "撤销" }));

    expect(
      await screen.findByText("这条记忆刚在别处被改过，已刷新为最新内容"),
    ).toBeDefined();
  });
});

describe("deleting a conversation", () => {
  test("by default it also drops memories that came only from it", async () => {
    invoke.mockReset();
    invoke.mockImplementation((command: string) => {
      switch (command) {
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
    const option = await screen.findByLabelText(
      "同时删除仅由此对话产生的记忆",
    );
    expect((option as HTMLInputElement).checked).toBe(true);

    await user.click(screen.getByRole("button", { name: "删除" }));

    await waitFor(() => {
      const call = invoke.mock.calls.find(
        ([command]) => command === "memory_forget_conversation",
      );
      expect(call).toBeDefined();
      expect(call![1]).toEqual({ conversationId: "ses_old" });
    });
  });

  test("unchecking the option leaves memories alone", async () => {
    invoke.mockReset();
    invoke.mockImplementation((command: string) => {
      switch (command) {
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
    await user.click(
      await screen.findByLabelText("同时删除仅由此对话产生的记忆"),
    );
    await user.click(screen.getByRole("button", { name: "删除" }));

    await waitFor(() => {
      expect(
        invoke.mock.calls.some(([command]) => command === "history_delete"),
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
    invoke.mockImplementation((command: string) => {
      switch (command) {
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

    await user.click(await screen.findByRole("button", { name: /旧会话/ }));

    expect(await screen.findByText("你好")).toBeDefined();
    expect(
      invoke.mock.calls.some(
        ([command, args]) =>
          command === "history_load" &&
          (args as { id?: string } | undefined)?.id === "ses_old",
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
    invoke.mockImplementation((command: string) => {
      switch (command) {
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
